import test from 'node:test';
import assert from 'node:assert/strict';
import { modelType, modelMotion, modelComplexity, filterModels, defaultFilters } from '../filters.mjs';
import { readFileSync } from 'node:fs';
const catalog = JSON.parse(readFileSync(new URL('../catalog.json',import.meta.url))).models.slice(0,33);
const names = ids => ids.map(id => catalog.find(entry => entry.id === id));
test('current catalog entries have sensible types and future entries are not forced into a type', () => {
  assert.equal(catalog.length >= 33, true);
  assert.equal(catalog.slice(0,33).some(m => modelType(m) === 'unknown'),false);
  const [dot, white, crocodile, pods, spire] = names(['dot','white-mech','crocodilian','vertical-pods-a-pod-module','spirecoil']);
  assert.deepEqual([dot,white,crocodile,pods,spire].map(modelType),['other','humanoid','creature','gear','creature']);
  assert.equal(modelType({id:'new',name:'Untitled blockout'}),'unknown');
  assert.equal(modelType({id:'new',type:'environment'}),'environment');
});
test('walk, skinned and animated are independent, with real skin required', () => {
  assert.deepEqual(modelMotion({rig:'articulated',clips:[{name:'Idle'}]}),{walk:false,skinned:false,animated:true});
  assert.deepEqual(modelMotion({rig:'skinned',clips:[]}),{walk:false,skinned:true,animated:false});
  assert.deepEqual(modelMotion({rig:'unrigged',skinJointCount:0,clips:[{name:'Walk_Preview'}]}),{walk:true,skinned:false,animated:true});
  assert.equal(modelMotion({clips:[{name:'Sidewalk cam'}]}).walk,false);
});
test('triangle buckets have exact boundaries and no invented zero', () => {
  assert.deepEqual([null,0,9999,10000,49999,50000].map(triangles=>modelComplexity({triangles})),['unknown','low','low','medium','medium','high']);
});
test('latest only is opt-in and uses descending numeric version within stable id', () => {
  const models = ['v10','v2','v1.1','v1.12'].map(version=>({id:'same',version}));
  assert.deepEqual(filterModels(models,defaultFilters),models);
  assert.deepEqual(filterModels(models,{...defaultFilters,latest:true}),[models[0]]);
  assert.deepEqual(filterModels(models.slice(2),{...defaultFilters,latest:true}),[models[3]]);
  const suffixes = ['v2a','v1z','v2b','v2'].map(version=>({id:'same',version}));
  assert.deepEqual(filterModels(suffixes,{...defaultFilters,latest:true}),[suffixes[2]]);
  const oldAnimated = {id:'same',version:'v1',clips:[{name:'Idle'}]}, newerStatic = {id:'same',version:'v2'};
  assert.deepEqual(filterModels([oldAnimated,newerStatic],{...defaultFilters,latest:true,motion:['animated']}),[]);
});
test('active filters combine, empty results recover to unfiltered list', () => {
  assert.deepEqual(filterModels(catalog,{...defaultFilters,type:'humanoid',motion:['walk','skinned'],complexity:'medium'}).map(m=>m.id),['white-mech','lilac-walker']);
  assert.deepEqual(filterModels(catalog,{...defaultFilters,type:'gear',motion:['walk']}),[]);
  assert.deepEqual(filterModels(catalog,defaultFilters),catalog);
});
