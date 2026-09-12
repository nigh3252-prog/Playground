import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {generateTerrain} from '../assets/world-lab/world-core.mjs';
import {generateHumanGeography} from '../assets/world-lab/human-geography.mjs';
import {resolveWaterStage,resolveEnvironments,exportBenchmarkWorld} from '../assets/world-lab/world-pipeline.mjs';
import {generateReferenceTerrain,decode16} from '../assets/world-lab/reference-terrain.mjs';
import {fromLonLat,bilinear} from '../assets/world-lab/reference-regions.mjs';
import {topologicalOrder} from '../assets/world-lab/water-balance.mjs';
const near=(a,b,t=.01)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
function check(w){
 topologicalOrder(w.receiver);let total=0,sinks=0;
 for(let i=0;i<w.height.length;i++){
  assert.ok(Number.isFinite(w.waterSurface[i]));assert.ok(w.runoff[i]>=0&&Number.isFinite(w.runoff[i]));if(w.ocean[i]||w.observedLake?.[i])continue;
  total+=w.mesh.nodeArea[i];const r=w.receiver[i];if(r<0||w.ocean[r]||w.observedLake?.[r])sinks+=w.area[i];
  if(r>=0){assert.ok(w.rank[r]<w.rank[i]);assert.ok(w.mesh.neighbors.slice(w.mesh.offsets[i],w.mesh.offsets[i+1]).includes(r));}
  if(w.lake[i]){assert.ok(w.waterSurface[i]>=w.height[i]);assert.ok(w.waterSurface[i]<=w.potentialSpill[i]+.01);assert.ok(w.lakeBodies[w.lakeId[i]]);}
 }
 near(total,sinks,.02);
 for(const b of w.basinWater)if(b)near(b.supplyM3Year-b.evaporationM3Year-b.seepageM3Year,b.outflowM3Year,Math.max(.1,b.supplyM3Year*1e-8));
}
for(const seed of [1,42,431970387])test(`generated seed ${seed}: real routing, conservative areas, preserved terrain`,()=>{
 const t=generateTerrain({seed,n:49}),before=t.height.slice(),w=resolveWaterStage(t);check(w);assert.deepEqual(t.height,before);assert.equal(t.waterSurface,undefined);
 const eco=resolveEnvironments(w);assert.deepEqual(eco.runoff,w.runoff);for(let i=0;i<w.height.length;i++)if(w.lake[i])assert.equal(eco.biome[i],1);
 const human=generateHumanGeography(eco);assert.ok(human.humanPotential.every(Number.isFinite));assert.equal(human.settlements,undefined);
});
test('water budget is deterministic and ignores visual exaggeration',()=>{
 const t=generateTerrain({seed:8,n:49}),a=resolveWaterStage(t),b=resolveWaterStage({...t,visualExaggeration:30});assert.deepEqual(a.receiver,b.receiver);assert.deepEqual(a.waterSurface,b.waterSurface);assert.deepEqual(a.basinWater,b.basinWater);
});
for(const id of ['michigan','cascades'])test(`${id}: genuine packaged data runs through Water, Ecology and Human`,async()=>{
 const pack=JSON.parse(await readFile(new URL(`../assets/world-lab/references/${id}.json`,import.meta.url),'utf8'));
 assert.equal(pack.schema,'watershed-reference-v1');assert.ok(pack.provenance.tiles.length>0);assert.ok(pack.provenance.tiles.every(t=>t.sha256.length===64));assert.ok(pack.rivers.length>0);
 const t=generateReferenceTerrain(pack,{n:129});assert.equal(t.features.length,0);assert.equal(t.erosion,null);assert.ok(t.observedLake.some(Boolean));
 if(id==='michigan'){assert.ok(pack.lakes.some(l=>/michigan/i.test(l.name)));const lake=pack.lakes.find(l=>/michigan/i.test(l.name));near(lake.level,176,.01);for(let i=0;i<t.height.length;i++)if(t.observedLake[i])assert.equal(t.ocean[i],0);}
 else{const h=decode16(pack.height,true,pack.n),[x,z]=fromLonLat(pack.region,-121.76,46.853);assert.ok(bilinear(h,pack.n,x,z,pack.region.sizeKm)>2300,'Rainier exists in actual elevation samples');}
 const water=resolveWaterStage(t);check(water);for(let i=0;i<t.height.length;i++)if(t.observedLake[i]){assert.equal(water.lake[i],1);near(water.waterSurface[i],t.observedLevel[i]);assert.equal(water.receiver[i],-1);}
 const eco=resolveEnvironments(water),human=generateHumanGeography(eco),out=exportBenchmarkWorld(eco,human);assert.equal(out.version,'regional-world-v5');assert.equal(out.reference.region.id,id);assert.equal(human.settlements,undefined);assert.ok(human.humanPotential.every(Number.isFinite));
 console.log(`${id}: ${water.lakeBodies.length} visible/mapped lakes, ${human.strategicNodes.length} opportunities; ${pack.provenance.tiles.length} verified source tiles`);
});
