import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
const companion=fileURLToPath(new URL('../public/blew-linux-companion.mjs',import.meta.url));
function run(config){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,[companion,'--service'],{env:{...process.env,XDG_CONFIG_HOME:config},stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Service did not stop'));},5000);child.on('error',reject);child.on('close',code=>{clearTimeout(timer);resolve({code,output});});});}
test('unpaired background agent exits without prompting or retrying',{skip:process.platform!=='linux'},async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'blew-service-'));
 try{const result=await run(root);assert.equal(result.code,78);assert.match(result.output,/Pairing is missing/);assert.doesNotMatch(result.output,/One-time pairing code/);}finally{await rm(root,{recursive:true,force:true});}
});
test('revoked background agent stops without exposing its token',{skip:process.platform!=='linux'},async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'blew-service-'));const token='private-test-device-token';
 const server=createServer((req,res)=>{assert.equal(req.headers.authorization,'Bearer '+token);res.writeHead(401);res.end();});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{await mkdir(path.join(root,'blew-code'));await writeFile(path.join(root,'blew-code','companion.json'),JSON.stringify({server:`http://127.0.0.1:${server.address().port}`,token}));const result=await run(root);assert.equal(result.code,78);assert.match(result.output,/disconnected/);assert(!result.output.includes(token));}finally{server.close();await rm(root,{recursive:true,force:true});}
});
