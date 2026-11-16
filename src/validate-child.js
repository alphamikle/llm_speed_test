import fs from 'node:fs';
import path from 'node:path';
const [kind,file,minimum='0']=process.argv.slice(2);
if(kind==='sql') {
  const {DatabaseSync,constants}=await import('node:sqlite');
  const sql=fs.readFileSync(file,'utf8');
  const db=new DatabaseSync(':memory:',{enableForeignKeyConstraints:true,allowExtension:false});
  db.exec('PRAGMA foreign_keys=ON');
  db.setAuthorizer((action,arg1,arg2)=>{
    if([constants.SQLITE_ATTACH,constants.SQLITE_DETACH,constants.SQLITE_PRAGMA].includes(action))return constants.SQLITE_DENY;
    if(action===constants.SQLITE_FUNCTION&&String(arg2||arg1).toLowerCase()==='load_extension')return constants.SQLITE_DENY;
    return constants.SQLITE_OK;
  });
  db.exec(sql);db.setAuthorizer(null);
  if(db.prepare('PRAGMA foreign_keys').get().foreign_keys!==1)throw new Error('Foreign keys were disabled');
  const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
  for(const table of ['cities','streets','users','organizations','memberships']) if(!tables.some(row=>row.name===table)) throw new Error(`Missing table: ${table}`);
  const rows=Object.fromEntries(tables.map(row=>[row.name,db.prepare('SELECT COUNT(*) AS n FROM "'+row.name.replaceAll('"','""')+'"').get().n]));
  const total=Object.values(rows).reduce((a,b)=>a+b,0);if(total<Number(minimum))throw new Error(`Only ${total} rows; expected at least ${minimum}`);
  const foreign=db.prepare('PRAGMA foreign_key_check').all();if(foreign.length)throw new Error('Foreign key violations');
  if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('SQLite integrity check failed');
  for(const table of ['streets','users','organizations','memberships']) if(!db.prepare(`PRAGMA foreign_key_list(${table})`).all().length)throw new Error(`Missing foreign key constraints in ${table}`);
  if(Number(minimum)>=5000 && (rows.cities<20||rows.streets<40||rows.organizations<20||rows.users<100))throw new Error('Population diversity minima were not met');
  console.log(JSON.stringify({passed:true,total_rows:total,rows}));db.close();
} else throw new Error(`Unknown child validator: ${kind}`);
