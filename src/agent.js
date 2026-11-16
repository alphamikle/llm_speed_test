import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {StringDecoder} from 'node:string_decoder';
import {chromium} from 'playwright';
import {Measurement} from './metrics.js';
import {endpoint,requestHeaders,measureResponse} from './transport.js';
import {piPath} from './pi-path.js';
import {appendJSON,ensureDir,now,terminate,writeJSON,JSONLWriter} from './util.js';

export async function startMeteringProxy({slot,defaults,dir,metadata,signal,maxSteps=100,onRecord}) {
  let sequence=0;const records=[];const controllers=new Set();
  const server=http.createServer(async(req,res)=>{
    if(req.method!=='POST'||!req.url.endsWith('/chat/completions')){res.writeHead(404);res.end('Unknown proxy route');return;}
    if(++sequence>maxSteps){res.writeHead(400,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:`Agent exceeded ${maxSteps} inference steps`}}));return;}
    const id=`agent-${String(sequence).padStart(5,'0')}`;const recordDir=path.join(dir,'requests',id);ensureDir(recordDir);
    const meter=new Measurement({...metadata,request_id:id,agent_step:sequence,timestamp:new Date().toISOString()});
    const controller=new AbortController();controllers.add(controller);
    res.on('close',()=>{if(!res.writableEnded&&!meter.protocolDone)controller.abort();});
    try{
      let body='';for await(const chunk of req){body+=chunk;if(body.length>32000000)throw new Error('Agent request exceeds 32 MB');}
      const payload={...JSON.parse(body),...slot.request,model:slot.model};
      if(slot.output_token_field&&slot.output_token_field!=='max_tokens'&&payload.max_tokens!==undefined){payload[slot.output_token_field]=payload[slot.output_token_field]??payload.max_tokens;delete payload.max_tokens;}
      if(payload.temperature===null)delete payload.temperature;
      if(payload.stream&&slot.stream_options!==false)payload.stream_options={include_usage:true};
      if(slot.stream_options===false)delete payload.stream_options;
      writeJSON(path.join(recordDir,'request.json'),payload);
      const signals=[controller.signal,AbortSignal.timeout(defaults.timeout_seconds*1000)];if(signal)signals.push(signal);
      const response=await fetch(endpoint(slot.base_url),{method:'POST',headers:requestHeaders(slot),body:JSON.stringify(payload),signal:AbortSignal.any(signals)});
      if(!response.ok){const text=await response.text();meter.error=`HTTP ${response.status}: ${text.slice(0,3000)}`;res.writeHead(response.status,{'content-type':'application/json'});res.end(text);}
      else{
        res.writeHead(200,{'content-type':response.headers.get('content-type')||'text/event-stream','cache-control':'no-cache'});
        await measureResponse(response,meter,{eventsFile:path.join(recordDir,'events.jsonl'),forward:async chunk=>{if(!res.write(chunk))await new Promise((resolve,reject)=>{const cleanup=()=>{res.removeListener('drain',drain);res.removeListener('close',close);res.removeListener('error',fail);};const drain=()=>{cleanup();resolve();};const close=()=>{cleanup();reject(new Error('Agent disconnected during response streaming'));};const fail=error=>{cleanup();reject(error);};res.once('drain',drain);res.once('close',close);res.once('error',fail);});}});
        if(!res.destroyed)res.end();
      }
    }catch(error){meter.error=error.message;if(!res.headersSent)res.writeHead(502,{'content-type':'application/json'});if(!res.destroyed)res.end(JSON.stringify({error:{message:error.message}}));}
    finally{controllers.delete(controller);const record=meter.finish();records.push(record);appendJSON(path.join(dir,'requests.jsonl'),record);writeJSON(path.join(recordDir,'result.json'),record);onRecord?.(record);}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return {baseUrl:`http://127.0.0.1:${server.address().port}/v1`,records,close:async()=>{for(const controller of controllers)controller.abort();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
function isolatedEnv(home,extra={}) {
  const env={};for(const name of ['PATH','Path','SystemRoot','WINDIR','COMSPEC','PATHEXT','TEMP','TMP','TMPDIR','LANG','LC_ALL','TERM'])if(process.env[name])env[name]=process.env[name];
  let browserDir=path.dirname(chromium.executablePath());
  for(let level=0;level<10;level++){
    if(/^chromium(?:_headless_shell|-headless-shell)?-\d+$/.test(path.basename(browserDir))){browserDir=path.dirname(browserDir);break;}
    browserDir=path.dirname(browserDir);
  }
  return {...env,HOME:home,USERPROFILE:home,PI_CODING_AGENT_DIR:home,PI_SKIP_VERSION_CHECK:'1',PLAYWRIGHT_BROWSERS_PATH:process.env.PLAYWRIGHT_BROWSERS_PATH||browserDir,...extra};
}
export async function runAgent({slot,defaults,agent,dir,workspace,prompt,system,metadata,signal,noTools=false,onRecord,onProgress}) {
  ensureDir(dir);ensureDir(workspace);const home=path.join(dir,'pi-home');ensureDir(home);
  const extraEnv=Object.fromEntries(Object.entries(agent.env||{}).map(([key,value])=>[key,String(value).replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g,(_,name)=>{if(process.env[name]===undefined)throw new Error(`Missing agent environment variable: ${name}`);return process.env[name];})]));
  const proxy=await startMeteringProxy({slot,defaults,dir,metadata,signal,maxSteps:agent.native_model?10000:defaults.agent_max_steps,onRecord});
  const outputBudget=noTools?defaults.max_output_tokens:agent.max_tokens;
  const model={id:slot.model,name:'sllm benchmark model',api:'openai-completions',reasoning:true,input:agent.input||['text'],contextWindow:agent.context_window,maxTokens:outputBudget,cost:{input:0,output:0,cacheRead:0,cacheWrite:0},compat:agent.compat};
  const providers={sllm:{baseUrl:proxy.baseUrl,api:'openai-completions',apiKey:'local-benchmark',models:[model]}};
  if(agent.native_provider&&agent.native_model&&agent.native_provider!=='sllm')providers[agent.native_provider]={modelOverrides:{[agent.native_model]:{maxTokens:outputBudget,contextWindow:agent.context_window}}};
  writeJSON(path.join(home,'models.json'),{providers});
  writeJSON(path.join(home,'settings.json'),{compaction:{enabled:false},retry:{enabled:false},packages:[],shellPath:process.platform==='win32'?undefined:process.env.SHELL||'/bin/bash'});
  const promptFile=path.join(dir,'agent-prompt.txt');fs.writeFileSync(promptFile,prompt);
  const systemFile=path.join(dir,'agent-system.txt');fs.writeFileSync(systemFile,system);
  const pi=piPath();
  const substitutions={base_url:proxy.baseUrl,model:slot.model,prompt_file:promptFile,workspace};
  const args=agent.command?(agent.args||[]).map(value=>String(value).replace(/\{(base_url|model|prompt_file|workspace)\}/g,(_,key)=>substitutions[key])):[pi.cli,'--mode','json','--provider',agent.native_provider||'sllm','--model',agent.native_model||slot.model,'--thinking',agent.thinking,'--no-session','--no-extensions','--no-skills','--no-prompt-templates','--no-approve','--append-system-prompt',systemFile,...(noTools?['--no-tools']:['--tools','read,write,edit,bash']),`@${promptFile}`];
  const command=agent.command||process.execPath;
  const start=now();let buffer='',stderr='',finalMessage='',lastStopReason=null,lastMessageError=null,terminationReason=null,turns=0,toolStarts=new Map(),tools=[],events=0,ended=false,settled=false,fallback=null;const fallbackRecords=[];const eventWriter=new JSONLWriter(path.join(dir,'agent-events.jsonl'));
  const child=spawn(command,args,{cwd:workspace,env:isolatedEnv(home,extraEnv),windowsHide:true,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});
  const decoder=new StringDecoder('utf8');
  const timeout=setTimeout(()=>{terminationReason='timeout';terminate(child);},defaults.agent_timeout_seconds*1000);
  const abort=()=>{terminationReason='interrupted';terminate(child);};signal?.addEventListener('abort',abort,{once:true});
  const processLine=line=>{
    if(!line.trim())return;
    let event;try{event=JSON.parse(line);}catch{appendJSON(path.join(dir,'agent-unparsed.jsonl'),{line});return;}
    const time=now();events++;eventWriter.write({elapsed_ms:time-start,event});
    if(event.type==='turn_start'){turns++;onProgress?.({type:'agent_turn',turn:turns});}
    if(event.type==='message_start'&&event.message?.role==='assistant')fallback=new Measurement({...metadata,agent_step:turns,request_id:`native-pi-${turns}`,timing_scope:'pi_message_events'},time);
    if(event.type==='message_update'&&fallback){const e=event.assistantMessageEvent;const delta=e?.type==='text_delta'?{content:e.delta}:e?.type==='thinking_delta'?{reasoning_content:e.delta}:e?.type==='toolcall_delta'?{tool_calls:[{index:e.contentIndex,function:{arguments:e.delta}}]}:{};fallback.ingest({choices:[{delta}]},time);}
    if(event.type==='message_end'&&event.message?.role==='assistant'){
      const m=event.message;lastStopReason=m.stopReason;lastMessageError=m.errorMessage;finalMessage=(m.content||[]).filter(x=>x.type==='text').map(x=>x.text).join('\n');
      if(fallback){fallback.metadata={...fallback.metadata,actual_model:m.model,provider:m.provider};fallback.usage={prompt_tokens:typeof m.usage?.input==='number'?m.usage.input+(m.usage.cacheRead||0)+(m.usage.cacheWrite||0):undefined,completion_tokens:m.usage?.output,prompt_tokens_details:{cached_tokens:m.usage?.cacheRead}};fallback.finishReason=m.stopReason;const record=fallback.finish(time);if(m.stopReason==='error'||m.errorMessage){record.status='error';record.error=m.errorMessage;}fallbackRecords.push(record);fallback=null;}
    }
    if(event.type==='tool_execution_start'){toolStarts.set(event.toolCallId,{name:event.toolName,args:event.args,start:time});onProgress?.({type:'tool_start',tool:event.toolName,turn:turns});}
    if(event.type==='tool_execution_end'){
      const first=toolStarts.get(event.toolCallId)||{name:event.toolName,start:time};
      const exitCode=event.result?.structuredContent?.exit_code??event.result?.details?.exitCode??event.result?.details?.exit_code;
      tools.push({id:event.toolCallId,name:first.name,args:first.args,duration_ms:time-first.start,is_error:Boolean(event.isError||(typeof exitCode==='number'&&exitCode!==0)),exit_code:exitCode,result:event.result});toolStarts.delete(event.toolCallId);
    }
    if(event.type==='agent_end')ended=true;if(event.type==='agent_settled')settled=!event.aborted;
    if(turns>defaults.agent_max_steps){terminationReason='step_limit';terminate(child);}
  };
  child.stdout.on('data',chunk=>{buffer+=decoder.write(chunk);for(;;){const index=buffer.indexOf('\n');if(index<0)break;const line=buffer.slice(0,index).replace(/\r$/,'');buffer=buffer.slice(index+1);processLine(line);}if(buffer.length>64000000){stderr+='\nAgent JSONL record exceeded 64 MB';terminate(child);}});
  child.stderr.on('data',chunk=>{fs.appendFileSync(path.join(dir,'agent-stderr.txt'),chunk);stderr=(stderr+chunk).slice(-20000);});
  let code=null,exitSignal=null,error=null;
  try {await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(c,s)=>{code=c;exitSignal=s;resolve();});});buffer+=decoder.end();if(buffer.trim())processLine(buffer);}
  catch(e){error=e.message;}finally{clearTimeout(timeout);signal?.removeEventListener('abort',abort);await proxy.close();await eventWriter.close();}
  if(fallback){fallback.error=error||'Agent stopped before assistant completion';fallbackRecords.push(fallback.finish());}
  for(const [id,tool] of toolStarts)tools.push({id,name:tool.name,args:tool.args,duration_ms:now()-tool.start,is_error:true,incomplete:true,termination_reason:terminationReason||exitSignal||'agent_exit',result:null});
  toolStarts.clear();
  const useFallback=!proxy.records.length;
  const records=(useFallback?fallbackRecords:proxy.records).toSorted((a,b)=>(a.agent_step||0)-(b.agent_step||0));
  if(useFallback)for(const record of records){appendJSON(path.join(dir,'requests.jsonl'),record);onRecord?.(record);}
  const recoveredErrors=records.filter(record=>record.status!=='ok');
  error=error||lastMessageError||(terminationReason?`Agent stopped: ${terminationReason} (step limit ${defaults.agent_max_steps}, timeout ${defaults.agent_timeout_seconds}s)`:null);
  const result={code,signal:exitSignal,error,stderr,duration_ms:now()-start,turns,steps:records.length,tools,tool_count:tools.length,tool_errors:tools.filter(t=>t.is_error).length,events,ended,settled,terminal_reason:lastStopReason,termination_reason:terminationReason,pi_version:pi.version,content:finalMessage,records,recovered_request_errors:recoveredErrors.length,success:!terminationReason&&code===0&&records.some(record=>record.status==='ok')&&(ended||settled)&&!['error','aborted'].includes(lastStopReason)&&!lastMessageError};
  writeJSON(path.join(dir,'agent-result.json'),result);return result;
}
