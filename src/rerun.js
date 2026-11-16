import {KITS} from './catalog.js';

export function rerunSelection(selection,plannedKits,resume) {
  if(selection===undefined)return [];
  if(!resume)throw new Error('--rerun-kits requires --resume');
  if(typeof selection!=='string'||!selection.trim())throw new Error('--rerun-kits needs a nonempty kit list');
  const names=selection==='all'?plannedKits.map(kit=>kit.id):selection.split(',').map(name=>name.trim());
  const ids=names.map(name=>{
    const kit=KITS.find(item=>item.id===name||item.id.slice(0,2)===name.padStart(2,'0'));
    if(!kit)throw new Error(`Unknown rerun kit '${name}'`);
    if(!plannedKits.some(item=>item.id===kit.id))throw new Error(`Rerun kit '${name}' is outside the original workload`);
    return kit.id;
  });
  const affected=new Set(ids);let changed=true;
  while(changed){changed=false;for(const kit of plannedKits)if(!affected.has(kit.id)&&kit.dependencies.some(id=>affected.has(id))){affected.add(kit.id);changed=true;}}
  return plannedKits.filter(kit=>affected.has(kit.id)).map(kit=>kit.id);
}

export function checkRerunConflict(state,requested) {
  const active=state.targeted_rerun;
  if(active?.pending.length&&requested.length&&JSON.stringify([...active.kits].sort())!==JSON.stringify([...requested].sort()))throw new Error('An unfinished targeted rerun exists; resume it before choosing different rerun kits');
}

export function prepareRerun(state,requested,keys,sourceRevision) {
  if(requested.length&&!state.targeted_rerun?.pending.length) {
    if(state.targeted_rerun){state.targeted_rerun_history=state.targeted_rerun_history||[];state.targeted_rerun_history.push(state.targeted_rerun);}
    state.targeted_rerun={id:`${Date.now()}-${sourceRevision?.slice(0,8)||'installed'}`,kits:requested,started_at:new Date().toISOString(),source_revision:sourceRevision,total:keys.length,pending:[...keys],completed:[],attempts:[]};
  }
  return new Set(state.targeted_rerun?.pending||[]);
}

export function recordRerun(state,pending,key,previous,result) {
  const rerun=state.targeted_rerun;
  rerun.attempts.push({key,previous_attempt:previous?.attempt??null,previous_artifact_dir:previous?.artifact_dir??null,attempt:result.attempt,artifact_dir:result.artifact_dir,status:result.status,source_revision:result.source_revision});
  if(result.status==='completed') {
    pending.delete(key);rerun.pending=[...pending];rerun.completed.push(key);
    if(!pending.size)rerun.finished_at=new Date().toISOString();
  }
}
