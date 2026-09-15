import test from 'node:test';
import assert from 'node:assert/strict';
import {simulateHumanHistory} from '../assets/world-lab/human-history.mjs';
import {simulateWorldHistory} from '../assets/world-lab/modern-history.mjs';

function fixture({n=31,spacing=8,water=false,allWater=false}={}) {
 const N=n*n,f=v=>new Float32Array(N).fill(v),offsets=[0],neighbors=[],distances=[];
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){
  for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const xx=x+dx,yy=y+dy;if(xx>=0&&yy>=0&&xx<n&&yy<n){neighbors.push(yy*n+xx);distances.push(spacing);}}
  offsets.push(neighbors.length);
 }
 const w={stage:4,parentDomain:{sizeKm:n*spacing,nominalSpacingKm:spacing},config:{seed:8,sizeKm:n*spacing},height:f(100),ocean:new Uint8Array(N),lake:new Uint8Array(N),slope:f(.002),biome:new Uint8Array(N).fill(6),productivity:f(.75),productiveArea:f(spacing*spacing*.75),travelFriction:f(1),humanPotential:f(.8),transportAccess:f(.5),wetDistanceKm:f(5),navigableRiver:new Uint8Array(N),receiver:new Int32Array(N).fill(-1),mesh:{x:f(0),z:f(0),nodeArea:f(spacing*spacing),offsets:Uint32Array.from(offsets),neighbors:Uint32Array.from(neighbors),distances:Float32Array.from(distances)}};
 for(let i=0;i<N;i++){const x=i%n;w.mesh.x[i]=x*spacing;w.mesh.z[i]=Math.floor(i/n)*spacing;if(allWater||(water&&x===Math.floor(n/2)))w.ocean[i]=1;}
 return w;
}
const sum=a=>a.reduce((n,v)=>n+v,0);

// Relabeling/scaling the last agrarian frame would leak future places, lose
// original dates, or silently pretend the food ledger supports modern growth.
test('modern wrapper appends causally dated eras and keeps agrarian history intact',async()=>{
 const w=fixture(),options={seed:13,generations:4},early=await simulateHumanHistory(w,options),agrarian=await simulateWorldHistory(w,{...options,era:'agrarian'}),modern=await simulateWorldHistory(w,{...options,era:'modern'});
 assert.equal(agrarian.era,'agrarian');assert.equal(agrarian.generations,4);assert.equal(modern.earlyGenerations,4);assert.ok(modern.generations>4);
 assert.equal(modern.snapshots.length,modern.generations+1);assert.equal(modern.snapshots.at(-1).era,'modern');
 for(let g=0;g<=4;g++){
  const frame=modern.snapshots[g];assert.equal(frame.year,early.snapshots[g].year);
  for(const key of ['siteStates','events','accounting','cultivation','soil','woodland','influence','settled'])assert.deepEqual(frame[key],early.snapshots[g][key]);
  assert.deepEqual(frame,agrarian.snapshots[g]);assert.equal(frame.era,'agrarian');
 }
 assert.ok(modern.sites.some(s=>s.founded>4));
 for(const [g,frame] of modern.snapshots.entries()){
  assert.equal(frame.generation,g);assert.equal(frame.year,g*25);assert.ok(frame.eraLabel);
  for(const state of frame.siteStates)assert.ok(modern.sites[state.siteId].founded<=g);
  for(const event of frame.events)for(const id of event.siteIds)assert.ok(modern.sites[id].founded<=g);
 }
 for(const f of modern.snapshots.slice(5)){
  assert.equal(f.accounting.model,'modern-density-transition');assert.equal(f.accounting.foodProduced,undefined);
  assert.equal(f.accounting.populationAfter,f.accounting.populationBefore+f.accounting.modeledPopulationChange);
 }
});

test('modern population has exact urban, rural, nodal and city budgets with a settlement hierarchy',async()=>{
 const h=await simulateWorldHistory(fixture(),{generations:4,seed:11,era:'modern'});
 for(const f of h.snapshots.slice(5)){
  const s=f.summary;assert.equal(s.population,s.urbanPopulation+s.ruralPopulation);assert.equal(s.urbanPopulation,sum(f.siteStates.map(x=>x.population)));
  assert.equal(s.population,sum(f.population));assert.equal(s.ruralPopulation,sum(f.ruralPopulation));
  assert.equal(s.densityPerKm2,s.population/s.landAreaKm2);
  for(const x of f.siteStates){
   assert.ok(Number.isSafeInteger(x.population)&&x.population>=0);assert.ok(Number.isFinite(x.densityPerKm2));
   if(x.population){assert.ok(x.urbanAreaKm2>0);assert.equal(x.densityPerKm2,x.population/x.urbanAreaKm2);assert.ok(x.coreDensityPerKm2>x.suburbanDensityPerKm2);}
  }
 }
 const end=h.snapshots.at(-1);assert.ok(end.summary.densityPerKm2>20&&end.summary.densityPerKm2<100);
 assert.ok(end.summary.ruralPopulation>0&&end.summary.urbanPopulation>end.summary.ruralPopulation);
 assert.ok(end.siteStates.some(s=>s.population>=50000));assert.ok(end.siteStates.some(s=>s.population>0&&s.population<50000));
 assert.ok(h.sites.length<=1000);
});

test('modern population spreads across suitable land without crossing water or changing geography',async()=>{
 const w=fixture({n:41,water:true}),before=structuredClone(w),h=await simulateWorldHistory(w,{seed:19,generations:2,era:'modern'}),end=h.snapshots.at(-1);
 assert.deepEqual(w,before);assert.deepEqual(h,structuredClone(h));
 const quarters=new Set();for(const state of end.siteStates.filter(s=>s.population>0)){const site=h.sites[state.siteId];assert.equal(w.ocean[site.nodeId],0);quarters.add(`${w.mesh.x[site.nodeId]<160},${w.mesh.z[site.nodeId]<160}`);}
 assert.equal(quarters.size,4);assert.ok(end.ruralPopulation.filter(v=>v>0).length>w.height.length*.8);
 for(const f of h.snapshots.slice(3))for(let i=0;i<w.height.length;i++){
  for(const key of ['population','ruralPopulation','populationDensity','cultivation','woodland','soil','settled'])assert.ok(Number.isFinite(f[key][i]));
  if(w.ocean[i])for(const key of ['population','ruralPopulation','populationDensity','cultivation','settled'])assert.equal(f[key][i],0);
 }
 for(const r of h.routes)for(let k=0;k<r.nodes.length;k++){
  const node=r.nodes[k];assert.equal(w.ocean[node],0);
  if(k){const a=r.nodes[k-1];assert.ok(w.mesh.neighbors.slice(w.mesh.offsets[a],w.mesh.offsets[a+1]).includes(node));}
 }
});

test('modern replay ignores display choices, changes with seed, and cancels within later frames',async()=>{
 const w=fixture({n:17}),options={seed:104729,generations:2,era:'modern'},a=await simulateWorldHistory(w,options);
 assert.deepEqual(a,await simulateWorldHistory({...w,window:{index:7},visualExaggeration:12},options));
 assert.notDeepEqual(a.sites,(await simulateWorldHistory(w,{...options,seed:0})).sites);
 let stop=false;const progress=[];
 assert.equal(await simulateWorldHistory(w,options,update=>{progress.push(update);if(update.generation===3)stop=true;},()=>stop),null);
 assert.ok(progress.every(p=>p.generations===a.generations));assert.equal(progress.at(-1).generation,3);
 assert.equal(await simulateWorldHistory(w,options,()=>{},()=>true),null);
 await assert.rejects(simulateWorldHistory(w,{...options,era:'future'}),/era/);
});

test('uninhabitable seas stay empty through the modern endpoint',async()=>{
 const h=await simulateWorldHistory(fixture({n:5,allWater:true}),{generations:1,era:'modern'});
 assert.equal(h.sites.length,0);assert.equal(h.routes.length,0);
 for(const f of h.snapshots){assert.equal(f.summary.population,0);assert.equal(f.summary.densityPerKm2,0);}
});

test('an inherited population on modern-disfavored ground is accounted without new development',async()=>{
 const w=fixture({n:5});w.biome.fill(11);
 const h=await simulateWorldHistory(w,{generations:1,era:'modern'}),early=h.snapshots[1],end=h.snapshots.at(-1);
 assert.ok(early.summary.population>0);
 assert.equal(end.summary.population,end.accounting.targetPopulation);
 assert.equal(end.summary.population,sum(end.population));
 assert.equal(end.summary.population,end.summary.urbanPopulation+end.summary.ruralPopulation);
 assert.equal(h.sites.length,early.siteStates.length);
});

test('later frames use 25-year steps after the actual early endpoint date',async()=>{
 const h=await simulateWorldHistory(fixture({n:5}),{generations:2,yearsPerGeneration:10,era:'modern'});
 assert.equal(h.snapshots[2].year,20);assert.equal(h.snapshots[3].year,45);assert.equal(h.snapshots.at(-1).year,320);
});
