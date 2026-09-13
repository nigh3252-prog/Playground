import test from 'node:test';import assert from 'node:assert/strict';
import {generateTerrain} from '../assets/world-lab/world-core.mjs';
import {generateHumanGeography} from '../assets/world-lab/human-geography.mjs';
import {resolveWaterStage,resolveEnvironments} from '../assets/world-lab/world-pipeline.mjs';
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
