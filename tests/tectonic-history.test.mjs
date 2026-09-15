import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTectonicHistory} from '../assets/world-lab/tectonic-history.mjs';

const mesh={width:81,height:41,sizeKm:800};
const plate=(id,centerX,crust,buoyancy)=>({id,centerX,centerZ:400,crust,ageMyr:crust==='oceanic'?80:700,buoyancy,velocityX:0,velocityZ:0});
function plan(kind,{polarity=null}={}){
 return{seed:17,sizeKm:800,paddingKm:0,warpSeed:29,
  plates:[plate(0,180,kind==='subduction'?'oceanic':'continental',.2),plate(1,620,'continental',.7)],
  boundaries:[{id:0,plateA:0,plateB:1,kind,polarity,normalRate:kind==='rift'?-.3:.3,shearRate:kind==='transform'?.2:0,lengthKm:800,points:[{x:400,z:0},{x:400,z:800}]}]};
}
const at=(field,xFraction,zFraction=.5)=>field[Math.round(zFraction*(mesh.height-1))*mesh.width+Math.round(xFraction*(mesh.width-1))];
const max=field=>field.reduce((best,value)=>Math.max(best,value),-Infinity);

test('ocean-continent convergence raises an overriding mountain belt and volcanic arc',()=>{
 const history=buildTectonicHistory(plan('subduction',{polarity:1}),mesh);
 assert.ok(at(history.subsidence,.45)>.2);
 assert.ok(at(history.uplift,.59)>.35);
 assert.ok(at(history.volcanism,.67)>.2);
});

test('continental collision is broad without a dominant volcanic arc',()=>{
 const history=buildTectonicHistory(plan('collision'),mesh);
 assert.ok(max(history.uplift)>.4);
 assert.ok(max(history.volcanism)<.12);
});

test('collision strength and belt width vary along strike',()=>{
 const history=buildTectonicHistory(plan('collision'),mesh),north=at(history.uplift,.62,.24),south=at(history.uplift,.62,.76);
 assert.ok(Math.abs(north-south)>.03,`${north} and ${south} formed a uniform ribbon`);
});

test('rifting creates a subsiding axis and uplifted shoulders',()=>{
 const history=buildTectonicHistory(plan('rift'),mesh);
 assert.ok(at(history.subsidence,.5)>.25);
 assert.ok(at(history.uplift,.61)>.1);
});

test('a finite rift stops deforming terrain far beyond its endpoints',()=>{
 const tectonics=plan('rift');
 tectonics.boundaries[0].points=[{x:400,z:300},{x:400,z:500}];
 tectonics.boundaries[0].lengthKm=200;
 const history=buildTectonicHistory(tectonics,mesh);
 assert.ok(at(history.subsidence,.5,.5)>.25);
 assert.ok(at(history.subsidence,.5,0)<.001,'subsidence extends 300 km beyond the fault');
 assert.ok(at(history.subsidence,.5,1)<.001,'subsidence extends 300 km beyond the other end');
});

test('deformation follows a bent margin instead of the plate-center projection',()=>{
 const tectonics=plan('rift');
 tectonics.boundaries[0].points=[{x:200,z:0},{x:200,z:300},{x:700,z:400}];
 tectonics.boundaries[0].lengthKm=300+Math.hypot(500,100);
 const history=buildTectonicHistory(tectonics,mesh);
 // (500,360) lies on the shallow diagonal. (600,200) is about
 // 177 km from it, but only 35 km away in the plate-center direction.
 assert.ok(at(history.subsidence,.625,.45)>.2);
 assert.ok(at(history.subsidence,.75,.25)<.002,'the bend broadens into a projected fault stripe');
});

for(const kind of ['rift','subduction'])test(`${kind}: crossing an endpoint's tangent does not create a terrain seam`,()=>{
 const sample=offset=>{
  const tectonics=plan(kind,{polarity:1});
  tectonics.boundaries[0].points=[{x:400+offset,z:100},{x:400+offset,z:300}];
  tectonics.boundaries[0].lengthKm=200;
  return buildTectonicHistory(tectonics,mesh);
 };
 // Move the fault two metres across the sample, 100 km beyond its end.
 // A tiny displacement must not switch a positive/negative 100 km distance
 // and produce a mountain or trough seam.
 const a=sample(-.001),b=sample(.001);
 for(const key of ['uplift','subsidence','volcanism'])assert.ok(Math.abs(at(a[key],.5,0)-at(b[key],.5,0))<.001,`${key} jumps across the endpoint tangent`);
});

test('history fields are deterministic, finite, and record recent active deformation',()=>{
 const a=buildTectonicHistory(plan('subduction',{polarity:1}),mesh);
 const b=buildTectonicHistory(plan('subduction',{polarity:1}),mesh);
 assert.deepEqual(a,b);
 for(const field of [a.uplift,a.subsidence,a.volcanism,a.shear,a.tectonicAge])assert.ok(field.every(Number.isFinite));
 assert.ok(at(a.tectonicAge,.5)<at(a.tectonicAge,.05));
 assert.equal(a.episodes.length,3);
});
