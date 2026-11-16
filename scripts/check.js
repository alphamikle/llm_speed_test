import fs from 'node:fs';import path from 'node:path';import {runCommand} from '../src/util.js';
const root=path.resolve(import.meta.dirname,'..');let count=0;
for(const dir of ['src','bin','scripts','tests'])for(const file of fs.readdirSync(path.join(root,dir),{recursive:true}).filter(x=>x.endsWith('.js'))){const full=path.join(root,dir,file);const source=fs.readFileSync(full,'utf8');if(/\p{Script=Cyrillic}/u.test(source))throw new Error(`Non-English source text: ${full}`);const result=await runCommand(process.execPath,['--check',full]);if(result.code!==0)throw new Error(result.stderr);count++;}
for(const lang of ['en','ste','zh','ru'])JSON.parse(fs.readFileSync(path.join(root,'data/prompts',lang+'.json'),'utf8'));
console.log(`Checked ${count} JavaScript files and four language datasets`);
