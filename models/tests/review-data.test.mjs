import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildReviewIndex,reviewKey,reviewQuality,familyVariants} from '../review-data.mjs';
import {filterModels,defaultFilters} from '../filters.mjs';

const catalog=JSON.parse(readFileSync(new URL('../catalog.json',import.meta.url))).models;
const registry=JSON.parse(readFileSync(new URL('../reviews.json',import.meta.url)));
const index=buildReviewIndex(registry,catalog);
const models=catalog.map(entry=>({...entry,review:index.get(reviewKey(entry))}));

test('every review links to one exact catalog id and version, no ordinal aliases',()=>{
  assert.equal(index.size,registry.modelReviews.length);
  assert.equal(index.has('warden@v1'),true);
  assert.equal(index.has('crocodilian@v2'),false); // unresolved spoken model remains unresolved
  assert.equal(index.has('beast-hangar-solmane@v1'),false); // not personally reviewed
});

test('review quality is independent from polygon complexity and from being unseen',()=>{
  const get=(id,version)=>models.find(m=>m.id===id&&m.version===version);
  assert.equal(reviewQuality(get('warden','v1')),'exceptional');
  assert.equal(reviewQuality(get('warden-machine-apiary','v1')),'low');
  assert.equal(reviewQuality(get('dot','v1')),'not-rated');
  assert.equal(reviewQuality(get('beast-hangar-solmane','v1')),'unreviewed');
  assert.deepEqual(filterModels(models,{...defaultFilters,reviewQuality:'exceptional'}).map(m=>m.id),['warden']);
  assert.deepEqual(filterModels(models,{...defaultFilters,reviewQuality:'unreviewed'}).some(m=>m.id==='beast-hangar-solmane'),true);
  assert.deepEqual(filterModels(models,{...defaultFilters,reviewQuality:'not-rated'}).some(m=>m.id==='dot'),true);
});

test('families include versions and differently named variants, not entire collections',()=>{
  const get=(id,version)=>models.find(m=>m.id===id&&m.version===version);
  assert.deepEqual(familyVariants(models,get('railgun-sunspike','v1')).map(m=>m.version),['v2','v1']);
  assert.deepEqual(familyVariants(models,get('bulwark-modular','v1')).map(m=>m.id),['bulwark-modular','bulwark-modular-bare-frame']);
  assert.equal(familyVariants(models,get('warden-machine-apiary','v1')).length,1);
});

test('a corrupt registry rejects unknown references, duplicates, and inferred ratings',()=>{
  const template={schemaVersion:1,modelReviews:[{id:'warden',version:'v1',visualQuality:'high'}]};
  assert.equal(buildReviewIndex(template,catalog).size,1);
  assert.throws(()=>buildReviewIndex({...template,modelReviews:[...template.modelReviews,...template.modelReviews]},catalog),/Duplicate/);
  assert.throws(()=>buildReviewIndex({...template,modelReviews:[{id:'missing',version:'v1',visualQuality:'high'}]},catalog),/missing from catalog/);
  assert.throws(()=>buildReviewIndex({...template,modelReviews:[{id:'warden',version:'v1',visualQuality:'unreviewed'}]},catalog),/Invalid visual/);
});
