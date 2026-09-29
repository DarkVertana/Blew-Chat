export type ScheduleInput={title:string;prompt:string;mode:"ai"|"command";computer_id:number|null;kind:"once"|"cron";cron:string;timezone:string;run_at:string|null};
export type BotSchedule=ScheduleInput & {id:number;bot_id:number;enabled:boolean;next_run:string|null};
export type ScheduleRun={id:number;schedule_id:number;title:string;turn_id:string;status:"running"|"complete"|"failed"|"cancelled";error:string;started_at:string;finished_at:string|null};
export type ScheduleState={schedules:BotSchedule[];runs:ScheduleRun[];worker_configured:boolean};
export function scheduleProposal(text:string):ScheduleInput|null{
 const block=text.match(/```blew-schedule\s*\n([\s\S]*?)```/);if(!block)return null;
 try{const p=JSON.parse(block[1]);if(typeof p.title!=="string"||!p.title.trim()||p.title.length>160||typeof p.prompt!=="string"||!p.prompt.trim()||p.prompt.length>16000||typeof p.timezone!=="string"||p.timezone.length>100)return null;if(p.kind==="cron"&&(typeof p.cron!=="string"||p.cron.length>150))return null;if(p.kind==="once"&&(typeof p.run_at!=="string"||!Number.isFinite(Date.parse(p.run_at))))return null;if(p.kind!=="once"&&p.kind!=="cron")return null;return {title:p.title,prompt:p.prompt,mode:"ai",computer_id:null,kind:p.kind,cron:p.kind==="cron"?p.cron:"",timezone:p.timezone,run_at:p.kind==="once"?p.run_at:null};}catch{return null;}
}
