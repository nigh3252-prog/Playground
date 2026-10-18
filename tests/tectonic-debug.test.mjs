import test from 'node:test';
import assert from 'node:assert/strict';
import {tectonicColor,tectonicFacts} from '../assets/world-lab/tectonic-debug.mjs';

const world={mesh:{x:Float64Array.from([100,700]),z:Float64Array.from([400,400])},geology:{tectonics:{
 plates:[{id:0,crust:'oceanic',velocityX:.2,velocityZ:0},{id:1,crust:'continental',velocityX:-.2,velocityZ:0}],
 boundaries:[{id:0,plateA:0,plateB:1,kind:'subduction',polarity:1,normalRate:.4,shearRate:.03,points:[{x:400,z:0},{x:400,z:800}]}],
 history:{plateId:Int16Array.from([0,1]),crust:Uint8Array.from([0,2]),tectonicAge:Float32Array.from([70,12]),uplift:Float32Array.from([0,.8]),subsidence:Float32Array.from([.7,0]),volcanism:Float32Array.from([0,.5])}
}}};

test('tectonic map color distinguishes plate ownership and crust',()=>{
 const ocean=tectonicColor(world,0),continent=tectonicColor(world,1);
 assert.equal(ocean.length,3);assert.equal(continent.length,3);
 assert.ok(ocean.every(Number.isFinite)&&continent.every(Number.isFinite));
 assert.notDeepEqual(ocean,continent);
});

test('tectonic inspector explains the causal boundary and response',()=>{
 const facts=tectonicFacts(world,1),lookup=Object.fromEntries(facts);
 assert.equal(lookup['Plate / crust'],'1 / continental');
 assert.equal(lookup['Boundary class'],'subduction');
 assert.match(lookup['Relative motion'],/convergence/);
 assert.match(lookup['Tectonic age'],/Myr/);
 assert.match(lookup['Tectonic response'],/uplift/);
});

test('real benchmark terrain reports that fictional tectonics do not apply',()=>{
 assert.deepEqual(tectonicFacts({geology:{}},0),[['Tectonics','Not generated for measured terrain']]);
});
