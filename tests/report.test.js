import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {aggregate} from '../src/metrics.js';import {createReport} from '../src/report.js';import {writeJSON} from '../src/util.js';
test('reports distinguish interrupted work, request errors, and model quality failures',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sllm-report-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const base={slot:'test',model:'model',language:'en',kit:'01-prose-short',profile:'full',repetition:1,duration_ms:100,records:[],statistics:aggregate([]),validation:{passed:false,errors:['test']}};
  writeJSON(path.join(dir,'run.json'),{id:'test',profile:'full',status:'interrupted',started_at:new Date().toISOString(),active_ms:300,planned_cases:3,environment:{},models:[],cases:{a:{...base,status:'interrupted'},b:{...base,kit:'02-prose-long',status:'error'},c:{...base,kit:'03-prose-summary-short',status:'completed'}}});
  const report=createReport(dir);assert.equal(report.completed_cases,2);assert.equal(report.interrupted_cases.length,1);assert.equal(report.harness_errors,1);assert.equal(report.quality_failures,1);assert.equal(report.rows.length,2);
});
