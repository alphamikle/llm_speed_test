import fs from 'node:fs';
import {fileURLToPath} from 'node:url';

export const LANGUAGES = ['en', 'ste', 'zh', 'ru'];
export const KITS = [
  {id:'01-prose-short', title:'Science-fiction screenplay from a short prompt', kind:'prose', dependencies:[]},
  {id:'02-prose-long', title:'Historical first-contact screenplay from a detailed dossier', kind:'prose', dependencies:[]},
  {id:'03-prose-summary-short', title:'Summarize the first generated screenplay', kind:'summary', dependencies:['01-prose-short']},
  {id:'04-prose-summary-long', title:'Summarize the second generated screenplay', kind:'summary', dependencies:['02-prose-long']},
  {id:'05-sql-generation', title:'Generate and execute a related SQLite population', kind:'sql', dependencies:[]},
  {id:'06-json-generation', title:'Generate linked logistics JSON with integrity constraints', kind:'json', dependencies:[]},
  {id:'07-json-prefill', title:'Analyze a large deterministic JSON corpus', kind:'json-analysis', dependencies:['06-json-generation']},
  {id:'08-code-generation', title:'Generate a tested event-processing JavaScript library', kind:'code', dependencies:[]},
  {id:'09-code-prefill', title:'Review a large code corpus with seeded defects', kind:'code-analysis', dependencies:['08-code-generation']},
  {id:'10-agent-battleship', title:'Pi builds and tests an SVG browser Battleship game', kind:'agent', dependencies:[]},
  {id:'11-agent-repair', title:'Pi repairs a transactional inventory service', kind:'agent', dependencies:[]},
  {id:'12-mixed-iterations', title:'Repeated prose, JSON and code reasoning with updates', kind:'mixed', dependencies:['01-prose-short','06-json-generation','08-code-generation']}
];
export const PROFILES = {
  full: {pages:50, pageBatch:5, wordsPerPage:180, hanPerPage:500, jsonRecords:256, sqlRows:5000, corpusRecords:3500, codeFunctions:900, mixedSteps:6},
  smoke: {pages:2, pageBatch:1, wordsPerPage:45, hanPerPage:100, jsonRecords:8, sqlRows:50, corpusRecords:20, codeFunctions:8, mixedSteps:2}
};
export function locale(language) {
  if (!LANGUAGES.includes(language)) throw new Error(`Unknown language '${language}'. Expected ${LANGUAGES.join(', ')}`);
  return JSON.parse(fs.readFileSync(new URL(`../data/prompts/${language}.json`, import.meta.url),'utf8'));
}
export function render(template, values) {
  return template.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (all,key) => Object.hasOwn(values,key) ? String(values[key]) : all);
}
export function selectKits(selection = 'all') {
  const names = selection === 'all' ? KITS.map(kit=>kit.id) : selection.split(',').map(value=>value.trim());
  const ids = new Set();
  function add(name) {
    const kit = KITS.find(item=>item.id===name || item.id.slice(0,2)===name.padStart(2,'0'));
    if (!kit) throw new Error(`Unknown kit '${name}'`);
    for (const dependency of kit.dependencies) add(dependency);
    ids.add(kit.id);
  }
  names.forEach(add);
  return KITS.filter(kit=>ids.has(kit.id));
}
export const ROOT = fileURLToPath(new URL('../',import.meta.url));
