import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from './transport.js';
import {aggregate} from './metrics.js';
import {runAgent} from './agent.js';
import {loadConfig} from './config.js';
import {KITS,LANGUAGES,PROFILES,locale,render,selectKits,ROOT} from './catalog.js';
import {logisticsCorpus,corpusExpected,codeCorpus,repairWorkspace} from './fixtures.js';
import {validateLogistics,validateProse,languageAudit,compareJSON,validateCode,validateSQL,validateRepair,unfence} from './validators.js';
import {GAME_CONTRACT,browserHelperSource,inspectGame} from './browser.js';
import {createReport} from './report.js';
import {ensureDir,hash,now,readJSON,redact,runCommand,safeName,writeJSON,extractJSON} from './util.js';

function validateBatch(text,start,end,profile,language) {
  const validation=validateProse(text,{...profile,pages:end},language);
  validation.errors=validation.errors.filter(error=>!/^Page (\d+) is missing or repeated$/.test(error)||Number(error.match(/\d+/)[0])>=start).filter(error=>!error.startsWith('Expected exactly'));
  if(validation.pages.length!==end-start+1)validation.errors.push(`Expected ${end-start+1} pages in this batch, got ${validation.pages.length}`);
  validation.passed=!validation.errors.length;return validation;
}
async function environmentInfo(){
  const results=await Promise.allSettled([runCommand('git',['rev-parse','HEAD'],{cwd:ROOT,timeoutMs:5000}),runCommand('nvidia-smi',['--query-gpu=name,driver_version,memory.total,power.limit','--format=csv,noheader'],{timeoutMs:5000})]);
  const revision=results[0].status==='fulfilled'&&results[0].value.code===0?results[0].value.stdout.trim():null;
  const gpus=results[1].status==='fulfilled'&&results[1].value.code===0?results[1].value.stdout.trim().split('\n'):[];
  return {node:process.version,platform:process.platform,arch:process.arch,os:os.release(),cpu:os.cpus()[0]?.model,logical_cpus:os.cpus().length,total_ram_bytes:os.totalmem(),nvidia_gpus:gpus,hardware_scope:'Client host; remote inference hardware is not inferred',sllm_version:'0.1.0',source_revision:revision};
}
async function screenplayExport(text,dir) {
  const escape=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  const pages=text.split(/(?==== PAGE \d{3} ===)/).filter(value=>value.trim());
  fs.writeFileSync(path.join(dir,'screenplay.html'),`<!doctype html><meta charset="utf-8"><title>Generated screenplay</title><style>@page{size:A4;margin:18mm}body{font:10pt/1.3 monospace}.page{break-before:page;white-space:pre-wrap}.page:first-child{break-before:auto}</style>${pages.map(value=>`<section class="page">${escape(value)}</section>`).join('')}`);
  // The HTML has real print page breaks and is portable even without a browser.
}
async function executeKit(context) {
  const {kit,language,profile,dir,dependency,client,defaults,slot,agent,signal,log,metadata,via}=context;
  const l=locale(language);const records=[];let validation={passed:true,errors:[]};let output='';let agentInfo={};
  const promptValues={pages:profile.pages,words:profile.wordsPerPage,records:profile.jsonRecords,rows:profile.sqlRows};
  async function chat(prompt,label,history=[],overrides={}) {
    const messages=[{role:'system',content:l.system},...history,{role:'user',content:prompt}];
    if(via==='pi'){
      const callDir=path.join(dir,`pi-call-${String(records.length+1).padStart(4,'0')}`);
      const result=await runAgent({slot,defaults,agent,dir:callDir,workspace:path.join(callDir,'workspace'),prompt:JSON.stringify(messages),system:l.agentSystem,metadata:{...metadata,phase:label,via:'pi'},signal,noTools:true,onRecord:client.onRecord});records.push(...result.records);
      if(!result.success)throw new Error(result.error||result.stderr||'Pi inference failed');
      return {...result.records.at(-1),content:result.content};
    }
    const before=client.records.length;try{return await client.chat(messages,{...metadata,phase:label},overrides);}finally{records.push(...client.records.slice(before));}
  }
  async function repaired(prompt,label,validator) {
    let result,check;
    for(let attempt=0;attempt<=defaults.repair_attempts;attempt++){
      result=await chat(attempt?`${prompt}\n\n${render(l.fix,{errors:check.errors.join('; ')})}`:prompt,`${label}-${attempt}`);
      check=await validator(result.content);if(check.passed)break;
    }
    return {result,check};
  }
  if(kit.kind==='prose'){
    const base=render(kit.id.startsWith('01')?l.short:l.long,promptValues)+(kit.id.startsWith('02')?`\n\n${JSON.stringify(l.dossier,null,2)}`:'');
    const batch=defaults.page_batch||profile.pageBatch;const parts=[];const batchChecks=[];
    for(let start=1;start<=profile.pages;start+=batch){
      const end=Math.min(profile.pages,start+batch-1);log(`pages ${start}-${end}/${profile.pages}`);
      const previous=parts.length?`\n\n${l.continue}\n${parts.join('\n').slice(-14000)}`:'';
      const pages=render(l.pages,{...promptValues,start,end,han:profile.hanPerPage});
      const {result,check}=await repaired(base+previous+'\n\n'+pages,`pages-${start}-${end}`,text=>validateBatch(text,start,end,profile,language));
      parts.push(result.content);batchChecks.push(check);fs.writeFileSync(path.join(dir,'output.txt'),parts.join('\n\n'));
    }
    output=parts.join('\n\n');validation=validateProse(output,profile,language);validation.batch_checks=batchChecks;await screenplayExport(output,dir);
  }else if(kit.kind==='summary'){
    const source=dependency(kit.dependencies[0]);
    const result=await chat(`${l.summary}\n\n${source}`,'summarize');output=result.content;
    try{const data=extractJSON(output);const errors=[];for(const key of ['title','chronology','characters','causal_chain','scientific_claims','contradictions','verdict'])if(!(key in data))errors.push(`Missing ${key}`);if(!Array.isArray(data.chronology)||data.chronology.length<12)errors.push('Chronology needs twelve events');if(!Array.isArray(data.causal_chain)||data.causal_chain.length<8)errors.push('Causal chain needs eight links');validation={passed:!errors.length,errors};}catch(error){validation={passed:false,errors:[error.message]};}
  }else if(kit.kind==='sql'){
    const {result,check}=await repaired(render(l.sql,promptValues),'sql',text=>validateSQL(text,profile.sqlRows,path.join(dir,'validation'),signal));output=result.content;validation=check;
  }else if(kit.kind==='json'){
    const {result,check}=await repaired(render(l.json,promptValues),'json',text=>validateLogistics(text,profile.jsonRecords));output=result.content;validation=check;if(check.data)writeJSON(path.join(dir,'dataset.json'),check.data);
  }else if(kit.kind==='json-analysis'){
    const corpus=logisticsCorpus(profile.corpusRecords);const data={corpus,generated_sample:dependency('06-json-generation')};writeJSON(path.join(dir,'input-corpus.json'),data);
    const result=await chat(`${l.jsonAnalysis}\n\n${JSON.stringify(data)}`,'json-prefill');output=result.content;validation=compareJSON(output,corpusExpected(corpus));
  }else if(kit.kind==='code'){
    const {result,check}=await repaired(l.code,'code',text=>validateCode(text,path.join(dir,'validation'),signal));output=result.content;validation=check;
  }else if(kit.kind==='code-analysis'){
    const corpus=codeCorpus(profile.codeFunctions,dependency('08-code-generation'));fs.writeFileSync(path.join(dir,'input-corpus.js'),corpus);
    const result=await chat(`${l.codeAnalysis}\n\n${corpus}`,'code-prefill');output=result.content;
    try{const data=extractJSON(output);const found=JSON.stringify(data.findings||[]);const missing=['median','uniqueCount','weightedMean','safeDivide','lastValue','overlap'].filter(name=>!found.includes(name));validation={passed:!missing.length,errors:missing.map(name=>`Missing defect finding: ${name}`)};}catch(error){validation={passed:false,errors:[error.message]};}
  }else if(kit.kind==='mixed'){
    const data={screenplay:dependency('01-prose-short').slice(0,100000),logistics:dependency('06-json-generation'),code:dependency('08-code-generation')};const history=[];const parts=[];
    for(let step=1;step<=profile.mixedSteps;step++){
      const prompt=render(l.mixed,{step,steps:profile.mixedSteps,change:l.changes[(step-1)%l.changes.length]})+(step===1?`\n\n${JSON.stringify(data)}`:'');
      const result=await chat(prompt,`mixed-step-${step}`,history);parts.push(result.content);history.push({role:'user',content:prompt},{role:'assistant',content:result.content});
      try{const value=extractJSON(result.content);if(value.step!==step||!Array.isArray(value.tests)||value.tests.length<3)validation.errors.push(`Invalid mixed result at step ${step}`);}catch(error){validation.errors.push(`Step ${step}: ${error.message}`);}
    }
    output=JSON.stringify(parts,null,2);validation.passed=!validation.errors.length;
  }else if(kit.kind==='agent'){
    const workspace=path.join(dir,'workspace');ensureDir(workspace);
    if(kit.id.startsWith('11')){repairWorkspace(workspace);fs.writeFileSync(path.join(workspace,'REQUIREMENTS.md'),l.repairRequirements);}else{fs.writeFileSync(path.join(workspace,'BENCHMARK_CONTRACT.md'),l.gameContract);fs.writeFileSync(path.join(workspace,'browser-check.mjs'),browserHelperSource());}
    fs.writeFileSync(path.join(workspace,'AGENTS.md'),l.agentSystem);
    let prompt=kit.id.startsWith('10')?l.battleship:l.repair;
    if(kit.id.startsWith('10'))prompt+='\n\n'+l.gameContract;
    agentInfo={agent_steps:0,agent_turns:0,tool_calls:0,tool_errors:0};
    for(let attempt=0;attempt<=Math.min(defaults.repair_attempts,1);attempt++){
      const result=await runAgent({slot,defaults,agent,dir:path.join(dir,`agent-${attempt}`),workspace,prompt:attempt?prompt+'\n\n'+l.agentSystem+'\n'+JSON.stringify({validation_errors:validation.errors}):prompt,system:l.agentSystem,metadata:{...metadata,agent_attempt:attempt},signal,onRecord:client.onRecord,onProgress:event=>log(`${event.type} ${event.tool||event.turn}`)});
      records.push(...result.records);agentInfo.agent_steps+=result.steps;agentInfo.agent_turns+=result.turns;agentInfo.tool_calls+=result.tool_count;agentInfo.tool_errors+=result.tool_errors;output=result.content;
      if(!result.success){validation={passed:false,errors:[result.error||result.stderr||`Agent exited with ${result.code}`]};if(signal?.aborted)throw signal.reason;continue;}
      const test=await runCommand(process.execPath,['--run','test'],{cwd:workspace,timeoutMs:120000,signal});writeJSON(path.join(dir,`agent-tests-${attempt}.json`),test);
      if(kit.id.startsWith('11'))validation=await validateRepair(workspace,path.join(dir,`external-validation-${attempt}`),signal);
      else{
        const rules=await runCommand(process.execPath,[fileURLToPath(new URL('./battleship-child.js',import.meta.url)),path.join(workspace,'engine.js')],{cwd:workspace,timeoutMs:60000,signal});
        const browser=await inspectGame(workspace,path.join(dir,`browser-${attempt}`));const reviewed=result.tools.some(tool=>tool.name==='read'&&/\.(png|jpe?g|webp)$/i.test(tool.args?.path||''));validation={passed:rules.code===0&&browser.passed,errors:[...(rules.code===0?[]:[rules.stderr||rules.stdout]),...browser.errors],rules,browser,model_image_review:reviewed};
      }
      if(test.code!==0){validation.passed=false;validation.errors.push(`Project tests failed: ${test.stderr||test.stdout}`);}
      if(validation.passed)break;
    }
  }else throw new Error(`Unknown kit kind: ${kit.kind}`);
  fs.writeFileSync(path.join(dir,'output.txt'),output);writeJSON(path.join(dir,'validation.json'),validation);
  return {output,validation,records,...agentInfo,language_audit:languageAudit(output,language)};
}

export async function runSuite(options) {
  const initial=loadConfig(options.config,options.slots[0]);const profileName=options.profile||initial.config.defaults.profile;
  if(!PROFILES[profileName])throw new Error(`Unknown profile: ${profileName}`);
  const languages=options.languages||initial.config.defaults.languages;for(const value of languages)if(!LANGUAGES.includes(value))throw new Error(`Unknown language: ${value}`);
  if(!languages.length||new Set(languages).size!==languages.length)throw new Error('Languages must be a nonempty unique list');
  const kits=selectKits(options.kits||'all');const repetitions=options.repetitions||initial.config.defaults.repetitions;
  if(!Number.isSafeInteger(repetitions)||repetitions<1||repetitions>100)throw new Error('Repetitions must be an integer from 1 to 100');
  const dir=path.resolve(options.output||path.join(initial.config.defaults.output_dir,new Date().toISOString().replace(/[:.]/g,'-')));ensureDir(dir);
  const selected=options.slots.map(name=>loadConfig(options.config,name));
  const fingerprint=hash({profile:profileName,languages,kits:kits.map(k=>k.id),repetitions,via:options.via||'api',dimensions:options.dimensions,overrides:options.overrides,models:selected.map(value=>redact({name:value.slotName,slot:value.slot,agent:value.agent,defaults:value.config.defaults})),prompts:languages.map(language=>hash(locale(language)))});
  const lockFile=path.join(dir,'run.lock');let lock;
  try{lock=fs.openSync(lockFile,'wx');fs.writeFileSync(lock,JSON.stringify({pid:process.pid,host:os.hostname()}));}
  catch(error){if(error.code!=='EEXIST')throw error;const owner=readJSON(lockFile);if(owner.host!==os.hostname())throw new Error('Run is locked by another host');let alive=true;try{process.kill(owner.pid,0);}catch(e){if(e.code==='ESRCH')alive=false;}if(alive)throw new Error(`Run is locked by PID ${owner.pid}`);fs.unlinkSync(lockFile);return runSuite(options);}
  const start=now();let state;const file=path.join(dir,'run.json');
  const log=message=>options.log?.(message);
  try{
    if(fs.existsSync(file)){
      if(!options.resume)throw new Error('Output directory already contains a run. Use --resume or choose a new --output directory.');
      const existing=readJSON(file);if(existing.fingerprint!==fingerprint)throw new Error('Resume configuration, prompts or workload differ from the original run');state=existing;
    }else state={schema_version:1,id:path.basename(dir),fingerprint,profile:profileName,started_at:new Date().toISOString(),status:'running',active_ms:0,planned_cases:selected.length*languages.length*kits.length*repetitions,cases:{},models:selected.map(value=>({slot:value.slotName,...redact(value.slot),agent:redact(value.agent)})),environment:await environmentInfo()};
    state.status='running';delete state.finished_at;writeJSON(file,state);
    for(const selectedSlot of selected){
      const {slot,slotName,agent,config}=selectedSlot;const defaults={...config.defaults,...options.overrides};const profile={...PROFILES[profileName],...options.dimensions};
      const pending=languages.some(language=>kits.some(kit=>Array.from({length:repetitions},(_,i)=>`${slotName}/${language}/${kit.id}/${i+1}`).some(key=>!state.cases[key]||state.cases[key].status==='interrupted'||(options.retryFailed&&(!state.cases[key].validation?.passed)))));
      if(!pending)continue;
      options.signal?.throwIfAborted();log(`Starting slot ${slotName} (${slot.model})`);
      const startupStart=now();
      if(slot.startup){const {command,args=[],timeout_seconds=900}=slot.startup;if(typeof command!=='string'||!Array.isArray(args))throw new Error('startup must contain command and args');const result=await runCommand(command,args,{timeoutMs:timeout_seconds*1000,signal:options.signal});writeJSON(path.join(dir,'startup',`${slotName}-${Date.now()}.json`),result);if(result.code!==0)throw new Error(`Startup failed for ${slotName}: ${result.stderr||result.stdout}`);}
      state.startups=state.startups||[];state.startups.push({slot:slotName,duration_ms:now()-startupStart});
      const warmupDir=path.join(dir,'warmup',`${slotName}-${Date.now()}`);
      if(options.via==='pi'){
        const warmup=await runAgent({slot,defaults,agent,dir:warmupDir,workspace:path.join(warmupDir,'workspace'),prompt:'Reply with OK.',system:'Give a short answer without tools.',metadata:{slot:slotName,phase:'warmup'},signal:options.signal,noTools:true});
        if(!warmup.success)throw new Error(`Pi warmup failed: ${warmup.stderr||warmup.error}`);
      }else{
        const warmup=new Client({slot,defaults:{...defaults,retries:defaults.retries},dir:warmupDir,signal:options.signal});
        await warmup.chat([{role:'user',content:'Reply with OK.'}],{slot:slotName,phase:'warmup'},{max_tokens:8});
      }
      for(const language of languages)for(let repetition=1;repetition<=repetitions;repetition++)for(const kit of kits){
        const key=`${slotName}/${language}/${kit.id}/${repetition}`;const previous=state.cases[key];
        if(previous&&previous.status!=='interrupted'&&!(options.retryFailed&&!previous.validation?.passed))continue;
        options.signal?.throwIfAborted();const attempt=(previous?.attempt||0)+1;const caseDir=path.join(dir,'cases',slotName,language,kit.id,String(repetition),`attempt-${attempt}`);ensureDir(caseDir);
        const metadata={slot:slotName,model:slot.model,language,kit:kit.id,repetition,profile:profileName};const caseStart=now();
        const client=new Client({slot,defaults,dir:caseDir,signal:options.signal,onProgress:event=>log(`${slotName}/${language}/${kit.id}: receiving ${event.phase} · ${event.elapsed_seconds.toFixed(0)} s · ${event.characters} characters`),onRecord:record=>log(`${slotName}/${language}/${kit.id}: ${record.phase||`agent step ${record.agent_step}`} · TTFT ${record.ttft_ms?.toFixed(0)??'?'} ms · PP ${record.pp_tps?.toFixed(1)??'?'} · TG ${record.tg_tps?.toFixed(1)??'?'} tok/s`)});
        const dependency=id=>{const test=state.cases[`${slotName}/${language}/${id}/${repetition}`];if(!test?.output_file||!fs.existsSync(test.output_file))throw new Error(`Dependency artifact unavailable: ${id}`);return fs.readFileSync(test.output_file,'utf8');};
        log(`CASE ${Object.keys(state.cases).length+1}/${state.planned_cases}: ${key}`);let result;
        try{result=await executeKit({kit,language,profile,dir:caseDir,dependency,client,defaults,slot,agent,signal:options.signal,log:message=>log(`${key}: ${message}`),metadata,via:options.via||'api'});result.status='completed';}
        catch(error){result={status:options.signal?.aborted?'interrupted':'error',error:error.message,validation:{passed:false,errors:[error.message]},records:client.records};log(`ERROR ${key}: ${error.message}`);}
        delete result.output;result={...metadata,...result,attempt,duration_ms:now()-caseStart,output_file:fs.existsSync(path.join(caseDir,'output.txt'))?path.join(caseDir,'output.txt'):null,artifact_dir:caseDir};result.statistics=aggregate(result.records||[]);
        writeJSON(path.join(caseDir,'case.json'),result);state.cases[key]=result;state.updated_at=new Date().toISOString();writeJSON(file,{...state,active_ms:state.active_ms+now()-start});createReport(dir);
        if(options.signal?.aborted)throw options.signal.reason;
      }
    }
    state.status='completed';state.finished_at=new Date().toISOString();
  }catch(error){if(state){state.status=options.signal?.aborted?'interrupted':'error';state.error=error.message;}throw error;}
  finally{if(state){state.active_ms+=now()-start;state.updated_at=new Date().toISOString();writeJSON(file,state);createReport(dir);}if(lock!==undefined)fs.closeSync(lock);fs.rmSync(lockFile,{force:true});}
  return {dir,report:createReport(dir)};
}
