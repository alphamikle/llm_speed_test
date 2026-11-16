import {now} from './util.js';

export function stats(values) {
  const data = values.filter(value => Number.isFinite(value)).sort((a, b) => a - b);
  if (!data.length) return {count: 0, mean: null, median: null, min: null, max: null, p90: null, p95: null, stddev: null};
  const quantile = p => {const n = (data.length - 1) * p, i = Math.floor(n); return data[i] + (data[Math.ceil(n)] - data[i]) * (n - i);};
  const mean = data.reduce((a, b) => a + b, 0) / data.length;
  return {count: data.length, mean, median: quantile(0.5), min: data[0], max: data.at(-1), p90: quantile(0.9), p95: quantile(0.95), stddev: Math.sqrt(data.reduce((sum, value) => sum + (value - mean) ** 2, 0) / data.length)};
}
const finite = value => Number.isFinite(Number(value)) && value !== null && value !== undefined ? Number(value) : null;
const rate = (tokens, ms) => tokens > 0 && ms > 0 ? tokens * 1000 / ms : null;
export class Measurement {
  constructor(metadata = {}, start = now()) {
    this.start = start; this.metadata = metadata; this.first = null; this.firstAnswer = null; this.last = null;
    this.content = ''; this.reasoning = ''; this.refusal=''; this.toolCalls = new Map(); this.usage = {}; this.native = {}; this.intervals = [];
    this.finishReason = null; this.eventCount = 0; this.error = null; this.serverModel = null; this.protocolDone=false; this.completionSignal=null;
  }
  ingest(event, time = now()) {
    this.eventCount++;
    if(typeof event.model==='string')this.serverModel=event.model;
    if (event.error) this.error = typeof event.error === 'string' ? event.error : JSON.stringify(event.error);
    if (event.usage) this.usage = {...this.usage, ...event.usage};
    if (event.timings) this.native = {...this.native, ...event.timings};
    const choice = event.choices?.[0];
    if (!choice) return;
    if (choice.finish_reason) this.finishReason = choice.finish_reason;
    const delta = choice.delta || choice.message || {};
    const content = typeof delta.content === 'string' ? delta.content : Array.isArray(delta.content) ? delta.content.filter(x => x.type === 'text').map(x => x.text || '').join('') : '';
    const reasoning = delta.reasoning_content || delta.reasoning || '';
    const refusal=typeof delta.refusal==='string'?delta.refusal:'';
    const toolText = (delta.tool_calls || []).map(tool => tool.function?.arguments || tool.function?.name || '').join('');
    if (content || reasoning || refusal || toolText) {
      if (this.first === null) this.first = time;
      if (this.last !== null) this.intervals.push(time - this.last);
      this.last = time;
    }
    if ((content||refusal) && this.firstAnswer === null) this.firstAnswer = time;
    this.content += content; this.reasoning += reasoning;this.refusal+=refusal;
    for (const tool of delta.tool_calls || []) {
      const key = tool.index ?? tool.id ?? 0;
      const previous = this.toolCalls.get(key) || {id: '', type: 'function', function: {name: '', arguments: ''}};
      if (tool.id) previous.id = tool.id;
      if (tool.function?.name) previous.function.name += tool.function.name;
      previous.function.arguments += tool.function?.arguments || '';
      this.toolCalls.set(key, previous);
    }
  }
  finish(end = now()) {
    const inputTokens = finite(this.usage.prompt_tokens ?? this.usage.input_tokens);
    const outputTokens = finite(this.usage.completion_tokens ?? this.usage.output_tokens);
    const cachedTokens = finite(this.usage.prompt_tokens_details?.cached_tokens ?? this.usage.input_tokens_details?.cached_tokens ?? this.native.cache_n);
    const promptCount = finite(this.native.prompt_n ?? this.native.prompt_tokens);
    const promptMs = finite(this.native.prompt_ms);
    const decodeCount = finite(this.native.predicted_n ?? this.native.generated_tokens);
    const decodeMs = finite(this.native.predicted_ms);
    const ttft = this.first === null ? null : this.first - this.start;
    const uncached = promptCount ?? (inputTokens === null || cachedTokens === null ? null : Math.max(0, inputTokens - cachedTokens));
    const estimatedInput = uncached ?? inputTokens;
    const generationMs = this.first !== null && this.last > this.first ? this.last - this.first : null;
    const estimatedTG = outputTokens > 1 && generationMs > 0 ? (outputTokens - 1) * 1000 / generationMs : null;
    return {...this.metadata, server_model:this.serverModel, completion_signal:this.completionSignal, status: this.error ? 'error' : 'ok', error: this.error, duration_ms: end - this.start,
      ttft_ms: ttft, first_answer_ms: this.firstAnswer === null ? null : this.firstAnswer - this.start,
      input_tokens: inputTokens, output_tokens: outputTokens, cached_tokens: cachedTokens, uncached_tokens: uncached,
      pp_tps: rate(promptCount, promptMs), pp_estimate_tps: rate(estimatedInput, ttft),
      tg_tps: rate(decodeCount, decodeMs), tg_estimate_tps: estimatedTG,
      pp_source: rate(promptCount, promptMs) === null ? 'unavailable' : 'server_timings',
      tg_source: rate(decodeCount, decodeMs) === null ? 'unavailable' : 'server_timings',
      prompt_ms: promptMs, decode_ms: decodeMs, native_prompt_tokens: promptCount, native_decode_tokens: decodeCount,
      stream_event_count: this.eventCount, inter_delta_ms: stats(this.intervals), finish_reason: this.finishReason,
      usage: this.usage, native_timings: this.native, content: this.content, reasoning: this.reasoning, refusal:this.refusal, tool_calls: [...this.toolCalls.values()]};
  }
}
export function aggregate(records) {
  const good = records.filter(record => record.status === 'ok');
  const metrics = {};
  for (const key of ['pp_tps','tg_tps','pp_estimate_tps','tg_estimate_tps','ttft_ms','first_answer_ms','duration_ms']) metrics[key] = {...stats(good.map(r => r[key])), missing: good.filter(r => !Number.isFinite(r[key])).length};
  for (const [key, tokens, ms] of [['pp_tps','native_prompt_tokens','prompt_ms'],['tg_tps','native_decode_tokens','decode_ms']]) {
    const matching = good.filter(r => Number.isFinite(r[key]));
    metrics[key].weighted = rate(matching.reduce((n, r) => n + r[tokens], 0), matching.reduce((n, r) => n + r[ms], 0));
  }
  const knownInput=good.reduce((n,r)=>n+(r.input_tokens??0),0),knownOutput=good.reduce((n,r)=>n+(r.output_tokens??0),0);
  return {requests: records.length, successful_requests: good.length, failed_requests: records.length - good.length,
    input_tokens:good.every(r=>Number.isFinite(r.input_tokens))?knownInput:null,output_tokens:good.every(r=>Number.isFinite(r.output_tokens))?knownOutput:null,known_input_tokens:knownInput,known_output_tokens:knownOutput,
    missing_token_usage: good.filter(r => r.input_tokens === null || r.output_tokens === null).length,
    cached_tokens: good.reduce((n,r) => n + (r.cached_tokens ?? 0),0), metrics};
}
