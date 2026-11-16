import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {defaults} from '../src/config.js';import {runAgent} from '../src/agent.js';
test('agent deadlines retain unfinished tool timing and the stop reason',{timeout:10000},async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'sllm-deadline-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const script=path.join(root,'hanging.mjs');
  fs.writeFileSync(script,`console.log(JSON.stringify({type:'turn_start'}));console.log(JSON.stringify({type:'tool_execution_start',toolCallId:'unfinished',toolName:'bash',args:{command:'long task'}}));setInterval(()=>{},1000);`);
  const config=defaults();const result=await runAgent({slot:config.slots.default,defaults:{...config.defaults,agent_timeout_seconds:1},agent:{...config.agent,command:process.execPath,args:[script]},dir:path.join(root,'artifacts'),workspace:path.join(root,'workspace'),prompt:'Test',system:'Test',metadata:{kit:'deadline'}});
  assert.equal(result.success,false);assert.equal(result.termination_reason,'timeout');assert.equal(result.tool_count,1);assert.equal(result.tool_errors,1);assert.equal(result.tools[0].incomplete,true);assert.ok(result.tools[0].duration_ms>500);assert.match(result.error,/timeout/);
});
