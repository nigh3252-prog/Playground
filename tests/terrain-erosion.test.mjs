import test from 'node:test';
import assert from 'node:assert/strict';
import {erodeTerrain} from '../assets/world-lab/terrain-erosion.mjs';

const index=(x,z,width)=>z*width+x;

test('erosion lowers steep relief and deposits sediment downslope',()=>{
 const width=7,height=7,elevation=new Float32Array(width*height).fill(100),age=new Float32Array(width*height).fill(500),peak=index(3,3,width),basin=index(4,3,width);
 elevation[peak]=1100;elevation[basin]=0;
 const result=erodeTerrain({elevation,width,height},age,{passes:4});
 assert.ok(result.elevation[peak]<1100);
 assert.ok(result.sediment[basin]>0);
});

test('old inactive relief becomes rounder than equally high young relief',()=>{
 const width=13,height=7,elevation=new Float32Array(width*height).fill(100),age=new Float32Array(width*height).fill(30);
 for(let z=1;z<height-1;z++){elevation[index(3,z,width)]=900;elevation[index(9,z,width)]=900;age[index(3,z,width)]=900;}
 const result=erodeTerrain({elevation,width,height},age,{passes:6});
 const contrast=x=>Math.abs(result.elevation[index(x,3,width)]-(result.elevation[index(x-1,3,width)]+result.elevation[index(x+1,3,width)])/2);
 assert.ok(contrast(3)<contrast(9));
});

test('erosion output remains finite and sediment stays non-negative',()=>{
 const width=9,height=9,elevation=Float32Array.from({length:width*height},(_,i)=>100+(i%7)*80),age=new Float32Array(width*height).fill(400),result=erodeTerrain({elevation,width,height},age,{passes:5});
 assert.ok(result.elevation.every(Number.isFinite));
 assert.ok(result.sediment.every(value=>Number.isFinite(value)&&value>=0));
});
