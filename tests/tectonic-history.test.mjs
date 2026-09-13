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

test('rifting creates a subsiding axis and uplifted shoulders',()=>{
 const history=buildTectonicHistory(plan('rift'),mesh);
 assert.ok(at(history.subsidence,.5)>.25);
 assert.ok(at(history.uplift,.61)>.1);
});

test('history fields are deterministic, finite, and record recent active deformation',()=>{
 const a=buildTectonicHistory(plan('subduction',{polarity:1}),mesh);
 const b=buildTectonicHistory(plan('subduction',{polarity:1}),mesh);
 assert.deepEqual(a,b);
 for(const field of [a.uplift,a.subsidence,a.volcanism,a.shear,a.tectonicAge])assert.ok(field.every(Number.isFinite));
 assert.ok(at(a.tectonicAge,.5)<at(a.tectonicAge,.05));
 assert.equal(a.episodes.length,3);
});
