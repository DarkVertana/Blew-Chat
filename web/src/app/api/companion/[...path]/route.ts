// Companion bearer tokens authenticate in Go; browser session cookies are never forwarded.
async function forward(request:Request,{params}:{params:Promise<{path:string[]}>}){
 const route=(await params).path.join("/");
 if(!/^(pair|next|tasks\/[1-9][0-9]*(?:\/attachments\/[a-f0-9]{48})?)$/.test(route))return new Response(null,{status:404});
 const headers=new Headers({"Content-Type":"application/json"});const token=request.headers.get("authorization");if(token)headers.set("authorization",token);
 try{const result=await fetch(`${process.env.API_URL||"http://localhost:8080"}/api/companion/${route}`,{method:request.method,headers,body:request.method==="POST"?request.body:undefined,duplex:"half",redirect:"error",cache:"no-store",signal:AbortSignal.timeout(15000)} as RequestInit);return new Response(result.body,{status:result.status,headers:{"Content-Type":result.headers.get("content-type")||"application/json","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});}catch{return Response.json({error:"Server unavailable"},{status:502});}
}
export {forward as GET,forward as POST};
