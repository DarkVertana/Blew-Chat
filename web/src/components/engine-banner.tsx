"use client";
import Link from "next/link";
import { Cpu, X } from "lucide-react";
import { useState } from "react";
import { useEngineHealth } from "./engine-provider";
import { engineBanner } from "@/lib/engine/health";
export function EngineBanner() {
  const health=useEngineHealth();
  const banner=engineBanner(health);
  const identity=`${health?.provider}:${health?.status}`;
  if(!banner)return null;
  return <Banner key={identity} banner={banner}/>;
}
function Banner({banner}:{banner:NonNullable<ReturnType<typeof engineBanner>>}) {
  const [dismissed,setDismissed]=useState(false);
  if(dismissed)return null;
  return <div role="status" className="mx-3 my-3 flex shrink-0 items-start gap-3 rounded-2xl bg-wa-green-deep p-4">
    <Cpu size={24} className="mt-1 shrink-0 text-wa-accent"/>
    <div className="min-w-0 flex-1"><p className="text-[15px] font-medium">{banner.title}</p><p className="mt-1 text-sm text-wa-muted">{banner.description}</p><Link href="/settings/engine" className="mt-1 inline-block text-sm font-medium text-wa-accent hover:underline">{banner.action}</Link></div>
    <button type="button" aria-label="Dismiss Engine alert" className="rounded-full p-1 hover:bg-white/10" onClick={()=>setDismissed(true)}><X size={18}/></button>
  </div>;
}
