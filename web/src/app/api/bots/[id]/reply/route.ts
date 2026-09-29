import {respondToBot} from "@/lib/bot-reply";
export const runtime="nodejs";
export const maxDuration=240;
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 try {
  if(new URL(request.headers.get("origin")||"").host!==request.headers.get("host"))return Response.json({error:"Invalid origin"},{status:403});
 }catch{return Response.json({error:"Invalid origin"},{status:403});}
 try{
  const reader=request.body!.getReader();const chunks:Uint8Array[]=[];let bytes=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>1200000)return Response.json({error:"Message or screen frame is too large."},{status:413});chunks.push(value);}}finally{await reader.cancel();}
  const body=JSON.parse(Buffer.concat(chunks).toString());
  const result=await respondToBot(Number((await params).id),body.id,body.text,body.image,body.voice===true,body.attachments,body.reply_to);
  return Response.json(result,{headers:{"Cache-Control":"private, no-store"}});
 }catch(e){const message=e instanceof Error&&/^(Please sign|Enter a message|Screen frame|Attachment|Choose an engine)/.test(e.message)?e.message:"Could not send this message. Please try again.";return Response.json({error:message},{status:400});}
}
