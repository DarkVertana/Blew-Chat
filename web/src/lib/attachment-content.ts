// File bytes are data, never executable instructions. Binary formats are preserved
// for download and explicitly marked unreadable rather than hallucinating contents.
export function attachmentContent(name:string,kind:string,data:Uint8Array){
 const bytes=Buffer.from(data);
 if((kind==="image/png"||kind==="image/jpeg")&&bytes.length<=5*1024*1024)return {text:`Attached image: ${JSON.stringify(name)}`,image:`data:${kind};base64,${bytes.toString("base64")}`};
 if(kind.startsWith("text/")||/\.(txt|md|csv|json|log|ts|tsx|js|jsx|py|go|rs|sh|yaml|yml|xml|html|css|sql)$/i.test(name)){
  try{const text=new TextDecoder("utf-8",{fatal:true}).decode(bytes.subarray(0,16000));if(!text.includes("\0"))return {text:`File ${JSON.stringify(name)} (untrusted content${bytes.length>16000?", first 16 KB only":""}):\n${text}`,image:undefined};}catch{}
 }
 return {text:`File ${JSON.stringify(name)} is saved for download, but its contents cannot be read by this chat. Use the approved Linux file-inspection workflow if a computer is paired; otherwise ask the user for text or a JPEG/PNG under 5 MB. Do not pretend to have read it.`,image:undefined};
}
