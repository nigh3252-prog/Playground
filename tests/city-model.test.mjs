import test from 'node:test';
import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {createTerrainMesh,indexMesh,locateTriangle} from '../assets/world-lab/world-mesh.mjs';
import {triangulate} from '../assets/world-lab/triangulate.mjs';
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

// Replacing a route with a bearing-only street would detach the close view
// from the regional polyline even if the orientation remained plausible.
test('dated regional approaches retain their exact parent geometry and join the street network',()=>{
 const f=fixture({population:35000}),node=f.history.sites[0].nodeId;
 f.history.routes=[
  {id:2,a:0,b:1,nodes:[node,node+1,node+2,node+3,node+4],founded:2,kind:'land'},
  {id:3,a:2,b:0,nodes:[node-75,node-50,node-25,node],founded:3,kind:'land'},
  {id:4,a:0,b:3,nodes:[node,node-1],founded:30,kind:'land'},
  {id:5,a:0,b:4,nodes:[node,node+25],founded:4,kind:'land'}
 ];
 f.frame.routeStates=f.history.routes.map(r=>({routeId:r.id,active:r.id!==5,traffic:100}));
 const c=cityFor(f);assert.deepEqual(c.approaches.map(a=>a.routeId),[2,3]);
 for(const approach of c.approaches){
  const route=f.history.routes.find(r=>r.id===approach.routeId),source=route.nodes.map(i=>({x:f.world.mesh.x[i],z:f.world.mesh.z[i]}));
  assert.ok(approach.points.length>=2);assert.deepEqual(approach.connection,c.origin);
  for(const p of approach.points)assert.ok(source.slice(1).some((b,i)=>segmentDistance(p,source[i],b)<1e-8),'approach follows actual regional segments');
  const road=c.roads.find(r=>r.id===approach.roadIds[0]);assert.equal(road.sourceRouteId,route.id);assert.deepEqual(road.points,approach.points);
  assert.ok(c.roads.some(r=>r.sourceRouteId==null&&r.points.some(p=>Math.hypot(p.x-c.origin.x,p.z-c.origin.z)<1e-8)),'city streets meet the dated route endpoint');
 }
 const replay=cityFor(f);assert.deepEqual(replay,c);
 f.frame.routeStates[0].active=false;assert.deepEqual(cityFor(f).approaches.map(a=>a.routeId),[3]);
});

// A navigable route is not permission to pave a lake or sea. Only inherited
// land corridors become streets, and only narrow rivers permit bridge flags.
test('non-land routes never create city roads and broad-water land corridors stay regional',()=>{
 const f=fixture({population:35000,coast:true}),node=f.history.sites[0].nodeId;
 const early=cityFor(f);
 f.history.routes=[
  {id:2,a:0,b:1,nodes:[node,node+1],founded:2,kind:'ferry'},
  {id:3,a:0,b:2,nodes:[node,node-25],founded:2,kind:'river'},
 ];
 f.frame.routeStates=f.history.routes.map(r=>({routeId:r.id,active:true,traffic:100}));
 assert.ok(isDeepStrictEqual(cityFor(f),early),'water transport remains in the regional route context');
 f.history.routes.push({id:4,a:0,b:3,nodes:[node,node-1,node-2,node-3],founded:2,kind:'land'});f.frame.routeStates.push({routeId:4,active:true});
 const c=cityFor(f);assert.ok(c.approaches.some(a=>a.routeId===4));assert.ok(!c.roads.some(r=>r.sourceRouteId===4),'a land-labelled route over broad water is not paved');
 assert.ok(c.roads.every(r=>!r.bridge||r.bridges?.every(b=>b.kind==='river')));
});

test('river bridges describe short crossing spans and never pave a river longitudinally',()=>{
 const f=fixture({population:35000,river:true}),node=f.history.sites[0].nodeId;
 f.history.routes=[{id:2,a:0,b:1,nodes:[node,node+1,node+2],founded:2,kind:'land'}];f.frame.routeStates=[{routeId:2,active:true}];
 const crossing=cityFor(f),road=crossing.roads.find(r=>r.sourceRouteId===2);assert.ok(road?.bridge);
 assert.ok(road.bridges.length>0&&road.bridges.every(b=>b.kind==='river'&&b.points?.length===2&&Math.hypot(b.points[1].x-b.points[0].x,b.points[1].z-b.points[0].z)<=.4),'bridge spans only the narrow inherited channel');
 f.history.routes[0].nodes=[node,node+25,node+50];
 const alongRiver=cityFor(f);assert.ok(!alongRiver.roads.some(r=>r.sourceRouteId===2),'a river-following corridor stays regional transport');
});

const segmentDistance=(p,a,b)=>{const dx=b.x-a.x,dz=b.z-a.z,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/(dx*dx+dz*dz||1)));return Math.hypot(p.x-a.x-dx*t,p.z-a.z-dz*t);};
const intersects=(a,b)=>{for(const p of [a,b])for(let i=0;i<p.length;i++){const q=p[(i+1)%p.length],nx=q.z-p[i].z,nz=p[i].x-q.x,A=a.map(v=>v.x*nx+v.z*nz),B=b.map(v=>v.x*nx+v.z*nz);if(Math.max(...A)<Math.min(...B)-1e-10||Math.max(...B)<Math.min(...A)-1e-10)return false;}return true;};

// A single rotated or warped grid cannot supply a curved core and independently
// oriented, bounded planned and industrial quarters.
test('urban fabric has inherited central lanes and several local plans instead of whole-city grid lines',()=>{
 const c=cityFor(fixture({population:220000}));
 const local=c.roads.filter(r=>r.kind==='local'),bearings=new Set(local.flatMap(r=>r.points.slice(1).map((b,i)=>Math.round((((Math.atan2(b.z-r.points[i].z,b.x-r.points[i].x)%Math.PI)+Math.PI)%Math.PI)*12/Math.PI))));
 assert.ok(bearings.size>=7,'local streets use multiple directions');
 assert.ok(c.roads.some(r=>r.phase==='old center'&&r.points.length>3));
 assert.ok(c.roads.some(r=>r.phase==='planned expansion'));
 assert.ok(c.roads.some(r=>r.phase==='industrial access'));
 assert.ok(c.roads.some(r=>r.phase==='later arterial'));
 assert.ok(new Set(local.map(r=>r.patternId)).size>=4);
 assert.ok(c.roads.some(r=>r.districtIds?.length===2),'local street connections continue between different neighborhood plans');
 assert.ok(c.development?.note&&c.development?.sourceGeneration===c.generation);
 assert.ok(local.every(r=>Math.hypot(r.points.at(-1).x-r.points[0].x,r.points.at(-1).z-r.points[0].z)<c.bounds.size*.55),'local plans remain neighborhood scale');
});

// A visually adjacent neighborhood is still detached if its streets never
// actually touch the city's network. Test geometric intersections, not IDs.
test('neighborhood streets form one physically connected network, including along a coast',()=>{
 for(const coast of [false,true]){
  const c=cityFor(fixture({population:22000,coast})),parent=c.roads.map((r,i)=>i),root=i=>parent[i]===i?i:(parent[i]=root(parent[i]));
  const segments=c.roads.flatMap((r,road)=>r.points.slice(1).map((b,i)=>({a:r.points[i],b,road})));
  const touch=(a,b,c,d)=>{
   const ax=b.x-a.x,az=b.z-a.z,bx=d.x-c.x,bz=d.z-c.z,den=ax*bz-az*bx;
   if(Math.abs(den)>1e-12){const t=((c.x-a.x)*bz-(c.z-a.z)*bx)/den,u=((c.x-a.x)*az-(c.z-a.z)*ax)/den;if(t>=-1e-7&&t<=1+1e-7&&u>=-1e-7&&u<=1+1e-7)return true;}
   return Math.min(segmentDistance(a,c,d),segmentDistance(b,c,d),segmentDistance(c,a,b),segmentDistance(d,a,b))<1e-7;
  };
  for(let i=0;i<segments.length;i++)for(let j=i+1;j<segments.length;j++){
   const a=segments[i],b=segments[j];if(root(a.road)===root(b.road)||Math.max(a.a.x,a.b.x)+1e-7<Math.min(b.a.x,b.b.x)||Math.max(b.a.x,b.b.x)+1e-7<Math.min(a.a.x,a.b.x)||Math.max(a.a.z,a.b.z)+1e-7<Math.min(b.a.z,b.b.z)||Math.max(b.a.z,b.b.z)+1e-7<Math.min(a.a.z,a.b.z))continue;
   if(touch(a.a,a.b,b.a,b.b))parent[root(a.road)]=root(b.road);
  }
  assert.equal(new Set(c.roads.map((r,i)=>root(i))).size,1,'every street connects through actual shared geometry');
 }
});

// Offsetting roofs from their own street alone leaves buildings crossing other
// streets at junctions; pairwise footprint and all-road clearance are required.
test('road-frontage buildings share the street geometry and clear every street, water polygon and other roof',()=>{
 const c=cityFor(fixture({population:18000,river:true}));
 assert.ok(c.buildings.length>100&&c.buildings.length<=48000);
 const roadById=new Map(c.roads.map(r=>[r.id,r])),segments=c.roads.flatMap(r=>r.points.slice(1).map((b,i)=>({a:r.points[i],b,width:r.widthKm})));
 const bounds=p=>({x:Math.min(...p.map(v=>v.x)),z:Math.min(...p.map(v=>v.z)),r:Math.max(...p.map(v=>v.x)),b:Math.max(...p.map(v=>v.z))});
 const roofs=c.buildings.map(b=>({...b,box:bounds(b.polygon)}));
 for(let i=0;i<roofs.length;i++){
  const roof=roofs[i],road=roadById.get(roof.roadId);assert.ok(road);assert.ok(roof.areaKm2>0);assert.ok(c.districts.some(d=>d.id===roof.districtId&&d.kind!=='park'));
  assert.ok(road.points.slice(1).some((b,j)=>{const a=road.points[j],edge={x:roof.polygon[1].x-roof.polygon[0].x,z:roof.polygon[1].z-roof.polygon[0].z};return Math.abs(edge.x*(b.z-a.z)-edge.z*(b.x-a.x))<1e-8;}),'frontage is parallel to a source street segment');
  for(const s of segments){
   if(Math.max(s.a.x,s.b.x)+s.width<roof.box.x||Math.min(s.a.x,s.b.x)-s.width>roof.box.r||Math.max(s.a.z,s.b.z)+s.width<roof.box.z||Math.min(s.a.z,s.b.z)-s.width>roof.box.b)continue;
   const dx=s.b.x-s.a.x,dz=s.b.z-s.a.z,len=Math.hypot(dx,dz),half=s.width/2+.0019;
   if(!len)continue;
   const corridor=[{x:s.a.x-dz/len*half,z:s.a.z+dx/len*half},{x:s.b.x-dz/len*half,z:s.b.z+dx/len*half},{x:s.b.x+dz/len*half,z:s.b.z-dx/len*half},{x:s.a.x+dz/len*half,z:s.a.z-dx/len*half}];
   assert.ok(!intersects(roof.polygon,corridor),`roof ${roof.id} clears every street`);
  }
  for(const water of c.terrain.water)assert.ok(!intersects(roof.polygon,water.polygon));
  for(let j=i+1;j<roofs.length;j++){const other=roofs[j];if(roof.box.r<other.box.x||roof.box.x>other.box.r||roof.box.b<other.box.z||roof.box.z>other.box.b)continue;assert.ok(!intersects(roof.polygon,other.polygon),`roofs ${roof.id}/${other.id} do not overlap`);}
 }
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
 assert.ok(c.roads.filter(r=>r.kind==='local').length>1000,'local streets reach metropolitan neighborhoods');
 assert.ok(c.roads.length<=12000&&c.buildings.length<=48000,'roads and roofs have finite geometry budgets');
 assert.ok(c.buildings.length>15000,'the metropolis retains fine urban fabric');
 assert.ok(new Set(c.buildings.map(b=>b.districtId)).size>=75,'frontage detail reaches the whole metropolis');
 assert.equal(c.districts.reduce((v,d)=>v+d.population,0),8800000);
 assert.equal(new Set(c.districts.map(d=>d.name)).size,c.districts.length);
 assert.ok(c.districts.every(d=>! /\s\d+$/.test(d.name)),'neighborhoods use distinct local names instead of repeated numbered suffixes');
});

// Independently generated nearby cities formerly occupied the same land.
// Their reversed views must agree on one area-weighted straight boundary.
test('neighboring metropolises reserve symmetric dated territories before either city grows',()=>{
 // The failing default-world pair's populations, areas and relative parent
 // coordinates, on a compact flat terrain patch so the regression is portable.
 const f=fixture({population:7813471});f.world.mesh=createTerrainMesh(25,160,901);f.world.config.sizeKm=160;f.world.parentDomain.sizeKm=160;f.frame.year=600;
 const first=f.history.sites[0],mesh=f.world.mesh;first.id=3;first.name='Woodland End';mesh.x[first.nodeId]=80;mesh.z[first.nodeId]=80;
 const neighborPoint={x:118.4782120092625,z:94.5611260807196};let node=-1,nearest=Infinity;
 for(let i=0;i<mesh.x.length;i++){const d=Math.hypot(mesh.x[i]-neighborPoint.x,mesh.z[i]-neighborPoint.z);if(i!==first.nodeId&&d<nearest){nearest=d;node=i;}}
 mesh.x[node]=neighborPoint.x;mesh.z[node]=neighborPoint.z;mesh.triangles=triangulate(mesh.x,mesh.z);
 f.history.sites.push({id:107,nodeId:node,name:'Zoya Parker High Ground',founded:12,groupId:0});
 Object.assign(f.frame.siteStates[0],{siteId:3,densityPerKm2:4327.8819244099395,urbanAreaKm2:1805.3798917042504});
 f.frame.siteStates.push({siteId:107,population:2858470,status:'city',groupId:0,densityPerKm2:3927.5377805120233,urbanAreaKm2:727.8020377508242});
 f.history.routes.push({id:0,a:3,b:107,nodes:[first.nodeId,node],founded:12,kind:'land'});f.frame.routeStates.push({routeId:0,active:true});
 const a=generateCity(f.world,f.history,f.frame,3),b=generateCity(f.world,f.history,f.frame,107),dx=b.origin.x-a.origin.x,dz=b.origin.z-a.origin.z,d=Math.hypot(dx,dz),nx=dx/d,nz=dz/d,share=Math.sqrt(1805.3798917042504)/(Math.sqrt(1805.3798917042504)+Math.sqrt(727.8020377508242));
 const expected={x:a.origin.x+dx*share,z:a.origin.z+dz*share},signed=p=>(p.x-expected.x)*nx+(p.z-expected.z)*nz;
 for(const [city,sign]of[[a,1],[b,-1]]){
  for(const block of city.blocks)for(const p of block.polygon)assert.ok(sign*signed(p)<=1e-8,'accounting polygons remain wholly inside owned land');
  for(const roof of city.buildings)for(const p of roof.polygon)assert.ok(sign*signed(p)<-1e-5,'opposite cities cannot overlap their roofs');
  for(const road of city.roads.filter(r=>r.sourceRouteId==null))for(const p of road.points)assert.ok(sign*signed(p)+road.widthKm/2<=1e-8,'street corridors remain inside their own territory');
  assert.equal(city.districts.reduce((sum,q)=>sum+q.population,0),city.population);
  assert.ok(city.roads.some(r=>r.sourceRouteId===0&&r.points.some(p=>sign*signed(p)>0)),'inherited regional approaches can continue across the boundary');
 }
 const ab=a.territory.boundaries.find(q=>q.neighborSiteId===107),ba=b.territory.boundaries.find(q=>q.neighborSiteId===3);
 assert.deepEqual(ab.point,ba.point);assert.ok(Math.hypot(ab.point.x-expected.x,ab.point.z-expected.z)<1e-8);
 assert.equal(ab.normal.x,-ba.normal.x);assert.equal(ab.normal.z,-ba.normal.z);assert.equal(ab.offsetKm,-ba.offsetKm);
});

test('future or abandoned neighbors do not reserve land in an earlier city view',()=>{
 const f=fixture({population:22000}),early=cityFor(f);
 f.history.sites.push({id:1,nodeId:f.history.sites[0].nodeId+1,name:'Future center',founded:f.frame.generation+1,groupId:0});
 f.frame.siteStates.push({siteId:1,population:8800000,status:'city',densityPerKm2:4400,urbanAreaKm2:2000});
 assert.ok(isDeepStrictEqual(cityFor(f),early),'a future neighbor has no effect');
 f.history.sites[1].founded=0;f.frame.siteStates[1].status='abandoned';
 assert.ok(isDeepStrictEqual(cityFor(f),early),'an abandoned neighbor has no effect');
});

// A neighboring city's inherited route can cross this city's territory even
// when this settlement is neither endpoint. Its exact corridor must stay clear.
test('buildings clear active dated through-routes as well as their own city approaches',()=>{
 const f=fixture({population:22000}),node=f.history.sites[0].nodeId;
 f.history.sites.push({id:9,nodeId:node-2,name:'West neighbor',founded:0,groupId:0},{id:10,nodeId:node+2,name:'East neighbor',founded:0,groupId:0});
 f.frame.siteStates.push({siteId:9,population:50,status:'village',urbanAreaKm2:.04},{siteId:10,population:50,status:'village',urbanAreaKm2:.04});
 const early=cityFor(f);f.history.routes.push({id:40,a:9,b:10,nodes:[node-2,node+2],founded:f.frame.generation+1,kind:'land'});f.frame.routeStates.push({routeId:40,active:true});
 assert.ok(isDeepStrictEqual(cityFor(f),early),'future through-routes reserve no land');
 f.history.routes[0].founded=0;f.frame.routeStates[0].active=false;assert.ok(isDeepStrictEqual(cityFor(f),early),'inactive through-routes reserve no land');
 f.frame.routeStates[0].active=true;const c=cityFor(f),mesh=f.world.mesh,a={x:mesh.x[node-2],z:mesh.z[node-2]},b={x:mesh.x[node+2],z:mesh.z[node+2]},dx=b.x-a.x,dz=b.z-a.z,length=Math.hypot(dx,dz),half=.026/2+.0019;
 const corridor=[{x:a.x-dz/length*half,z:a.z+dx/length*half},{x:b.x-dz/length*half,z:b.z+dx/length*half},{x:b.x+dz/length*half,z:b.z-dx/length*half},{x:a.x+dz/length*half,z:a.z-dx/length*half}];
 assert.ok(c.buildings.length>100);for(const building of c.buildings)assert.ok(!intersects(building.polygon,corridor),'buildings clear the shared regional road width');
 assert.ok(c.roads.some(r=>r.sourceRouteId===40),'active through route becomes an exact inherited city corridor');
 assert.ok(c.roads.some(r=>r.phase==='through-route connection'),'through routes connect to the urban skeleton');
});


test('Metro shares the dated plan with Streets without realizing local streets or roofs',()=>{
 const f=fixture({population:35000});
 const metro=generateCity(f.world,f.history,f.frame,0,{detail:'metro'}),streets=cityFor(f);
 assert.equal(metro.detailLevel,'metro');assert.equal(streets.detailLevel,'streets');
 assert.deepEqual(metro.blocks,streets.blocks);assert.deepEqual(metro.districts,streets.districts);assert.deepEqual(metro.bounds,streets.bounds);
 assert.equal(metro.areaKm2,streets.areaKm2);assert.deepEqual(metro.buildings,[]);
 assert.ok(metro.roads.every(r=>r.kind!=='local'));
 const principal=c=>c.roads.filter(r=>r.kind!=='local');
 assert.deepEqual(principal(metro),principal(streets));
 assert.equal(metro.development.localStreetCount,0);assert.ok(streets.development.localStreetCount>0);
 // Shared objects demonstrate plan reuse, independent of requesting order.
 assert.equal(metro.blocks,streets.blocks);
 const reverse=structuredClone(f),fine=cityFor(reverse),broad=generateCity(reverse.world,reverse.history,reverse.frame,0,{detail:'metro'});
 assert.deepEqual(broad,metro);assert.deepEqual(fine,streets);
});

test('dated founding lanes survive expansion with unchanged geometry and provenance',()=>{
 for(const river of [false,true]){
 const f=fixture({population:1800,river}),early=structuredClone(f.frame);early.generation=2;early.year=50;
 const later=structuredClone(early);later.generation=14;later.year=350;later.siteStates[0].population=45000;later.siteStates[0].urbanAreaKm2=45000/4400;
 f.history.snapshots=[early,later];
 const old=generateCity(f.world,f.history,early,0),expanded=generateCity(f.world,f.history,later,0);
 const paths=old.roads.filter(r=>r.kind==='local'&&r.provenance?.kind==='retained local path');
 assert.ok(paths.length>=4,'retain a meaningful founding network');
 for(const path of paths){
  const retained=expanded.roads.find(r=>r.provenance?.pathId===path.provenance.pathId);
  assert.ok(retained);assert.deepEqual(retained.points,path.points);assert.deepEqual(retained.provenance,path.provenance);
  assert.equal(path.provenance.sourceGeneration,2);assert.equal(path.provenance.sourceYear,50);
 }
 const reverse=structuredClone(f);assert.deepEqual(generateCity(reverse.world,reverse.history,later,0),expanded);
 }
});

test('planned adjacent districts use a shared survey direction',()=>{
 const c=cityFor(fixture({population:420000})),planned=c.development.patterns.filter(p=>['planned expansion','industrial access'].includes(p.phase));
 assert.ok(planned.length>=4);assert.ok(planned.every(p=>p.surveyId==='founding-survey'));
 assert.equal(new Set(planned.map(p=>p.angleRadians)).size,1);assert.equal(planned[0].angleRadians,0);assert.equal(planned[0].surveySource,'cardinal survey');
 const aligned=c.roads.filter(r=>r.kind==='local'&&r.phase==='planned expansion');
 assert.ok(aligned.length>10);
});

test('dated road widths are honored and road access changes growth beyond its initial bearing',()=>{
 const f=fixture({population:220000}),node=f.history.sites[0].nodeId;
 // Keep the first approach (hence orientation) unchanged; a second bent road
 // should pull occupied cells into its actual corridor.
 f.history.routes=[{id:1,a:0,b:1,nodes:[node,node+1,node+2],founded:1,kind:'land'}];
 f.frame.routeStates=[{routeId:1,active:true,roadClass:'trail',widthKm:.012}];
 const before=generateCity(f.world,f.history,f.frame,0,{detail:'metro'});
 assert.equal(before.roads.find(r=>r.sourceRouteId===1).widthKm,.012);
 f.history.routes.push({id:2,a:0,b:2,nodes:[node,node-25,node-50,node-49,node-48],founded:2,kind:'land'});
 f.frame.routeStates.push({routeId:2,active:true,roadClass:'arterial',widthKm:.026});
 const after=generateCity(f.world,f.history,f.frame,0,{detail:'metro'});
 assert.equal(after.orientationRadians,before.orientationRadians);assert.notDeepEqual(after.blocks,before.blocks);
 assert.equal(after.roads.find(r=>r.sourceRouteId===2).widthKm,.026);
 const route=f.history.routes[1].nodes.map(i=>({x:f.world.mesh.x[i],z:f.world.mesh.z[i]}));
 const accessibleArea=city=>city.blocks.filter(b=>route.slice(1).some((p,i)=>segmentDistance(b.center,route[i],p)<.6)).reduce((sum,b)=>sum+b.areaKm2,0);
 assert.ok(accessibleArea(after)>accessibleArea(before),'new occupied area favors the actual bent corridor');
});


test('dated plan reuse is bounded and eviction preserves deterministic geometry',()=>{
 const f=fixture({population:180}),first=generateCity(f.world,f.history,f.frame,0,{detail:'metro'});
 assert.equal(generateCity(f.world,f.history,f.frame,0,{detail:'metro'}),first);
 for(let i=1;i<=8;i++){const frame={...f.frame,generation:24+i,year:2025+25*i};generateCity(f.world,f.history,frame,0,{detail:'metro'});}
 const replay=generateCity(f.world,f.history,f.frame,0,{detail:'metro'});
 assert.notEqual(replay,first);assert.deepEqual(replay,first);
});

// A cached Metro must refine its original dated inputs even if callers later
// mutate objects and request the original date through equivalent fresh data.
test('cached Metro refinement isolates dated route, frame and site inputs',()=>{
 for(const mutation of ['frame','route and site']){
  const f=fixture({population:35000}),node=f.history.sites[0].nodeId;
  f.history.routes=[{id:1,a:0,b:1,nodes:[node,node+1,node+2],founded:1,kind:'land'}];
  f.frame.routeStates=[{routeId:1,active:true,roadClass:'trail',widthKm:.012}];
  const original=structuredClone({history:f.history,frame:f.frame}),metro=generateCity(f.world,f.history,f.frame,0,{detail:'metro'});
  if(mutation==='frame')Object.assign(f.frame.routeStates[0],{roadClass:'arterial',widthKm:.026});
  else{
   f.history.routes[0].nodes[1]=node+25;f.history.sites[0].founded=20;
   f.history.routes=original.history.routes;f.history.sites=original.history.sites;
  }
  const streets=generateCity(f.world,f.history,original.frame,0,{detail:'streets'});
  assert.equal(streets.blocks,metro.blocks,'the equivalent original date reuses its land plan');
  assert.deepEqual(streets.roads.filter(r=>r.kind!=='local'),metro.roads,mutation);
  assert.equal(streets.roads.find(r=>r.sourceRouteId===1).widthKm,.012);
 }
});

test('changing an early source era invalidates fallback historical lane geometry',()=>{
 const f=fixture({population:35000}),early=structuredClone(f.frame);
 early.generation=2;early.year=50;early.era='agrarian';early.siteStates[0].population=1800;
 delete early.siteStates[0].urbanAreaKm2;delete early.siteStates[0].densityPerKm2;
 f.history.snapshots=[early,f.frame];
 const before=cityFor(f),historic=c=>c.roads.filter(r=>r.provenance?.kind==='retained local path').map(r=>r.points);
 assert.ok(historic(before).length>=4);
 early.era='modern';const after=cityFor(f);
 assert.notDeepEqual(historic(after),historic(before),'the source-era fallback changes the retained lane radius');
 const fresh=structuredClone(f);assert.deepEqual(after,cityFor(fresh),'cached generation agrees with fresh generation');
});
