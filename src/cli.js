import fs from 'node:fs';
import path from 'node:path';
import {Command,Option} from 'commander';
import YAML from 'yaml';
import {chromium} from 'playwright';
import {configPath,initConfig,loadConfig,saveConfig,resolveConfig} from './config.js';
import {KITS,LANGUAGES,PROFILES} from './catalog.js';
import {piPath} from './pi-path.js';
import {parsePositive,redact,runCommand,safeName} from './util.js';
import {runSuite} from './runner.js';
import {createReport} from './report.js';

const integer=(label,max)=>value=>parsePositive(value,label,max);
export function program() {
  const root=new Command().name('sllm').description('Multilingual LLM inference and coding-agent speed test kits').version('0.1.0').option('--config <file>','YAML configuration file',configPath()).option('--slot <name>','Configuration slot (default: configured default slot)').showHelpAfterError().showSuggestionAfterError();
  root.command('init').description('Create the user YAML configuration without overwriting existing settings').action(()=>console.log(initConfig(root.opts().config)));
  const config=root.command('config').description('Inspect and edit configuration');
  config.command('path').action(()=>console.log(root.opts().config));
  config.command('show').action(()=>{const value=loadConfig(root.opts().config,root.opts().slot);console.log(YAML.stringify(redact(value.config)));});
  config.command('set <key> <value>').description('Set a dotted YAML key; secrets should use environment variables').action((key,value)=>{
    const loaded=loadConfig(root.opts().config,root.opts().slot);const parts=key.split('.');if(parts.some(part=>['__proto__','prototype','constructor'].includes(part)))throw new Error('Invalid configuration path');
    let target=loaded.config;for(const part of parts.slice(0,-1)){if(!target[part]||typeof target[part]!=='object')target[part]={};target=target[part];}target[parts.at(-1)]=YAML.parse(value);resolveConfig(loaded.config,loaded.file,root.opts().slot);saveConfig(loaded.file,loaded.config);console.log(`Updated ${key}`);
  });
  const slots=root.command('slot').description('Manage named model connections');
  slots.command('list').action(()=>{const {config}=loadConfig(root.opts().config,root.opts().slot);for(const [name,slot] of Object.entries(config.slots))console.log(`${name}\t${slot.model}\t${slot.base_url}`);});
  slots.command('add <name>').requiredOption('--base-url <url>','OpenAI-compatible API base URL, including /v1').requiredOption('--model <id>','API model identifier').option('--api-key-env <name>','Environment variable containing an API key','SLLM_API_KEY').action((name,opts)=>{safeName(name);const loaded=loadConfig(root.opts().config,root.opts().slot);if(Object.hasOwn(loaded.config.slots,name))throw new Error(`Slot already exists: ${name}`);loaded.config.slots[name]={base_url:opts.baseUrl,model:opts.model,api_key_env:opts.apiKeyEnv};resolveConfig(loaded.config,loaded.file,name);saveConfig(loaded.file,loaded.config);console.log(`Added slot ${name}`);});
  slots.command('remove <name>').action(name=>{const loaded=loadConfig(root.opts().config,root.opts().slot);if(name==='default'||name===loaded.config.defaults.slot)throw new Error('Cannot remove the default slot');if(!Object.hasOwn(loaded.config.slots,name))throw new Error(`Unknown slot: ${name}`);delete loaded.config.slots[name];saveConfig(loaded.file,loaded.config);console.log(`Removed slot ${name}`);});
  root.command('kits').description('List the 12 test kits and their dependencies').option('--json','Print machine-readable output').action(opts=>{if(opts.json)console.log(JSON.stringify({languages:LANGUAGES,profiles:PROFILES,kits:KITS},null,2));else{for(const kit of KITS)console.log(`${kit.id}\t${kit.title}\t${kit.dependencies.length?'requires '+kit.dependencies.join(', '):'independent'}`);console.log(`\nLanguages: ${LANGUAGES.join(', ')}. Each model has 48 cases in the full four-language matrix.`);}});
  root.command('doctor').description('Check configuration, bundled Pi, Chromium and API discovery').option('--offline','Do not contact the configured endpoint').action(async opts=>{
    const loaded=loadConfig(root.opts().config,root.opts().slot);const pi=piPath();const version=await runCommand(process.execPath,[pi.cli,'--version']);if(version.code!==0)throw new Error(`Pi failed: ${version.stderr}`);
    console.log(`Node: ${process.version}\nPi: ${version.stdout.trim()}\nConfig: ${loaded.file}\nSlot: ${loaded.slotName}\nModel: ${loaded.slot.model}`);
    let browser;try{browser=await chromium.launch({headless:true});console.log('Chromium: ready');}finally{await browser?.close();}
    if(!opts.offline){const response=await fetch(`${loaded.slot.base_url.replace(/\/$/,'')}/models`,{signal:AbortSignal.timeout(10000),headers:(await import('./transport.js')).requestHeaders(loaded.slot)});if(!response.ok)throw new Error(`API discovery returned HTTP ${response.status}`);const data=await response.json();console.log(`API: ready (${data.data?.length??'?'} models)`);}
  });
  root.command('run').description('Execute kits; dependency kits are included automatically').option('--slots <names>','Comma-separated model slots').option('--languages <codes>','Comma-separated en,ste,zh,ru').option('--kits <ids>','Comma-separated kit IDs or numbers; default all','all').addOption(new Option('--profile <name>','Workload size').choices(['full','smoke'])).option('--repetitions <n>','Independent repetitions',integer('repetitions',100)).option('--output <dir>','Run output directory').option('--resume','Continue an interrupted or partially completed run').option('--retry-failed','Rerun quality failures and harness errors during resume').addOption(new Option('--via <transport>','Direct API or Pi without tools for non-agent kits').choices(['api','pi']).default('api')).option('--max-output-tokens <n>','Override output token budget',integer('max-output-tokens',1000000)).option('--timeout <seconds>','Per-request timeout',integer('timeout',86400)).option('--agent-timeout <seconds>','Per-agent process timeout',integer('agent-timeout',86400)).option('--agent-max-steps <n>','Maximum LLM turns in one agent session',integer('agent-max-steps',10000)).option('--page-batch <n>','Pages per inference request',integer('page-batch',50)).action(async opts=>{
    const global=root.opts();const loaded=loadConfig(global.config,global.slot);const names=opts.slots?opts.slots.split(',').map(s=>s.trim()):[loaded.slotName];if(new Set(names).size!==names.length)throw new Error('Duplicate slot names');names.forEach(safeName);
    const controller=new AbortController();let interrupted=false;const stop=()=>{if(interrupted){console.error('A second interrupt forces exit; the run can be resumed.');process.exit(130);}interrupted=true;controller.abort(new Error('Interrupted by user'));};process.on('SIGINT',stop);process.on('SIGTERM',stop);
    const overrides={};for(const [key,value] of [['max_output_tokens',opts.maxOutputTokens],['timeout_seconds',opts.timeout],['agent_timeout_seconds',opts.agentTimeout],['agent_max_steps',opts.agentMaxSteps],['page_batch',opts.pageBatch]])if(value!==undefined)overrides[key]=value;
    try{const result=await runSuite({config:global.config,slots:names,languages:opts.languages?.split(',').map(x=>x.trim()),kits:opts.kits,profile:opts.profile,repetitions:opts.repetitions,output:opts.output,resume:opts.resume,retryFailed:opts.retryFailed,via:opts.via,overrides,signal:controller.signal,log:message=>console.log(`[${new Date().toISOString()}] ${message}`)});console.log(`Report: ${path.join(result.dir,'report.html')}`);console.log(`Finished ${result.report.completed_cases}/${result.report.planned_cases}; quality passes ${result.report.quality_passes}; harness errors ${result.report.harness_errors}`);if(result.report.harness_errors)process.exitCode=2;else if(result.report.quality_failures)process.exitCode=3;}
    finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
  });
  root.command('report <directory>').description('Rebuild CSV, JSON, Markdown and interactive HTML reports').action(directory=>{const report=createReport(path.resolve(directory));console.log(`${report.completed_cases}/${report.planned_cases} cases; report: ${path.resolve(directory,'report.html')}`);});
  root.addHelpText('after',`\nExamples:\n  sllm init\n  sllm slot add local --base-url http://localhost:8000/v1 --model my-model\n  sllm --slot local run --profile smoke --languages en\n  sllm run --slots model-a,model-b --languages en,ste,zh,ru --output ./matrix\n  sllm run --slots model-a,model-b --output ./matrix --resume\n\nExit codes: 0 success; 1 configuration/runtime failure; 2 harness errors; 3 model quality failures; 130 interrupted.\nAgent kits execute model-generated code in their dedicated workspaces. This is not an OS sandbox.`);
  return root;
}
export async function main(argv=process.argv) {
  try{await program().parseAsync(argv);}catch(error){console.error(`sllm: ${error.message}`);if(process.env.SLLM_DEBUG)console.error(error.stack);process.exitCode=error.name==='AbortError'||/Interrupted by user/.test(error.message)?130:1;}
}
