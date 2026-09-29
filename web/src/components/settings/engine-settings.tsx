"use client";

import { useEffect, useState, useRef } from "react";
import { Check, Cpu, ExternalLink, KeyRound, Search } from "lucide-react";
import { engineConnectionChanged } from "@/components/engine-provider";
import { PanelHeader } from "./primitives";
import { providers, type Connection, type EngineState, type Login, type ProviderID } from "@/lib/engine/catalog";
import { getEngineState, connectEngineAPI, refreshEngineAPI, startEngineLogin, completeEngineLogin, disconnectEngine, selectEngine } from "@/app/actions/engine";
const button = "rounded-full border border-wa-border px-4 py-2 text-sm transition hover:bg-wa-hover disabled:opacity-50 disabled:cursor-not-allowed";
const input = "w-full rounded-xl border border-wa-border bg-wa-bg px-3 py-2.5 text-sm outline-none focus:border-wa-green";

export function EngineSettings() {
  const [state,setState] = useState<EngineState>({connections:{},selected:null});
  const [loading,setLoading] = useState(true);
  const [busy,setBusy] = useState<string|null>(null);
  const working = useRef(false);
  const [error,setError] = useState("");
  const [message,setMessage] = useState("");
  const [query,setQuery] = useState("");
  const [expanded,setExpanded] = useState<ProviderID|null>(null);
  const [key,setKey] = useState("");
  const [code,setCode] = useState("");
  const [login,setLogin] = useState<Login|null>(null);
  const [models,setModels] = useState<Partial<Record<ProviderID,string>>>({});
  useEffect(()=>{
    let active=true;
    getEngineState().then(result=>{if(!active)return;if(result.error)setError(result.error);else if(result.data)setState(result.data);setLoading(false);}).catch(()=>{if(active){setLoading(false);setError("Could not load Engine. Refresh to try again.");}});
    return ()=>{active=false;};
  },[]);
  async function act(label:string,fn:()=>Promise<void>) {
    if(working.current)return;
    working.current=true;setBusy(label);setError("");setMessage("");
    try{await fn();engineConnectionChanged();}catch(e){setError(e instanceof Error?e.message:"Connection failed. Try again.");}
    finally{working.current=false;setBusy(null);}
  }
  function update(id:ProviderID,connection:Connection) {setState(old=>({...old,connections:{...old.connections,[id]:connection}}));}
  async function refresh() {
    const result=await getEngineState();if(result.error)throw new Error(result.error);
    if(result.data){setState(result.data);if(login && result.data.connections[login.provider]?.connected){setLogin(null);setCode("");setMessage("Account connected. Choose a model below.");}else if(login){setMessage("Waiting for sign-in. Complete the provider's login, then check again.");}}
  }
  const selectedProvider=providers.find(p=>p.id===state.selected?.provider);
  const visible=providers.filter(p=>`${p.name} ${p.description} ${p.mode}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="wa-scroll flex h-full flex-col overflow-y-auto">
    <PanelHeader title="Engine" backHref="/settings" />
    <div className="space-y-5 px-5 pb-8">
      <p className="text-[15px] leading-relaxed text-wa-muted">Connect an AI provider and choose the model for your engine.</p>
      <div className="rounded-2xl border border-wa-border p-4">
        <div className="flex items-center gap-2 font-medium"><Cpu size={19}/>Selected engine</div>
        <p className="mt-2 break-words text-sm text-wa-muted">{loading?"Loading connections…":state.selected?`${selectedProvider?.name} · ${state.selected.model}`:"No engine selected"}</p>
        <p className="mt-2 text-xs text-wa-muted">Your account’s bots use this engine for chat, voice replies and screen teaching.</p>
      </div>
      <label className="flex items-center gap-2 rounded-full border border-wa-border px-4 py-2.5"><Search size={18} className="text-wa-muted"/><input aria-label="Search AI providers" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search providers" className="w-full bg-transparent text-sm outline-none"/></label>
      {error&&<p role="alert" className="rounded-xl bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {message&&<p role="status" className="text-sm text-wa-accent">{message}</p>}
      {login&&<div className="space-y-3 rounded-2xl border border-wa-green p-4">
        <h2 className="font-medium">Finish {login.provider==="codex"?"Codex":"Claude Code"} sign-in</h2>
        <p className="text-sm text-wa-muted">Sign in to your own account in the provider’s window. This request expires after a few minutes.</p>
        {login.code&&<div><p className="text-xs text-wa-muted">Enter this device code on the provider’s page</p><code className="mt-1 block select-all text-xl tracking-widest">{login.code}</code></div>}
        <a href={login.url} target="_blank" rel="noopener noreferrer" className={`${button} inline-flex items-center gap-2`}>Open sign-in <ExternalLink size={14}/></a>
        {login.provider==="claude-code"&&<form onSubmit={e=>{e.preventDefault();void act("complete",async()=>{const result=await completeEngineLogin(code);setCode("");if(result.error)throw new Error(result.error);if(result.data)update("claude-code",result.data);setLogin(null);setMessage("Claude Code connected. Choose a model below.");});}} className="space-y-2">
          <label className="block text-sm" htmlFor="claude-code">Confirmation code from Claude</label><input id="claude-code" type="password" autoComplete="off" value={code} onChange={e=>setCode(e.target.value)} className={input}/><button disabled={!!busy||!code.trim()} className={button}>Complete sign-in</button>
        </form>}
        <div className="flex flex-wrap gap-2"><button disabled={!!busy} className={button} onClick={()=>void act("refresh",refresh)}>Check connection</button><button disabled={!!busy} className={button} onClick={()=>void act("cancel",async()=>{const result=await disconnectEngine(login.provider);if(result.error)throw new Error(result.error);setLogin(null);setCode("");})}>Cancel sign-in</button></div>
      </div>}
      <div className="space-y-3">{visible.map(provider=>{
        const connection=state.connections[provider.id];const connected=!!connection?.connected;const open=expanded===provider.id;
        const model=models[provider.id] || (state.selected?.provider===provider.id?state.selected.model:connection?.models[0]?.id) || "";
        return <section key={provider.id} className="rounded-2xl border border-wa-border p-4">
          <button type="button" onClick={()=>{setExpanded(open?null:provider.id);setKey("");}} aria-expanded={open} className="flex w-full items-start justify-between gap-3 text-left">
            <div><h2 className="text-base font-medium">{provider.name}</h2><p className="mt-1 text-xs text-wa-muted">{provider.mode==="subscription"?"Subscription login":"API key"}</p></div>
            <span className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-xs ${connected?"bg-wa-green/10 text-wa-accent":"bg-wa-hover text-wa-muted"}`}>{connected?<><Check size={12}/>Connected</>:"Not connected"}</span>
          </button>
          {open&&<div className="mt-4 space-y-3">
            <p className="text-sm leading-relaxed text-wa-muted">{provider.description}</p>
            {connection?.account&&<p className="break-words text-sm">{connection.account}</p>}
            {connection?.error&&<p className="text-sm text-red-500">{connection.error}</p>}
            {provider.mode==="api"&&<form className="space-y-2" onSubmit={e=>{e.preventDefault();void act(provider.id,async()=>{const result=await connectEngineAPI(provider.id,key.trim());setKey("");if(result.error)throw new Error(result.error);if(result.data)update(provider.id,result.data);setMessage("API key verified and saved. Choose a model below.");});}}>
              <label htmlFor={`key-${provider.id}`} className="flex items-center gap-2 text-sm"><KeyRound size={14}/>{connected?"Replace API key":"API key"}</label>
              <input id={`key-${provider.id}`} type="password" autoComplete="off" spellCheck={false} value={key} onChange={e=>setKey(e.target.value)} placeholder={connected?"Enter a new key to replace the saved key":"Paste your provider API key"} className={input}/>
              <button disabled={loading||!!busy||!key.trim()} className={button}>{busy===provider.id?"Connecting…":"Verify and save"}</button>
            </form>}
            {provider.mode==="subscription"&&!connected&&<button disabled={loading||!!busy||!!login} className={`${button} bg-wa-green text-black`} onClick={()=>void act(provider.id,async()=>{const result=await startEngineLogin(provider.id);if(result.error)throw new Error(result.error);if(result.data)setLogin(result.data);})}>{busy===provider.id?"Starting sign-in…":provider.id==="codex"?"Sign in with ChatGPT":"Sign in with Claude"}</button>}
            {provider.id==="claude-code"&&<p className="text-xs leading-relaxed text-wa-muted">Uses the official Claude Code client. Subscription access depends on your account and Anthropic’s current rules; included Max usage is not guaranteed for third-party apps. <a className="underline" href="https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan" target="_blank" rel="noopener noreferrer">Usage details</a></p>}
            {connected&&<>
              <label className="block text-sm" htmlFor={`model-${provider.id}`}>Model</label>
              <select id={`model-${provider.id}`} className={input} value={model} onChange={e=>setModels(old=>({...old,[provider.id]:e.target.value}))}>{connection.models.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select>
              <div className="flex flex-wrap gap-2"><button disabled={!!busy||!model} className={`${button} bg-wa-green text-black`} onClick={()=>void act(provider.id,async()=>{const result=await selectEngine(provider.id,model);if(result.error)throw new Error(result.error);if(result.data)setState(old=>({...old,selected:result.data}));setMessage("Default engine saved.");})}>Use this engine</button>
              <button disabled={!!busy} className={button} onClick={()=>void act(provider.id,async()=>{if(provider.mode==="subscription"){await refresh();}else{const result=await refreshEngineAPI(provider.id);if(result.error)throw new Error(result.error);if(result.data)update(provider.id,result.data);}setMessage("Connection checked; models refreshed.");})}>Check connection</button>
              <button disabled={!!busy} className={button} onClick={()=>void act(provider.id,async()=>{const result=await disconnectEngine(provider.id);if(result.error)throw new Error(result.error);update(provider.id,{connected:false,models:[]});setState(old=>({...old,selected:old.selected?.provider===provider.id?null:old.selected}));setMessage("Provider disconnected.");})}>Disconnect</button></div>
            </>}
          </div>}
        </section>;
      })}</div>
      {!visible.length&&<p className="py-4 text-center text-sm text-wa-muted">No providers found.</p>}
      <p className="text-xs leading-relaxed text-wa-muted">API providers bill separately from subscriptions. Connection checks list models without generating a paid response. Credentials stay on the server and are never returned to this page.</p>
    </div>
  </div>;
}
