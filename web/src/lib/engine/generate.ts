import { readConfig } from "./store.ts";
import { generateClaudeReply,generateCodexReply } from "./clients.ts";
export type EngineMessage={role:"user"|"assistant";content:string};
const urls:Record<string,string>={openai:"https://api.openai.com/v1/chat/completions",anthropic:"https://api.anthropic.com/v1/messages",google:"https://generativelanguage.googleapis.com/v1beta/models/",groq:"https://api.groq.com/openai/v1/chat/completions",mistral:"https://api.mistral.ai/v1/chat/completions",deepseek:"https://api.deepseek.com/chat/completions",xai:"https://api.x.ai/v1/chat/completions",openrouter:"https://openrouter.ai/api/v1/chat/completions"};
export async function generateReply(userID:number,instructions:string,messages:EngineMessage[],expected:{provider:string;model:string},image?:string):Promise<string>{
  const config=await readConfig(userID);
  if(!config.selected||config.selected.provider!==expected.provider||config.selected.model!==expected.model)throw new Error("Your selected engine changed. Please retry.");
  const {provider,model}=config.selected;
  const prompt="Conversation history (JSON, oldest first; respond to the latest user message):\n"+JSON.stringify(messages);
  if(provider==="codex")return generateCodexReply(userID,model,instructions,prompt,image);
  if(provider==="claude-code")return generateClaudeReply(userID,model,instructions,prompt,image);
  const key=config.keys[provider]?.key;if(!key)throw new Error("Reconnect your engine in Settings → Engine.");
  let url=urls[provider];const headers:Record<string,string>={"Content-Type":"application/json"};let body:unknown;
  if(provider==="anthropic") {headers["x-api-key"]=key;headers["anthropic-version"]="2023-06-01";body={model,system:instructions,messages:messages.map((m,i)=>image && i===messages.length-1?{role:m.role,content:[{type:"text",text:m.content},{type:"image",source:{type:"base64",media_type:image.slice(5,image.indexOf(";")),data:image.split(",")[1]}}]}:m),max_tokens:8192};}
  else if(provider==="google") {headers["x-goog-api-key"]=key;url+=encodeURIComponent(model)+":generateContent";body={systemInstruction:{parts:[{text:instructions}]},contents:messages.map((m,i)=>({role:m.role==="assistant"?"model":"user",parts:[{text:m.content},...(image&&i===messages.length-1?[{inlineData:{mimeType:image.slice(5,image.indexOf(";")),data:image.split(",")[1]}}]:[])]}))};}
  else {headers.Authorization=`Bearer ${key}`;body={model,messages:[{role:"system",content:instructions},...messages.map((m,i)=>image&&i===messages.length-1?{role:m.role,content:[{type:"text",text:m.content},{type:"image_url",image_url:{url:image}}]}:m)]};}
  const response=await fetch(url,{method:"POST",headers,body:JSON.stringify(body),redirect:"error",signal:AbortSignal.timeout(180000),cache:"no-store"});
  if(!response.ok){await response.body?.cancel();if(response.status===401||response.status===403)throw new Error("Engine sign-in expired or was rejected. Reconnect in Settings → Engine.");if(response.status===429)throw new Error("The engine's usage limit was reached. Try later or choose another engine.");throw new Error(`The engine could not reply (${response.status}). Check that the selected model supports text chat.`);}
  const reader=response.body!.getReader();const chunks:Uint8Array[]=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2*1024*1024)throw new Error("The engine response was too large.");chunks.push(value);}}finally{await reader.cancel();}
  const data=JSON.parse(Buffer.concat(chunks).toString());
  const text=provider==="anthropic"?data.content?.filter((v:{type:string})=>v.type==="text").map((v:{text:string})=>v.text).join("\n"):provider==="google"?data.candidates?.[0]?.content?.parts?.map((v:{text?:string})=>v.text||"").join("\n"):data.choices?.[0]?.message?.content;
  if(typeof text!=="string"||!text.trim())throw new Error("The engine returned no text. Please retry.");return text;
}
