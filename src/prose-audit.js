import fs from 'node:fs';
import path from 'node:path';
import {readJSON,writeJSON} from './util.js';

const METHOD={version:1,similarity:'Multiset Sorensen-Dice; repeated shingles retain their frequency',shingle_tokens:5,min_page_tokens:100,near_duplicate_dice:0.9,internal_repetition_fraction:0.65,normalization:'NFKC, lowercase, numeric runs replaced; Han characters are individual tokens'};
function pageData(number,body) {
  const tokens=body.normalize('NFKC').toLowerCase().replace(/\p{N}+/gu,'#').match(/\p{Script=Han}|[\p{L}\p{M}]+|#/gu)||[];
  const shingles=new Map();for(let i=0;i<=tokens.length-METHOD.shingle_tokens;i++){const key=tokens.slice(i,i+METHOD.shingle_tokens).join('\u0001');shingles.set(key,(shingles.get(key)||0)+1);}
  const count=Math.max(0,tokens.length-METHOD.shingle_tokens+1);
  return {number,tokens:tokens.length,shingles,shingle_count:count,internal_repetition:count?1-shingles.size/count:0};
}
function dice(a,b) {
  if(!a.shingle_count||!b.shingle_count)return 0;
  if(a.shingles.size>b.shingles.size)[a,b]=[b,a];let common=0;for(const [value,count] of a.shingles)common+=Math.min(count,b.shingles.get(value)||0);
  return 2*common/(a.shingle_count+b.shingle_count);
}
export function auditProse(text) {
  const markers=[...text.matchAll(/=== PAGE (\d{3}) ===/g)];
  const pages=markers.map((marker,index)=>pageData(Number(marker[1]),text.slice(marker.index+marker[0].length,markers[index+1]?.index)));
  const duplicates=[];const pairs=[];let maximum=0;
  for(let i=1;i<pages.length;i++) {
    const current=pages[i];if(current.tokens<METHOD.min_page_tokens)continue;
    let closest=null;
    for(let j=0;j<i;j++) {
      const previous=pages[j];if(previous.tokens<METHOD.min_page_tokens)continue;
      const similarity=dice(current,previous);maximum=Math.max(maximum,similarity);
      if(!closest||similarity>closest.similarity)closest={page:current.number,similar_to:previous.number,similarity};
      if(similarity>=METHOD.near_duplicate_dice)pairs.push({page:current.number,similar_to:previous.number,similarity});
    }
    if(closest&&closest.similarity>=METHOD.near_duplicate_dice)duplicates.push(closest);
  }
  const internal=pages.filter(page=>page.tokens>=METHOD.min_page_tokens&&page.internal_repetition>=METHOD.internal_repetition_fraction).map(({number,internal_repetition})=>({page:number,repetition_fraction:internal_repetition}));
  return {method:METHOD,pages:pages.length,flagged:Boolean(duplicates.length||internal.length),near_duplicate_pages:duplicates,near_duplicate_page_fraction:pages.length?duplicates.length/pages.length:0,near_duplicate_pair_count:pairs.length,most_similar_pairs:pairs.toSorted((a,b)=>b.similarity-a.similarity).slice(0,10),maximum_page_similarity:maximum,internally_repetitive_pages:internal,page_statistics:pages.map(({number,tokens,internal_repetition})=>({page:number,tokens,internal_repetition}))};
}

export function createProseAudit(runDirectory,destination=runDirectory) {
  const state=readJSON(path.join(runDirectory,'run.json'));const rows=[];
  for(const test of Object.values(state.cases||{})) {
    if(test.status!=='completed'||!/^0[12]-prose-/.test(test.kit))continue;
    const row={slot:test.slot,language:test.language,kit:test.kit,repetition:test.repetition,as_run_structural_passed:test.validation?.passed??null};
    try{Object.assign(row,{status:'audited'},auditProse(fs.readFileSync(test.output_file,'utf8')));}catch(error){row.status='unavailable';row.error=error.message;}
    rows.push(row);
  }
  rows.sort((a,b)=>a.slot.localeCompare(b.slot)||a.language.localeCompare(b.language)||a.kit.localeCompare(b.kit)||a.repetition-b.repetition);
  const result={schema_version:1,run_id:state.id,created_at:new Date().toISOString(),scope:'Post-run diagnostic only. Original validation and timing records are unchanged. A flag requests review; it is not a semantic quality verdict.',method:METHOD,cases:rows.length,audited_cases:rows.filter(row=>row.status==='audited').length,flagged_cases:rows.filter(row=>row.flagged).length,unavailable_cases:rows.filter(row=>row.status==='unavailable').length,rows};
  writeJSON(path.join(destination,'PROSE-AUDIT.json'),result);
  const lines=['# Prose repetition audit','',result.scope,'',`Audited ${result.audited_cases}/${result.cases} completed screenplay cases. Flagged ${result.flagged_cases}; unavailable ${result.unavailable_cases}.`,'','Compare five-token shingle multisets after NFKC/lowercase/number normalization; repeated shingles retain their frequency. Han characters are individual tokens. A page needs at least 100 tokens. Near duplicates have Dice similarity >= 0.90; internal repetition is flagged at >= 0.65. The first occurrence is excluded from the repeated-page count. This conservative heuristic does not certify plot continuity, factual accuracy or literary merit.','','| Slot | Language | Kit | Structural pass | Later near-duplicate pages | Internally repetitive pages | Maximum page similarity | Audit |','|---|---|---|---|---:|---:|---:|---|',...rows.map(row=>`| ${row.slot} | ${row.language} | ${row.kit} | ${row.as_run_structural_passed} | ${row.near_duplicate_pages?.length??'n/a'} / ${row.pages??'n/a'} | ${row.internally_repetitive_pages?.length??'n/a'} | ${row.maximum_page_similarity?.toFixed(4)??'n/a'} | ${row.status==='unavailable'?'unavailable':row.flagged?'review':'no flag'} |`)];
  fs.writeFileSync(path.join(destination,'PROSE-AUDIT.md'),lines.join('\n')+'\n');return result;
}
