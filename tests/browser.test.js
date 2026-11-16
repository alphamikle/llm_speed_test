import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {inspectGame,serveWorkspace} from '../src/browser.js';
test('browser evaluator performs desktop/mobile interaction and produces real screenshots',{timeout:60000},async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'sllm-browser-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const cells=Array.from({length:100},(_,i)=>`<button data-testid="opponent-cell-${Math.floor(i/10)}-${i%10}">.</button>`).join('');
  fs.writeFileSync(path.join(root,'index.html'),`<!doctype html><meta name="viewport" content="width=device-width"><h1>Fixture</h1><button data-testid="auto-place">Place</button><button data-testid="start-game">Start</button><button data-testid="restart">Restart</button><div style="display:grid;grid-template-columns:repeat(10,25px)">${cells}</div>`);
  fs.writeFileSync(path.join(root,'ship.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20"/></svg>');
  const result=await inspectGame(root,path.join(root,'screenshots'));assert.ok(result.passed,JSON.stringify(result));assert.equal(result.viewports.length,2);assert.ok(fs.statSync(path.join(root,'screenshots/desktop.png')).size>1000);
});
test('workspace HTTP server does not expose files outside its root',async t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'sllm-static-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const server=await serveWorkspace(root);t.after(()=>server.close());const result=await fetch(server.url+'/%2e%2e%2fsecret');assert.equal(result.status,403);});
