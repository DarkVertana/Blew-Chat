import type {BotConversation,BotTurn} from "./bots.ts";
// Preserve loaded history and optimistic sends. A stale pending snapshot must
// never replace a reply already received from the POST or WebSocket refresh.
export function mergeConversation(previous:BotConversation|null,incoming:BotConversation):BotConversation{
 if(!previous||previous.bot.id!==incoming.bot.id)return incoming;
 const turns=new Map(previous.turns.map(turn=>[turn.id,turn]));
 for(const turn of incoming.turns){const old=turns.get(turn.id);if(old?.status==="complete"&&turn.status==="pending")continue;turns.set(turn.id,turn);}
 return {...incoming,before:previous.turns.some(turn=>!incoming.turns.some(next=>next.id===turn.id))?previous.before:incoming.before,turns:[...turns.values()].sort((a,b)=>Date.parse(a.started_at)-Date.parse(b.started_at))};
}
export function optimisticTurn(id:string,text:string,attachments:BotTurn["attachments"],replyTo=""):BotTurn{return {id,user_text:text,assistant_text:"",status:"pending",error:"",started_at:new Date().toISOString(),attachments,reply_to:replyTo};}
