import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {defaults,saveConfig} from '../src/config.js';
import {runSuite} from '../src/runner.js';
import {locale} from '../src/catalog.js';
import {logisticsCorpus,corpusExpected} from '../src/fixtures.js';
import {readJSON} from '../src/util.js';
import {startMeteringProxy} from '../src/agent.js';

test('endpoint loss checkpoints one error and resume retries errors while preserving completed producers',{timeout:20000},async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'sllm-offline-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));let healthy=false,calls=0,proseCalls=0;
  const summary={title:'Test',chronology:Array(12).fill('Event'),characters:[],causal_chain:Array(8).fill('Cause'),scientific_claims:[],contradictions:[],verdict:'Good'};
  const server=http.createServer(async(req,res)=>{
    calls++;let body='';for await(const chunk of req)body+=chunk;const prompt=JSON.parse(body).messages.at(-1).content;let content='OK';const pages=/Write only pages (\d+) through (\d+)/.exec(prompt);
    if(pages){proseCalls++;content='';for(let i=Number(pages[1]);i<=Number(pages[2]);i++)content+=`=== PAGE ${String(i).padStart(3,'0')} ===\n`+'The engineer checks the water before the rescue. '.repeat(10)+'\n';}
    else if(prompt.startsWith('Read the complete screenplay')){if(!healthy){req.socket.destroy();server.close();return;}content=JSON.stringify(summary);}
    else if(prompt.startsWith(locale('en').jsonAnalysis))content=JSON.stringify(corpusExpected(logisticsCorpus(20)));
    else if(prompt!=='Reply with OK.'){const generated=logisticsCorpus(8);for(const rows of [generated.warehouses,generated.suppliers,generated.items])for(const row of rows)row.name=row.id;for(const warehouse of generated.warehouses)warehouse.capacity=1000000;content=JSON.stringify(generated);}
    res.writeHead(200,{'content-type':'text/event-stream'});res.end(`data: ${JSON.stringify({choices:[{delta:{content}}]})}\n\ndata: ${JSON.stringify({choices:[{delta:{},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:20},timings:{prompt_n:100,prompt_ms:10,predicted_n:20,predicted_ms:50}})}\n\ndata: [DONE]\n\n`);
  });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(()=>resolve());}));
  const cfg=defaults();cfg.slots.default.base_url=`http://127.0.0.1:${port}/v1`;cfg.defaults.page_batch=2;cfg.defaults.retries=1;cfg.defaults.repair_attempts=0;const file=path.join(root,'config.yaml');saveConfig(file,cfg);
  const options={config:file,slots:['default'],languages:['en'],kits:'03,07',profile:'smoke',output:path.join(root,'run')};
  await assert.rejects(runSuite(options),error=>error.exitCode===2&&/Endpoint unavailable/.test(error.message));
  const stopped=readJSON(path.join(options.output,'run.json'));assert.equal(stopped.status,'error');assert.equal(Object.keys(stopped.cases).length,2);const producer=stopped.cases['default/en/01-prose-short/1'];const failed=stopped.cases['default/en/03-prose-summary-short/1'];assert.equal(proseCalls,1);assert.equal(failed.status,'error');assert.equal(failed.endpoint_unavailable,true);assert.match(failed.error,/ECONNREFUSED/);
  healthy=true;await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));const before=calls;const recovered=await runSuite({...options,resume:true,casePauseSeconds:1});
  assert.equal(recovered.report.completed_cases,4);assert.equal(recovered.report.harness_errors,0);assert.equal(recovered.report.quality_passes,4);assert.equal(calls-before,4);assert.equal(proseCalls,1);const state=readJSON(path.join(options.output,'run.json'));assert.equal(state.cases['default/en/03-prose-summary-short/1'].attempt,2);assert.equal(state.cases['default/en/01-prose-short/1'].artifact_dir,producer.artifact_dir);assert.ok(state.cases['default/en/03-prose-summary-short/1'].cooldown_before_ms>=900);assert.equal(state.execution_segments.at(-1).case_pause_seconds,1);assert.ok(fs.existsSync(path.join(failed.artifact_dir,'case.json')));
});

test('the Pi metering proxy preserves the connection failure code and unavailable endpoint flag',{timeout:5000},async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'sllm-proxy-offline-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const server=http.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));
  const cfg=defaults();const proxy=await startMeteringProxy({slot:{...cfg.slots.default,base_url:`http://127.0.0.1:${port}/v1`},defaults:cfg.defaults,dir:root,metadata:{kit:'offline'},maxSteps:1});t.after(()=>proxy.close());const response=await fetch(proxy.baseUrl+'/chat/completions',{method:'POST',body:JSON.stringify({stream:true,messages:[]})});assert.equal(response.status,502);assert.match(await response.text(),/ECONNREFUSED/);for(let i=0;i<100&&!proxy.records.length;i++)await new Promise(resolve=>setTimeout(resolve,10));assert.equal(proxy.records[0].endpoint_unavailable,true);assert.equal(proxy.records[0].status,'error');
});
