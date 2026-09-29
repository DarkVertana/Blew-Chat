#!/usr/bin/env node
// Blew Chats Linux companion. Node.js 24+, no npm dependencies.
// Runs only commands approved in the owning Blew account's chat.
import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {homedir,hostname} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createInterface} from 'node:readline/promises';

export function runCommand(command,{cwd=homedir(),timeout=90000,shouldContinue=async()=>true,fileEnvironment={}}={}) {
 return new Promise(resolve=>{
  const env={...Object.fromEntries(Object.entries(fileEnvironment).filter(([key])=>/^BLEW_FILE_[a-f0-9]{48}$/.test(key))),PATH:process.env.PATH||'/usr/local/bin:/usr/bin:/bin',HOME:homedir(),USER:process.env.USER||'',LANG:process.env.LANG||'C.UTF-8',DISPLAY:process.env.DISPLAY||'',WAYLAND_DISPLAY:process.env.WAYLAND_DISPLAY||'',XDG_RUNTIME_DIR:process.env.XDG_RUNTIME_DIR||'',DBUS_SESSION_BUS_ADDRESS:process.env.DBUS_SESSION_BUS_ADDRESS||''};
  const child=spawn('/bin/sh',['-c',command],{cwd,env,stdio:['ignore','pipe','pipe'],detached:true});
  let output=Buffer.alloc(0),reason='',done=false,checking=false;
  const kill=()=>{try{process.kill(-child.pid,'SIGKILL');}catch{child.kill('SIGKILL');}};
  const append=data=>{if(output.length<60000)output=Buffer.concat([output,data]).subarray(0,60000);};
  child.stdout.on('data',append);child.stderr.on('data',append);
  const deadline=setTimeout(()=>{reason='\n[Stopped after the 90-second task limit.]';kill();},timeout);
  const heartbeat=setInterval(async()=>{if(checking)return;checking=true;try{if(!await shouldContinue()){reason='\n[Stopped: task cancelled or computer disconnected.]';kill();}}catch{reason='\n[Stopped: could not verify continued authorization.]';kill();}finally{checking=false;}},2000);
  const shutdown=()=>{reason='\n[Companion stopped.]';kill();};process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
  const finish=code=>{if(done)return;done=true;clearTimeout(deadline);clearInterval(heartbeat);process.removeListener('SIGINT',shutdown);process.removeListener('SIGTERM',shutdown);resolve({output:output.toString('utf8')+(output.length>=60000?'\n[Output truncated.]':'')+reason,exit_code:code??1});};
  child.on('error',()=>{reason='Could not start the Linux shell.';finish(1);});child.on('close',finish);
 });
}
// Files are downloaded only after task approval, with task-scoped authorization.
// Keep them in private local task folders so viewers can still read them after
// the command exits. The account owner can remove those folders when finished.
export async function prepareTaskFiles(task,download,root){
 const files=task.attachments||[];
 const referenced=[...task.command.matchAll(/BLEW_FILE_([a-f0-9]{48})/g)].map(match=>match[1]);
 if(referenced.some(id=>!files.some(file=>file.id===id)))throw Error('A referenced task file is unavailable.');
 if(!files.length)return {};
 if(files.length>100)throw Error('Too many task files.');
 await mkdir(root,{recursive:true,mode:0o700});
 const directory=await mkdtemp(path.join(root,`task-${task.id}-`));
 const fileEnvironment={};
 for(const file of files){
  if(!/^[a-f0-9]{48}$/.test(file.id)||!task.command.includes('BLEW_FILE_'+file.id))throw Error('Invalid task file.');
  const bytes=await download(file.id);if(bytes.length>10*1024*1024||bytes.length!==file.size)throw Error('Invalid file download.');
  const extension=path.extname(file.name).replace(/[^a-zA-Z0-9.]/g,'').slice(0,16);
  const filename=path.join(directory,file.id+extension);await writeFile(filename,bytes,{mode:0o600,flag:'wx'});fileEnvironment['BLEW_FILE_'+file.id]=filename;
 }
 return fileEnvironment;
}
export function validateServer(value){const url=new URL(value);if(url.username||url.password||url.search||url.hash||url.pathname!=='/')throw Error('Use only the Blew server origin, without credentials or a path.');if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw Error('Use HTTPS for a remote Blew server. HTTP is allowed only on localhost.');return url.origin;}
async function main(){
 if(process.platform!=='linux')throw Error('Run this companion on the Linux machine you want the bot to control.');
 const directory=path.join(process.env.XDG_CONFIG_HOME||path.join(homedir(),'.config'),'blew-code');const file=path.join(directory,'companion.json');
 let config;
 try{config=JSON.parse(await readFile(file,'utf8'));}catch{}
 if(process.argv.includes('--pair')||!config){
  const readline=createInterface({input:process.stdin,output:process.stdout});
  try{
   const server=validateServer(await readline.question('Blew server origin (e.g. https://blew.example.com): '));
   const code=(await readline.question('One-time pairing code from your Blew chat: ')).trim();
   const response=await fetch(server+'/api/companion/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code,name:hostname(),platform:'linux'}),redirect:'error',signal:AbortSignal.timeout(15000)});
   if(!response.ok)throw Error('Pairing failed. Generate a fresh code in your account.');
   const paired=await response.json();config={server,token:paired.token};
   await mkdir(directory,{recursive:true,mode:0o700});await writeFile(file,JSON.stringify(config),{mode:0o600});
  }finally{readline.close();}
 }
 validateServer(config.server);
 const request=async(route,method='GET',body)=>{const response=await fetch(config.server+'/api/companion/'+route,{method,headers:{Authorization:'Bearer '+config.token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(10000)});if(response.status===401)throw Error('DISCONNECTED');if(!response.ok)throw Error('Server request failed');return response.status===204?null:response.json();};
 console.log('Linux companion connected. Only commands you approve in this Blew account will run. Ctrl+C stops the companion.');
 let stopping=false;const stop=()=>{stopping=true;};process.on('SIGINT',stop);process.on('SIGTERM',stop);
 while(!stopping){
  try{
   const {task}=await request('next','POST',{});
   if(task){
    console.log(`Running approved task ${task.id}…`);let result;
    try{
     const fileEnvironment=await prepareTaskFiles(task,async fileID=>{
      const response=await fetch(config.server+`/api/companion/tasks/${task.id}/attachments/${fileID}`,{headers:{Authorization:'Bearer '+config.token},redirect:'error',signal:AbortSignal.timeout(30000)});
      if(!response.ok)throw Error('File download not authorized.');return new Uint8Array(await response.arrayBuffer());
     },path.join(directory,'task-files'));
     if(stopping||(await request('tasks/'+task.id)).status!=='running')throw Error('Task was cancelled.');
     result=await runCommand(task.command,{fileEnvironment,shouldContinue:async()=>!stopping&&(await request('tasks/'+task.id)).status==='running'});
    }catch{result={output:'Could not prepare the approved task files, or the task was cancelled. No command was started.',exit_code:1};}
    await request('tasks/'+task.id,'POST',result);console.log(`Task ${task.id} finished (exit ${result.exit_code}).`);
   }
  }catch(e){if(e.message==='DISCONNECTED'){console.log('Computer disconnected by the account owner. Pair again with --pair.');break;}console.error('Connection interrupted; retrying shortly.');}
  if(!stopping)await new Promise(resolve=>setTimeout(resolve,3000));
 }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){main().catch(error=>{console.error(error.message);process.exitCode=1;});}
