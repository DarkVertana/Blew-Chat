"use client";
import {useEffect,useState} from "react";
import {messagePreview} from "@/lib/message-ui";
import {listBots} from "@/app/actions/bots";
import type {Bot} from "@/lib/bots";
import {APP_NAME} from "@/lib/app";
import {ChatListPanel} from "./chat-list";
import {BotEditor} from "./bot-editor";
import {BotConversationView} from "./bot-conversation";
import {EmptyState} from "./empty-state";
import {TwoPane} from "./two-pane";
export function ChatsView(){
 const [bots,setBots]=useState<Bot[]>([]);const [selected,setSelected]=useState<number|null>(null);const [editor,setEditor]=useState<Bot|true|null>(null);const [error,setError]=useState("");
 useEffect(()=>{let active=true;const refresh=()=>listBots().then(r=>{if(active){if(r.data)setBots(r.data);else setError(r.error);}});void refresh();const timer=setInterval(refresh,10000);return()=>{active=false;clearInterval(timer);};},[]);
 function saved(bot:Bot){setBots(items=>[bot,...items.filter(b=>b.id!==bot.id)]);setSelected(bot.id);}
 const bot=bots.find(b=>b.id===selected);
 return <TwoPane showMain={!!bot&&!editor} left={editor?<BotEditor bot={editor===true?undefined:editor} onClose={()=>setEditor(null)} onSaved={saved}/>:<><ChatListPanel title={APP_NAME} selectedId={selected?.toString()||null} onSelect={id=>setSelected(Number(id))} onNew={()=>setEditor(true)} items={bots.map(b=>({id:String(b.id),name:b.name,initials:b.name.slice(0,2).toUpperCase(),color:"#19bd66",preview:messagePreview(b.preview||b.designation),time:"",imageURL:b.image_version?`/api/bots/${b.id}/image?v=${b.image_version}`:undefined}))}/>{error&&<p role="alert">{error}</p>}</>} main={bot?<BotConversationView key={bot.id} bot={bot} onBack={()=>setSelected(null)} onEdit={()=>setEditor(bot)} onBotChanged={saved} onDeleted={()=>{setBots(items=>items.filter(item=>item.id!==bot.id));setSelected(null);setEditor(null);}}/>:<EmptyState onNew={()=>setEditor(true)}/>}/>;
}
