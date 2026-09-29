"use client";
import Image from "next/image";
import {useEngineHealth} from "@/components/engine-provider";
import {useCallback,useEffect,useRef,useState,type CSSProperties} from "react";
import {ArrowLeft,Phone,Video,Monitor,Pencil,SendHorizontal,CalendarClock,EllipsisVertical,Search,Plus,Smile,Mic,X,UserRound,FileUp,FileText,Brain} from "lucide-react";
import {getBotConversation,decideComputerTask,saveBotMemory} from "@/app/actions/bots";
import type {Bot,BotConversation,ComputerTask,Computer,ChatAttachment} from "@/lib/bots";
import {VoiceCall} from "./voice-call";
import {ScreenShare} from "./screen-share";
import {ComputerPanel} from "./computer-panel";
import {SchedulePanel} from "./schedule-panel";
import {scheduleProposal,type ScheduleInput} from "@/lib/schedules";
import {useSetting} from "@/lib/local-settings";
import {DOODLES_KEY,WALLPAPER_KEY,wallpaperById} from "@/lib/wallpaper";
import {Avatar} from "./avatar";
import {Bubble} from "./conversation";
import {mergeConversation,optimisticTurn} from "@/lib/chat-state";
import {MessageContent} from "./message-content";
import {MemoryPanel} from "./memory-panel";
import {BotInfo} from "./bot-info";
const button="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-wa-text transition hover:bg-wa-hover disabled:opacity-40";
export function BotConversationView({bot,onBack,onEdit,onDeleted}:{bot:Bot;onBack:()=>void;onEdit:()=>void;onBotChanged:(bot:Bot)=>void;onDeleted:()=>void}){
 const [data,setData]=useState<BotConversation|null>(null);const [draft,setDraft]=useState("");const [busy,setBusy]=useState(false);const sending=useRef(false);const [error,setError]=useState("");const [call,setCall]=useState(false);const [screen,setScreen]=useState<MediaStream|null>(null);const [tasks,setTasks]=useState<ComputerTask[]>([]);const [computers,setComputers]=useState<Computer[]>([]);const submitted=useRef<{text:string;id:string}|null>(null);const capture=useRef<(()=>string|undefined)|null>(null);const end=useRef<HTMLDivElement>(null);
 const [panel,setPanel]=useState<"info"|"schedules"|"computer"|"memory"|null>(null);
 const [menuOpen,setMenuOpen]=useState(false);
 const [attachOpen,setAttachOpen]=useState(false);
 const [emojiOpen,setEmojiOpen]=useState(false);
 const [searchOpen,setSearchOpen]=useState(false);
 const [query,setQuery]=useState("");
 const [attachments,setAttachments]=useState<ChatAttachment[]>([]);
 const [uploading,setUploading]=useState(false);
 const fileInput=useRef<HTMLInputElement>(null);
 const scrollArea=useRef<HTMLDivElement>(null);
 const stickToBottom=useRef(true);
 const refreshing=useRef(false);
 const refreshQueued=useRef(false);
 const mounted=useRef(true);
 const menuRef=useRef<HTMLDivElement>(null);
 const [wallpaperId]=useSetting<string>(WALLPAPER_KEY,"default");
 const [doodles]=useSetting<boolean>(DOODLES_KEY,true);
 const wallpaper=wallpaperById(wallpaperId);
 useEffect(()=>{
  const close=(event:MouseEvent)=>{if(menuRef.current&&!menuRef.current.contains(event.target as Node))setMenuOpen(false);};
  const escape=(event:KeyboardEvent)=>{if(event.key==="Escape"){setMenuOpen(false);setAttachOpen(false);setEmojiOpen(false);setSearchOpen(false);setPanel(null);}};
  document.addEventListener("mousedown",close);document.addEventListener("keydown",escape);
  return()=>{document.removeEventListener("mousedown",close);document.removeEventListener("keydown",escape);};
 },[]);
 function showSchedules(){setScheduleDraft(undefined);setPanel("schedules");setMenuOpen(false);setAttachOpen(false);}
 function showComputer(){setPanel("computer");setMenuOpen(false);setAttachOpen(false);}
 function startVoice(){setPanel(null);setCall(true);}
 function startSearch(){setPanel(null);setSearchOpen(true);}

 const [scheduleDraft,setScheduleDraft]=useState<ScheduleInput|undefined>();
 const health=useEngineHealth();
 const [networkOnline,setNetworkOnline]=useState(true);
 const [voicePhase,setVoicePhase]=useState("Starting microphone…");
 useEffect(()=>{
  const update=()=>setNetworkOnline(navigator.onLine);
  const initial=setTimeout(update,0);
  window.addEventListener("online",update);window.addEventListener("offline",update);
  return()=>{clearTimeout(initial);window.removeEventListener("online",update);window.removeEventListener("offline",update);};
 },[]);
 const replying=busy||!!data?.turns.some(turn=>turn.status==="pending");
 const runningTask=tasks.find(task=>task.status==="running");
 const queuedTask=tasks.some(task=>task.status==="approved");
 const available=networkOnline&&health?.status==="connected";
 const activity=!networkOnline?"offline":replying?"typing…":runningTask?"working…":queuedTask?"waiting for computer…":call?voicePhase.toLowerCase():available?"online":!health?"connecting…":health.status==="unconfigured"?"engine not connected":health.status==="expired"?"reconnect engine":"connection unavailable";
 const onFrame=useCallback((fn:(()=>string|undefined)|null)=>{capture.current=fn;},[]);
 const refresh=useCallback(async()=>{
  if(refreshing.current){refreshQueued.current=true;return;}refreshing.current=true;
  try{do{refreshQueued.current=false;const response=await fetch(`/api/bots/${bot.id}/state`,{cache:"no-store"});const result=await response.json();if(!response.ok)throw Error(result.error||"Could not refresh chat.");if(mounted.current){setData(previous=>mergeConversation(previous,result.conversation));setTasks(result.tasks);setComputers(result.computers);}}while(refreshQueued.current&&mounted.current);}catch(e){if(mounted.current)setError(e instanceof Error?e.message:"Could not refresh chat.");}finally{refreshing.current=false;}
 },[bot.id]);
 useEffect(()=>{
  mounted.current=true;let stopped=false;let socket:WebSocket|null=null;let retry:ReturnType<typeof setTimeout>;let failures=0;
  function connect(){if(stopped)return;socket=new WebSocket(`${location.protocol==="https:"?"wss:":"ws:"}//${location.host}/api/live/bots/${bot.id}`);socket.onopen=()=>{failures=0;void refresh();};socket.onmessage=()=>void refresh();socket.onerror=()=>socket?.close();socket.onclose=()=>{if(!stopped)retry=setTimeout(connect,Math.min(15000,1000*2**failures++));};}
  connect();const initial=setTimeout(()=>void refresh(),0);
  // Recovery when a proxy drops upgrades or the tab wakes after sleeping.
  const fallback=setInterval(()=>{if(socket?.readyState!==WebSocket.OPEN)void refresh();},5000);
  const wake=()=>{if(document.visibilityState==="visible")void refresh();};document.addEventListener("visibilitychange",wake);
  return()=>{stopped=true;mounted.current=false;clearTimeout(retry);clearTimeout(initial);clearInterval(fallback);document.removeEventListener("visibilitychange",wake);socket?.close();};
 },[bot.id,refresh]);
 useEffect(()=>{if(stickToBottom.current&&scrollArea.current)scrollArea.current.scrollTop=scrollArea.current.scrollHeight;},[data,tasks,busy]);
 async function send(text:string,requestID:string=crypto.randomUUID(),voice=false,files:ChatAttachment[]=[],replyTo=""){
  if(sending.current)throw Error("Please wait for the current reply.");sending.current=true;setBusy(true);setError("");stickToBottom.current=true;setQuery("");
  setData(previous=>mergeConversation(previous,{bot,before:previous?.before||null,turns:[optimisticTurn(requestID,text,files,replyTo)]}));
  try{const response=await fetch(`/api/bots/${bot.id}/reply`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:requestID,text,image:capture.current?.(),voice,attachments:files.map(file=>file.id),reply_to:replyTo})});const result=await response.json();if(!response.ok)throw Error(result.error||"Could not send message.");if(mounted.current)setData(previous=>mergeConversation(previous,result));void refresh();const turn=(result as BotConversation).turns.find(t=>t.id===requestID);if(turn?.status!=="complete")throw Error(turn?.error||"Reply still pending. It will appear here when ready.");return turn.assistant_text;}catch(e){const message=e instanceof Error?e.message:"Could not send message.";if(mounted.current){setError(message);setData(previous=>previous?{...previous,turns:previous.turns.map(turn=>turn.id===requestID&&turn.status==="pending"?{...turn,status:"failed",error:message}:turn)}:previous);}throw e;}finally{sending.current=false;if(mounted.current)setBusy(false);}
 }
 function chooseFiles(){setAttachOpen(false);fileInput.current?.click();}
 async function upload(files:FileList|null){
  if(!files?.length)return;
  const selected=Array.from(files);if(selected.length+attachments.length>4){setError("Attach up to four files per message.");return;}
  if(selected.some(file=>!file.size||file.size>10*1024*1024)){setError("Choose nonempty files up to 10 MB each.");return;}
  setUploading(true);setError("");
  try{for(const file of selected){const response=await fetch(`/api/bots/${bot.id}/attachments`,{method:"POST",headers:{"X-File-Name":encodeURIComponent(file.name)},body:file});const result=await response.json();if(!response.ok)throw Error(result.error||"Upload failed.");setAttachments(old=>[...old,result]);}}catch(e){setError(e instanceof Error?e.message:"Upload failed.");}finally{setUploading(false);if(fileInput.current)fileInput.current.value="";}
 }
 async function removeAttachment(file:ChatAttachment){try{const response=await fetch(`/api/bots/${bot.id}/attachments/${file.id}`,{method:"DELETE"});if(!response.ok&&response.status!==404)throw Error("Could not remove attachment.");setAttachments(old=>old.filter(item=>item.id!==file.id));}catch(e){setError(e instanceof Error?e.message:"Could not remove attachment.");}}
 async function submit(e:React.FormEvent){e.preventDefault();const text=draft.trim()||(attachments.length?"Please review the attached files.":"");if(!text||busy||uploading)return;setDraft("");const fingerprint=JSON.stringify([text,attachments.map(file=>file.id)]);const request=submitted.current?.text===fingerprint?submitted.current:{text:fingerprint,id:crypto.randomUUID()};submitted.current=request;try{await send(text,request.id,false,attachments);submitted.current=null;setAttachments([]);}catch{setDraft(current=>current||text);}}
 async function share(){try{if(!navigator.mediaDevices?.getDisplayMedia)throw Error("Screen sharing needs HTTPS or localhost and a supported browser.");const stream=await navigator.mediaDevices.getDisplayMedia({video:true,audio:false});stream.getVideoTracks()[0].addEventListener("ended",()=>setScreen(null),{once:true});setScreen(stream);setCall(true);}catch(e){setError(e instanceof Error?e.message:"Screen sharing was cancelled.");}}
 async function remember(text:string){const result=await saveBotMemory(bot.id,text);setError(result.error||"Saved to this bot’s memory.");}
 async function decide(task:ComputerTask,decision:"approve"|"cancel",computerID:number){const r=await decideComputerTask(bot.id,task.id,decision,computerID);if(r.error)setError(r.error);await refresh();}
 return <div className="flex h-full min-h-0 min-w-0 overflow-hidden">
 <div className={`${panel?"hidden min-[1400px]:flex":"flex"} h-full min-h-0 min-w-0 flex-1 flex-col`}>
 <header className="flex h-16 shrink-0 items-center gap-3 border-b border-wa-border bg-wa-panel px-3 sm:px-4">
  <button onClick={onBack} aria-label="Back" className={`${button} md:hidden`}><ArrowLeft size={22}/></button>
  <button onClick={()=>setPanel("info")} aria-label={`Contact info for ${bot.name}`} aria-expanded={panel==="info"} className="-mx-1 flex min-w-0 flex-1 items-center gap-3 rounded-lg px-1 py-1 text-left transition hover:bg-wa-hover">
   {bot.image_version?<Image unoptimized src={`/api/bots/${bot.id}/image?v=${bot.image_version}`} alt="" width={40} height={40} className="h-10 w-10 rounded-full object-cover"/>:<Avatar initials={bot.name.slice(0,2).toUpperCase()} color="#19bd66" size={40}/>}
   <div className="min-w-0 flex-1"><p className="truncate text-[16px]">{bot.name}</p><p role="status" aria-live="polite" aria-atomic="true" title={runningTask?`Working on: ${runningTask.title}`:`${bot.designation} · AI coworker`} className={`truncate text-xs ${networkOnline&&(replying||runningTask||queuedTask||available)?"text-wa-accent":"text-wa-muted"}`}>{activity}</p></div>
  </button>
  <div className="flex items-center">
   <button className={button} title="Video call and screen teaching" aria-label="Video call and screen teaching" onClick={()=>void share()} disabled={!!screen}><Video size={20}/></button>
   <button className={button} title="Voice call" aria-label="Voice call" onClick={()=>setCall(!call)}><Phone size={20}/></button>
   <button className={button} title="Search in conversation" aria-label="Search in conversation" onClick={()=>setSearchOpen(!searchOpen)}><Search size={20}/></button>
   <div ref={menuRef} className="relative"><button className={button} title="Chat menu" aria-label="Chat menu" aria-expanded={menuOpen} aria-haspopup="menu" onClick={()=>setMenuOpen(!menuOpen)}><EllipsisVertical size={20}/></button>
    {menuOpen&&<div role="menu" aria-label="Chat actions" className="absolute right-0 top-11 z-30 w-60 rounded-xl bg-wa-panel py-2 shadow-lg ring-1 ring-wa-border">{[{label:"Contact info",Icon:UserRound,action:()=>{setPanel("info");setMenuOpen(false);}},{label:"Bot memory",Icon:Brain,action:()=>{setPanel("memory");setMenuOpen(false);}},{label:"Tasks & schedules",Icon:CalendarClock,action:showSchedules},{label:"Linux computer",Icon:Monitor,action:showComputer},{label:"Edit bot",Icon:Pencil,action:()=>{setMenuOpen(false);onEdit();}}].map(({label,Icon,action})=><button role="menuitem" key={label} onClick={action} className="flex w-full items-center gap-3 px-5 py-3 text-left text-[15px] hover:bg-wa-hover"><Icon size={18} className="text-wa-muted"/>{label}</button>)}</div>}
   </div>
  </div>
 </header>
 {searchOpen&&<div className="flex shrink-0 items-center gap-3 border-b border-wa-border bg-wa-panel px-4 py-2"><Search size={18} className="text-wa-muted"/><input autoFocus value={query} onChange={e=>setQuery(e.target.value)} aria-label="Search loaded messages" placeholder="Search this conversation" className="min-w-0 flex-1 rounded-full bg-wa-input px-4 py-2 text-sm outline-none"/><button className={button} aria-label="Close search" onClick={()=>{setSearchOpen(false);setQuery("");}}><X size={20}/></button></div>}
 {call&&<VoiceCall name={bot.name} onPhaseChange={setVoicePhase} onMessage={text=>send(text,crypto.randomUUID(),true)} onClose={()=>{setCall(false);setScreen(null);}}/>}
 {screen&&<ScreenShare stream={screen} onStop={()=>setScreen(null)} onFrame={onFrame}/>}
 <div ref={scrollArea} onScroll={e=>{const element=e.currentTarget;stickToBottom.current=element.scrollHeight-element.scrollTop-element.clientHeight<100;}} className={`wa-scroll wa-canvas min-h-0 flex-1 overflow-y-auto px-[6%] py-4 ${doodles?"wa-doodles":""}`} style={{"--wp-light":wallpaper.light,"--wp-dark":wallpaper.dark} as CSSProperties}><p className="mx-auto mb-5 max-w-md rounded-lg bg-[#fdf4c5] px-3 py-2 text-center text-xs leading-relaxed text-[#5b5b3a] shadow-sm dark:bg-[#1f2b2a] dark:text-[#d1c48f]">Messages and shared screen frames are sent to your selected AI Engine. Chats, lessons and paired computers belong to this Blew account.</p>
 {data?.before&&<button className="mb-3 text-sm text-wa-accent" onClick={async()=>{const r=await getBotConversation(bot.id,data.before!);if(r.data)setData(current=>current?{...current,before:r.data.before,turns:[...r.data.turns,...current.turns.filter(t=>!r.data.turns.some(n=>n.id===t.id))]}:r.data);}}>Load earlier messages</button>}
 {!data?.turns.length&&<p className="py-8 text-center text-sm text-wa-muted">Say hello to {bot.name}, or describe something you want help with.</p>}
 {data?.turns.filter(turn=>!query||!searchOpen||`${turn.user_text} ${turn.assistant_text}`.toLowerCase().includes(query.toLowerCase())).map((turn,index,visibleTurns)=>{
  const proposal=scheduleProposal(turn.assistant_text);
  const time=new Date(turn.started_at).toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"});
  const date=new Date(turn.started_at).toLocaleDateString(undefined,{day:"numeric",month:"long",year:"numeric"});
  const previous=visibleTurns[index-1];
  const showDate=!previous||new Date(previous.started_at).toDateString()!==new Date(turn.started_at).toDateString();
  return <div key={turn.id} className="pb-3">
   {showDate&&<div className="mx-auto mb-3 mt-1 w-fit rounded-lg bg-wa-card px-3 py-1.5 text-xs text-wa-muted shadow-sm">{date}</div>}
   <ul><Bubble hideReaction first accent="#19bd66" message={{id:turn.id+"-user",from:"me",text:turn.user_text,time,status:turn.status==="complete"?"read":"delivered"}}>{!!turn.attachments?.length&&<div className="space-y-2">{turn.attachments.map(file=><a key={file.id} href={`/api/bots/${bot.id}/attachments/${file.id}`} download className="flex items-center gap-2 rounded-lg bg-black/5 p-3 text-sm hover:bg-black/10"><FileText size={20} className="shrink-0"/><span className="min-w-0 break-all">{file.name}<small className="block text-wa-muted">{Math.ceil(file.size/1024)} KB · Download</small></span></a>)}</div>}</Bubble>
   {turn.assistant_text&&<Bubble hideReaction first accent="#19bd66" content={<MessageContent text={proposal?turn.assistant_text.replace(/```blew-schedule\s*\n[\s\S]*?```/,"Review the proposed schedule below before enabling it."):turn.assistant_text} disabled={replying} answered={!!data.turns.some(answer=>answer.reply_to===turn.id&&answer.status!=="failed")} answerText={data.turns.find(answer=>answer.reply_to===turn.id&&answer.status!=="failed")?.user_text} onRespond={text=>send(text,crypto.randomUUID(),false,[],turn.id)}/>} message={{id:turn.id+"-bot",from:"them",text:proposal?turn.assistant_text.replace(/```blew-schedule\s*\n[\s\S]*?```/,"Review the proposed schedule below before enabling it."):turn.assistant_text,time}}>
    {proposal&&<button className="mr-3 text-xs font-medium text-wa-accent hover:underline" onClick={()=>{setScheduleDraft(proposal);setPanel("schedules");}}>Review schedule</button>}
    <button onClick={()=>void remember(turn.assistant_text)} className="text-xs text-wa-muted hover:text-wa-accent">Remember this</button>
   </Bubble>}</ul>
   {turn.status==="failed"&&<p className="mx-2 mt-2 text-xs text-red-500">{turn.error} <button disabled={busy} onClick={()=>void send(turn.user_text,turn.id,false,turn.attachments,turn.reply_to).catch(()=>{})} className="underline">Retry</button></p>}
   {tasks.filter(t=>t.turn_id===turn.id).map(task=><div key={task.id} className="mx-2 mt-3 max-w-lg"><TaskCard task={task} computers={computers} onDecide={decide} onAnalyse={()=>void send(`Analyse the Linux task result for task ${task.id}: ${task.title}. Explain what you found and any remaining limitations.`).catch(()=>{})} replying={replying}/></div>)}
  </div>;
 })}
 {replying&&<p role="status" className="text-sm text-wa-accent">{bot.name} is typing…</p>}<div ref={end}/></div>
 {error&&<p role="status" className="bg-wa-panel px-4 py-2 text-sm text-wa-muted">{error}</p>}
 <div className="relative shrink-0 bg-wa-panel">
 <input ref={fileInput} type="file" multiple aria-label="Upload files" className="sr-only" tabIndex={-1} disabled={busy||uploading} onChange={e=>void upload(e.target.files)}/>
 {attachOpen&&<div className="absolute bottom-full left-3 z-20 mb-2 w-60 rounded-xl bg-wa-panel py-2 shadow-lg ring-1 ring-wa-border"><button onClick={chooseFiles} disabled={busy||uploading} className="flex w-full items-center gap-3 px-5 py-3 text-left text-[15px] hover:bg-wa-hover disabled:opacity-40"><FileUp size={20} className="text-wa-muted"/>Photos & files</button>{[{label:"Screen teaching",Icon:Video,action:()=>{setAttachOpen(false);void share();}},{label:"Schedule a task",Icon:CalendarClock,action:showSchedules},{label:"Linux computer",Icon:Monitor,action:showComputer}].map(({label,Icon,action})=><button key={label} onClick={action} className="flex w-full items-center gap-3 px-5 py-3 text-left text-[15px] hover:bg-wa-hover"><Icon size={20} className="text-wa-muted"/>{label}</button>)}</div>}
 {emojiOpen&&<div aria-label="Emoji picker" className="absolute bottom-full left-12 z-20 mb-2 flex max-w-[280px] flex-wrap gap-1 rounded-xl bg-wa-panel p-3 shadow-lg ring-1 ring-wa-border">{["🙂","😊","👍","🙏","🎉","❤️","🚀","✅"].map(emoji=><button key={emoji} type="button" onClick={()=>{setDraft(text=>text+emoji);setEmojiOpen(false);}} className="rounded-lg p-2 text-2xl hover:bg-wa-hover">{emoji}</button>)}</div>}
 {(uploading||attachments.length>0)&&<div className="border-t border-wa-border px-5 py-3"><div className="flex flex-wrap gap-2">{attachments.map(file=><div key={file.id} className="flex max-w-full items-center gap-2 rounded-lg bg-wa-input px-3 py-2 text-sm"><FileText size={18}/><span className="truncate">{file.name}</span><button type="button" disabled={busy||uploading} aria-label={`Remove ${file.name}`} onClick={()=>void removeAttachment(file)} className="rounded-full p-1 hover:bg-wa-hover"><X size={16}/></button></div>)}</div><p role="status" className="mt-2 text-xs text-wa-muted">{uploading?"Uploading…":"Ready to send · Images and text/code files can be analysed. Other formats can be inspected on your paired Linux computer after task approval."}</p></div>}
 <form onSubmit={submit} className="flex items-center gap-1 px-3 py-2.5 sm:px-4"><button type="button" title="Add to chat" aria-label="Add to chat" aria-expanded={attachOpen} onClick={()=>{setAttachOpen(!attachOpen);setEmojiOpen(false);}} className={button}><Plus size={24}/></button><button type="button" title="Emoji" aria-label="Emoji" aria-expanded={emojiOpen} onClick={()=>{setEmojiOpen(!emojiOpen);setAttachOpen(false);}} className={button}><Smile size={24}/></button><textarea rows={1} aria-label="Type a message" placeholder="Type a message" value={draft} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();e.currentTarget.form?.requestSubmit();}}} className="mx-1 h-11 min-w-0 flex-1 resize-none rounded-full bg-wa-input px-4 py-2.5 text-[15px] text-wa-text outline-none placeholder:text-wa-muted"/>{(draft.trim()||attachments.length>0)?<button disabled={busy||uploading} aria-label="Send" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-wa-green text-black transition hover:brightness-110 disabled:opacity-40"><SendHorizontal size={20}/></button>:<button type="button" title="Start voice call" aria-label="Start voice call" onClick={startVoice} className={button}><Mic size={24}/></button>}</form>
 </div></div>
 {panel&&<aside aria-label={panel==="info"?"Contact info":panel==="schedules"?"Tasks and schedules":panel==="memory"?"Bot memory":"Linux computer"} className="flex h-full min-w-0 w-full shrink-0 flex-col bg-wa-panel min-[1400px]:w-[420px] min-[1400px]:border-l min-[1400px]:border-wa-border">
  {panel==="info"&&<BotInfo onDeleted={onDeleted} bot={bot} onClose={()=>setPanel(null)} onEdit={onEdit} onVoice={startVoice} onVideo={()=>{setPanel(null);void share();}} onSearch={startSearch} onSchedules={showSchedules} onMemory={()=>setPanel("memory")} onComputer={showComputer}/>}
  {panel==="schedules"&&<SchedulePanel key={JSON.stringify(scheduleDraft)||"schedule"} botID={bot.id} computers={computers} initial={scheduleDraft} onClose={()=>setPanel(null)}/>}
  {panel==="memory"&&<MemoryPanel botID={bot.id} onClose={()=>setPanel(null)}/>}
  {panel==="computer"&&<ComputerPanel onClose={()=>setPanel(null)}/>}
 </aside>}
 </div>;
}

function TaskCard({task,computers,onDecide,onAnalyse,replying}:{onAnalyse:()=>void;replying:boolean;task:ComputerTask;computers:Computer[];onDecide:(task:ComputerTask,decision:"approve"|"cancel",computerID:number)=>Promise<void>}){const [selected,setSelected]=useState(0);const [busy,setBusy]=useState(false);const id=selected||computers[0]?.id||0;async function decide(decision:"approve"|"cancel"){setBusy(true);try{await onDecide(task,decision,id);}finally{setBusy(false);}}return <div className="rounded-xl border border-wa-border bg-wa-panel p-3 text-sm"><p className="font-medium">{task.title} · {task.status}</p>{!!task.attachments?.length&&<p className="mt-2 text-xs text-wa-muted">Files to copy to the selected Linux computer: {task.attachments.map(file=>file.name).join(", ")}. Copies remain in the companion’s private task-files folder.</p>}<pre className="my-3 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-wa-input p-3">{task.command}</pre>{task.status==="proposed"&&<><p className="mb-2 text-xs text-wa-muted">Review this command. It will run with your Linux user’s permissions.</p><select aria-label="Linux computer" value={id} onChange={e=>setSelected(Number(e.target.value))} className="mb-2 max-w-full rounded bg-wa-input p-2">{computers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select><button disabled={busy||!id} className="ml-2 rounded-full bg-wa-green px-3 py-2 text-black disabled:opacity-40" onClick={()=>void decide("approve")}>Approve and run</button></>}{["proposed","approved","running"].includes(task.status)&&<button disabled={busy} onClick={()=>void decide("cancel")} className="ml-3 text-red-500">Cancel</button>}{task.output&&<pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap bg-wa-input p-3">{task.output}</pre>}{task.exit_code!==null&&<p className="mt-2 text-xs text-wa-muted">Exit code: {task.exit_code}. <button disabled={replying} onClick={onAnalyse} className="text-wa-accent underline disabled:opacity-40">Analyse result</button></p>}</div>;}
