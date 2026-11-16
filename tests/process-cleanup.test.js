import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {cleanupWorkspaceProcesses} from '../src/process-cleanup.js';

test('workspace cleanup reaches an orphan in its own process group and preserves outside processes',{skip:process.platform!=='linux',timeout:10000},async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'sllm-cleanup-'));const workspace=path.join(root,'workspace');fs.mkdirSync(workspace);
  const outside=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{cwd:root,stdio:'ignore',detached:true});let orphan;
  t.after(()=>{for(const pid of [outside.pid,orphan])try{process.kill(pid,'SIGKILL');}catch{}fs.rmSync(root,{recursive:true,force:true});});
  const pidFile=path.join(root,'orphan.pid');
  const source=`const {spawn}=require('node:child_process');const fs=require('node:fs');const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{cwd:process.argv[1],detached:true,stdio:'ignore'});fs.writeFileSync(process.argv[2],String(child.pid));child.unref();`;
  const parent=spawn(process.execPath,['-e',source,workspace,pidFile],{stdio:'ignore'});await once(parent,'close');orphan=Number(fs.readFileSync(pidFile,'utf8'));
  await new Promise(resolve=>setTimeout(resolve,150));
  const result=await cleanupWorkspaceProcesses(workspace);
  assert.equal(result.supported,true);assert.ok(result.processes.some(record=>record.pid===orphan));assert.ok(result.processes.every(record=>!record.remaining));assert.doesNotThrow(()=>process.kill(outside.pid,0));
});
