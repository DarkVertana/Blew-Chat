import { spawn, execFile, type ChildProcessWithoutNullStreams } from "node:child_process";
import { promisify } from "node:util";
import { createInterface } from "node:readline";
import { mkdir, rm, readFile } from "node:fs/promises";
import path from "node:path";
import { claudeCredentialExpired } from "./health.ts";
import { userDirectory } from "./store.ts";
import type { Connection, EngineModel, Login } from "./catalog.ts";
const run = promisify(execFile);
async function environment(userID: number, provider: string) {
  const home = path.join(await userDirectory(userID), provider);
  await mkdir(home, { recursive: true, mode: 0o700 });
  // Do not inherit host credentials, API keys, plugins or project configuration.
  return { home, env: { NODE_ENV: "production" as const, PATH: process.env.PATH, HOME: home, CODEX_HOME: home, CLAUDE_CONFIG_DIR: home, LANG: "C.UTF-8", NO_COLOR: "1" } };
}
type RPC = {
  process: ChildProcessWithoutNullStreams;
  listeners: Set<(message: {method?:string;params?:unknown})=>void>;
  request: <T>(method: string, params: unknown) => Promise<T>;
  close: () => void;
  login?: Login;
  loginID?: string;
  loginError?: string;
  timer?: NodeJS.Timeout;
};
type ClaudeLogin = { process: ChildProcessWithoutNullStreams; url?: string; timer: NodeJS.Timeout; finished: Promise<void> };
const globals = globalThis as typeof globalThis & { blewCodex?: Map<number, Promise<RPC>>; blewClaude?: Map<number, ClaudeLogin> };
const codexClients = globals.blewCodex ??= new Map();
const claudeLogins = globals.blewClaude ??= new Map();
async function codex(userID: number): Promise<RPC> {
  const existing = codexClients.get(userID);
  if (existing) return existing;
  if (codexClients.size >= 32) throw new Error("Engine login is busy. Please try again later.");
  const promise = (async () => {
    const {home,env} = await environment(userID, "codex");
    const child = spawn("codex", ["app-server", "-c", 'cli_auth_credentials_store="file"'], { env, cwd: home, stdio: "pipe" });
    const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
    let nextID = 0;
    const fail = () => {
      clearTimeout(client.timer);
      for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error("Codex stopped. Reconnect and try again.")); }
      pending.clear();
      if (codexClients.get(userID) === promise) codexClients.delete(userID);
    };
    const client: RPC = {
      process: child,
      listeners: new Set(),
      request<T>(method: string, params: unknown) {
        clearTimeout(client.timer);
        client.timer = setTimeout(() => client.close(), 15 * 60 * 1000); client.timer.unref();
        return new Promise<T>((resolve,reject) => {
          const id = ++nextID;
          const timer = setTimeout(() => { pending.delete(id); reject(new Error("Codex did not respond. Try again.")); }, 20000);
          pending.set(id, { resolve: v => resolve(v as T), reject, timer });
          child.stdin.write(JSON.stringify({id,method,params}) + "\n", err => { if (err) { clearTimeout(timer); pending.delete(id); reject(new Error("Codex connection closed.")); } });
        });
      },
      close() { child.kill(); fail(); },
    };
    child.on("error", fail); child.on("exit", fail);
    child.stdin.on("error", () => {});
    child.stderr.resume(); // Never log tokens, login URLs or provider responses.
    createInterface({ input: child.stdout }).on("line", line => {
      try {
        const message = JSON.parse(line);
        if (message.id !== undefined && !message.method && pending.has(message.id)) {
          const p = pending.get(message.id)!; pending.delete(message.id); clearTimeout(p.timer);
          if (message.error) {
            const expired = /invalid_grant|refresh.{0,60}(expired|revoked|reused|invalid)|not authenticated|unauthorized/i.test(String(message.error.message));
            p.reject(new Error(expired ? "Codex sign-in expired. Reconnect your account." : "Codex rejected the request. Check account access and device-code login permissions."));
          } else p.resolve(message.result);
        } else if (message.id !== undefined && message.method) {
          // This runtime handles chat only. Linux tasks use the separate,
          // explicitly approved companion queue, never this shared server.
          child.stdin.write(JSON.stringify({id:message.id,error:{code:-32601,message:"Computer tools are not available in this chat runtime."}})+"\n");
        } else if (message.method === "account/login/completed") {
          client.login = undefined; client.loginID = undefined;
          client.loginError = message.params?.success ? undefined : "Sign-in did not complete. Please try again.";
        }
        for (const listener of client.listeners) listener(message);
      } catch { /* Ignore non-protocol startup output. */ }
    });
    try { await client.request("initialize", { clientInfo: { name: "blew_code", title: "Blew Chats", version: "0.1.0" } }); }
    catch(e) { client.close(); throw e; }
    child.stdin.write(JSON.stringify({method:"initialized",params:{}}) + "\n");
    return client;
  })();
  codexClients.set(userID, promise);
  try { return await promise; } catch (e) { codexClients.delete(userID); throw e; }
}
export async function codexStatus(userID: number): Promise<Connection> {
  const client = await codex(userID);
  const result = await client.request<{ account: null | { type: string; email?: string; planType?: string } }>("account/read", { refreshToken: true });
  if (result.account?.type !== "chatgpt") return {connected:false,models:[],error:client.loginError};
  const models = await client.request<{ data: {id:string;model:string;displayName:string}[] }>("model/list", {});
  return {connected:true,account:[result.account.email,result.account.planType].filter(Boolean).join(" · "),models:models.data.map(m => ({id:m.model || m.id,name:m.displayName || m.model}))};
}
export async function startCodex(userID: number): Promise<Login> {
  const client = await codex(userID);
  if (client.login) return client.login;
  client.loginError = undefined;
  const result = await client.request<{loginId:string;verificationUrl:string;userCode:string}>("account/login/start", {type:"chatgptDeviceCode"});
  const url = new URL(result.verificationUrl);
  if (url.protocol !== "https:" || url.hostname !== "auth.openai.com") { client.close(); throw new Error("Codex returned an unexpected sign-in URL."); }
  client.loginID = result.loginId;
  client.login = {provider:"codex",url:url.toString(),code:result.userCode};
  return client.login;
}
export async function claudeStatus(userID: number): Promise<Connection> {
  const {home,env} = await environment(userID, "claude-code");
  try {
    const {stdout} = await run("claude", ["auth","status","--json"], {env,cwd:home,timeout:10000,maxBuffer:32768});
    const status = JSON.parse(stdout);
    if (!status.loggedIn || status.authMethod !== "claude.ai") return {connected:false,models:[]};
    try {
      const credentials = JSON.parse(await readFile(path.join(home, ".credentials.json"), "utf8"));
      if (claudeCredentialExpired(credentials)) return {connected:false,models:[]};
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    const models: EngineModel[] = ["sonnet","opus","haiku"].map(id => ({id,name:id[0].toUpperCase()+id.slice(1)}));
    return {connected:true,models,account:[status.email,status.subscriptionType].filter(Boolean).join(" · ")};
  } catch (e) {
    if ((e as {code?:unknown}).code === 1) return {connected:false,models:[]};
    throw new Error("Claude Code is unavailable. Check the server installation.");
  }
}
export async function startClaude(userID: number): Promise<Login> {
  const existing = claudeLogins.get(userID);
  if (existing?.url) return {provider:"claude-code",url:existing.url};
  if (claudeLogins.size >= 32) throw new Error("Engine login is busy. Try again later.");
  const {home,env} = await environment(userID, "claude-code");
  const child = spawn("claude", ["auth","login","--claudeai"], {env,cwd:home,stdio:"pipe"});
  let finish!: () => void;
  const entry: ClaudeLogin = {process:child,finished:new Promise(resolve => {finish=resolve;}),timer:setTimeout(() => child.kill(), 10*60*1000)};
  entry.timer.unref(); claudeLogins.set(userID,entry);
  return new Promise<Login>((resolve,reject) => {
    let output = "";
    const deadline = setTimeout(() => {child.kill();reject(new Error("Claude login timed out. Try again."));},20000);
    const done = () => { clearTimeout(entry.timer);clearTimeout(deadline); if(claudeLogins.get(userID)===entry) claudeLogins.delete(userID);finish(); if(!entry.url) reject(new Error("Claude login could not start. Try again.")); };
    child.on("exit",done); child.on("error",done); child.stdin.on("error",()=>{});
    const receive = (data: Buffer) => {
      output = (output + data.toString()).slice(-16384);
      const found = output.match(/https:\/\/(?:claude\.com|claude\.ai)\/[^\s\x1b]+/);
      if (!found || entry.url) return;
      const url = new URL(found[0]);
      entry.url = url.toString(); clearTimeout(deadline);
      resolve({provider:"claude-code",url:entry.url});
      output = "";
    };
    child.stdout.on("data",receive);child.stderr.on("data",receive);
  });
}
export async function completeClaude(userID: number, code: string) {
  if(typeof code!=="string" || !code.trim() || code.length>4096 || /[\r\n\x00]/.test(code)) throw new Error("Enter the confirmation code from Claude.");
  const login = claudeLogins.get(userID);
  if(!login) throw new Error("Sign-in expired. Start again.");
  login.process.stdin.write(code.trim()+"\n");
  let timer: NodeJS.Timeout | undefined;
  try { await Promise.race([login.finished,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error("Claude is still completing sign-in. Refresh the connection status shortly.")),15000);})]); }
  finally {clearTimeout(timer);}
  const status = await claudeStatus(userID);
  if (!status.connected) throw new Error("Claude did not accept that sign-in. Start again.");
}
export async function disconnectClient(userID:number,provider:"codex"|"claude-code") {
  if(provider === "codex") {
    const client = await codex(userID);
    if(client.loginID) await client.request("account/login/cancel",{loginId:client.loginID});
    await client.request("account/logout",{}); client.close();
  } else {
    const pending = claudeLogins.get(userID);
    if(pending) {pending.process.kill();await pending.finished;}
    const {home,env} = await environment(userID,provider);
    await run("claude",["auth","logout"],{cwd:home,env,timeout:10000,maxBuffer:32768});
  }
  // Remove only the current account's provider-specific credentials.
  await rm(path.join(await userDirectory(userID),provider),{recursive:true,force:true});
}


export async function generateCodexReply(userID:number,model:string,instructions:string,prompt:string,image?:string):Promise<string> {
  const client=await codex(userID);
  const workspace=path.join(await userDirectory(userID),"chat-workspace");
  await mkdir(workspace,{recursive:true,mode:0o700});
  const result=await client.request<{thread:{id:string}}>("thread/start",{
    model,cwd:workspace,ephemeral:true,approvalPolicy:"never",sandbox:"read-only",
    baseInstructions:instructions,
    config:{"features.shell_tool":false,"features.unified_exec":false,"features.apply_patch_freeform":false,"web_search":"disabled"},
  });
  const threadID=result.thread.id;
  let turnID:string|undefined;
  let text="";
  let timer:NodeJS.Timeout|undefined;
  let listener:(message:{method?:string;params?:unknown})=>void;
  try {
    return await new Promise<string>((resolve,reject)=>{
      listener=message=>{
        const params=message.params as {threadId?:string;delta?:string;item?:{type?:string;text?:string};turn?:{id:string;status:string;error?:unknown}}|undefined;
        if(params?.threadId!==threadID)return;
        if(message.method==="item/agentMessage/delta")text+=params.delta||"";
        if(text.length>400000){if(turnID)void client.request("turn/interrupt",{threadId:threadID,turnId:turnID}).catch(()=>{});reject(new Error("The engine response was too large."));return;}
        if(message.method==="item/completed"&&params.item?.type==="agentMessage"&&params.item.text)text=params.item.text;
        if(message.method==="turn/completed") {
          if(params.turn?.status==="completed"&&text.trim())resolve(text);
          else reject(new Error("The engine could not finish its reply. Check its login or usage limits, then retry."));
        }
      };
      client.listeners.add(listener);
      timer=setTimeout(()=>{if(turnID)void client.request("turn/interrupt",{threadId:threadID,turnId:turnID}).catch(()=>{});reject(new Error("The engine took too long. Please retry."));},180000);
      void client.request<{turn:{id:string}}>("turn/start",{
        threadId:threadID,model,input:[{type:"text",text:prompt},...(image?[{type:"image",url:image}]:[])],approvalPolicy:"never",
        sandboxPolicy:{type:"readOnly",access:{type:"restricted",includePlatformDefaults:true,readableRoots:[workspace]}},
      }).then(r=>{turnID=r.turn.id;}).catch(reject);
    });
  } finally {
    clearTimeout(timer);client.listeners.delete(listener!);
    void client.request("thread/archive",{threadId:threadID}).catch(()=>{});
  }
}
export async function generateClaudeReply(userID:number,model:string,instructions:string,prompt:string,image?:string):Promise<string> {
  const {home,env}=await environment(userID,"claude-code");
  const workspace=path.join(await userDirectory(userID),"chat-workspace");
  await mkdir(workspace,{recursive:true,mode:0o700});
  const {writeFile,unlink}=await import("node:fs/promises");
  const {randomUUID}=await import("node:crypto");
  const file=path.join(home,`prompt-${randomUUID()}.txt`);
  await writeFile(file,instructions,{mode:0o600});
  try {
    const child=run("claude",["-p","--input-format","stream-json","--output-format","stream-json","--verbose","--model",model,"--system-prompt-file",file,"--tools","","--strict-mcp-config","--mcp-config",'{"mcpServers":{}}',"--disable-slash-commands","--setting-sources","","--no-session-persistence"],{cwd:workspace,env,timeout:180000,maxBuffer:1024*1024});
    child.child.stdin?.end(JSON.stringify({type:"user",message:{role:"user",content:[{type:"text",text:prompt},...(image?[{type:"image",source:{type:"base64",media_type:image.slice(5,image.indexOf(";")),data:image.split(",")[1]}}]:[])]}})+"\n");
    const {stdout}=await child;
    const result=stdout.trim().split("\n").map(line=>JSON.parse(line)).findLast(item=>item.type==="result");
    if(!result||result.is_error||typeof result.result!=="string"||!result.result.trim())throw new Error("empty reply");
    return result.result;
  } catch {throw new Error("Claude could not finish its reply. Check its login or usage limits, then retry.");}
  finally {await unlink(file).catch(()=>{});}
}
