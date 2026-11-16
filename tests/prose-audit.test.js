import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {auditProse,createProseAudit} from '../src/prose-audit.js';

const words=Array.from({length:180},(_,i)=>`word${String.fromCharCode(97+Math.floor(i/26),97+i%26)}`);
test('prose audit detects near duplicates despite changed counters but preserves independent pages',()=>{
  const text=`=== PAGE 001 ===\n${words.join(' ')} altitude 21\n=== PAGE 002 ===\n${words.join(' ')} altitude 41\n=== PAGE 003 ===\n${words.toReversed().join(' ')}`;
  const result=auditProse(text);assert.equal(result.flagged,true);assert.equal(result.near_duplicate_pages.length,1);assert.equal(result.near_duplicate_pages[0].page,2);assert.equal(result.near_duplicate_pages[0].similar_to,1);assert.equal(result.near_duplicate_pages[0].similarity,1);assert.equal(result.internally_repetitive_pages.length,0);
  assert.equal(auditProse('=== PAGE 001 ===\n'+words.join(' ')).flagged,false);
});
test('prose audit handles unspaced Han text and internal loops',()=>{
  const body=Array.from({length:160},(_,i)=>String.fromCodePoint(0x4e00+i)).join('');
  assert.equal(auditProse(`=== PAGE 001 ===\n${body}\n=== PAGE 002 ===\n${body}`).near_duplicate_pages.length,1);
  assert.equal(auditProse('=== PAGE 001 ===\n'+'The same sentence repeats for no reason. '.repeat(70)).internally_repetitive_pages.length,1);
});
test('post-run audit records missing files without changing original validation or timing',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'sllm-prose-audit-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const original=JSON.stringify({id:'test',cases:{one:{status:'completed',slot:'test',kit:'01-prose-short',language:'en',repetition:1,validation:{passed:true},duration_ms:100,output_file:path.join(root,'missing.txt')}}});
  fs.writeFileSync(path.join(root,'run.json'),original);const result=createProseAudit(root);assert.equal(result.unavailable_cases,1);assert.equal(result.rows[0].as_run_structural_passed,true);assert.equal(fs.readFileSync(path.join(root,'run.json'),'utf8'),original);assert.ok(fs.existsSync(path.join(root,'PROSE-AUDIT.md')));
});
