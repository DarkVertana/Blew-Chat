import {memoryContext,type MemoryRecall} from "./bot-memory";
import {readConfig,withEngineLock} from "./engine/store";
import {generateReply,type EngineMessage} from "./engine/generate";
import {botInstructions,extractTask,type Bot,type BotTurn,type Computer} from "./bots";

type Run={id:number;lease:string;user_id:number;bot:Bot;profile:{name:string;about:string};history:BotTurn[];computers:Computer[];prompt:string;title:string};
const globals=globalThis as typeof globalThis & {blewScheduler?:{timer:ReturnType<typeof setTimeout>|null;busy:boolean}};
async function request(path:string,body:unknown){
 const response=await fetch(`${process.env.API_URL||"http://localhost:8080"}/internal/scheduler/${path}`,{method:"POST",headers:{"Content-Type":"application/json","X-Scheduler-Key":process.env.SCHEDULER_SECRET!},body:JSON.stringify(body),signal:AbortSignal.timeout(15000),cache:"no-store"});
 if(!response.ok)throw Error(`Scheduler ${path} failed (${response.status})`);
 return response.status===204?null:response.json();
}
export async function executeScheduledRun(run:Run){
 return withEngineLock(run.user_id,async()=>{
  // A run may be paused while waiting behind an interactive turn.
  await request("active",{id:run.id,lease:run.lease});
  let text="",error="";let task:ReturnType<typeof extractTask>["task"]=null;
  try{
   const config=await readConfig(run.user_id);if(!config.selected)throw Error("Choose an engine in Settings → Engine to run scheduled AI tasks.");
   const history:EngineMessage[]=[];let budget=120000;
   // API returns newest first. Bound context, then restore chronological order.
   for(const turn of run.history){const cost=turn.user_text.length+turn.assistant_text.length;if(cost>budget)break;budget-=cost;history.unshift({role:"user",content:turn.user_text},{role:"assistant",content:turn.assistant_text});}
   history.push({role:"user",content:run.prompt});
   const memories=await request("memory",{id:run.id,lease:run.lease,query:run.prompt.slice(0,1000)}).catch(()=>null) as MemoryRecall|null;
   const instructions=memoryContext(memories)+botInstructions(run.bot,run.profile,run.computers[0]||null)+"\nThis is an enabled scheduled task, running at "+new Date().toISOString()+". Complete the requested work now and report the result. Do not create or enable another schedule. Computer commands still require a reviewed task proposal; never claim they already ran.";
   const reply=extractTask(await generateReply(run.user_id,instructions,history,config.selected));text=reply.text;task=run.computers.length?reply.task:null;
  }catch(e){error=e instanceof Error&&/^(Choose an engine|The engine|Claude could|Codex |Engine sign-in|Reconnect|Your selected)/.test(e.message)?e.message:"Scheduled reply failed. Check Engine settings and run the task again.";}
  await request("finish",{id:run.id,lease:run.lease,text,error,task});
 });
}
export function startScheduler(){
 if((process.env.SCHEDULER_SECRET||"").length<32||globals.blewScheduler)return;
 const state:{timer:ReturnType<typeof setTimeout>|null;busy:boolean}=globals.blewScheduler={timer:null,busy:false};
 async function tick(){
  if(state.busy)return;state.busy=true;
  try{const {run}=await request("claim",{});if(run)await executeScheduledRun(run);}
  catch{console.warn("Scheduler could not complete a tick; it will retry its connection. Interrupted jobs are not automatically replayed.");}
  finally{state.busy=false;state.timer=setTimeout(tick,15000);state.timer.unref();}
 }
 state.timer=setTimeout(tick,1000);state.timer.unref();
}
