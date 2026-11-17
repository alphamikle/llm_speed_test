import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {aggregate} from '../src/metrics.js';import {createReport} from '../src/report.js';import {writeJSON} from '../src/util.js';
test('reports distinguish interrupted work, request errors, and model quality failures',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sllm-report-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const base={slot:'test',model:'model',language:'en',kit:'01-prose-short',profile:'full',repetition:1,duration_ms:100,records:[],statistics:aggregate([]),validation:{passed:false,errors:['test']}};
  writeJSON(path.join(dir,'run.json'),{id:'test',profile:'full',status:'interrupted',started_at:new Date().toISOString(),active_ms:300,planned_cases:3,environment:{},models:[],targeted_rerun:{total:2,completed:['done'],pending:['pending'],kits:['03-prose-summary-short']},cases:{a:{...base,status:'interrupted'},b:{...base,kit:'02-prose-long',status:'error'},c:{...base,kit:'03-prose-summary-short',status:'completed'}}});
  const report=createReport(dir);assert.equal(report.completed_cases,1);assert.equal(report.attempted_cases,2);assert.equal(report.interrupted_cases.length,1);assert.equal(report.harness_errors,1);assert.equal(report.quality_failures,1);assert.equal(report.rows.length,2);
  const html=fs.readFileSync(path.join(dir,'report.html'),'utf8');
  assert.equal(report.targeted_rerun.total,2);assert.match(html,/Targeted rerun: 1\/2/);
  assert.equal((html.match(/<tr class="bad">/g)||[]).length,1);
  assert.equal((html.match(/<tr class="harness">/g)||[]).length,1);
  assert.match(html,/<th>execution_status<\/th><th>output_checks<\/th>/);
  assert.match(html,/>not evaluated<\/td>/);
  assert.match(html,/<th>check_details<\/th>/);
  const markdown=fs.readFileSync(path.join(dir,'REPORT.md'),'utf8');assert.match(markdown,/Model aggregates/);assert.match(markdown,/TTFT mean \| TTFT median \| TTFT min \| TTFT max/);assert.match(markdown,/End-to-end elapsed time/);
});
