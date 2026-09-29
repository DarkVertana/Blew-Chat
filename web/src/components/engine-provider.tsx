"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { getEngineHealth } from "@/app/actions/engine";
import type { EngineHealth } from "@/lib/engine/health";
const EngineContext = createContext<EngineHealth|null>(null);
export function engineConnectionChanged() { window.dispatchEvent(new Event("blew-engine-updated")); }
export function useEngineHealth() { return useContext(EngineContext); }
export function EngineProvider({children}:{children:ReactNode}) {
  const [health,setHealth] = useState<EngineHealth|null>(null);
  const working = useRef(false);
  const queued = useRef(false);
  const mounted = useRef(true);
  const refresh = useCallback(async function refresh(force=false){
    if(working.current){queued.current ||= force;return;}
    working.current=true;
    try {const result=await getEngineHealth(force);if(mounted.current)setHealth(result.data || {status:"unavailable"});}
    catch {if(mounted.current)setHealth({status:"unavailable"});}
    finally {working.current=false;if(queued.current&&mounted.current){queued.current=false;void refresh(true);}}
  },[]);
  useEffect(()=>{
    mounted.current=true;
    const onFocus=()=>{if(document.visibilityState==="visible")void refresh();};
    const onChange=()=>{void refresh(true);};
    const initial=setTimeout(()=>void refresh(),0);
    const timer=setInterval(onFocus,60000);
    window.addEventListener("focus",onFocus);document.addEventListener("visibilitychange",onFocus);window.addEventListener("blew-engine-updated",onChange);
    return ()=>{mounted.current=false;clearTimeout(initial);clearInterval(timer);window.removeEventListener("focus",onFocus);document.removeEventListener("visibilitychange",onFocus);window.removeEventListener("blew-engine-updated",onChange);};
  },[refresh]);
  return <EngineContext.Provider value={health}>{children}</EngineContext.Provider>;
}
