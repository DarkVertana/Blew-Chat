import {forwardAttachment} from "@/lib/attachment-proxy";
export const runtime="nodejs";
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){return forwardAttachment(request,(await params).id);}
