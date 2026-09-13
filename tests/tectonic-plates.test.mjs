import test from 'node:test';
import assert from 'node:assert/strict';
import {planTectonicPlates,plateAt} from '../assets/world-lab/tectonic-plates.mjs';

test('plate plans are deterministic and cover the padded parent domain',()=>{
 const a=planTectonicPlates({seed:431970387,sizeKm:4096});
 const b=planTectonicPlates({seed:431970387,sizeKm:4096});
 assert.deepEqual(a,b);
 assert.ok(a.plates.length>=6&&a.plates.length<=10);
 assert.ok(a.boundaries.length>0);
 assert.ok(a.continents.length>=2&&a.continents.length<=3);
 assert.ok(a.continents.every(block=>a.plates.some(plate=>plate.id===block.plateId)));
 assert.ok(a.continents.every(block=>block.x>=block.rz*.45&&block.x<=a.sizeKm-block.rz*.45&&block.z>=block.rz*.45&&block.z<=a.sizeKm-block.rz*.45));
 for(const [x,z] of [[0,0],[2048,2048],[4096,4096],[-200,100],[4250,3900]]){
  const plate=plateAt(a,x,z);
  assert.ok(a.plates.some(candidate=>candidate.id===plate.id));
 }
});

test('boundary classes follow relative normal motion',()=>{
 const plan=planTectonicPlates({seed:431970387,sizeKm:4096});
 for(const boundary of plan.boundaries){
  if(boundary.normalRate>0.08)assert.match(boundary.kind,/subduction|collision/);
  else if(boundary.normalRate<-.08)assert.equal(boundary.kind,'rift');
  else assert.match(boundary.kind,/transform|inactive/);
 }
});

test('the initial conditions contain a mountain-forming plate boundary',()=>{
 const plan=planTectonicPlates({seed:431970387,sizeKm:4096});
 assert.ok(plan.boundaries.some(({kind})=>kind==='subduction'||kind==='collision'));
});

test('subduction polarity points to the more buoyant overriding plate',()=>{
 const plan=planTectonicPlates({seed:431970387,sizeKm:4096});
 for(const boundary of plan.boundaries.filter(({kind})=>kind==='subduction')){
  const a=plan.plates.find(({id})=>id===boundary.plateA);
  const b=plan.plates.find(({id})=>id===boundary.plateB);
  const overriding=a.buoyancy>=b.buoyancy?a:b;
  assert.equal(boundary.polarity,overriding.id);
 }
});
