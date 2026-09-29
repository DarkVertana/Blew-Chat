"use server";

import { getCurrentUser } from "@/lib/auth";
import { providerByID, type EngineState, type Login, type ProviderID } from "@/lib/engine/catalog";
import { readConfig, writeConfig, withEngineLock } from "@/lib/engine/store";
import { listAPIModels } from "@/lib/engine/api-providers";
import { codexStatus, claudeStatus, startCodex, startClaude, completeClaude, disconnectClient } from "@/lib/engine/clients";

import type { EngineHealth } from "@/lib/engine/health";

type Result<T> = { data: T; error?: never } | { error: string; data?: never };
async function authorized<T>(fn: (id: number) => Promise<T>): Promise<Result<T>> {
  const user = await getCurrentUser();
  if (!user) return {error:"Please sign in again."};
  try {
    return {data: await withEngineLock(user.id, async () => {
      // Recheck after waiting for an earlier operation (logout may have occurred).
      const { api } = await import("@/lib/api");
      const { getSessionToken } = await import("@/lib/session");
      await api("/api/auth/me", {token:await getSessionToken()});
      return fn(user.id);
    })};
  } catch(e) {
    const message = e instanceof Error ? e.message : "";
    // Never forward filesystem, subprocess output or network diagnostics containing credentials.
    const safe = /^(Choose |Enter |The provider |Provider |No models |This provider |Codex |Claude |Engine login |Sign-in |Connect |That model |The selected )/.test(message);
    return {error:safe ? message : "Could not update Engine. Check the connection and try again."};
  }
}
async function state(userID: number): Promise<EngineState> {
  const config = await readConfig(userID);
  const connections: EngineState["connections"] = {};
  for (const [id,value] of Object.entries(config.keys)) if(value) connections[id as ProviderID] = {connected:true,models:value.models};
  const subscriptions = await Promise.allSettled([codexStatus(userID),claudeStatus(userID)]);
  for (const [i,id] of (["codex","claude-code"] as const).entries()) {
    const result = subscriptions[i];
    connections[id] = result.status === "fulfilled" ? result.value : {connected:false,models:[],error:"Login service is unavailable. Please try again."};
  }
  return {connections,selected:config.selected};
}
export async function getEngineState() { return authorized(state); }
export async function connectEngineAPI(id: string, key: string) {
  return authorized(async userID => {
    const provider = providerByID(id);
    if(provider.mode!=="api") throw new Error("This provider uses subscription login.");
    const models = await listAPIModels(provider.id,key);
    const config = await readConfig(userID);
    config.keys[provider.id] = {key,models};
    await writeConfig(userID,config);
    healthCache.delete(userID);
    return {connected:true,models};
  });
}
export async function refreshEngineAPI(id: string) {
  return authorized(async userID => {
    const provider = providerByID(id);
    const config = await readConfig(userID);
    const saved = config.keys[provider.id];
    if(!saved) throw new Error("Connect this provider first.");
    saved.models = await listAPIModels(provider.id,saved.key);
    await writeConfig(userID,config);
    healthCache.delete(userID);
    return {connected:true,models:saved.models};
  });
}
export async function startEngineLogin(id: string): Promise<Result<Login>> {
  return authorized(async userID => {
    providerByID(id);
    if(id==="codex") return startCodex(userID);
    if(id==="claude-code") return startClaude(userID);
    throw new Error("This provider uses an API key.");
  });
}
export async function completeEngineLogin(code: string) {
  return authorized(async userID => {await completeClaude(userID,code);healthCache.delete(userID);return claudeStatus(userID);});
}
export async function disconnectEngine(id: string) {
  return authorized(async userID => {
    const provider = providerByID(id);
    if(provider.id==="codex" || provider.id==="claude-code") await disconnectClient(userID,provider.id);
    const config = await readConfig(userID);
    delete config.keys[provider.id];
    if(config.selected?.provider===provider.id) config.selected=null;
    await writeConfig(userID,config);
    healthCache.delete(userID);
    return null;
  });
}
export async function selectEngine(id: string, model: string) {
  return authorized(async userID => {
    const provider = providerByID(id);
    const config = await readConfig(userID);
    const connection = provider.id==="codex" ? await codexStatus(userID) : provider.id==="claude-code" ? await claudeStatus(userID) : {connected:!!config.keys[provider.id],models:config.keys[provider.id]?.models || []};
    if(!connection.connected) throw new Error("Connect this provider first.");
    if(typeof model!=="string" || !connection.models.some(m=>m.id===model)) throw new Error("That model is unavailable. Refresh the connection.");
    config.selected={provider:provider.id,model};
    await writeConfig(userID,config);
    healthCache.delete(userID);
    return config.selected;
  });
}

const healthGlobal = globalThis as typeof globalThis & { blewEngineHealth?: Map<number,{time:number;health:EngineHealth}> };
const healthCache = healthGlobal.blewEngineHealth ??= new Map();
export async function getEngineHealth(force = false) {
  return authorized(async userID => {
    const config = await readConfig(userID);
    if(!config.selected) return {status:"unconfigured"} as EngineHealth;
    const cached = healthCache.get(userID);
    if(!force && cached && Date.now()-cached.time<60000) return cached.health;
    const provider = providerByID(config.selected.provider);
    let health: EngineHealth;
    try {
      if(provider.id === "codex" || provider.id === "claude-code") {
        const connection = await (provider.id === "codex" ? codexStatus(userID) : claudeStatus(userID));
        health = {status:connection.connected?"connected":"expired",provider:provider.name};
      } else {
        const saved = config.keys[provider.id];
        if(!saved) health = {status:"expired",provider:provider.name};
        else { await listAPIModels(provider.id,saved.key); health={status:"connected",provider:provider.name}; }
      }
    } catch(e) {
      health={status:e instanceof Error && (e.message.startsWith("The provider rejected") || e.message.startsWith("Codex sign-in expired"))?"expired":"unavailable",provider:provider.name};
    }
    if(healthCache.size>1000) healthCache.clear();
    healthCache.set(userID,{time:Date.now(),health});
    return health;
  });
}
