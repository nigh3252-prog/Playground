import test from 'node:test';
import assert from 'node:assert/strict';
import {planRegionalLandforms,applyRegionalLandforms} from '../assets/world-lab/regional-landforms.mjs';
import {planGeology,applyGeology} from '../assets/world-lab/geology-provinces.mjs';
import {generateParentTerrain} from '../assets/world-lab/parent-world.mjs';

const coast={seed:23,sizeKm:2400,baseAt:(x,z)=>({height:(x-1200)*.7,landBlend:x>1200?1:0})};

test('regional relief makes both drowned valleys and emergent bedrock on a simple shelf',()=>{
 const plan=planRegionalLandforms(coast);
 let drowned=0,emerged=0;
 for(let z=200;z<=2200;z+=20)for(let x=700;x<=1700;x+=20){
  const base=coast.baseAt(x,z).height,height=applyRegionalLandforms(plan,x,z,base);
  assert.ok(Number.isFinite(height));
  if(base>30&&height<0)drowned++;
  if(base< -30&&height>0)emerged++;
 }
 assert.ok(drowned>0,'landward branches never become water');
 assert.ok(emerged>0,'the seaward bedrock cannot form islands or headlands');
});

test('regional landforms replay without moving with the viewing window',()=>{
 const a=planRegionalLandforms(coast),b=planRegionalLandforms({...coast,window:{x:400,z:600,size:800}});
 assert.deepEqual(a,b);
 assert.notDeepEqual(a,planRegionalLandforms({...coast,seed:24}));
 assert.equal(applyRegionalLandforms(a,1200,1200,-4000),-4000,'deep ocean is outside the coastal process');
 assert.equal(applyRegionalLandforms(a,1200,1200,4000),4000,'high mountains are outside the coastal process');
});

test('an inland parent has no invented coastal province',()=>{
 const plan=planRegionalLandforms({...coast,baseAt:()=>({height:500,landBlend:1})});
 assert.equal(applyRegionalLandforms(plan,1200,1200,500),500);
});

test('parent generation retains its landform provenance and physical terrain across crop sizes',()=>{
 const a=generateParentTerrain({seed:23,parentN:65,parentKm:4800,sizeKm:1200});
 assert.ok(a.geology.regionalLandforms?.provinces.length>0,'the parent did not run the regional landform stage');
 const b=generateParentTerrain({seed:23,parentN:65,parentKm:4800,sizeKm:800});
 assert.deepEqual(a.height,b.height);
 assert.deepEqual(a.ocean,b.ocean);
 assert.deepEqual(a.geology.regionalLandforms,b.geology.regionalLandforms);
});

test('rift basins follow the curved source and retain intervening higher ground',()=>{
 const points=[{x:600,z:100},{x:1000,z:600},{x:600,z:1100},{x:1000,z:1600},{x:600,z:2100}];
 const geology=planGeology({seed:17,sizeKm:2400,northAxis:.2,eastAxis:.8,baseAt:()=>({height:350,landBlend:1}),tectonics:{boundaries:[{id:7,kind:'rift',points}]}});
 const rift=geology.features.find(f=>f.type===2);
 assert.ok(rift.points?.some(p=>p.x>900),'a curved fault has been replaced by a straight centerline');
 const heights=[];
 for(let k=0;k<points.length-1;k++)for(let j=0;j<30;j++){
  const t=j/30,x=points[k].x+(points[k+1].x-points[k].x)*t,z=points[k].z+(points[k+1].z-points[k].z)*t;
  heights.push(applyGeology({features:[rift]},x,z,350).height);
 }
 // Ignore the tapered ends: the interior must contain depressions and
 // higher inter-basin ground, rather than one constant-depth trench.
 const interior=heights.slice(20,-20);
 assert.ok(Math.min(...interior)<0,'no basin was deepened below the surrounding plain');
 assert.ok(Math.max(...interior)>150,'the entire rift was carved into one continuous trench');
});

test('repeated province draws do not carve the same tectonic rift multiple times',()=>{
 const boundary={id:7,kind:'rift',points:[{x:1200,z:0},{x:1100,z:1200},{x:1300,z:2400}]};
 const geology=planGeology({seed:0,sizeKm:2400,northAxis:.2,eastAxis:.8,baseAt:()=>({height:350,landBlend:1}),tectonics:{boundaries:[boundary]}});
 assert.equal(geology.features.filter(f=>f.sourceBoundaryId===7).length,1);
});
