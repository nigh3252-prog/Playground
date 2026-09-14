import test from 'node:test';
import assert from 'node:assert/strict';
import {createTerrainMesh} from '../assets/world-lab/world-mesh.mjs';
import {windowAround,createInheritedWindow} from '../assets/world-lab/inherited-window.mjs';
import {createRefinementContext,sampleRefinement,createRefinedWindow} from '../assets/world-lab/terrain-refinement.mjs';

function fixture(seed=71){
 const mesh=createTerrainMesh(17,32,seed),N=mesh.x.length,height=Float32Array.from(mesh.x,(x,i)=>220+14*x+2*mesh.z[i]+10*Math.sin(mesh.z[i]*.31));
 const river=new Uint8Array(N),receiver=new Int32Array(N).fill(-1),area=new Float64Array(N).fill(1),ocean=new Uint8Array(N),lake=new Uint8Array(N);
 const from=8*17+9;
 let to=-1;for(let k=mesh.offsets[from];k<mesh.offsets[from+1];k++){const j=mesh.neighbors[k];if(to<0||height[j]<height[to])to=j;}
 receiver[from]=to;river[from]=1;area[from]=3200;area[to]=5400;
 const w={version:'refinement-fixture',stage:4,config:{seed,sizeKm:32},mesh,n:17,stepKm:2,parentDomain:{sizeKm:32,windowKm:12},height,ocean,lake,river,receiver,area,waterSurface:height.slice(),rainfall:new Float32Array(N).fill(900)};
 return {w,from,to,point:{x:(mesh.x[from]+mesh.x[to])/2,z:(mesh.z[from]+mesh.z[to])/2}};
}
const close=(a,b,tol=.001)=>assert.ok(Math.abs(a-b)<tol,`${a} != ${b}`);

test('refinement adds nonplanar landforms while preserving exact parent provenance and river identity',()=>{
 const {w,point,from,to}=fixture(),box=windowAround(32,point.x,point.z,1.2),before={height:w.height.slice(),receiver:w.receiver.slice(),area:w.area.slice()};
 const plain=createInheritedWindow(w,box),d=createRefinedWindow(w,box,{n:65});
 assert.equal(d.version,'watershed-refined-window-v1');assert.ok(d.mesh.x.length>plain.mesh.x.length*10);
 assert.ok(d.refinement.maxAbsDeltaM>1,'not just subdividing the old planes');
 assert.ok(d.rivers.some(e=>e.from===from&&e.to===to&&e.upstreamAreaKm2===w.area[from]));
 assert.deepEqual(d.rivers,plain.rivers,'the actual parent centerlines must not move');
 for(let i=0;i<d.heightM.length;i++){
  close(d.baseHeightM[i],d.sourceWeights[i].reduce((v,[id,a])=>v+w.height[id]*a,0));
  close(d.heightM[i],d.baseHeightM[i]+d.detailM[i]);
  assert.ok(Number.isFinite(d.heightM[i])&&Number.isFinite(d.surfaceM[i]));
 }
 for(const k of Object.keys(before))assert.deepEqual(w[k],before[k]);
});

test('overlapping windows and different render resolutions sample the same world-coordinate field',()=>{
 const {w,point}=fixture(),ctx=createRefinementContext(w),a=windowAround(32,point.x,point.z,1.2),b={...a,x:a.x+.3};
 const first=createRefinedWindow(w,a,{n:33}),second=createRefinedWindow(w,b,{n:65});
 let shared=0;const values=new Map();
 for(let i=0;i<first.mesh.x.length;i++){const x=first.window.x+first.mesh.x[i],z=first.window.z+first.mesh.z[i];values.set(x.toFixed(7)+','+z.toFixed(7),first.heightM[i]);}
 for(let i=0;i<second.mesh.x.length;i++){
  const x=second.window.x+second.mesh.x[i],z=second.window.z+second.mesh.z[i],key=x.toFixed(7)+','+z.toFixed(7);
  close(second.heightM[i],sampleRefinement(ctx,x,z).heightM);
  if(values.has(key)){close(values.get(key),second.heightM[i]);shared++;}
 }
 assert.ok(shared>200);assert.deepEqual(first.heightM,createRefinedWindow(w,a,{n:33}).heightM);
});

test('retained lake and ocean surfaces are not turned into procedural hills',()=>{
 const {w}=fixture();w.lake.fill(1);w.waterSurface.fill(1000);
 const d=createRefinedWindow(w,{x:5,z:5,size:1.2},{n:33});
 for(let i=0;i<d.heightM.length;i++){close(d.baseHeightM[i],d.heightM[i]);close(d.surfaceM[i],1000);}
 const {w:o}=fixture();o.ocean.fill(1);o.height.fill(-40);
 const sea=createRefinedWindow(o,{x:5,z:5,size:1.2},{n:33});
 for(let i=0;i<sea.heightM.length;i++){close(sea.heightM[i],-40);close(sea.surfaceM[i],0);}
});

test('refinement pins nonwater parent samples and supplies downhill profiles for modeled channels',()=>{
 const {w,point}=fixture(),ctx=createRefinementContext(w);
 for(const id of [3*17+3,12*17+12,4*17+12])close(sampleRefinement(ctx,w.mesh.x[id],w.mesh.z[id]).heightM,w.height[id]);
 const d=createRefinedWindow(w,windowAround(32,point.x,point.z,1.2),{n:65});
 assert.ok(d.refinement.channelCount>0);assert.ok(d.waterDepthM.some(v=>v>.2));
 assert.ok(d.channels.every(e=>e.levelsM[0]>=e.levelsM[1]));
 assert.ok(d.gullies.every(g=>g.points.every((p,i)=>!i||p[2]>=g.points[i-1][2])));
});

test('rejects invalid dimensions and reports uphill inherited river reaches instead of rerouting them',()=>{
 const {w,from,to,point}=fixture();
 assert.throws(()=>createRefinedWindow(w,{x:2,z:2,size:1.2},{n:900}),/resolution/i);
 assert.throws(()=>createRefinementContext({}),/parent/i);
 w.waterSurface[from]=w.height[to]-10;
 const d=createRefinedWindow(w,windowAround(32,point.x,point.z,1.2),{n:33});
 assert.equal(w.receiver[from],to);assert.ok(d.refinement.unresolvedReachCount>0);
 assert.ok(d.warnings.some(s=>/uphill|unresolved/i.test(s)));
});

test('fine channels bend inside their inherited corridor with pinned junctions, not grid-snapped routing',()=>{
 const {w,point}=fixture(),d=createRefinedWindow(w,windowAround(32,point.x,point.z,1.2),{n:33}),c=d.channels[0];
 assert.ok(c.points.length>5,'genuine fine geometry is exported');
 assert.deepEqual(c.points[0],c.parentPoints[0]);assert.deepEqual(c.points.at(-1),c.parentPoints[1]);
 const [[ax,az],[bx,bz]]=c.parentPoints,dx=bx-ax,dz=bz-az,len=Math.hypot(dx,dz);
 const distances=c.points.map(([x,z])=>Math.abs((x-ax)*dz-(z-az)*dx)/len);
 assert.ok(Math.max(...distances)>.001&&Math.max(...distances)<.1);
 assert.ok(d.incisionM.some(v=>v>.25),'dry gullies actually change the surface');
 assert.ok(d.gullies.length>0);
});

test('channel beds remain below their inherited downhill water profile, including pinned parent junctions',()=>{
 const {w,point}=fixture(),ctx=createRefinementContext(w),d=createRefinedWindow(w,windowAround(32,point.x,point.z,1.2),{n:33}),c=d.channels[0];
 for(let j=0;j<c.points.length;j+=Math.max(1,Math.floor(c.points.length/17))){const [x,z]=c.points[j],s=sampleRefinement(ctx,x,z),t=j/(c.points.length-1),level=c.levelsM[0]*(1-t)+c.levelsM[1]*t;close(s.surfaceM,level);assert.ok(s.waterDepthM>.2,'a preserved channel cannot be blocked by an added hill or node pin');}
});

test('dry gullies stop at crests instead of curling into self-intersecting loops',()=>{
 const {w,point}=fixture();const d=createRefinedWindow(w,windowAround(32,point.x,point.z,12),{n:33});
 const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
 for(const g of d.gullies)for(let i=1;i<g.points.length;i++)for(let j=1;j<i-2;j++){
  const a=g.points[i-1],b=g.points[i],c=g.points[j-1],e=g.points[j];
  assert.ok(!(cross(a,b,c)*cross(a,b,e)<0&&cross(c,e,a)*cross(c,e,b)<0),`self-intersection: ${g.id}`);
 }
});

test('continuous riverbank outlines are inherited, not reconstructed from the display raster',()=>{
 const {w,point}=fixture(),a=createRefinedWindow(w,windowAround(32,point.x,point.z,1.2),{n:33}),b=createRefinedWindow(w,windowAround(32,point.x+.3,point.z,.41),{n:65});
 const c=a.channels[0];assert.ok(c.leftBank?.length>5&&c.rightBank?.length>5);
 assert.deepEqual(c.leftBank,b.channels.find(r=>r.from===c.from).leftBank);
 for(let i=0;i<c.points.length;i++){const p=c.points[i],l=c.leftBank[i],r=c.rightBank[i];assert.ok(Math.hypot(l[0]-r[0],l[1]-r[1])>.006);close((l[0]+r[0])/2,p[0],1e-7);close((l[1]+r[1])/2,p[1],1e-7);}
 assert.ok(a.ambient.every(v=>v>=.7&&v<=1));
});
