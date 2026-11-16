import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const {chooseShot}=await import(pathToFileURL(process.argv[2]).href);
assert.equal(typeof chooseShot,'function','engine.js must export chooseShot');
function random(seed){let state=seed>>>0;return ()=>{state=(1664525*state+1013904223)>>>0;return state/4294967296;};}
const lengths=[5,4,3,3,2];const counts=[];
for(let game=0;game<30;game++){
  const rng=random(game+93);const ships=[];const occupied=new Set();
  for(const length of lengths){for(;;){const horizontal=rng()<0.5;const row=Math.floor(rng()*(horizontal?10:11-length));const col=Math.floor(rng()*(horizontal?11-length:10));const cells=Array.from({length},(_,i)=>(row+(horizontal?0:i))*10+col+(horizontal?i:0));if(cells.every(x=>!occupied.has(x))){cells.forEach(x=>occupied.add(x));ships.push({length,cells,hits:new Set()});break;}}}
  const shots=[];const used=new Set();let remaining=[...lengths];Math.random=random(game+7919);
  while(remaining.length&&shots.length<100){
    const knowledge={size:10,shots:structuredClone(shots),remainingShips:[...remaining],seed:game+17};
    const copy=JSON.stringify(knowledge);const shot=chooseShot(knowledge);assert.equal(JSON.stringify(knowledge),copy,'chooseShot mutated knowledge');
    assert.ok(shot&&Number.isInteger(shot.row)&&Number.isInteger(shot.col),'Expected {row,col}');assert.ok(shot.row>=0&&shot.row<10&&shot.col>=0&&shot.col<10,'Shot outside board');
    const square=shot.row*10+shot.col;assert.ok(!used.has(square),'Repeated shot');used.add(square);
    let result='miss';for(const ship of ships)if(ship.cells.includes(square)){ship.hits.add(square);result=ship.hits.size===ship.length?'sunk':'hit';if(result==='sunk')remaining.splice(remaining.indexOf(ship.length),1);break;}
    shots.push({...shot,result});
  }
  assert.equal(remaining.length,0);counts.push(shots.length);
}
counts.sort((a,b)=>a-b);const median=(counts[14]+counts[15])/2;assert.ok(median<=72,`Hunt/target play too weak: median ${median} shots`);
console.log(JSON.stringify({passed:true,complete_games:30,median_shots:median,min_shots:counts[0],max_shots:counts.at(-1),hidden_boards:'resolved externally; never passed to chooseShot'}));
