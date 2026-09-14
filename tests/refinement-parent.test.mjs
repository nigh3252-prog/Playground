import test from 'node:test';
import assert from 'node:assert/strict';
import {generateParentTerrain} from '../assets/world-lab/parent-world.mjs';
import {predictFromTerrain} from '../assets/world-lab/benchmark-pipeline.mjs';
import {createRefinementContext,createRefinedWindow,sampleRefinement} from '../assets/world-lab/terrain-refinement.mjs';
import {windowAround} from '../assets/world-lab/inherited-window.mjs';
for(const seed of [431970387,92817])test(`actual parent ${seed}: fine terrain, overlapping coordinates, river anchors and immutable drainage`,()=>{
 const w=predictFromTerrain(generateParentTerrain({seed,parentN:65,sizeKm:1200}))[3],ctx=createRefinementContext(w);
 const r=ctx.reaches.find(r=>w.height[r.from]>100&&w.height[r.to]>50&&!w.lake[r.from]&&!w.lake[r.to]);assert.ok(r);
 const x=(r.points[0][0]+r.points[1][0])/2,z=(r.points[0][1]+r.points[1][1])/2,before={height:w.height.slice(),receiver:w.receiver.slice(),area:w.area.slice(),lake:w.lake.slice(),ocean:w.ocean.slice()};
 for(const size of [12,1.2,.41]){
  const d=createRefinedWindow(w,windowAround(w.config.sizeKm,x,z,size),{n:65});
  assert.ok(d.refinement.maxAbsDeltaM>1);assert.ok(d.waterDepthM.some(h=>h>.2));
  assert.ok(d.rivers.some(e=>e.from===r.from&&e.to===r.to&&e.upstreamAreaKm2===w.area[r.from]));
  for(let i=0;i<d.heightM.length;i+=13){const px=d.window.x+d.mesh.x[i],pz=d.window.z+d.mesh.z[i];assert.ok(Math.abs(sampleRefinement(ctx,px,pz).heightM-d.heightM[i])<.002);assert.ok(Math.abs(d.baseHeightM[i]-d.sourceWeights[i].reduce((sum,[id,t])=>sum+w.height[id]*t,0))<.002);}
 }
 for(const k of Object.keys(before))assert.deepEqual(w[k],before[k]);
});
