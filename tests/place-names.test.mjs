import test from 'node:test';
import assert from 'node:assert/strict';
import {simulateHumanHistory} from '../assets/world-lab/human-history.mjs';

function placeWorld({coast=false,river=false}={}) {
 const N=3,f=v=>new Float32Array(N).fill(v);
 return {stage:4,parentDomain:{sizeKm:24},height:f(100),ocean:Uint8Array.from([0,coast?1:0,0]),lake:new Uint8Array(N),slope:f(.002),biome:new Uint8Array(N).fill(6),productivity:f(.75),productiveArea:f(48),travelFriction:f(1),navigableRiver:Uint8Array.from([river?1:0,0,0]),receiver:Int32Array.from([river?2:-1,-1,-1]),mesh:{x:Float32Array.from([8,16,0]),z:f(8),nodeArea:f(64),offsets:Uint32Array.from([0,2,3,4]),neighbors:Uint32Array.from([1,2,0,0]),distances:Float32Array.from([8,8,8,8])}};
}

// A missing origin or an invented water feature in a dry meadow breaks the
// inspected place's claim about how its name relates to this world's geography.
test('early place names record a real geographical or represented community origin',async()=>{
 const h=await simulateHumanHistory(placeWorld(),{seed:7,generations:1});
 for(const site of h.sites){
  assert.equal(typeof site.nameOrigin,'string');
  assert.ok(site.nameOrigin.length>20);
  assert.doesNotMatch(site.nameOrigin,/\b(river|coast|lake|war|king)\b/i);
  const group=h.groups[site.groupId];assert.ok(group.foundingHousehold);assert.ok(group.civicForm);
 }
});

test('contextual names are unique without numbered suffixes and helpers do not mutate input',async()=>{
 const module=await import('../assets/world-lab/place-names.mjs');
 const world=placeWorld({coast:true,river:true}),before=structuredClone(world);
 const group=module.createCommunityIdentity(world,0,0,42),usedNames=new Set(),names=[];
 for(let id=0;id<1100;id++){
  const named=module.namePlace(world,{nodeId:0,id,seed:42,group,usedNames});
  assert.deepEqual(named,module.namePlace(world,{nodeId:0,id,seed:42,group,usedNames}));
  assert.equal(usedNames.size,id);assert.ok(named.nameOrigin.length>20);
  assert.doesNotMatch(named.name,/\d/);assert.ok(!usedNames.has(named.name));
  usedNames.add(named.name);names.push(named);
 }
 assert.deepEqual(world,before);assert.ok(names.some(n=>/river|coast/i.test(n.nameOrigin)));
 const dry=placeWorld();for(let id=0;id<20;id++)assert.doesNotMatch(module.namePlace(dry,{nodeId:0,id,seed:42,group,usedNames:new Set()}).nameOrigin,/\b(river|coast|lake)\b/i);
});

test('independent founding communities keep distinct unnumbered civic identities',async()=>{
 const {createCommunityIdentity}=await import('../assets/world-lab/place-names.mjs'),world=placeWorld();
 const groups=Array.from({length:1000},(_,id)=>createCommunityIdentity(world,0,id,42));
 assert.equal(new Set(groups.map(g=>g.name)).size,groups.length);
 for(const g of groups){assert.doesNotMatch(g.name,/\d/);assert.ok(g.name.includes(g.foundingHousehold));}
 assert.deepEqual(groups,Array.from({length:1000},(_,id)=>createCommunityIdentity(world,0,id,42)));
});
