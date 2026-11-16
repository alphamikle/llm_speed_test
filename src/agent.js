import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {StringDecoder} from 'node:string_decoder';
import {Measurement} from './metrics.js';
import {endpoint,requestHeaders,measureResponse} from './transport.js';
import {piPath} from './pi-path.js';
import {appendJSON,ensureDir,now,terminate,writeJSON} from './util.js';

export async function startMeteringProxy({slot,defaults,dir,metadata,signal,maxSteps=100,onRecord}) {
  let sequence=0;const records=[];const controllers=new Set();
  const server=http.createServer(async(req,res)=>{
    if(req.method!=='POST'||!req.url.endsWith('/chat/completions')){res.writeHead(404);res.end('Unknown proxy route');return;}
    if(++sequence>maxSteps){res.writeHead(400,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:`Agent exceeded ${maxSteps} inference steps`}}));return;}
    const id=`agent-${String(sequence).padStart(5,'0')}`;const recordDir=path.join(dir,'requests',id);ensureDir(recordDir);
    const meter=new Measurement({...metadata,request_id:id,agent_step:sequence,timestamp:new Date().toISOString()});
    const controller=new AbortController();controllers.add(controller);
    res.on('close',()=>{if(!res.writableEnded)controller.abort();});
    try{
      let body='';for await(const chunk of req){body+=chunk;if(body.length>32000000)throw new Error('Agent request exceeds 32 MB');}
      const payload={...JSON.parse(body),...slot.request,model:slot.model};
      if(payload.stream&&slot.stream_options!==false)payload.stream_options={include_usage:true};
      if(slot.stream_options===false)delete payload.stream_options;
      writeJSON(path.join(recordDir,'request.json'),payload);
      const signals=[controller.signal,AbortSignal.timeout(defaults.timeout_seconds*1000)];if(signal)signals.push(signal);
      const response=await fetch(endpoint(slot.base_url),{method:'POST',headers:requestHeaders(slot),body:JSON.stringify(payload),signal:AbortSignal.any(signals)});
      if(!response.ok){const text=await response.text();meter.error=`HTTP ${response.status}: ${text.slice(0,3000)}`;res.writeHead(response.status,{'content-type':'application/json'});res.end(text);}
      else{
        res.writeHead(200,{'content-type':response.headers.get('content-type')||'text/event-stream','cache-control':'no-cache'});
        await measureResponse(response,meter,{eventsFile:path.join(recordDir,'events.jsonl'),forward:async chunk=>{if(!res.write(chunk))await once(res,'drain');}});
        res.end();
      }
    }catch(error){meter.error=error.message;if(!res.headersSent)res.writeHead(502,{'content-type':'application/json'});if(!res.destroyed)res.end(JSON.stringify({error:{message:error.message}}));}
    finally{controllers.delete(controller);const record=meter.finish();records.push(record);appendJSON(path.join(dir,'requests.jsonl'),record);writeJSON(path.join(recordDir,'result.json'),record);onRecord?.(record);}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return {baseUrl:`http://127.0.0.1:${server.address().port}/v1`,records,close:async()=>{for(const controller of controllers)controller.abort();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
function isolatedEnv(home,extra={}) {
  const env={};for(const name of ['PATH','Path','SystemRoot','WINDIR','COMSPEC','PATHEXT','TEMP','TMP','TMPDIR','LANG','LC_ALL','TERM'])if(process.env[name])env[name]=process.env[name];
  return {...env,HOME:home,USERPROFILE:home,PI_CODING_AGENT_DIR:home,PI_SKIP_VERSION_CHECK:'1',...extra};
}
export async function runAgent({slot,defaults,agent,dir,workspace,prompt,system,metadata,signal,noTools=false,onRecord}) {
  ensureDir(dir);ensureDir(workspace);const home=path.join(dir,'pi-home');ensureDir(home);
  const proxy=await startMeteringProxy({slot,defaults,dir,metadata,signal,maxSteps:agent.native_model?10000:defaults.agent_max_steps,onRecord});
  const model={id:slot.model,name:'sllm benchmark model',api:'openai-completions',reasoning:true,input:agent.input||['text'],contextWindow:agent.context_window,maxTokens:agent.max_tokens,cost:{input:0,output:0,cacheRead:0,cacheWrite:0},compat:agent.compat};
  writeJSON(path.join(home,'models.json'),{providers:{sllm:{baseUrl:proxy.baseUrl,api:'openai-completions',apiKey:'local-benchmark',models:[model]}}});
  writeJSON(path.join(home,'settings.json'),{compaction:{enabled:false},retry:{enabled:false},packages:[],shellPath:process.platform==='win32'?undefined:process.env.SHELL||'/bin/bash'});
  const promptFile=path.join(dir,'agent-prompt.txt');fs.writeFileSync(promptFile,prompt);
  const systemFile=path.join(dir,'agent-system.txt');fs.writeFileSync(systemFile,system);
  const pi=piPath();
  const args=agent.command?[...(agent.args||[])]:[pi.cli,'--mode','json','--provider',agent.native_provider||'sllm','--model',agent.native_model||slot.model,'--thinking',agent.thinking,'--no-session','--no-extensions','--no-skills','--no-prompt-templates','--no-approve','--append-system-prompt',systemFile,...(noTools?['--no-tools']:['--tools','read,write,edit,bash']),`@${promptFile}`];
  const command=agent.command||process.execPath;
  const start=now();let buffer='',stderr='',finalMessage='',turns=0,toolStarts=new Map(),tools=[],events=0,ended=false,settled=false,fallback=null;const fallbackRecords=[];
  const extraEnv=Object.fromEntries(Object.entries(agent.env||{}).map(([key,value])=>[key,String(value).replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g,(_,name)=>{if(process.env[name]===undefined)throw new Error(`Missing agent environment variable: ${name}`);return process.env[name];})]));
  const child=spawn(command,args,{cwd:workspace,env:isolatedEnv(home,extraEnv),windowsHide:true,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});
  const decoder=new StringDecoder('utf8');
  const timeout=setTimeout(()=>terminate(child),defaults.agent_timeout_seconds*1000);
  const abort=()=>terminate(child);signal?.addEventListener('abort',abort,{once:true});
  const processLine=line=>{
    if(!line.trim())return;
    let event;try{event=JSON.parse(line);}catch{appendJSON(path.join(dir,'agent-unparsed.jsonl'),{line});return;}
    const time=now();events++;appendJSON(path.join(dir,'agent-events.jsonl'),{elapsed_ms:time-start,event});
    if(event.type==='turn_start')turns++;
    if(event.type==='message_start'&&event.message?.role==='assistant')fallback=new Measurement({...metadata,agent_step:turns,request_id:`native-pi-${turns}`,timing_scope:'pi_message_events'},time);
    if(event.type==='message_update'&&fallback){const e=event.assistantMessageEvent;const delta=e?.type==='text_delta'?{content:e.delta}:e?.type==='thinking_delta'?{reasoning_content:e.delta}:e?.type==='toolcall_delta'?{tool_calls:[{index:e.contentIndex,function:{arguments:e.delta}}]}:{};fallback.ingest({choices:[{delta}]},time);}
    if(event.type==='message_end'&&event.message?.role==='assistant'){
      const m=event.message;finalMessage=(m.content||[]).filter(x=>x.type==='text').map(x=>x.text).join('\n');
      if(fallback){fallback.usage={prompt_tokens:m.usage?.input,completion_tokens:m.usage?.output,prompt_tokens_details:{cached_tokens:m.usage?.cacheRead}};fallback.finishReason=m.stopReason;const record=fallback.finish(time);if(m.stopReason==='error'||m.errorMessage){record.status='error';record.error=m.errorMessage;}fallbackRecords.push(record);fallback=null;}
    }
    if(event.type==='tool_execution_start')toolStarts.set(event.toolCallId,{name:event.toolName,args:event.args,start:time});
    if(event.type==='tool_execution_end'){
      const first=toolStarts.get(event.toolCallId)||{name:event.toolName,start:time};
      tools.push({id:event.toolCallId,name:first.name,args:first.args,duration_ms:time-first.start,is_error:event.isError,result:event.result});toolStarts.delete(event.toolCallId);
    }
    if(event.type==='agent_end')ended=true;if(event.type==='agent_settled')settled=!event.aborted;
    if(turns>defaults.agent_max_steps)terminate(child);
  };
  child.stdout.on('data',chunk=>{buffer+=decoder.write(chunk);for(;;){const index=buffer.indexOf('\n');if(index<0)break;const line=buffer.slice(0,index).replace(/\r$/,'');buffer=buffer.slice(index+1);processLine(line);}if(buffer.length>64000000){stderr+='\nAgent JSONL record exceeded 64 MB';terminate(child);}});
  child.stderr.on('data',chunk=>{fs.appendFileSync(path.join(dir,'agent-stderr.txt'),chunk);stderr=(stderr+chunk).slice(-20000);});
  let code=null,exitSignal=null,error=null;
  try {await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(c,s)=>{code=c;exitSignal=s;resolve();});});buffer+=decoder.end();if(buffer.trim())processLine(buffer);}
  catch(e){error=e.message;}finally{clearTimeout(timeout);signal?.removeEventListener('abort',abort);await proxy.close();}
  const records=agent.native_model?fallbackRecords:proxy.records;
  if(agent.native_model)for(const record of records){appendJSON(path.join(dir,'requests.jsonl'),record);onRecord?.(record);}
  const result={code,signal:exitSignal,error,stderr,duration_ms:now()-start,turns,steps:records.length,tools,tool_count:tools.length,tool_errors:tools.filter(t=>t.is_error).length,events,ended,settled,pi_version:pi.version,content:finalMessage,records,success:code===0&&records.length>0&&records.every(r=>r.status==='ok')};
  writeJSON(path.join(dir,'agent-result.json'),result);return result;
}
