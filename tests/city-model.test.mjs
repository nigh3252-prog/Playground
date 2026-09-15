import test from 'node:test';
import assert from 'node:assert/strict';
import {createTerrainMesh,indexMesh,locateTriangle} from '../assets/world-lab/world-mesh.mjs';
import {generateCity} from '../assets/world-lab/city-model.mjs';

function fixture({population=220000,coast=false,island=false,hills=false,river=false,era='modern'}={}){
 const mesh=createTerrainMesh(25,40,901),N=mesh.x.length,fill=v=>new Float32Array(N).fill(v);
 const world={stage:4,config:{seed:91,sizeKm:40},parentDomain:{sizeKm:40},mesh,height:fill(60),ocean:new Uint8Array(N),lake:new Uint8Array(N),waterSurface:fill(60),slope:fill(.004),receiver:new Int32Array(N).fill(-1),river:new Uint8Array(N),runoff:fill(20)};
 let nodeId=0,nearest=Infinity;
 for(let i=0;i<N;i++){
  const {x,z}=mesh,d=Math.hypot(x[i]-20,z[i]-20);
  if(d<nearest){nearest=d;nodeId=i;}
  if(coast&&x[i]<18||island&&d>3.8){world.ocean[i]=1;world.height[i]=-40;world.waterSurface[i]=0;}
  if(hills&&x[i]>21){world.slope[i]=.35;world.height[i]=60+(x[i]-21)*400;world.waterSurface[i]=world.height[i];}
 }
 if(river){for(let row=4;row<20;row++){const i=row*25+12;world.river[i]=1;world.receiver[i]=i+25;}}
 const history={seed:704,sites:[{id:0,nodeId,name:'Millbank',nameOrigin:'The founding households settled beside workable land.',founded:0,groupId:0}],groups:[{id:0,name:'Millbank community',color:'#a99776'}],routes:[]};
 const density=era==='modern'?4400:900;
 const frame={generation:24,year:2025,era,siteStates:[{siteId:0,population,status:'city',groupId:0,densityPerKm2:density,urbanAreaKm2:population/density}],routeStates:[]};
 return{world,history,frame};
}
const cityFor=f=>generateCity(f.world,f.history,f.frame,0);
const area=polygon=>Math.abs(polygon.reduce((v,p,i)=>{const q=polygon[(i+1)%polygon.length];return v+p.x*q.z-q.x*p.z;},0))/2;

// Removing allocation remainders or mutating source arrays breaks exact city/region reconciliation.
test('city districts conserve the dated population, replay deterministically and leave the parent untouched',()=>{
 const f=fixture({population:223457}),before=structuredClone(f),a=cityFor(f),b=cityFor(f);
 assert.deepEqual(f,before);assert.deepEqual(a,b);assert.deepEqual(structuredClone(a),a);
 assert.equal(a.population,223457);assert.equal(a.year,2025);assert.equal(a.name,'Millbank');
 assert.equal(a.districts.reduce((v,d)=>v+d.population,0),223457);
 assert.ok(a.districts.every(d=>Number.isInteger(d.population)&&d.population>=0&&d.areaKm2>0&&Number.isFinite(d.densityPerKm2)));
 assert.ok(Math.abs(a.areaKm2-a.districts.reduce((v,d)=>v+d.areaKm2,0))<1e-7);
 assert.ok(a.districts.some(d=>d.kind==='downtown')&&a.districts.some(d=>d.kind==='residential'));
 assert.ok(a.districts.some(d=>d.kind==='industrial')&&a.districts.some(d=>d.kind==='park'&&d.population===0));
 assert.ok(a.roads.some(r=>r.kind==='arterial')&&a.roads.some(r=>r.kind==='local'));
 assert.ok(a.blocks.length>100&&a.blocks.length<=24000,'finite urban block budget');
});

// A fixed-size stamp would give these two populations similar footprints.
test('a larger settlement occupies more actual land and develops a larger view extent',()=>{
 const small=cityFor(fixture({population:1800})),large=cityFor(fixture({population:900000}));
 assert.ok(large.areaKm2>small.areaKm2*80);assert.ok(large.bounds.size>small.bounds.size*6);
 assert.ok(Math.abs(large.areaKm2-large.targetAreaKm2)/large.targetAreaKm2<.06);
 assert.ok(large.districts.length>small.districts.length);
 for(const c of [small,large])for(const b of c.blocks){assert.ok(area(b.polygon)>0);for(const p of b.polygon)assert.ok(Number.isFinite(p.x)&&Number.isFinite(p.z));}
});

// Ignoring the irregular triangle masks or routing straight across a bay breaks these shoreline checks.
test('coastal and island blocks and streets stay on parent land, with water retained in the city terrain',()=>{
 for(const options of [{coast:true},{island:true},{coast:true,hills:true}]){
  const f=fixture(options),c=cityFor(f),index=indexMesh(f.world.mesh);
  assert.ok(c.terrain.water.length>0);
  const dry=p=>{const q=locateTriangle(index,p.x,p.z);assert.ok(q);const water=q.wa*f.world.ocean[q.a]+q.wb*f.world.ocean[q.b]+q.wc*f.world.ocean[q.c];assert.ok(water<.500001,`water at ${p.x},${p.z}`);const slope=q.wa*f.world.slope[q.a]+q.wb*f.world.slope[q.b]+q.wc*f.world.slope[q.c];assert.ok(slope<=.22+1e-6);};
  for(const b of c.blocks)for(const p of [b.center,...b.polygon])dry(p);
  for(const r of c.roads)for(let k=1;k<r.points.length;k++){const a=r.points[k-1],b=r.points[k];for(let t=0;t<=1;t+=.1)dry({x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t});}
  assert.equal(c.districts.reduce((v,d)=>v+d.population,0),220000);
 }
 const inland=cityFor(fixture()),coastal=cityFor(fixture({coast:true}));assert.notDeepEqual(inland.blocks.map(b=>b.center),coastal.blocks.map(b=>b.center));
});

// Future state/route access would leak a later city's identity and street orientation into early frames.
test('city access is dated, abandoned places cannot open, and future transport does not influence early layouts',()=>{
 const f=fixture({population:37,era:'agrarian'});f.frame.generation=0;f.frame.year=0;
 const early=cityFor(f);assert.equal(early.population,37);assert.equal(early.districts.reduce((v,d)=>v+d.population,0),37);
 f.history.routes.push({id:0,a:0,b:1,nodes:[f.history.sites[0].nodeId,f.history.sites[0].nodeId+1],founded:5,kind:'land'});f.frame.routeStates.push({routeId:0,active:true});
 assert.deepEqual(cityFor(f),early);
 f.history.sites[0].founded=1;assert.throws(()=>cityFor(f),/date|founded|exist/i);
 f.history.sites[0].founded=0;f.frame.siteStates[0].population=0;f.frame.siteStates[0].status='abandoned';assert.throws(()=>cityFor(f),/population|inhabited|abandoned/i);
 assert.throws(()=>generateCity(f.world,f.history,f.frame,99),/site|settlement/i);
});

// Silently rescaling a crowded island to an unconstrained footprint would create neighborhoods over the sea.
test('limited island land keeps the exact population while reporting the constrained footprint',()=>{
 const c=cityFor(fixture({island:true,population:2500000}));
 assert.equal(c.population,2500000);assert.equal(c.districts.reduce((v,d)=>v+d.population,0),2500000);
 assert.ok(c.footprintLimited);assert.ok(c.areaKm2<c.targetAreaKm2*.5);
 assert.ok(c.blocks.length<=24000);assert.ok(c.districts.every(d=>Number.isFinite(d.densityPerKm2)));
});

test('inherited active land connections orient major streets without using future links',()=>{
 const f=fixture(),node=f.history.sites[0].nodeId;
 f.history.routes=[{id:2,a:0,b:1,nodes:[node,node+1,node+2],founded:2,kind:'land'}];f.frame.routeStates=[{routeId:2,active:true}];
 const c=cityFor(f);assert.deepEqual(c.inheritedRouteIds,[2]);assert.equal(c.orientationSource,'inherited route');
 assert.ok(c.roads.some(r=>r.kind==='arterial'));
});

// Metropolitan population must add inspectable neighborhoods and fine local
// streets, not just scale a town's handful of districts to million-person size.
test('a large metropolis retains neighborhood and local-block detail within finite budgets',()=>{
 const f=fixture({population:8800000});
 // A larger parent avoids making this a deliberately overcrowded island.
 f.world.mesh=createTerrainMesh(25,240,901);f.world.config.sizeKm=240;f.world.parentDomain.sizeKm=240;
 const c=cityFor(f);
 assert.ok(c.districts.length>=80&&c.districts.length<=96);
 assert.ok(c.blocks.length>8000&&c.blocks.length<=24000);
 assert.ok(c.blocks.every(b=>Math.sqrt(b.areaKm2)<.5),'local blocks stay below half a kilometer');
 assert.ok(c.roads.filter(r=>r.kind==='local').length>1000,'local streets subdivide metropolitan blocks');
 assert.equal(c.districts.reduce((v,d)=>v+d.population,0),8800000);
 assert.equal(new Set(c.districts.map(d=>d.name)).size,c.districts.length);
 assert.ok(c.districts.every(d=>! /\s\d+$/.test(d.name)),'neighborhoods use distinct local names instead of repeated numbered suffixes');
});
