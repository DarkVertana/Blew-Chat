import {test} from 'node:test';
import assert from 'node:assert/strict';
import {attachmentContent} from '../src/lib/attachment-content.ts';
test('attachment text is bounded and labelled as untrusted data',()=>{
 const result=attachmentContent('notes.txt','text/plain',Buffer.from('a'.repeat(20000)));
 assert.match(result.text,/first 16 KB only/);assert.ok(result.text.length<16200);assert.equal(result.image,undefined);
});
test('binary attachments are never fabricated as readable content',()=>{
 const result=attachmentContent('report.pdf','application/pdf',Buffer.from('%PDF-1.7'));
 assert.match(result.text,/cannot be read/);assert.equal(result.image,undefined);
});
test('JPEG and PNG attachment bytes reach multimodal engines',()=>{
 const result=attachmentContent('photo.png','image/png',Buffer.from([137,80,78,71]));assert.match(result.image,/^data:image\/png;base64,/);
});
test('invalid UTF-8 and null bytes are not decoded as instructions',()=>{
 assert.match(attachmentContent('example.txt','text/plain',Buffer.from([255,0])).text,/cannot be read/);
});
