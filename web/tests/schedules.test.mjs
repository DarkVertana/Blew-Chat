import test from 'node:test';
import assert from 'node:assert/strict';
import {scheduleProposal} from '../src/lib/schedules.ts';
test('AI schedule suggestions remain reviewable AI tasks, never approved commands',()=>{
 const task=scheduleProposal('```blew-schedule\n'+JSON.stringify({title:'Daily report',prompt:'Review tasks',kind:'cron',cron:'0 9 * * *',timezone:'Asia/Kolkata',mode:'command',computer_id:7,approve_command:true})+'\n```');
 assert.equal(task.mode,'ai');assert.equal(task.computer_id,null);assert.equal(task.cron,'0 9 * * *');assert.equal(task.approve_command,undefined);
});
test('invalid AI schedule cards are not actionable',()=>{for(const text of ['ordinary message','```blew-schedule\n{}\n```','```blew-schedule\n{"title":"x","prompt":"y","kind":"once","run_at":"invalid","timezone":"UTC"}\n```'])assert.equal(scheduleProposal(text),null);});
