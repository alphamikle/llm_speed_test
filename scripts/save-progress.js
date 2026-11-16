import fs from 'node:fs';
import path from 'node:path';
import {createReport} from '../src/report.js';
import {createProseAudit} from '../src/prose-audit.js';
import {ensureDir,readJSON,writeJSON} from '../src/util.js';
const [source,destination]=process.argv.slice(2);
if(!source||!destination)throw new Error('Usage: node scripts/save-progress.js RUN_DIRECTORY DESTINATION');
const target=path.resolve(destination);ensureDir(target);
const state=readJSON(path.resolve(source,'run.json'));
writeJSON(path.join(target,'run.json'),state);
try{
  createProseAudit(target);
  const report=createReport(target);
  writeJSON(path.join(target,'STATUS.json'),{status:report.status,profile:report.profile,completed_cases:report.completed_cases,planned_cases:report.planned_cases,quality_passes:report.quality_passes,harness_errors:report.harness_errors,rerun_total:report.targeted_rerun?.total,rerun_completed:report.targeted_rerun?.completed.length,rerun_pending:report.targeted_rerun?.pending.length,source_revision:report.environment.source_revision,local_raw_artifacts:path.resolve(source),snapshot_utc:new Date().toISOString()});
  console.log(JSON.stringify({status:report.status,completed:report.completed_cases,planned:report.planned_cases,destination:target}));
}finally{fs.rmSync(path.join(target,'run.json'),{force:true});}
