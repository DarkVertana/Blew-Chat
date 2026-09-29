import {forwardAttachment} from "@/lib/attachment-proxy";
export const runtime="nodejs";
async function forward(request:Request,{params}:{params:Promise<{id:string;attachment:string}>}){const p=await params;return forwardAttachment(request,p.id,p.attachment);}
export {forward as GET,forward as DELETE};
