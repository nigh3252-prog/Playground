// Run: node --test tests/procedural-city-lots.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {generateLots,polygonsOverlap} from '../assets/city-lab/lot-generator.mjs';
const line=(name,type,width,z=0)=>({name,type,width,points:Array.from({length:101},(_,i)=>({x:-190+i*3.8,z,y:0}))});
const flat=()=>5;

test('generates deterministic lots with plausible land uses',()=>{
 const roads=[line('Main','arterial',12,0),line('Local','local',6.5,80)];
 const a=generateLots({roads,worldSize:410,heightAt:flat,waterLevel:-5,seed:123});
 const b=generateLots({roads,worldSize:410,heightAt:flat,waterLevel:-5,seed:123});
 assert.ok(a.length>10);assert.deepEqual(a,b);
 assert.ok(a.some(x=>x.landUse==='commercial'));assert.ok(a.some(x=>x.landUse==='residential'));
});
test('lots remain inside world, clear roads, and do not overlap each other',()=>{
 const roads=[line('Main','arterial',12,0),line('Local','local',6.5,80)];
 const lots=generateLots({roads,worldSize:410,heightAt:flat,waterLevel:-5,seed:44});
 for(const lot of lots)for(const p of lot.polygon)assert.ok(Math.abs(p.x)<201&&Math.abs(p.z)<201);
 for(let i=0;i<lots.length;i++)for(let j=i+1;j<lots.length;j++)assert.equal(polygonsOverlap(lots[i].polygon,lots[j].polygon,.8),false);
});
test('water and extreme relief suppress development',()=>{
 const roads=[line('Main','collector',8,0)];
 assert.equal(generateLots({roads,worldSize:410,heightAt:()=>-6,waterLevel:-5,seed:1}).length,0);
 assert.equal(generateLots({roads,worldSize:410,heightAt:(x,z)=>z*.5,waterLevel:-50,seed:1}).length,0);
});
test('arbitrary road angles produce arbitrary lot orientation',()=>{
 const road={name:'Diagonal',type:'local',width:6.5,points:[{x:-150,z:-80,y:0},{x:160,z:37,y:0}]};
 const lots=generateLots({roads:[road],worldSize:410,heightAt:flat,waterLevel:-5,seed:6});
 assert.ok(lots.length>3);
 const e={x:lots[0].polygon[1].x-lots[0].polygon[0].x,z:lots[0].polygon[1].z-lots[0].polygon[0].z};
 const angle=Math.atan2(e.z,e.x)*180/Math.PI;
 assert.ok(Math.abs(angle)>5&&Math.abs(angle)<40,`angle ${angle}`);
});
