import {forwardProfile} from "@/lib/profile-proxy";
async function forward(request:Request,{params}:{params:Promise<{id:string}>}){return forwardProfile(request,true,Number((await params).id));}
export {forward as GET,forward as PUT,forward as DELETE};
