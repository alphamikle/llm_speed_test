import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {finished} from 'node:stream/promises';

export const now = () => performance.now();
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export const hash = value => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export const ensureDir = dir => fs.mkdirSync(dir, {recursive: true});
export const readJSON = file => JSON.parse(fs.readFileSync(file, 'utf8'));
export function writeJSON(file, value) {
  ensureDir(path.dirname(file));
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temp, file);
}
export function appendJSON(file, value) {
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, `${JSON.stringify(value)}\n`);
}
export class JSONLWriter {
  constructor(file) {
    ensureDir(path.dirname(file));this.error=null;
    this.stream=fs.createWriteStream(file,{flags:'a',highWaterMark:262144,mode:0o600});
    this.stream.on('error',error=>{this.error=error;});
  }
  write(value) {if(this.error)throw this.error;this.stream.write(`${JSON.stringify(value)}\n`);}
  async close() {this.stream.end();await finished(this.stream);if(this.error)throw this.error;}
}
export function safeName(value) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/.test(value) || value.includes('..')) throw new Error(`Invalid name: ${value}`);
  return value;
}
export function parsePositive(value, label, max = 10000000) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > max) throw new Error(`${label} must be an integer from 1 to ${max}`);
  return number;
}
export function redact(value) {
  if (Array.isArray(value)) {
    let hideNext=false;
    return value.map(item=>{
      if(hideNext){hideNext=false;return '[REDACTED]';}
      if(typeof item==='string'){
        const flag=item.split('=')[0];
        if(/^(?:--(?:api[-_]?key|auth(?:orization|[-_]token)?|access[-_]token|bearer|password|secret|token|header)|-H)$/i.test(flag)){
          if(item.includes('='))return flag+'=[REDACTED]';hideNext=true;return item;
        }
      }
      return redact(item);
    });
  }
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /api.?key$|authorization|password|secret|access.?token|^headers$|^env$/i.test(key) ? '[REDACTED]' : redact(item)]));
  return value;
}
export async function runCommand(command, args = [], options = {}) {
  const {cwd, env, timeoutMs = 60000, signal, onOutput} = options;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {cwd, env: {...process.env, ...env}, windowsHide: true, detached: process.platform!=='win32', signal, stdio: ['ignore', 'pipe', 'pipe']});
    let stdout = '', stderr = '', timedOut = false;
    const timer = setTimeout(() => { timedOut = true; terminate(child); }, timeoutMs);
    child.stdout.on('data', data => { stdout += data; onOutput?.('stdout', data.toString()); if (stdout.length > 8000000) stdout = stdout.slice(-8000000); });
    child.stderr.on('data', data => { stderr += data; onOutput?.('stderr', data.toString()); if (stderr.length > 8000000) stderr = stderr.slice(-8000000); });
    child.on('error', error => {clearTimeout(timer); reject(error);});
    child.on('close', (code, sig) => {clearTimeout(timer); resolve({code, signal: sig, stdout, stderr, timedOut});});
  });
}
export function terminate(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {windowsHide: true, stdio: 'ignore'});
  else {
    try {process.kill(-child.pid, 'SIGTERM');} catch {child.kill('SIGTERM');}
    const timer = setTimeout(() => {try {process.kill(-child.pid, 'SIGKILL');} catch {child.kill('SIGKILL');}}, 5000);
    timer.unref();
  }
}
export function csv(rows) {
  if (!rows.length) return '';
  const keys = [...new Set(rows.flatMap(row => Object.keys(row)))];
  const cell = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
  return `${keys.map(cell).join(',')}\n${rows.map(row => keys.map(key => cell(row[key])).join(',')).join('\n')}\n`;
}
export function extractJSON(text) {
  const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  try {return JSON.parse(clean);} catch {}
  const start = Math.min(...['{', '['].map(mark => clean.indexOf(mark)).filter(n => n >= 0));
  if (!Number.isFinite(start)) throw new Error('No JSON value found');
  return JSON.parse(clean.slice(start, Math.max(clean.lastIndexOf('}'), clean.lastIndexOf(']')) + 1));
}
