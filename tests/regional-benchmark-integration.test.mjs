import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {generateParentTerrain,chooseWindow} from '../assets/world-lab/parent-world.mjs';
import {blindTerrain,predictFromTerrain,observedClimate} from '../assets/world-lab/benchmark-pipeline.mjs';
import {evaluateWorld,portableReport,terrainMetrics} from '../assets/world-lab/benchmark-evaluate.mjs';
import {clipMesh,interpolateClip} from '../assets/world-lab/window-geometry.mjs';
import {topologicalOrder} from '../assets/world-lab/water-balance.mjs';
import {BENCHMARK_REGIONS,PROTOCOL} from '../assets/world-lab/benchmark-protocol.mjs';
const read=(id,kind)=>JSON.parse(readFileSync(`assets/world-lab/benchmarks/${id}.${kind}.json`,'utf8'));
const near=(a,b,tol=.01)=>assert.ok(Math.abs(a-b)<tol,`${a} != ${b}`);
function flowCheck(w){topologicalOrder(w.receiver);let source=0,sink=0;for(let i=0;i<w.height.length;i++){assert.ok(Number.isFinite(w.height[i]));assert.ok(Number.isFinite(w.waterSurface[i]));assert.ok(Number.isFinite(w.runoff[i])&&w.runoff[i]>=0);if(w.ocean[i])continue;source+=w.mesh.nodeArea[i];const r=w.receiver[i];if(r<0||w.ocean[r])sink+=w.area[i];else assert.ok(w.rank[r]<w.rank[i]);}near(source,sink,.2);}
for(const seed of [1,42,431970387])test(`parent ${seed}: crop is a view of an intact solved world`,()=>{
 const t=generateParentTerrain({seed,parentN:49}),stages=predictFromTerrain(t),w=stages[3];flowCheck(w);assert.equal(w.config.sizeKm,4800);assert.equal(w.parentDomain.windowKm,1200);assert.equal(w.height.length,49*49);
 const before=w.receiver.slice(),areas=w.area.slice(),heights=w.height.slice(),a=chooseWindow(w,0),b=chooseWindow(w,1);assert.deepEqual(a,chooseWindow(w,0));assert.notDeepEqual(a,b);
 for(const box of [a,b]){const c=clipMesh(w.mesh,box),display=interpolateClip(c,w.waterSurface);assert.ok(display.every(Number.isFinite));assert.ok(c.mesh.x.every(x=>x>=-.01&&x<=box.size+.01));}
 assert.deepEqual(w.receiver,before);assert.deepEqual(w.area,areas);assert.deepEqual(w.height,heights);assert.equal(stages[0].receiver,undefined);assert.equal(stages[1].humanPotential,undefined);assert.equal(w.settlements,undefined);
});
test('parent parameters reject impossible crops and unsafe grid sizes',()=>{for(const options of [{parentN:1},{parentN:322},{sizeKm:6000},{parentKm:Infinity},{rain:0}])assert.throws(()=>generateParentTerrain(options));});
test('geography is not locked to two ocean and two mountain edges',()=>{
 const signatures=new Set();for(let seed=1;seed<=8;seed++){const t=generateParentTerrain({seed,parentN:33});for(let k=0;k<4;k++){const b=chooseWindow(t,k),c=clipMesh(t.mesh,b),v=interpolateClip(c,t.height);const edges=[[],[],[],[]];for(let i=0;i<c.mesh.x.length;i++){const x=c.mesh.x[i],z=c.mesh.z[i];if(x<.01)edges[0].push(v[i]);if(z<.01)edges[1].push(v[i]);if(x>b.size-.01)edges[2].push(v[i]);if(z>b.size-.01)edges[3].push(v[i]);}signatures.add(edges.map(e=>e.filter(v=>v<=0).length/(e.length||1)>.5?'sea':e.filter(v=>v>1400).length/(e.length||1)>.5?'range':'land').join(','));}}
 assert.ok(signatures.size>=3,JSON.stringify([...signatures]));
});
test('blind adapter strips all water and location annotations before prediction',()=>{
 const pack=read('michigan','input'),dirty={...pack,region:{...pack.region,landmarks:[['Fake',44,-85,'city']]},lakes:[{id:1,level:9999}],population:[1e9],rivers:[{}],water:'invalid'},a=blindTerrain(pack,{n:33}),b=blindTerrain(dirty,{n:33});
 assert.deepEqual(a.height,b.height);assert.deepEqual(a.landHistory,b.landHistory);assert.ok(a.observedLake.every(v=>v===0));assert.equal(a.referenceMode,'blind');assert.equal(a.landmarks.length,0);assert.equal(a.referenceLakes.length,0);assert.equal(a.referenceRivers.length,0);
 assert.throws(()=>blindTerrain({...pack,provenance:{...pack.provenance,waterMasksUsed:true}}));
});
test('same predictions receive different scores when only withheld observations change',()=>{
 const pack=read('michigan','input'),terrain=blindTerrain(pack,{n:33}),w=predictFromTerrain(terrain,{forcing:pack.forcing})[3],obs=read('michigan','observations'),before=w.receiver.slice(),scores=w.humanPotential.slice(),base=evaluateWorld(w,obs);
 const changed={...obs,water:Buffer.alloc(obs.n*obs.n).toString('base64')},different=evaluateWorld(w,changed);assert.notDeepEqual(base.allSizeWaterDiagnostic,different.allSizeWaterDiagnostic);assert.deepEqual(w.receiver,before);assert.deepEqual(w.humanPotential,scores);
 assert.equal(evaluateWorld({...w,referenceMode:'constrained'},obs).status,'not-independent');assert.equal(evaluateWorld(w,{...obs,status:'missing'}).status,'unavailable');
});
test('NOAA observed climate is explicit and missing forcing cannot silently become generated climate',()=>{
 const pack=read('cascades','input'),w=blindTerrain(pack,{n:33}),a=observedClimate(w,pack.forcing);assert.ok(a.rainfall.every(v=>v>0&&Number.isFinite(v)));assert.ok(a.temperature.every(Number.isFinite));assert.ok(a.climateForcing.stationCount>=4);assert.throws(()=>observedClimate(w,null));
});
for(const id of Object.keys(BENCHMARK_REGIONS))test(`${id}: independent real-source benchmark completes all stages`,()=>{
 const pack=read(id,'input'),obs=read(id,'observations');assert.ok(pack.provenance.rawDEM);assert.equal(pack.provenance.waterMasksUsed,false);assert.ok(pack.provenance.tiles.every(p=>p.sha256.length===64));assert.equal(obs.status,'complete');assert.ok(obs.sourceDigest.length===64);assert.equal(obs.n,PROTOCOL.evaluationN);assert.ok(obs.population.length>0);assert.ok(obs.rivers.length>0);assert.ok(obs.lakeSizes.length>0);assert.ok(pack.forcing.stations.length>=4);
 const terrain=blindTerrain(pack,{n:129}),stages=predictFromTerrain(terrain,{forcing:pack.forcing}),world=stages[3];flowCheck(world);const r=evaluateWorld(world,obs);assert.equal(r.status,'scored');assert.equal(r.region,id);assert.equal(r.role,BENCHMARK_REGIONS[id].role);assert.ok(r.water.evaluatedKm2>0);assert.ok(r.terrain.sampledPeakM>0);assert.ok(world.humanPotential.every(Number.isFinite));assert.equal(world.settlements,undefined);
 for(const v of [r.water.precision,r.water.recall,r.water.iou,r.population.coverage])assert.ok(v===null||Number.isFinite(v)&&v>=0&&v<=1);assert.equal(portableReport(r).overlay,undefined);
 console.log(`${id}: ${obs.population.length} Census tracts; ${obs.historical.length} historical sample places; ${pack.forcing.stations.length} NOAA stations; water P=${r.water.precision} R=${r.water.recall}`);
});
test('true visual relief does not enter benchmark predictions or terrain metrics',()=>{
 const t=generateParentTerrain({seed:3,parentN:33}),s=terrainMetrics(t),a=terrainMetrics({...t,visualExaggeration:18});assert.deepEqual(s,a);const r=chooseWindow(t);assert.deepEqual(r,chooseWindow({...t,visualExaggeration:1}));
});
