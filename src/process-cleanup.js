import fs from 'node:fs';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

function identity(pid) {
  try {
    const source=fs.readFileSync(`/proc/${pid}/stat`,'utf8');
    const fields=source.slice(source.lastIndexOf(')')+2).trim().split(/\s+/);
    return {pid,ppid:Number(fields[1]),start:fields[19],state:fields[0]};
  }catch{return null;}
}
function live(record) {
  const current=identity(record.pid);
  return current?.start===record.start&&current.state!=='Z';
}
function inventory(workspace) {
  const processes=new Map();const selected=new Set();
  for(const name of fs.readdirSync('/proc')) {
    if(!/^\d+$/.test(name))continue;
    const pid=Number(name);if(pid===process.pid)continue;
    try {
      if(fs.statSync(`/proc/${pid}`).uid!==process.getuid())continue;
      const record=identity(pid);if(!record||record.state==='Z')continue;
      processes.set(pid,record);
      const cwd=fs.readlinkSync(`/proc/${pid}/cwd`);
      const relative=path.relative(workspace,cwd);
      if(!relative||(relative!=='..'&&!relative.startsWith(`..${path.sep}`)&&!path.isAbsolute(relative)))selected.add(pid);
    }catch{ /* Processes can exit during a scan. */ }
  }
  // Keep the caller and its ancestors even if invoked from inside a workspace.
  let ancestor=identity(process.ppid);
  while(ancestor){selected.delete(ancestor.pid);ancestor=identity(ancestor.ppid);}
  let added=true;
  while(added){added=false;for(const record of processes.values())if(selected.has(record.ppid)&&!selected.has(record.pid)){selected.add(record.pid);added=true;}}
  return [...selected].map(pid=>processes.get(pid));
}

// A shell can exit after starting a new process group (GNU timeout, a browser,
// or a background server). Parent-PID tree cleanup cannot reach such orphans.
// This Linux-only sweep supplements the portable process-tree cancellation.
// The caller must own a dedicated, isolated benchmark workspace.
export async function cleanupWorkspaceProcesses(workspace) {
  if(process.platform!=='linux')return {supported:false,reason:'Workspace process inventory requires Linux /proc',processes:[]};
  const started=performance.now();const records=inventory(path.resolve(workspace));
  const signal=(record,name)=>{if(live(record))try{process.kill(record.pid,name);}catch{}};
  for(const record of records)signal(record,'SIGTERM');
  if(records.length)await delay(1000);
  for(const record of records)signal(record,'SIGKILL');
  if(records.some(live))await delay(100);
  return {supported:true,duration_ms:performance.now()-started,processes:records.map(record=>({...record,remaining:live(record)}))};
}
