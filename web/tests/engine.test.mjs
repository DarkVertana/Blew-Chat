import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readConfig, writeConfig, userDirectory, withEngineLock } from '../src/lib/engine/store.ts';
import { listAPIModels } from '../src/lib/engine/api-providers.ts';
import { providerByID } from '../src/lib/engine/catalog.ts';

test('engine storage encrypts credentials, persists selection and isolates accounts', async () => {
  const dir=await mkdtemp(path.join(tmpdir(),'blew-engine-test-'));
  process.env.ENGINE_DATA_DIR=dir;
  try {
    const config={selected:{provider:'openai',model:'test-model'},keys:{openai:{key:'secret-test-key',models:[{id:'test-model',name:'Test'}]}}};
    await writeConfig(1,config);
    assert.deepEqual(await readConfig(1),config);
    assert.deepEqual(await readConfig(2),{selected:null,keys:{}});
    const stored=await readFile(path.join(dir,'1','settings.enc'));
    assert.equal(stored.includes(Buffer.from('secret-test-key')),false);
    assert.equal((await stat(path.join(dir,'1','storage.key'))).mode & 0o777,0o600);
    await assert.rejects(userDirectory('../2'));
    await assert.rejects(userDirectory(0));
    await writeFile(path.join(dir,'2','storage.key'),await readFile(path.join(dir,'1','storage.key')));
    await writeFile(path.join(dir,'2','settings.enc'),stored);
    await assert.rejects(readConfig(2)); // AAD rejects ciphertext copied across users.
    stored[stored.length-1]^=1;
    await writeFile(path.join(dir,'1','settings.enc'),stored);
    await assert.rejects(readConfig(1));
  } finally {delete process.env.ENGINE_DATA_DIR;await rm(dir,{recursive:true,force:true});}
});
test('same account mutations serialize, including after a failed operation',async()=>{
  const calls=[];
  const first=withEngineLock(4,async()=>{calls.push(1);await new Promise(r=>setTimeout(r,20));calls.push(2);throw Error('test');});
  const second=withEngineLock(4,async()=>{calls.push(3);});
  await Promise.allSettled([first,second]);assert.deepEqual(calls,[1,2,3]);
});
test('API connection uses fixed endpoints, keeps keys out of URLs and forbids redirects',async()=>{
  const original=global.fetch;
  try {
    global.fetch=async(url,options)=>{
      assert.equal(url,'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000');
      assert.equal(options.headers['x-goog-api-key'],'test-secret');assert.equal(options.redirect,'error');
      return Response.json({models:[{name:'models/gemini-test',displayName:'Gemini',supportedGenerationMethods:['generateContent']},{name:'models/embedding',supportedGenerationMethods:['embedContent']}]});
    };
    assert.deepEqual(await listAPIModels('google','test-secret'),[{id:'gemini-test',name:'Gemini'}]);
    await assert.rejects(listAPIModels('google','bad\nkey'),/valid API key/);
    assert.throws(()=>providerByID('http://localhost'),/supported provider/);
    global.fetch=async()=>new Response('secret-provider-error',{status:401});
    await assert.rejects(listAPIModels('openai','test-secret'),e=>!e.message.includes('secret-provider-error')&&e.message.includes('rejected'));
    global.fetch=async()=>Response.json({data:[]});
    await assert.rejects(listAPIModels('openai','test-secret'),/No models/);
  } finally {global.fetch=original;}
});

test('expiry banners hide for healthy connections and distinguish unavailable checks',async()=>{
  const {engineBanner,claudeCredentialExpired}=await import('../src/lib/engine/health.ts');
  assert.equal(engineBanner(null),null);
  assert.equal(engineBanner({status:'connected',provider:'Codex'}),null);
  assert.equal(engineBanner({status:'expired',provider:'Codex'}).action,'Reconnect');
  assert.equal(engineBanner({status:'unconfigured'}).action,'Set up Engine');
  assert.equal(engineBanner({status:'unavailable'}).description.includes('login is saved'),true);
  assert.equal(claudeCredentialExpired({claudeAiOauth:{expiresAt:100}},101),true);
  assert.equal(claudeCredentialExpired({claudeAiOauth:{expiresAt:200}},101),false);
  assert.equal(claudeCredentialExpired({claudeAiOauth:{expiresAt:200,refreshTokenExpiresAt:100}},101),true);
  assert.equal(claudeCredentialExpired({claudeAiOauth:{expiresAt:100,refreshToken:'retained'}},101),true);
});
