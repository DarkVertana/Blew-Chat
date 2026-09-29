import {getCurrentUser} from "@/lib/auth";
export const runtime="nodejs";
export const maxDuration=180;
export async function POST(request:Request){
 try{if(new URL(request.headers.get("origin")||"").host!==request.headers.get("host"))return Response.json({error:"Invalid origin"},{status:403});}catch{return Response.json({error:"Invalid origin"},{status:403});}
 if(!await getCurrentUser())return Response.json({error:"Please sign in again."},{status:401});
 const reader=request.body?.getReader();if(!reader)return Response.json({error:"No audio received."},{status:400});
 const chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>8*1024*1024)return Response.json({error:"Audio is too large. Try a shorter sentence."},{status:413});chunks.push(value);}}finally{await reader.cancel();}
 const form=new FormData();form.set("audio",new Blob(chunks as BlobPart[],{type:request.headers.get("content-type")||"audio/webm"}),"speech.webm");
 try{const response=await fetch(`${process.env.SPEECH_URL||"http://speech:8090"}/transcribe`,{method:"POST",body:form,signal:AbortSignal.timeout(150000),cache:"no-store"});if(!response.ok)return Response.json({error:"Speech recognition is unavailable or warming up. Try again shortly."},{status:503});const data=await response.json();return Response.json({text:typeof data.text==="string"?data.text:""},{headers:{"Cache-Control":"no-store"}});}catch{return Response.json({error:"Speech recognition is unavailable. Check the speech service."},{status:503});}
}
