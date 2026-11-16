import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {runCommand} from '../src/util.js';import {initConfig,loadConfig} from '../src/config.js';
const cli=fileURLToPath(new URL('../bin/sllm.js',import.meta.url));
test('help works and invalid options, numbers and slots fail before model requests',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sllm-cli-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const config=path.join(dir,'config.yaml');initConfig(config);
  const call=args=>runCommand(process.execPath,[cli,'--config',config,...args]);
  const help=await call(['-h']);assert.equal(help.code,0);assert.match(help.stdout,/coding-agent/);
  for(const args of [['run','--repetitions','0'],['run','--unknown'],['--slot','missing','run'],['run','--profile','invalid']]){const r=await call(args);assert.notEqual(r.code,0,JSON.stringify(args));}
  const before=fs.readFileSync(config,'utf8');const invalid=await call(['config','set','defaults.repetitions','-1']);assert.notEqual(invalid.code,0);assert.equal(fs.readFileSync(config,'utf8'),before);
  const add=await call(['slot','add','test','--base-url','https://example.test/v1','--model','abc']);assert.equal(add.code,0,add.stderr);assert.equal(loadConfig(config,'test').slot.model,'abc');
  const added=fs.readFileSync(config,'utf8');for(const name of ['TEST','CON','trailing.']){const invalidName=await call(['slot','add',name,'--base-url','https://example.test/v1','--model','abc']);assert.notEqual(invalidName.code,0);assert.equal(fs.readFileSync(config,'utf8'),added);}
});
