import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import {ensureDir, safeName} from './util.js';

export function configPath() {
  if (process.env.SLLM_CONFIG) return path.resolve(process.env.SLLM_CONFIG);
  const root = process.platform === 'win32' ? (process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')) : process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support') : (process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'));
  return path.join(root, 'sllm', 'config.yaml');
}
export const defaults = () => ({
  version: 1,
  defaults: {slot: 'default', profile: 'full', repetitions: 1, languages: ['en', 'ste', 'zh', 'ru'], output_dir: path.join(os.homedir(), 'sllm-results'), timeout_seconds: 1800, retries: 2, temperature: 0, max_output_tokens: 16384, page_batch: 5, agent_timeout_seconds: 3600, agent_max_steps: 100, repair_attempts: 2},
  agent: {provider: 'pi', command: null, args: [], thinking: 'off', context_window: 131072, max_tokens: 8192, compat: {supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, supportsUsageInStreaming: true}, env: {}, validation_commands: []},
  slots: {default: {base_url: 'http://127.0.0.1:1234/v1', model: 'deepseek-uncensored', api_key_env: 'SLLM_API_KEY', headers: {}, request: {}, output_token_field:'max_tokens', stream_options: true, startup: null}}
});
export function saveConfig(file, config) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, '# sllm configuration. Prefer environment variables for credentials.\n# Optional agent.tool_timeout_seconds: 180 (0 disables the Pi shell deadline).\n' + YAML.stringify(config,{aliasDuplicateObjects:false}), {mode: 0o600});
}
export function initConfig(file = configPath()) {
  if (!fs.existsSync(file)) saveConfig(file, defaults());
  return file;
}
export function loadConfig(file = configPath(), slotName) {
  initConfig(file);
  let config;
  try {config = YAML.parse(fs.readFileSync(file, 'utf8'), {uniqueKeys: true, maxAliasCount: 0});} catch (error) {throw new Error(`Invalid YAML in ${file}: ${error.message}`);}
  return resolveConfig(config,file,slotName);
}
export function resolveConfig(config,file,slotName) {
  if (!config || config.version !== 1 || !config.slots || Array.isArray(config.slots)) throw new Error('Configuration must have version: 1 and a slots mapping');
  for (const name of Object.keys(config.slots)) safeName(name);
  const common = defaults();
  config.defaults = {...common.defaults, ...config.defaults};
  config.agent = {...common.agent, ...config.agent};
  if(!['full','smoke'].includes(config.defaults.profile))throw new Error('defaults.profile must be full or smoke');
  if(!Array.isArray(config.defaults.languages)||!config.defaults.languages.length||config.defaults.languages.some(value=>!['en','ste','zh','ru'].includes(value))||new Set(config.defaults.languages).size!==config.defaults.languages.length)throw new Error('defaults.languages must be a nonempty unique list of en, ste, zh, ru');
  for(const [key,min,max] of [['repetitions',1,100],['timeout_seconds',1,86400],['agent_timeout_seconds',1,86400],['max_output_tokens',1,1000000],['page_batch',1,50],['agent_max_steps',1,10000],['retries',0,10],['repair_attempts',0,10]]){
    const value=config.defaults[key];if(!Number.isSafeInteger(value)||value<min||value>max)throw new Error(`defaults.${key} must be an integer from ${min} to ${max}`);
  }
  if(config.defaults.temperature!==null&&(!Number.isFinite(config.defaults.temperature)||config.defaults.temperature<0||config.defaults.temperature>2))throw new Error('defaults.temperature must be null or between 0 and 2');
  const name = slotName || config.defaults.slot;
  safeName(name);
  if (!Object.hasOwn(config.slots, name)) throw new Error(`Unknown slot '${name}'. Available slots: ${Object.keys(config.slots).join(', ')}`);
  const slot = {...common.slots.default, ...config.slots[name]};
  let url;
  try {url = new URL(slot.base_url);} catch {throw new Error(`Invalid base_url for slot '${name}'`);}
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('base_url must be an HTTP(S) URL without embedded credentials, query or fragment');
  if (typeof slot.model !== 'string' || !slot.model.trim()) throw new Error('The slot model must be a nonempty string');
  if (slot.api_key_env && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(slot.api_key_env)) throw new Error('Invalid api_key_env name');
  if (!slot.headers || typeof slot.headers !== 'object' || Array.isArray(slot.headers)) throw new Error('Slot headers must be a mapping');
  if (!slot.request || typeof slot.request !== 'object' || Array.isArray(slot.request)) throw new Error('Slot request must be a mapping');
  if (['model', 'messages', 'stream'].some(key => key in slot.request)) throw new Error('Slot request must not override model, messages, or stream');
  if(slot.request.n!==undefined&&slot.request.n!==1)throw new Error('The benchmark measures one completion per request; request.n must be 1');
  if(!['max_tokens','max_completion_tokens','max_output_tokens'].includes(slot.output_token_field))throw new Error('output_token_field must be max_tokens, max_completion_tokens or max_output_tokens');
  const agent = {...config.agent, ...slot.agent, compat: {...config.agent.compat, ...slot.agent?.compat}, env: {...config.agent.env, ...slot.agent?.env}};
  for(const key of ['context_window','max_tokens'])if(!Number.isSafeInteger(agent[key])||agent[key]<1)throw new Error(`agent.${key} must be a positive integer`);
  if(agent.tool_timeout_seconds!==undefined&&(!Number.isSafeInteger(agent.tool_timeout_seconds)||agent.tool_timeout_seconds<0||agent.tool_timeout_seconds>86400))throw new Error('agent.tool_timeout_seconds must be an integer from 0 to 86400');
  for(const [key,value] of Object.entries(slot.headers))if(typeof value!=='string'||/[\r\n]/.test(key+value))throw new Error('Header names and values must be strings without newlines');
  if(slot.startup&&(typeof slot.startup.command!=='string'||!Array.isArray(slot.startup.args)||slot.startup.args.some(value=>typeof value!=='string')))throw new Error('startup requires a command string and string args array');
  return {config, slot, slotName: name, agent, file};
}
