import test from 'node:test';
import assert from 'node:assert/strict';
import {simulateHumanHistory} from '../assets/world-lab/human-history.mjs';

// Actual CSR geography: every move has to follow these edges. No mocked routes.
function fixture({n=25,spacing=8,water=false,poor=false,allWater=false}={}) {
 const N=n*n, f=(v)=>new Float32Array(N).fill(v), offsets=[0],neighbors=[],distances=[];
 for(let y=0;y<n;y++)for(let x=0;x<n;x++) { for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {const xx=x+dx,yy=y+dy;if(xx>=0&&yy>=0&&xx<n&&yy<n){neighbors.push(yy*n+xx);distances.push(spacing);}} offsets.push(neighbors.length); }
 const world={stage:4,parentDomain:{sizeKm:n*spacing},config:{seed:0,sizeKm:n*spacing},height:f(100),ocean:new Uint8Array(N),lake:new Uint8Array(N),slope:f(.002),biome:new Uint8Array(N).fill(5),productivity:f(.75),productiveArea:f(spacing*spacing*.75),travelFriction:f(1),humanPotential:f(.8),transportAccess:f(.5),wetDistanceKm:f(5),navigableRiver:new Uint8Array(N),receiver:new Int32Array(N).fill(-1),mesh:{x:f(0),z:f(0),nodeArea:f(spacing*spacing),offsets:Uint32Array.from(offsets),neighbors:Uint32Array.from(neighbors),distances:Float32Array.from(distances)}};
 for(let i=0;i<N;i++){const x=i%n;world.mesh.x[i]=x*spacing;world.mesh.z[i]=Math.floor(i/n)*spacing;if(allWater||(water&&x===Math.floor(n/2)))world.ocean[i]=1;if(poor){world.productivity[i]=x<n*.55?.10:.85;world.productiveArea[i]=world.productivity[i]*spacing*spacing;}}
 return world;
}

test('replay is deterministic, display-independent, immutable, and structured-clone-safe',async()=>{
 const w=fixture(),before=structuredClone(w),a=await simulateHumanHistory(w,{seed:0,generations:3});
 assert.deepEqual(w,before);assert.deepEqual(structuredClone(a),a);
 assert.deepEqual(a,await simulateHumanHistory({...w,window:{index:99},relief:4},{seed:0,generations:3}));
 assert.notDeepEqual(a.sites,(await simulateHumanHistory(w,{seed:7,generations:3})).sites);
 assert.deepEqual(a.snapshots,(await simulateHumanHistory(w,{seed:0,generations:5})).snapshots.slice(0,4));
 assert.equal(a.snapshots.length,4);assert.equal(a.snapshots[0].year,0);
 for(const key of ['cultivation','woodland','soil','influence','settled']){assert.notEqual(a.snapshots[0][key].buffer,a.snapshots[1][key].buffer);const old=a.snapshots[0][key][0];a.snapshots[1][key][0]=.5;assert.equal(a.snapshots[0][key][0],old);}
});
test('finite land and food with exact births/deaths and conserved migration',async()=>{
 const w=fixture(),h=await simulateHumanHistory(w,{seed:104729,generations:12});let moved=0;
 for(const [g,s] of h.snapshots.entries()){
  const a=s.accounting;assert.equal(s.summary.population,s.siteStates.reduce((v,x)=>v+x.population,0));
  if(g){assert.equal(a.populationBefore,h.snapshots[g-1].summary.population);assert.equal(a.populationAfter,a.populationBefore+a.births-a.deaths);assert.equal(a.populationAfter,s.summary.population);}
  assert.equal(a.migrated,s.events.filter(e=>e.type==='migration').reduce((v,e)=>v+e.amount,0));
  for(const e of s.events.filter(e=>e.type==='cooperation'))assert.ok(e.amount>0,'sharing events represent an actual food transfer');
  moved+=a.migrated;assert.ok(a.foodConsumed+a.transportLoss<=a.foodProduced+1e-6);
  const area=s.cultivation.reduce((v,x,i)=>v+x*w.mesh.nodeArea[i],0);assert.ok(Math.abs(area-s.summary.cultivatedKm2)<.02);assert.ok(Math.abs(area-s.siteStates.reduce((v,x)=>v+x.farmAreaKm2,0))<.02);
  for(const key of ['cultivation','woodland','soil','settled'])for(const v of s[key])assert.ok(Number.isFinite(v)&&v>=0&&v<=1);
  for(const x of s.siteStates){assert.ok(h.sites[x.siteId].founded<=g);assert.ok(x.population>=0&&Number.isInteger(x.population));}
 }
 assert.ok(moved>0);assert.ok(h.routes.length>0);assert.ok(h.sites.length<=240);
});
test('settlements and every route respect land adjacency and an impassable water strip',async()=>{
 const w=fixture({water:true}),h=await simulateHumanHistory(w,{seed:19,generations:10});
 for(const s of h.sites)assert.equal(w.ocean[s.nodeId],0);
 for(const r of h.routes){assert.equal(r.nodes[0],h.sites[r.a].nodeId);assert.equal(r.nodes.at(-1),h.sites[r.b].nodeId);for(let k=0;k<r.nodes.length;k++){assert.equal(w.ocean[r.nodes[k]],0);if(k)assert.ok(Array.from(w.mesh.neighbors.slice(w.mesh.offsets[r.nodes[k-1]],w.mesh.offsets[r.nodes[k-1]+1])).includes(r.nodes[k]));}}
 for(const s of h.snapshots)for(const e of s.events)if(e.type==='migration'){const [a,b]=e.siteIds.map(id=>w.mesh.x[h.sites[id].nodeId]);assert.equal(a<96,b<96);}
});
test('marginal land can lose habitation and then recover vegetation; site identity survives reuse',async()=>{
 const h=await simulateHumanHistory(fixture({poor:true,n:19,spacing:3}),{seed:13,generations:20});
 const abandoned=h.snapshots.flatMap(s=>s.events).filter(e=>e.type==='abandonment');assert.ok(abandoned.length>0,'controlled marginal land produces abandonment');
 assert.ok(abandoned.some(e=>{const node=h.sites[e.siteIds[0]].nodeId;return h.snapshots.slice(e.generation+1).some(s=>s.woodland[node]>h.snapshots[s.generation-1].woodland[node]||s.soil[node]>h.snapshots[s.generation-1].soil[node]);}),'fallow land recovers between historical frames');
 const reused=h.snapshots.flatMap(s=>s.events).filter(e=>e.type==='reoccupation');assert.ok(reused.length>0);
 for(const e of reused){assert.ok(h.sites[e.siteIds[0]].founded<e.generation);assert.equal(h.snapshots[e.generation-1].siteStates[e.siteIds[0]].status,'abandoned');}
});
test('empty seas, dry unproductive worlds, validation and cooperative cancellation',async()=>{
 const w=fixture({allWater:true});assert.equal((await simulateHumanHistory(w,{seed:0,generations:1})).sites.length,0);
 const dry=fixture();dry.productivity.fill(0);dry.productiveArea.fill(0);assert.equal((await simulateHumanHistory(dry,{generations:1})).sites.length,0);
 for(const options of [{seed:-1},{seed:1.5},{generations:0},{generations:21},{yearsPerGeneration:0}])await assert.rejects(simulateHumanHistory(fixture(),options),/seed|generations|yearsPerGeneration/);
 await assert.rejects(simulateHumanHistory({stage:3}),/Stage 4/);
 await assert.rejects(simulateHumanHistory({...fixture(),parentDomain:null}),/parent/);
 assert.equal(await simulateHumanHistory(fixture(),{},()=>{},()=>true),null);
 let stop=false;assert.equal(await simulateHumanHistory(fixture(),{},({generation})=>{if(generation===1)stop=true;},()=>stop),null);
});

test('new colonies establish an affordable route to their origin immediately',async()=>{
 const h=await simulateHumanHistory(fixture(),{seed:104729,generations:5});
 for(const site of h.sites.filter(s=>s.founded>0)){const frame=h.snapshots[site.founded],migration=frame.events.find(e=>e.type==='migration'&&e.siteIds[1]===site.id);assert.ok(migration);assert.ok(h.routes.some(r=>r.founded===site.founded&&[r.a,r.b].includes(site.id)&&[r.a,r.b].includes(migration.siteIds[0])));}
});

test('contact under food pressure can suspend a route with a visible next-generation cost',async()=>{
 const h=await simulateHumanHistory(fixture({n:65,spacing:.5,poor:true}),{seed:0,generations:20});
 const conflicts=h.snapshots.flatMap(s=>s.events).filter(e=>e.type==='conflict');assert.ok(conflicts.length>0);
 for(const e of conflicts){const rs=h.snapshots[e.generation].routeStates[e.routeId];assert.equal(rs.active,false);assert.equal(rs.traffic,0);if(e.generation<20)assert.equal(h.snapshots[e.generation+1].routeStates[e.routeId].active,false);}
});

test('woodland potential follows actual world-core biome IDs including mountain forest and ice',async()=>{
 const w=fixture();for(let i=0;i<12;i++)w.biome[i]=i;
 const h=await simulateHumanHistory(w,{generations:1}),wood=h.snapshots[0].woodland;
 assert.ok(wood[3]>wood[5]&&wood[5]>wood[6]&&wood[6]>wood[8]);assert.ok(wood[9]>.6);assert.equal(wood[10],0);assert.equal(wood[11],0);
});
