import {api,ApiError} from "@/lib/api";
import {getSessionToken} from "@/lib/session";
import type {BotConversation,ComputerTask,Computer} from "@/lib/bots";
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 const {id}=await params;if(!/^[1-9]\d*$/.test(id))return Response.json({error:"Not found"},{status:404});
 const token=await getSessionToken();if(!token)return Response.json({error:"Please sign in again."},{status:401});
 try{const [conversation,tasks,computers]=await Promise.all([api<BotConversation>(`/api/bots/${id}`,{token}),api<ComputerTask[]>(`/api/bots/${id}/tasks`,{token}),api<Computer[]>("/api/computers",{token})]);return Response.json({conversation,tasks,computers},{headers:{"Cache-Control":"private, no-store"}});}catch(e){return Response.json({error:e instanceof ApiError?e.message:"Could not update this chat."},{status:e instanceof ApiError?e.status:502});}
}
