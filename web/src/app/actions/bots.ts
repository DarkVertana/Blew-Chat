"use server";
import {api,ApiError} from "@/lib/api";
import {getSessionToken} from "@/lib/session";
import type {Bot,BotConversation,Computer,ComputerTask} from "@/lib/bots";
async function request<T>(path:string,method="GET",json?:unknown):Promise<{data:T;error?:never}|{error:string;data?:never}>{
 const token=await getSessionToken();if(!token)return {error:"Please sign in again."};
 try{return {data:await api<T>(path,{method,token,json})};}catch(e){return {error:e instanceof ApiError?e.message:"Could not reach the server. Please try again."};}
}
function id(value:number){if(!Number.isSafeInteger(value)||value<1)throw new Error("Invalid account resource.");return value;}
export async function listBots(){return request<Bot[]>("/api/bots");}
export async function saveBot(details:{name:string;designation:string;instructions:string},botID?:number){return request<Bot>(botID?`/api/bots/${id(botID)}`:"/api/bots",botID?"PUT":"POST",details);}
export async function getBotConversation(botID:number,before?:number){return request<BotConversation>(`/api/bots/${id(botID)}${before?`?before=${id(before)}`:""}`);}
export async function listComputers(){return request<Computer[]>("/api/computers");}
export async function createComputerPairing(){return request<{code:string}>("/api/computers/pairing","POST");}
export async function revokeComputer(computerID:number){return request<void>(`/api/computers/${id(computerID)}`,"DELETE");}
export async function listComputerTasks(botID:number){return request<ComputerTask[]>(`/api/bots/${id(botID)}/tasks`);}
export async function decideComputerTask(botID:number,taskID:number,decision:"approve"|"cancel",computerID:number){return request<void>(`/api/bots/${id(botID)}/tasks/${id(taskID)}`,"POST",{decision,computer_id:computerID});}
export async function listSchedules(botID:number){return request<import("@/lib/schedules").ScheduleState>(`/api/bots/${id(botID)}/schedules`);}
export async function previewSchedule(botID:number,details:import("@/lib/schedules").ScheduleInput){return request<string[]>(`/api/bots/${id(botID)}/schedules/preview`,"POST",details);}
export async function saveSchedule(botID:number,details:import("@/lib/schedules").ScheduleInput,approveCommand:boolean,scheduleID?:number){return request<import("@/lib/schedules").BotSchedule>(`/api/bots/${id(botID)}/schedules${scheduleID?`/${id(scheduleID)}`:""}`,scheduleID?"PUT":"POST",{...details,approve_command:approveCommand});}
export async function controlSchedule(botID:number,scheduleID:number,action:"pause"|"resume"|"run"|"delete"){return request<void>(`/api/bots/${id(botID)}/schedules/${id(scheduleID)}/control`,"POST",{action});}
export async function recallBotMemory(botID:number,query=""){return request<import("@/lib/bot-memory").MemoryRecall>(`/api/bots/${id(botID)}/memory?q=${encodeURIComponent(query.slice(0,1000))}`);}
export async function saveBotMemory(botID:number,text:string){return request<void>(`/api/bots/${id(botID)}/memory`,"POST",{text});}
export async function forgetBotMemory(botID:number,memoryID:number){return request<void>(`/api/bots/${id(botID)}/memory/${id(memoryID)}`,"DELETE");}

export async function deleteBot(botID:number){return request<void>(`/api/bots/${id(botID)}`,"DELETE");}
