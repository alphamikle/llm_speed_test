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
  defaults: {slot: 'default', profile: 'full', repetitions: 1, languages: ['en', 'ste', 'zh', 'ru'], output_dir: path.join(os.homedir(), 'sllm-results'), timeout_seconds: 1800, retries: 2, temperature: 0, max_output_tokens: 8192, page_batch: 5, agent_timeout_seconds: 3600, agent_max_steps: 100, repair_attempts: 2},
  agent: {provider: 'pi', command: null, args: [], thinking: 'off', context_window: 131072, max_tokens: 8192, compat: {supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, supportsUsageInStreaming: true}, env: {}, validation_commands: []},
  slots: {default: {base_url: 'http://127.0.0.1:1234/v1', model: 'deepseek-uncensored', api_key_env: 'SLLM_API_KEY', headers: {}, request: {}, stream_options: true, startup: null}}
});
export function saveConfig(file, config) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, '# sllm configuration. Prefer environment variables for credentials.\n' + YAML.stringify(config), {mode: 0o600});
}
export function initConfig(file = configPath()) {
  if (!fs.existsSync(file)) saveConfig(file, defaults());
  return file;
}
export function loadConfig(file = configPath(), slotName) {
  initConfig(file);
  let config;
  try {config = YAML.parse(fs.readFileSync(file, 'utf8'), {uniqueKeys: true, maxAliasCount: 0});} catch (error) {throw new Error(`Invalid YAML in ${file}: ${error.message}`);}
  if (!config || config.version !== 1 || !config.slots || Array.isArray(config.slots)) throw new Error('Configuration must have version: 1 and a slots mapping');
  for (const name of Object.keys(config.slots)) safeName(name);
  const common = defaults();
  config.defaults = {...common.defaults, ...config.defaults};
  config.agent = {...common.agent, ...config.agent};
  const name = slotName || config.defaults.slot;
  safeName(name);
  if (!Object.hasOwn(config.slots, name)) throw new Error(`Unknown slot '${name}'. Available slots: ${Object.keys(config.slots).join(', ')}`);
  const slot = {...common.slots.default, ...config.slots[name]};
  let url;
  try {url = new URL(slot.base_url);} catch {throw new Error(`Invalid base_url for slot '${name}'`);}
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('base_url must be an HTTP(S) URL without embedded credentials');
  if (typeof slot.model !== 'string' || !slot.model.trim()) throw new Error('The slot model must be a nonempty string');
  if (slot.api_key_env && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(slot.api_key_env)) throw new Error('Invalid api_key_env name');
  if (!slot.headers || typeof slot.headers !== 'object' || Array.isArray(slot.headers)) throw new Error('Slot headers must be a mapping');
  if (!slot.request || typeof slot.request !== 'object' || Array.isArray(slot.request)) throw new Error('Slot request must be a mapping');
  if (['model', 'messages', 'stream'].some(key => key in slot.request)) throw new Error('Slot request must not override model, messages, or stream');
  const agent = {...config.agent, ...slot.agent, compat: {...config.agent.compat, ...slot.agent?.compat}, env: {...config.agent.env, ...slot.agent?.env}};
  return {config, slot, slotName: name, agent, file};
}
