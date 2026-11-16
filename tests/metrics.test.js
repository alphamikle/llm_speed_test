import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Measurement,stats,aggregate} from '../src/metrics.js';
import {SSEParser} from '../src/transport.js';

test('statistics handle even medians, zero values and missing observations',()=>{
  assert.deepEqual(stats([null,undefined,NaN]).count,0);
  const value=stats([0,2,4,6,undefined]);assert.equal(value.mean,3);assert.equal(value.median,3);assert.equal(value.min,0);assert.equal(value.max,6);
});
test('TTFT ignores status/role events and counts reasoning before visible answer',()=>{
  const m=new Measurement({},100);m.ingest({choices:[{delta:{role:'assistant',content:''}}]},150);m.ingest({lai_status:{phase:'loading'}},200);
  m.ingest({choices:[{delta:{reasoning_content:'think'}}]},300);m.ingest({choices:[{delta:{content:'answer'}}]},500);
  m.ingest({usage:{prompt_tokens:200,completion_tokens:10,prompt_tokens_details:{cached_tokens:150}},timings:{prompt_n:50,prompt_ms:100,predicted_n:10,predicted_ms:200}},510);
  const r=m.finish(600);assert.equal(r.ttft_ms,200);assert.equal(r.first_answer_ms,400);assert.equal(r.pp_tps,500);assert.equal(r.tg_tps,50);assert.equal(r.cached_tokens,150);assert.equal(r.uncached_tokens,50);assert.equal(r.content,'answer');assert.equal(r.reasoning,'think');
});
test('missing server timings stay null and SSE chunk count is never a token count',()=>{
  const m=new Measurement({},0);for(let i=1;i<=3;i++)m.ingest({choices:[{delta:{content:'x'}}]},i*100);const r=m.finish(350);assert.equal(r.pp_tps,null);assert.equal(r.tg_tps,null);assert.equal(r.output_tokens,null);assert.equal(r.tg_estimate_tps,null);
});
test('tool arguments start TTFT and are reconstructed across deltas',()=>{
  const m=new Measurement({},0);m.ingest({choices:[{delta:{tool_calls:[{index:0,id:'call',function:{name:'read',arguments:'{"p'}}]}}]},50);m.ingest({choices:[{delta:{tool_calls:[{index:0,function:{arguments:'ath":"x"}'}}]}}]},60);
  const r=m.finish(100);assert.equal(r.ttft_ms,50);assert.equal(r.tool_calls[0].function.arguments,'{"path":"x"}');
});
test('aggregation separates native and estimated rates and reports missing counts',()=>{
  const a=new Measurement({},0);a.ingest({choices:[{delta:{content:'a'}}]},10);a.ingest({choices:[{delta:{content:'b'}}],usage:{prompt_tokens:100,completion_tokens:3},timings:{prompt_n:100,prompt_ms:100,predicted_n:3,predicted_ms:50}},60);
  const b=new Measurement({},0);b.ingest({choices:[{delta:{content:'x'}}]},20);
  const summary=aggregate([a.finish(70),b.finish(30)]);assert.equal(summary.metrics.pp_tps.count,1);assert.equal(summary.metrics.pp_tps.missing,1);assert.equal(summary.metrics.pp_tps.weighted,1000);assert.equal(summary.metrics.pp_estimate_tps.count,1);assert.equal(summary.missing_token_usage,1);
});
test('SSE parser preserves fragmented UTF-8, CRLF, comments and multiline data',()=>{
  const events=[];const parser=new SSEParser(event=>events.push(event));
  const text=': ping\r\n\r\ndata: {"choices":[{"delta":{"content":"\u4e2d\u6587 \u041f\u0440\u0438\u0432\u0435\u0442"}}]}\r\n\r\ndata: {"usage":\r\ndata: {"completion_tokens":2}}\r\n\r\ndata: [DONE]\r\n\r\n';
  for(const byte of Buffer.from(text))parser.push(Uint8Array.of(byte));parser.finish();assert.equal(events.length,2);assert.equal(events[0].choices[0].delta.content,'\u4e2d\u6587 \u041f\u0440\u0438\u0432\u0435\u0442');assert.equal(events[1].usage.completion_tokens,2);assert.equal(parser.done,true);
});
test('malformed SSE is an explicit protocol error',()=>{const p=new SSEParser(()=>{});assert.throws(()=>p.push('data: not-json\n\n'),/Invalid SSE/);});
