import test from 'node:test';
import assert from 'node:assert/strict';
import {generateParentTerrain} from '../assets/world-lab/parent-world.mjs';
import {predictFromTerrain} from '../assets/world-lab/benchmark-pipeline.mjs';
import {createInheritedWindow,windowAround} from '../assets/world-lab/inherited-window.mjs';

for(const seed of [431970387,92817])test(`real tectonic parent ${seed} retains its river and terrain through nested local windows`,()=>{
 const stages=predictFromTerrain(generateParentTerrain({seed,parentN:33,sizeKm:1200})),w=stages[3];
 const from=w.river.findIndex((v,i)=>v&&w.receiver[i]>=0&&!(w.lake[i]&&w.lake[w.receiver[i]]));
 assert.ok(from>=0,'The generated parent must contain an actual river');
 const to=w.receiver[from],x=(w.mesh.x[from]+w.mesh.x[to])/2,z=(w.mesh.z[from]+w.mesh.z[to])/2;
 const before={height:w.height.slice(),receiver:w.receiver.slice(),area:w.area.slice(),lake:w.lake.slice(),ocean:w.ocean.slice()};
 for(const size of [120,12,1.2,.41]){
  const local=createInheritedWindow(w,windowAround(w.config.sizeKm,x,z,size));
  assert.ok(local.rivers.some(e=>e.from===from&&e.to===to&&e.upstreamAreaKm2===w.area[from]));
  assert.ok(local.mesh.triangles.length>=3);
  for(let i=0;i<local.heightM.length;i++)assert.ok(Math.abs(local.heightM[i]-local.sourceWeights[i].reduce((h,[id,v])=>h+w.height[id]*v,0))<.01);
 }
 for(const key of Object.keys(before))assert.deepEqual(w[key],before[key]);
 assert.equal(createInheritedWindow(stages[0],windowAround(w.config.sizeKm,x,z,1.2)).rivers.length,0);
});
