import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mergeConversation,optimisticTurn} from '../src/lib/chat-state.ts';
const bot={id:1};
const state=turns=>({bot,before:null,turns});
test('sent message is visible immediately and survives a snapshot taken before persistence',()=>{const optimistic=optimisticTurn('send-1','New message',[]);const result=mergeConversation(state([optimistic]),state([]));assert.equal(result.turns[0].user_text,'New message');});
test('stale pending refresh cannot hide a completed reply',()=>{const pending=optimisticTurn('send-1','Hello',[]);const complete={...pending,status:'complete',assistant_text:'Reply now visible'};assert.equal(mergeConversation(state([complete]),state([pending])).turns[0].assistant_text,'Reply now visible');});
test('completion updates the existing bubble without duplicates and retains older loaded history',()=>{const old={...optimisticTurn('older','Old',[]),started_at:'2020-01-01T00:00:00Z'};const pending=optimisticTurn('send-1','Hello',[]);const result=mergeConversation(state([old,pending]),state([{...pending,status:'complete',assistant_text:'Done'}]));assert.equal(result.turns.length,2);assert.equal(result.turns[1].assistant_text,'Done');});
test('switching bots never merges another bot history',()=>{const result=mergeConversation(state([optimisticTurn('private','Secret',[])]),{bot:{id:2},before:null,turns:[]});assert.equal(result.turns.length,0);});
