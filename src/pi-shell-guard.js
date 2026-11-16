import {createBashTool} from '@earendil-works/pi-coding-agent';

export default function shellDeadline(pi) {
  const cap=Number(process.env.SLLM_TOOL_TIMEOUT_SECONDS);
  if(!Number.isFinite(cap)||cap<=0)return;
  const original=createBashTool(process.cwd());
  // Retain the built-in schema, description and prompt metadata. Only execution
  // receives a bounded copy of the arguments; model transcripts are unchanged.
  pi.registerTool({...original,execute:(id,args,signal,onUpdate,context)=>{
    const requested=typeof args.timeout==='number'&&args.timeout>0?args.timeout:cap;
    return original.execute(id,{...args,timeout:Math.min(requested,cap)},signal,onUpdate,context);
  }});
}
