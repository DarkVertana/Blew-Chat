import {getSessionToken} from "./session";
export async function forwardAttachment(request:Request,bot:string,attachment?:string){
 if(!/^[1-9]\d*$/.test(bot)||(attachment&&!/^[a-f0-9]{48}$/.test(attachment)))return Response.json({error:"Not found"},{status:404});
 if(request.method!=="GET") {try{if(new URL(request.headers.get("origin")||"").host!==request.headers.get("host"))throw Error();}catch{return Response.json({error:"Invalid origin"},{status:403});}}
 const token=await getSessionToken();if(!token)return Response.json({error:"Please sign in again."},{status:401});
 const headers=new Headers({Authorization:`Bearer ${token}`});headers.set("X-File-Name",request.headers.get("x-file-name")||"");
 const init:RequestInit&{duplex?:"half"}={method:request.method,headers,cache:"no-store",signal:AbortSignal.any([request.signal,AbortSignal.timeout(60000)])};
 if(request.method==="POST"){init.body=request.body;init.duplex="half";}
 try{const result=await fetch(`${process.env.API_URL||"http://localhost:8080"}/api/bots/${bot}/attachments${attachment?`/${attachment}`:""}`,init);const outgoing=new Headers({"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Content-Security-Policy":"sandbox"});for(const name of ["content-type","content-disposition"])if(result.headers.has(name))outgoing.set(name,result.headers.get(name)!);return new Response(result.body,{status:result.status,headers:outgoing});}catch{return Response.json({error:"Upload service unavailable. Please try again."},{status:502});}
}
