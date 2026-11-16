import fs from 'node:fs';
import path from 'node:path';
import {Measurement} from './metrics.js';
import {appendJSON, ensureDir, hash, now, sleep, writeJSON,JSONLWriter} from './util.js';

export class SSEParser {
  constructor(onEvent) {this.buffer = ''; this.decoder = new TextDecoder(); this.onEvent = onEvent; this.done = false;}
  push(chunk) {
    this.buffer += typeof chunk === 'string' ? chunk : this.decoder.decode(chunk, {stream: true});
    this.drain();
    if (this.buffer.length > 16000000) throw new Error('SSE event exceeds 16 MB');
  }
  drain() {
    for (;;) {
      const match = /\r?\n\r?\n/.exec(this.buffer);
      if (!match) break;
      const block = this.buffer.slice(0, match.index); this.buffer = this.buffer.slice(match.index + match[0].length);
      this.block(block);
    }
  }
  block(block) {
    const lines = block.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, ''));
    if (!lines.length) return;
    const data = lines.join('\n');
    if (data.trim() === '[DONE]') {this.done = true; return;}
    try {this.onEvent(JSON.parse(data));} catch (error) {throw new Error(`Invalid SSE event: ${error.message}`);}
  }
  finish() {this.buffer += this.decoder.decode(); this.drain(); if (this.buffer.trim()) this.block(this.buffer);}
}
export function endpoint(base) {return `${base.replace(/\/+$/, '')}/chat/completions`;}
export function requestHeaders(slot) {
  const key = slot.api_key ?? (slot.api_key_env ? process.env[slot.api_key_env] : undefined);
  return {'Content-Type': 'application/json', ...(key ? {Authorization: `Bearer ${key}`} : {}), ...slot.headers};
}
export async function measureResponse(response, meter, options = {}) {
  const {eventsFile, forward} = options;
  const contentType = response.headers.get('content-type') || '';
  if (!response.ok) {
    const text = (await response.text()).slice(0, 4000);
    const error = new Error(`HTTP ${response.status}: ${text}`); error.httpStatus = response.status; throw error;
  }
  if (!response.body) throw new Error('Server returned no response body');
  const writer=eventsFile?new JSONLWriter(eventsFile):null;
  try {
  if (contentType.includes('text/event-stream')) {
    const parser = new SSEParser(event => {
      const t = now(); meter.ingest(event, t);
      writer?.write({elapsed_ms: t - meter.start, event});
    });
    for await (const chunk of response.body) {parser.push(chunk); if (forward) await forward(chunk);}
    parser.finish();
    // Some compatible servers close after a finish_reason without a [DONE].
    if (!parser.done && !meter.finishReason) throw new Error('SSE stream ended without [DONE] or finish_reason');
  } else {
    const text = await response.text();
    let data; try {data = JSON.parse(text);} catch {throw new Error(`Expected JSON/SSE, got: ${text.slice(0, 150)}`);}
    meter.ingest(data);
    // A nonstreaming response cannot reveal TTFT or decode intervals.
    meter.first = meter.firstAnswer = meter.last = null;
    writer?.write({elapsed_ms: now() - meter.start, event: data});
    if (forward) await forward(Buffer.from(text));
  }
  } finally {await writer?.close();}
}
export class Client {
  constructor({slot, defaults, dir, signal, onRecord, onProgress}) {Object.assign(this, {slot, defaults, dir, signal, onRecord, onProgress}); this.sequence = 0; this.records = [];}
  async chat(messages, metadata = {}, overrides = {}) {
    const id = `${String(++this.sequence).padStart(5, '0')}-${hash(metadata).slice(0, 6)}`;
    const requestDir = path.join(this.dir, 'requests', id); ensureDir(requestDir);
    const {max_tokens:overrideBudget,...otherOverrides}=overrides;
    const tokenField=this.slot.output_token_field||'max_tokens';
    const payload = {model: this.slot.model, messages, temperature: this.defaults.temperature, ...this.slot.request, ...otherOverrides, [tokenField]:overrideBudget??this.slot.request[tokenField]??this.defaults.max_output_tokens, stream: true};
    if(payload.temperature===null)delete payload.temperature;
    if (this.slot.stream_options !== false) payload.stream_options = {include_usage: true};
    writeJSON(path.join(requestDir, 'request.json'), payload);
    const maxRetries = this.defaults.retries;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      this.signal?.throwIfAborted();
      const meter = new Measurement({...metadata, request_id: id, attempt, timestamp: new Date().toISOString()});
      const heartbeat=this.onProgress?setInterval(()=>this.onProgress({...metadata,elapsed_seconds:(now()-meter.start)/1000,characters:meter.content.length+meter.reasoning.length}),15000):null;
      const timeout = AbortSignal.timeout(this.defaults.timeout_seconds * 1000);
      const signal = this.signal ? AbortSignal.any([this.signal, timeout]) : timeout;
      let failure;
      try {
        const response = await fetch(endpoint(this.slot.base_url), {method: 'POST', body: JSON.stringify(payload), headers: requestHeaders(this.slot), signal});
        await measureResponse(response, meter, {eventsFile: path.join(requestDir, `events-${attempt}.jsonl`)});
        if (meter.error) throw new Error(meter.error);
        if (!meter.content && !meter.reasoning && !meter.toolCalls.size) throw new Error('The model returned no content, reasoning, or tool calls');
      } catch (error) {failure = error; meter.error = error.message;}
      if(heartbeat)clearInterval(heartbeat);
      const record = meter.finish();
      this.records.push(record); appendJSON(path.join(this.dir, 'requests.jsonl'), record); writeJSON(path.join(requestDir, `result-${attempt}.json`), record); this.onRecord?.(record);
      if (!failure) return record;
      if (this.signal?.aborted) throw failure;
      const retryable = !failure.httpStatus || [408,409,425,429,500,502,503,504].includes(failure.httpStatus);
      if (attempt === maxRetries || !retryable) {failure.record = record; throw failure;}
      await sleep(Math.min(30000, 1000 * 2 ** attempt));
    }
  }
}
