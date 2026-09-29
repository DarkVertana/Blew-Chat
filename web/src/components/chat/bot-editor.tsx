"use client";
import {useState} from "react";
import {ArrowLeft,Camera} from "lucide-react";
import {saveBot} from "@/app/actions/bots";
import type {Bot} from "@/lib/bots";
export function BotEditor({bot,onClose,onSaved}:{bot?:Bot;onClose:()=>void;onSaved:(bot:Bot)=>void}){
 const [savedID,setSavedID]=useState(bot?.id);const [name,setName]=useState(bot?.name||"");const [designation,setDesignation]=useState(bot?.designation||"");const [instructions,setInstructions]=useState(bot?.instructions||"");const [image,setImage]=useState<File|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState("");
 async function save(e:React.FormEvent){e.preventDefault();if(busy)return;setBusy(true);setError("");try{const result=await saveBot({name,designation,instructions},savedID);if(result.error||!result.data)throw Error(result.error);const saved=result.data;setSavedID(saved.id);if(image){const response=await fetch(`/api/bots/${saved.id}/image`,{method:"PUT",headers:{"Content-Type":image.type},body:image});const data=await response.json();if(!response.ok){throw Error(`Bot saved, but photo failed: ${data.error}`);}saved.image_version=data.image_version;}onSaved(saved);onClose();}catch(e){setError(e instanceof Error?e.message:"Could not save bot.");}finally{setBusy(false);}}
 const input="mt-2 w-full rounded-xl border border-wa-border bg-wa-bg px-3 py-3 text-[15px] outline-none focus:border-wa-green";
 return <div className="wa-scroll h-full overflow-y-auto"><header className="flex h-[76px] items-center gap-3 px-5"><button aria-label="Back" onClick={onClose} className="rounded-full p-2 hover:bg-wa-hover"><ArrowLeft size={22}/></button><h1 className="text-[22px] font-medium">{bot?"Edit bot":"New AI coworker"}</h1></header><form onSubmit={save} className="space-y-5 px-5 pb-8">
 <p className="text-sm leading-relaxed text-wa-muted">Give your bot an identity and explain how you want it to work. It will use your profile name and About text to understand your preferences.</p>
 <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-wa-border p-5"><Camera className="text-wa-muted"/><span className="text-sm">{image?image.name:"Add bot image (JPEG or PNG)"}</span><input type="file" accept="image/jpeg,image/png" className="sr-only" onChange={e=>{const file=e.target.files?.[0];if(file&&file.size>5*1024*1024){setError("Choose an image up to 5 MB.");return;}setImage(file||null);}}/></label>
 <label className="block text-sm">Bot name<input required maxLength={100} value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Alex" className={input}/></label>
 <label className="block text-sm">Designation<input required maxLength={150} value={designation} onChange={e=>setDesignation(e.target.value)} placeholder="e.g. Software engineer" className={input}/></label>
 <label className="block text-sm">Description and instructions<textarea value={instructions} onChange={e=>setInstructions(e.target.value)} rows={8} placeholder="Describe the bot's role, tone, expertise, and how it should help you…" className={input}/></label>
 <p className="text-xs leading-relaxed text-wa-muted">Uses your account’s selected Engine. Linux tasks run only on a computer paired to your account, after you approve the command.</p>
 {error&&<p role="alert" className="text-sm text-red-500">{error}</p>}
 <button disabled={busy} className="w-full rounded-full bg-wa-green py-3 font-medium text-black disabled:opacity-50">{busy?"Saving…":bot?"Save changes":"Create bot"}</button>
 </form></div>;
}
