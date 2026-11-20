import test from 'node:test';
import assert from 'node:assert/strict';
import {generateWorld} from '../assets/world-lab/world-core.mjs';
import {generateHumanGeography,productivityAt,localTravelFriction,edgeTravelCost,STRATEGIC_TYPES} from '../assets/world-lab/human-geography.mjs';

const config={seed:431970387,n:49,sizeKm:1200};
const ecology=generateWorld(config);
const human=generateHumanGeography(ecology);
const close=(a,b,tol=1e-7)=>assert.ok(Math.abs(a-b)<=tol,`${a} != ${b}`);

test('Stage 4 is deterministic and does not mutate Stage 3',()=>{
  const before=ecology.height.slice(),b=generateHumanGeography(generateWorld(config));
  assert.equal(human.stage,4);assert.equal(human.version,'regional-world-v4');
  assert.deepEqual(ecology.height,before);assert.equal(ecology.stage,3);assert.equal(ecology.humanPotential,undefined);
  for(const key of ['productivity','travelFriction','navigableRiver','marketAccess','transportAccess','humanPotential'])assert.deepEqual(human[key],b[key]);
  assert.deepEqual(human.strategicNodes,b.strategicNodes);
});

test('productivity reacts to climate, slope and land cover rather than random placement',()=>{
  const good=productivityAt({biome:6,tempC:13,rainMm:900,slope:.002,elevationM:200,wetDistanceKm:10,upstreamAreaKm2:3000});
  const steep=productivityAt({biome:6,tempC:13,rainMm:900,slope:.18,elevationM:200,wetDistanceKm:10,upstreamAreaKm2:3000});
  const arid=productivityAt({biome:8,tempC:25,rainMm:180,slope:.002,elevationM:200,wetDistanceKm:100,upstreamAreaKm2:30});
  const alpine=productivityAt({biome:10,tempC:0,rainMm:1100,slope:.08,elevationM:3000,wetDistanceKm:10,upstreamAreaKm2:30});
  assert.ok(good>.7);assert.ok(steep<good*.15);assert.ok(arid<good*.2);assert.ok(alpine<good*.1);
});

test('overland friction makes grassland easier than wetland, forest and alpine terrain',()=>{
  const flat={slope:.002,elevationM:300};
  const grass=localTravelFriction({biome:6,...flat}),forest=localTravelFriction({biome:4,...flat}),wet=localTravelFriction({biome:2,...flat}),alpine=localTravelFriction({biome:10,slope:.08,elevationM:2600});
  assert.ok(grass<forest);assert.ok(forest<wet);assert.ok(wet<alpine);
});

test('cheap bulk-water links beat cart travel by design',()=>{
  const world={ocean:new Uint8Array([1,1,0,0]),lake:new Uint8Array(4),receiver:Int32Array.from([1,-1,3,-1])};
  const friction=Float32Array.from([0,0,1.5,1.5]),nav=Uint8Array.from([0,0,1,0]);
  close(edgeTravelCost(world,friction,nav,0,1,10),1.1);
  close(edgeTravelCost(world,friction,nav,2,3,10),2.2);
  nav[2]=0;close(edgeTravelCost(world,friction,nav,2,3,10),15);
});

test('water has no farming or settlement potential and all land scores stay bounded',()=>{
  for(let i=0;i<human.height.length;i++){
    for(const key of ['productivity','marketAccess','transportAccess','humanPotential'])assert.ok(human[key][i]>=0&&human[key][i]<=1,key);
    if(human.ocean[i]||human.lake[i]){assert.equal(human.productivity[i],0);assert.equal(human.humanPotential[i],0);}
  }
});

test('navigable reaches satisfy modeled size, slope and discharge constraints',()=>{
  let count=0;for(let i=0;i<human.height.length;i++)if(human.navigableRiver[i]){
    count++;assert.ok(human.river[i]);assert.ok(human.area[i]>=human.navigableAreaThresholdKm2);assert.ok(human.runoff[i]>=4);assert.ok(human.height[i]<1250);
    const r=human.receiver[i],d=Math.hypot(human.mesh.x[i]-human.mesh.x[r],human.mesh.z[i]-human.mesh.z[r]),s=(human.filled[i]-human.filled[r])/(d*1000);assert.ok(s<=.0018001);
  }
  assert.ok(count>0);assert.ok(human.navigableRiverKm>0);
});

test('transport-network sources have maximum modeled access and inland terrain decays away from them',()=>{
  let sources=0,remote=0;for(let i=0;i<human.height.length;i++){
    if(human.transportSource[i]){sources++;close(human.waterAccessCost[i],0);close(human.transportAccess[i],1,1e-6);}
    else if(Number.isFinite(human.waterAccessCost[i])&&human.waterAccessCost[i]>150&&!human.ocean[i]&&!human.lake[i]){remote++;assert.ok(human.transportAccess[i]<.28);}
  }
  assert.ok(sources>0);assert.ok(remote>0);
});

test('market access is actually affected by the transport graph',()=>{
  const values=[];for(let i=0;i<human.height.length;i++)if(!human.ocean[i]&&!human.lake[i]&&human.productivity[i]>.45)values.push([human.transportAccess[i],human.marketAccess[i]]);
  values.sort((a,b)=>a[0]-b[0]);const q=Math.max(1,Math.floor(values.length*.2));
  const low=values.slice(0,q).reduce((s,v)=>s+v[1],0)/q,high=values.slice(-q).reduce((s,v)=>s+v[1],0)/q;
  assert.ok(high>low,`${high} should exceed ${low}`);
});

test('strategic markers are typed opportunities, spaced apart, and never settlements',()=>{
  assert.ok(human.strategicNodes.length>0);const allowed=new Set(Object.keys(STRATEGIC_TYPES));
  const spacing=Math.max(24,human.config.sizeKm/55)-1e-6;
  for(let i=0;i<human.strategicNodes.length;i++){
    const a=human.strategicNodes[i];assert.ok(allowed.has(a.type));assert.ok(a.reason);assert.ok(!/city|town|village|settlement/i.test(a.label));
    for(let j=0;j<i;j++){const b=human.strategicNodes[j];assert.ok(Math.hypot(a.xKm-b.xKm,a.zKm-b.zKm)>=spacing);}
  }
  assert.equal(human.settlements,undefined);
});

test('human-potential hotspots combine usable land with market or transport access',()=>{
  const ids=Array.from({length:human.height.length},(_,i)=>i).filter(i=>!human.ocean[i]&&!human.lake[i]).sort((a,b)=>human.humanPotential[b]-human.humanPotential[a]);
  const top=ids.slice(0,Math.max(5,Math.floor(ids.length*.02))),bottom=ids.slice(-top.length);
  const avg=(arr,key)=>arr.reduce((s,i)=>s+human[key][i],0)/arr.length;
  assert.ok(avg(top,'productivity')>avg(bottom,'productivity'));
  assert.ok(avg(top,'marketAccess')+avg(top,'transportAccess')>avg(bottom,'marketAccess')+avg(bottom,'transportAccess'));
});

test('changing climate changes Stage 4 opportunity but preserves physical terrain and rivers',()=>{
  const dryEco=generateWorld({...config,rain:.45}),dry=generateHumanGeography(dryEco);
  assert.deepEqual(ecology.height,dryEco.height);assert.deepEqual(ecology.receiver,dryEco.receiver);assert.notDeepEqual(human.productivity,dry.productivity);assert.notDeepEqual(human.humanPotential,dry.humanPotential);
});

test('Stage 4 works across several seeds and sizes without NaN/Infinity scores',()=>{
  for(const [seed,sizeKm] of [[0,600],[17,1200],[99421,2400]]){
    const w=generateHumanGeography(generateWorld({seed,sizeKm,n:41}));
    assert.equal(w.stage,4);for(const a of [w.productivity,w.travelFrictionNormalized,w.marketAccess,w.transportAccess,w.humanPotential])for(const v of a)assert.ok(Number.isFinite(v));
  }
});
