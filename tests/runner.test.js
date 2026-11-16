import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';
import {defaults,saveConfig} from '../src/config.js';import {runSuite} from '../src/runner.js';import {readJSON} from '../src/util.js';
test('complete case execution checkpoints, reports, resumes without duplicate calls, and rejects changed settings',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sllm-suite-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));let calls=0;
  const server=http.createServer(async(req,res)=>{calls++;let body='';for await(const chunk of req)body+=chunk;const request=JSON.parse(body);const prompt=request.messages.at(-1).content;let content='OK';
    const pages=/Write only pages (\d+) through (\d+)/.exec(prompt);
    if(pages){content='';for(let i=Number(pages[1]);i<=Number(pages[2]);i++)content+=`=== PAGE ${String(i).padStart(3,'0')} ===\n`+'The engineer checks the water before the final rescue. '.repeat(10)+'\n';}
    else if(prompt.startsWith('Read the complete screenplay'))content=JSON.stringify({title:'Test',chronology:Array.from({length:12},(_,i)=>`Event ${i}`),characters:[],causal_chain:Array.from({length:8},(_,i)=>`Cause ${i}`),scientific_claims:[],contradictions:[],verdict:'Good'});
    res.writeHead(200,{'content-type':'text/event-stream'});res.end(`data: ${JSON.stringify({choices:[{delta:{content}}]})}\n\ndata: ${JSON.stringify({choices:[{delta:{},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:20},timings:{prompt_n:100,prompt_ms:10,predicted_n:20,predicted_ms:50}})}\n\ndata: [DONE]\n\n`);
  });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const config=defaults();config.slots.default.base_url=`http://127.0.0.1:${server.address().port}/v1`;config.defaults.page_batch=1;config.defaults.repair_attempts=0;const file=path.join(dir,'config.yaml');saveConfig(file,config);
  const options={config:file,slots:['default'],languages:['en'],kits:'03',profile:'smoke',output:path.join(dir,'run')};
  const result=await runSuite(options);assert.equal(result.report.completed_cases,2);assert.equal(result.report.quality_passes,2);assert.ok(fs.existsSync(path.join(result.dir,'report.html')));assert.ok(fs.existsSync(path.join(result.dir,'steps.csv')));const before=calls;
  await runSuite({...options,resume:true});assert.equal(calls,before);assert.equal(readJSON(path.join(result.dir,'run.json')).status,'completed');
  await assert.rejects(runSuite({...options,rerunKits:'03'}),/requires --resume/);
  await assert.rejects(runSuite({...options,resume:true,rerunKits:'05'}),/outside the original/);assert.equal(calls,before);
  const original=readJSON(path.join(result.dir,'run.json'));const summaryKey='default/en/03-prose-summary-short/1';const generationKey='default/en/01-prose-short/1';const oldCase=original.cases[summaryKey];
  const orphan=path.join(path.dirname(oldCase.artifact_dir),'attempt-2');fs.mkdirSync(orphan);fs.writeFileSync(path.join(orphan,'crash.txt'),'Uncheckpointed crash output');
  const controller=new AbortController();
  await assert.rejects(runSuite({...options,resume:true,rerunKits:'03',signal:controller.signal,log:message=>{if(message.startsWith('RERUN '))controller.abort(new Error('Interrupted replay test'));}}),/Interrupted replay test/);
  const interrupted=readJSON(path.join(result.dir,'run.json'));assert.equal(interrupted.status,'interrupted');assert.equal(interrupted.cases[summaryKey].attempt,3);assert.equal(interrupted.cases[generationKey].attempt,1);assert.deepEqual(interrupted.targeted_rerun.pending,[summaryKey]);assert.equal(calls,before+1);
  const interruptedBytes=fs.readFileSync(path.join(result.dir,'run.json'),'utf8');await assert.rejects(runSuite({...options,resume:true,rerunKits:'01'}),/unfinished targeted rerun/);assert.equal(fs.readFileSync(path.join(result.dir,'run.json'),'utf8'),interruptedBytes);
  await runSuite({...options,resume:true});const replayed=readJSON(path.join(result.dir,'run.json'));assert.equal(calls,before+3);assert.equal(replayed.cases[summaryKey].attempt,4);assert.equal(replayed.cases[generationKey].attempt,1);assert.deepEqual(replayed.targeted_rerun.pending,[]);assert.deepEqual(replayed.targeted_rerun.completed,[summaryKey]);assert.equal(replayed.targeted_rerun.attempts.length,2);assert.ok(fs.existsSync(path.join(oldCase.artifact_dir,'case.json')));assert.equal(fs.readFileSync(path.join(orphan,'crash.txt'),'utf8'),'Uncheckpointed crash output');
  await runSuite({...options,resume:true});assert.equal(calls,before+3);
  const checkpoint=fs.readFileSync(path.join(result.dir,'run.json'),'utf8');await assert.rejects(runSuite({...options,resume:true,dimensions:{pages:3}}),/differ/);assert.ok(!fs.existsSync(path.join(result.dir,'run.lock')));assert.equal(fs.readFileSync(path.join(result.dir,'run.json'),'utf8'),checkpoint);
});
