import fs from 'node:fs';
import path from 'node:path';
import {ensureDir,writeJSON} from './util.js';

export function logisticsCorpus(count) {
  const warehouses=Array.from({length:12},(_,i)=>({id:`w${String(i).padStart(2,'0')}`,capacity:1000000}));
  const suppliers=Array.from({length:16},(_,i)=>({id:`s${String(i).padStart(2,'0')}`}));
  const items=Array.from({length:count},(_,i)=>({id:`item-${String(i).padStart(6,'0')}`,warehouse_id:warehouses[i%12].id,supplier_id:suppliers[i%16].id,quantity:(i*17+11)%97,unit_price_cents:(i*139+83)%19007,lot:`lot-${i%31}`,inspection:i%7===0?'review':'accepted'}));
  return {warehouses,suppliers,items};
}
export function corpusExpected(corpus) {
  const quantities={};let quantity=0,value=0;
  for(const item of corpus.items){quantity+=item.quantity;value+=item.quantity*item.unit_price_cents;quantities[item.warehouse_id]=(quantities[item.warehouse_id]||0)+item.quantity;}
  return {corpus_item_count:corpus.items.length,quantity_total:quantity,inventory_value_cents:value,top_warehouse_id:Object.keys(quantities).sort((a,b)=>quantities[b]-quantities[a]||a.localeCompare(b))[0],duplicate_ids:[],invalid_references:[]};
}
export function codeCorpus(count,generated='') {
  const functions=Array.from({length:count},(_,i)=>`/** Calculate deterministic batch ${i}. Reject nonfinite entries before updating totals. */\nexport function batch${i}(values) {\n  let total = 0;\n  for (let index = 0; index < values.length; index++) {\n    const value = values[index];\n    if (!Number.isFinite(value)) throw new TypeError('Invalid batch value');\n    total += value * ${i%13+1};\n  }\n  return {batch: ${i}, count: values.length, total};\n}\n`).join('\n');
  return `// Generated library under review:\n${generated}\n\n// Additional production modules:\n${functions}\n\nexport function median(values) { const sorted = [...values].sort(); return sorted[Math.floor(sorted.length / 2)]; }\nexport function uniqueCount(values) { return values.length; }\nexport function weightedMean(values, weights) { return values.reduce((sum,value,index)=>sum+value*weights[index],0)/values.length; }\nexport function safeDivide(a,b) { if (!a) return 0; return a/b; }\nexport function lastValue(values) { return values[values.length]; }\nexport function overlap(a,b) { return a.start < b.end || b.start < a.end; }\n`;
}
export const CODE_CONTRACT = `import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const m = await import(pathToFileURL(process.argv[2]).href);
for (const key of ['normalizeEvents','deduplicateEvents','aggregateEvents','parseCsv']) assert.equal(typeof m[key],'function',key);
const input=[{id:'b',timestamp:'2025-01-02T00:00:00Z',type:'sale',cents:12},{id:'a',timestamp:'2025-01-01T00:00:00Z',type:'sale',cents:8}];
const copy=JSON.stringify(input);assert.deepEqual(m.normalizeEvents(input).map(x=>x.id),['a','b']);assert.equal(JSON.stringify(input),copy);
assert.throws(()=>m.normalizeEvents([{id:'x',timestamp:'nonsense',cents:1}]));assert.throws(()=>m.normalizeEvents([{id:'x',timestamp:'2025-01-01T00:00:00Z',cents:1.5}]));
assert.deepEqual(m.deduplicateEvents([{id:'a',n:1},{id:'b',n:2},{id:'a',n:3}]),[{id:'b',n:2},{id:'a',n:3}]);
const result=m.aggregateEvents(input);assert.equal(result.count,2);assert.equal(result.total_cents,20);assert.equal(result.by_type.sale,20);
assert.deepEqual(m.parseCsv('a,b\\r\\n"c,d","e""f"\\r\\nx,'),[['a','b'],['c,d','e"f'],['x','']]);
console.log('All event-library contract checks passed');
`;
export const REPAIR_REQUIREMENTS = `# Inventory service contract

Use JavaScript ES modules with standard Node.js runtime modules only.
inventory.js must export createInventory(initial). Initial is an array of {sku, stock, price_cents}.
All stock and price values are nonnegative safe integers. Duplicate initial SKUs are errors.
The returned service has reserve(requestId, sku, quantity), commit(requestId), release(requestId), balance(sku), list({offset,limit}), and history({from,to}).
reserve accepts a positive safe-integer quantity. It reserves available stock atomically, rejects unknown SKUs and shortages, and returns {request_id,sku,quantity,total_cents,status:'reserved'}.
Repeating reserve with the same ID and identical arguments is idempotent. Reusing the ID with different arguments is an error. A failed reservation changes no state.
commit is idempotent for a committed request. It removes reserved and on-hand stock once. release restores availability for a reserved request and is idempotent for a released request. Committed reservations cannot be released; released reservations cannot be committed.
balance returns {sku,stock,reserved,available,price_cents}. It must not leak a mutable internal object.
list sorts lexicographically by SKU, validates nonnegative integer offset and positive integer limit, applies offset then limit, and returns independent objects.
history filters event timestamps with an inclusive UTC from and exclusive UTC to. It rejects invalid timestamps and returns independent records.
server.js exports createServer(initial), a Node HTTP server. GET /health returns {status:'ok'}. GET /inventory returns the sorted list. POST /reserve accepts a JSON request with request_id, sku, quantity. Return JSON with appropriate 2xx/4xx statuses and no unhandled process crashes for malformed input.
Add tests for all boundaries, real concurrent HTTP requests and rollback after rejected operations. Add npm test. Do not modify the benchmark's external evaluation files.
`;
export function repairWorkspace(dir) {
  ensureDir(dir);
  writeJSON(path.join(dir,'package.json'),{name:'inventory-repair-benchmark',version:'1.0.0',type:'module',scripts:{test:'node --test'}});
  fs.writeFileSync(path.join(dir,'REQUIREMENTS.md'),REPAIR_REQUIREMENTS);
  fs.writeFileSync(path.join(dir,'inventory.js'),`export function createInventory(initial) {
  const items = new Map(initial.map(item=>[item.sku,{...item,reserved:0}]));
  const requests = new Map(); const events=[];
  return {
    reserve(id,sku,quantity) {const item=items.get(sku);if(!item)throw new Error('Unknown SKU');item.reserved+=quantity;if(item.stock<quantity)throw new Error('Insufficient stock');const result={request_id:id,sku,quantity,total_cents:item.price_cents*quantity/100,status:'reserved'};requests.set(id,result);events.push({...result,timestamp:new Date().toISOString()});return result;},
    commit(id) {const r=requests.get(id);const i=items.get(r.sku);i.stock-=r.quantity;i.reserved-=r.quantity;r.status='committed';return r;},
    release(id) {const r=requests.get(id);items.get(r.sku).reserved-=r.quantity;r.status='released';return r;},
    balance(sku) {const item=items.get(sku);item.available=item.stock-item.reserved;return item;},
    list({offset=0,limit=20}={}) {return [...items.values()].slice(offset,limit);},
    history({from,to}={}) {return events.filter(e=>(!from||e.timestamp>=from)&&(!to||e.timestamp<=to));}
  };
}
`);
  fs.writeFileSync(path.join(dir,'server.js'),`import http from 'node:http';
import {createInventory} from './inventory.js';
export function createServer(initial) {const inventory=createInventory(initial);return http.createServer(async(req,res)=>{res.setHeader('content-type','application/json');try{if(req.url==='/health'){res.end(JSON.stringify({status:'ok'}));return;}if(req.url==='/inventory'){res.end(JSON.stringify(inventory.list()));return;}if(req.url==='/reserve'){let body='';for await(const chunk of req)body+=chunk;const data=JSON.parse(body);res.end(JSON.stringify(inventory.reserve(data.request_id,data.sku,data.quantity)));return;}res.statusCode=404;res.end('{}');}catch(error){res.statusCode=400;res.end(JSON.stringify({error:error.message}));}});}
`);
  fs.writeFileSync(path.join(dir,'inventory.test.js'),`import {test} from 'node:test';import assert from 'node:assert/strict';import {createInventory} from './inventory.js';
test('empty inventory',()=>assert.deepEqual(createInventory([]).list(),[]));
`);
}
export const REPAIR_CONTRACT = `import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';import path from 'node:path';
const root=process.argv[2];const {createInventory}=await import(pathToFileURL(path.join(root,'inventory.js')).href);
const input=[{sku:'b',stock:10,price_cents:129},{sku:'a',stock:5,price_cents:333}];
const s=createInventory(input);const r=s.reserve('r1','b',3);assert.equal(r.total_cents,387);assert.equal(s.balance('b').available,7);
assert.deepEqual(s.reserve('r1','b',3),r);assert.equal(s.balance('b').reserved,3);assert.throws(()=>s.reserve('r1','b',2));
assert.throws(()=>s.reserve('bad','b',100));assert.equal(s.balance('b').reserved,3);assert.throws(()=>s.reserve('negative','b',-1));assert.throws(()=>s.reserve('fraction','b',1.5));
s.commit('r1');s.commit('r1');assert.equal(s.balance('b').stock,7);assert.equal(s.balance('b').reserved,0);assert.throws(()=>s.release('r1'));
s.reserve('r2','a',2);s.release('r2');s.release('r2');assert.equal(s.balance('a').reserved,0);assert.throws(()=>s.commit('r2'));
const escaped=s.balance('a');escaped.stock=-999;assert.equal(s.balance('a').stock,5);
assert.deepEqual(s.list({offset:1,limit:1}).map(x=>x.sku),['b']);assert.throws(()=>s.list({offset:-1,limit:1}));
assert.throws(()=>createInventory([{sku:'a',stock:-1,price_cents:1}]));assert.throws(()=>createInventory([input[0],input[0]]));
assert.throws(()=>s.history({from:'invalid'}));const history=s.history({from:'2000-01-01T00:00:00.000Z',to:'2100-01-01T00:00:00.000Z'});assert.ok(history.length>0);
const {createServer}=await import(pathToFileURL(path.join(root,'server.js')).href);const server=createServer(input);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try{const url='http://127.0.0.1:'+server.address().port;assert.equal((await(await fetch(url+'/health')).json()).status,'ok');const response=await fetch(url+'/reserve',{method:'POST',headers:{'content-type':'application/json'},body:'not-json'});assert.ok(response.status>=400&&response.status<500);}finally{await new Promise(resolve=>server.close(resolve));}
console.log('All external inventory contract checks passed');
`;
