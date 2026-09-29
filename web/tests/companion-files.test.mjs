import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {prepareTaskFiles,runCommand} from '../public/blew-linux-companion.mjs';
test('approved file bytes are privately staged and readable by Linux commands',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'blew-files-'));const id='a'.repeat(48);const data=Buffer.from('file inspection works');
 try{const command=`cat "$BLEW_FILE_${id}"`;const env=await prepareTaskFiles({id:123,command,attachments:[{id,name:'../../unsafe name.txt',size:data.length}]},async requested=>{assert.equal(requested,id);return data;},root);
 const filename=env['BLEW_FILE_'+id];assert(filename.startsWith(root+path.sep));assert.equal((await stat(filename)).mode&0o777,0o600);assert.equal((await readFile(filename)).toString(),data.toString());
 const result=await runCommand(command,{fileEnvironment:env});assert.equal(result.exit_code,0);assert.equal(result.output,data.toString());
 }finally{await rm(root,{recursive:true,force:true});}
});
test('unavailable or corrupt file transfers stop before command execution',async()=>{
 const id='a'.repeat(48);await assert.rejects(prepareTaskFiles({id:1,command:`cat "$BLEW_FILE_${id}"`,attachments:[]},async()=>Buffer.alloc(0),'/tmp/not-used'),/unavailable/);
 const root=await mkdtemp(path.join(tmpdir(),'blew-files-'));try{await assert.rejects(prepareTaskFiles({id:1,command:`cat "$BLEW_FILE_${id}"`,attachments:[{id,name:'file.txt',size:42}]},async()=>Buffer.from('bad'),root),/Invalid file download/);}finally{await rm(root,{recursive:true,force:true});}
});
