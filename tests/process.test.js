import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {runCommand} from '../src/util.js';
function alive(pid){try{process.kill(pid,0);if(process.platform==='linux'){const stat=fs.readFileSync(`/proc/${pid}/stat`,'utf8');if(stat.slice(stat.lastIndexOf(')')+2).startsWith('Z'))return false;}return true;}catch{return false;}}
test('command timeout also stops a detached descendant',{timeout:15000},async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'sllm-process-'));const pidFile=path.join(root,'child.pid');const script=path.join(root,'parent.mjs');let pid;
  t.after(()=>{if(pid&&alive(pid))try{process.kill(pid,'SIGKILL');}catch{}fs.rmSync(root,{recursive:true,force:true});});
  fs.writeFileSync(script,`import {spawn} from 'node:child_process';import fs from 'node:fs';const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore',windowsHide:true});fs.writeFileSync(process.argv[2],String(child.pid));setInterval(()=>{},1000);`);
  const result=await runCommand(process.execPath,[script,pidFile],{timeoutMs:2000});assert.equal(result.timedOut,true);assert.ok(fs.existsSync(pidFile));pid=Number(fs.readFileSync(pidFile,'utf8'));
  for(let i=0;i<100&&alive(pid);i++)await new Promise(resolve=>setTimeout(resolve,20));assert.equal(alive(pid),false,'Detached child survived the timeout');
});
test('command cancellation rejects without waiting for its normal deadline',{timeout:10000},async()=>{
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(new Error('Cancelled test')),100);try{await assert.rejects(runCommand(process.execPath,['-e','setInterval(()=>{},1000)'],{timeoutMs:30000,signal:controller.signal}),/Cancelled test/);}finally{clearTimeout(timer);}
});
