import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import Ajv from 'ajv';
import {extractJSON,ensureDir,runCommand,writeJSON} from './util.js';
import {CODE_CONTRACT,REPAIR_CONTRACT} from './fixtures.js';
const ajv=new Ajv({allErrors:true});
const itemSchema={type:'object',required:['warehouses','suppliers','items'],properties:{warehouses:{type:'array',minItems:4,items:{type:'object',required:['id','name','capacity'],properties:{id:{type:'string'},name:{type:'string'},capacity:{type:'integer',minimum:0}}}},suppliers:{type:'array',minItems:4,items:{type:'object',required:['id','name'],properties:{id:{type:'string'},name:{type:'string'}}}},items:{type:'array',items:{type:'object',required:['id','warehouse_id','supplier_id','name','quantity','unit_price_cents'],properties:{id:{type:'string'},warehouse_id:{type:'string'},supplier_id:{type:'string'},name:{type:'string'},quantity:{type:'integer',minimum:0},unit_price_cents:{type:'integer',minimum:0}}}}}};
const validItems=ajv.compile(itemSchema);
export function mixedOutputSchema(step) {
  return {type:'object',required:['step','screenplay_facts','inventory_value_cents','code_risks','change_plan','tests'],properties:{step:{type:'integer',const:step},screenplay_facts:{},inventory_value_cents:{},code_risks:{},change_plan:{},tests:{type:'array',minItems:3}}};
}
const mixedChecks=new Map();
export function validateMixedOutput(text,step) {
  try {
    const data=extractJSON(text);
    if(!mixedChecks.has(step))mixedChecks.set(step,ajv.compile(mixedOutputSchema(step)));
    const check=mixedChecks.get(step);const passed=check(data);
    return {passed,errors:passed?[]:check.errors.map(error=>`${error.instancePath||'/'} ${error.message}`),contract_version:2};
  }catch(error){return {passed:false,errors:[error.message],contract_version:2};}
}
export function unfence(text) {return text.trim().replace(/^```[A-Za-z]*\s*\n?/,'').replace(/\n?```\s*$/,'').trim();}
export function validateLogistics(text,count) {
  let data;try{data=extractJSON(text);}catch(error){return {passed:false,errors:[error.message]};}
  if(!validItems(data))return {passed:false,errors:validItems.errors.map(error=>`${error.instancePath} ${error.message}`)};
  const errors=[];if(data.items.length!==count)errors.push(`Expected ${count} items, got ${data.items.length}`);
  for(const key of ['warehouses','suppliers','items'])if(new Set(data[key].map(x=>x.id)).size!==data[key].length)errors.push(`Duplicate IDs in ${key}`);
  const ws=new Map(data.warehouses.map(w=>[w.id,w]));const ss=new Set(data.suppliers.map(s=>s.id));const totals={};
  for(const item of data.items){if(!ws.has(item.warehouse_id)||!ss.has(item.supplier_id))errors.push(`Invalid reference: ${item.id}`);totals[item.warehouse_id]=(totals[item.warehouse_id]||0)+item.quantity;}
  for(const [id,n] of Object.entries(totals))if(ws.has(id)&&n>ws.get(id).capacity)errors.push(`Capacity exceeded: ${id}`);
  return {passed:!errors.length,errors,records:data.items.length,data};
}
export function validateProse(text,profile,language) {
  const matches=[...text.matchAll(/=== PAGE (\d{3}) ===/g)];const errors=[];const pages=[];
  for(let i=0;i<matches.length;i++){
    const body=text.slice(matches[i].index+matches[i][0].length,matches[i+1]?.index??text.length);
    const words=body.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)?.length||0;
    const han=body.match(/\p{Script=Han}/gu)?.length||0;
    const number=Number(matches[i][1]);pages.push({number,words,han});
    if(language==='zh'?han<profile.hanPerPage:words<profile.wordsPerPage)errors.push(`Page ${number} is too short (${words} words, ${han} Han characters)`);
  }
  const numbers=pages.map(x=>x.number);
  for(let i=1;i<=profile.pages;i++)if(numbers.filter(n=>n===i).length!==1)errors.push(`Page ${i} is missing or repeated`);
  if(pages.length!==profile.pages)errors.push(`Expected exactly ${profile.pages} pages, got ${pages.length}`);
  return {passed:!errors.length,errors,pages,total_words:pages.reduce((n,p)=>n+p.words,0),han_characters:pages.reduce((n,p)=>n+p.han,0),format:'A4 screenplay-equivalent pages; explicit page breaks, minimum text per page'};
}
export function languageAudit(text,language) {
  const letters=text.match(/\p{L}/gu)||[];const cyrillic=text.match(/\p{Script=Cyrillic}/gu)||[];const han=text.match(/\p{Script=Han}/gu)||[];
  const sentences=text.split(/[.!?。！？]+/).map(s=>s.trim()).filter(Boolean);
  const short=sentences.filter(s=>(s.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g)||[]).length<=20).length;
  return {requested:language,letters:letters.length,cyrillic_ratio:letters.length?cyrillic.length/letters.length:0,han_ratio:letters.length?han.length/letters.length:0,ste_short_sentence_ratio:sentences.length?short/sentences.length:null,ste_certified:false,notes:language==='ste'?'Sentence-length screen only; not a licensed ASD-STE100 dictionary or formal certification.':undefined};
}
export function compareJSON(text,expected) {
  try{const data=extractJSON(text);const errors=[];for(const [key,value] of Object.entries(expected))if(JSON.stringify(data[key])!==JSON.stringify(value))errors.push(`Incorrect ${key}: expected ${JSON.stringify(value)}, got ${JSON.stringify(data[key])}`);return {passed:!errors.length,errors,data};}catch(error){return {passed:false,errors:[error.message]};}
}
export async function validateCode(text,dir,signal) {
  ensureDir(dir);const file=path.join(dir,'generated.mjs');fs.writeFileSync(file,unfence(text));
  const contract=path.join(dir,'contract.mjs');fs.writeFileSync(contract,CODE_CONTRACT);
  const result=await runCommand(process.execPath,[contract,file],{cwd:dir,timeoutMs:20000,signal});
  return {passed:result.code===0&&!result.timedOut,errors:result.code===0?[]:[result.stderr||result.stdout||'Code validator timed out'],execution:result};
}
export async function validateSQL(text,count,dir,signal) {
  ensureDir(dir);const file=path.join(dir,'population.sql');fs.writeFileSync(file,unfence(text));
  const result=await runCommand(process.execPath,[fileURLToPath(new URL('./validate-child.js',import.meta.url)),'sql',file,String(count)],{cwd:dir,timeoutMs:30000,signal});
  let detail;try{detail=JSON.parse(result.stdout.trim());}catch{}
  return {passed:result.code===0&&!result.timedOut,errors:result.code===0?[]:[result.stderr||result.stdout||'SQL validator timed out'],...detail,execution:result};
}
export async function validateRepair(dir,artifactDir,signal) {
  ensureDir(artifactDir);const contract=path.join(artifactDir,'inventory-contract.mjs');fs.writeFileSync(contract,REPAIR_CONTRACT);
  const result=await runCommand(process.execPath,[contract,dir],{cwd:dir,timeoutMs:30000,signal});
  return {passed:result.code===0&&!result.timedOut,errors:result.code===0?[]:[result.stderr||result.stdout],execution:result};
}
