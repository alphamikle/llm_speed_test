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
  await assert.rejects(runSuite({...options,resume:true,dimensions:{pages:3}}),/differ/);assert.ok(!fs.existsSync(path.join(result.dir,'run.lock')));
});
