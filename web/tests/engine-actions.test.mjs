import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function actions({user={id:7},revoke=false,selected=null,providerError=null}={}) {
  const observed={reads:[],writes:[],logins:[]};
  const config={selected,keys:{openai:{key:'never-return-me',models:[{id:'test-model',name:'Test'}]}}};
  const modules={
    '@/lib/auth':{getCurrentUser:async()=>user},
    '@/lib/api':{api:async()=>{if(revoke)throw Error('revoked');}},
    '@/lib/session':{getSessionToken:async()=>'session'},
    '@/lib/engine/catalog':{providerByID(id){if(!['openai','codex','claude-code'].includes(id))throw Error('Choose a supported provider.');return {id,mode:id==='openai'?'api':'subscription'};}},
    '@/lib/engine/store':{withEngineLock:async(id,fn)=>fn(),readConfig:async(id)=>{observed.reads.push(id);return structuredClone(config);},writeConfig:async(id,value)=>{observed.writes.push({id,value});}},
    '@/lib/engine/api-providers':{listAPIModels:async()=>{if(providerError)throw providerError;return [{id:'test-model',name:'Test'}];}},
    '@/lib/engine/clients':{codexStatus:async()=>({connected:false,models:[]}),claudeStatus:async()=>({connected:false,models:[]}),startCodex:async(id)=>{observed.logins.push(id);return {provider:'codex',url:'https://auth.openai.com/codex/device',code:'TEST'};},disconnectClient:async()=>{}},
  };
  const source=readFileSync(new URL('../src/app/actions/engine.ts',import.meta.url),'utf8');
  const {outputText}=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
  const exports={};vm.runInNewContext(outputText,{exports,Error,require(name){assert.ok(name in modules,name);return modules[name];}});
  return {exports,observed};
}
test('Engine actions reject missing and revoked sessions before credentials or clients are touched',async()=>{
  for(const options of [{user:null},{revoke:true}]) {
    const {exports,observed}=actions(options);
    assert.ok((await exports.getEngineState()).error);
    assert.ok((await exports.startEngineLogin('codex')).error);
    assert.ok((await exports.connectEngineAPI('openai','test-key')).error);
    assert.equal(observed.reads.length+observed.writes.length+observed.logins.length,0);
  }
});
test('Engine actions derive ownership from auth and never return saved API keys',async()=>{
  const {exports,observed}=actions();
  const state=await exports.getEngineState();assert.ok(state.data);
  assert.equal(JSON.stringify(state).includes('never-return-me'),false);
  await exports.startEngineLogin('codex');assert.deepEqual(observed.logins,[7]);
  const saved=await exports.selectEngine('openai','test-model');assert.ok(saved.data);
  assert.equal(observed.writes[0].id,7);
  assert.ok((await exports.selectEngine('openai','not-available')).error);
  assert.equal(observed.writes.length,1);
});

test('a different Blew account routes all storage and login work to its own identity',async()=>{
  const first=actions({user:{id:7}}),second=actions({user:{id:19}});
  await first.exports.startEngineLogin('codex');await second.exports.startEngineLogin('codex');
  await second.exports.selectEngine('openai','test-model');
  assert.deepEqual(first.observed.logins,[7]);assert.deepEqual(second.observed.logins,[19]);
  assert.deepEqual(second.observed.reads,[19]);assert.equal(second.observed.writes[0].id,19);
  assert.equal(first.observed.writes.length,0);
});


test('expired and temporarily unavailable engines retain the account credentials',async()=>{
  for(const [providerError,status] of [[Error('The provider rejected this key.'),'expired'],[Error('network unavailable'),'unavailable']]) {
    const {exports,observed}=actions({selected:{provider:'openai',model:'test-model'},providerError});
    const result=await exports.getEngineHealth(true);
    assert.equal(result.data.status,status);
    assert.equal(observed.writes.length,0);
    assert.equal(JSON.stringify(result).includes('never-return-me'),false);
  }
});
