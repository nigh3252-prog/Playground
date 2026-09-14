/** Fine terrain on the actual parent surface. No local world or water solver.
 * All construction keys are parent IDs / WORLD coordinates, never crop IDs.
 * Channel cross-sections and dry erosion gullies are procedural morphology,
 * not a calibrated hydraulic simulation. The original river graph is retained.
 */
import {indexMesh,locateTriangle} from './world-mesh.mjs';
import {createInheritedWindow,normalizeWindow} from './inherited-window.mjs';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const ease=t=>{t=clamp(t,0,1);return t*t*(3-2*t);};
const mix=(a,b,t)=>a+(b-a)*t;
const contexts=new WeakMap();
const REACH_CELL=4,GULLY_CELL=.12,REACH_MARGIN=1.35;
function hash(a,b,s){let h=(Math.imul(a,0x1f123bb5)^Math.imul(b,0x5f356495)^s)>>>0;h^=h>>>16;h=Math.imul(h,0x7feb352d);h^=h>>>15;h=Math.imul(h,0x846ca68b);return((h^(h>>>16))>>>0)/4294967296;}
function noise(x,z,seed){const a=Math.floor(x),b=Math.floor(z),u=ease(x-a),v=ease(z-b);return 2*mix(mix(hash(a,b,seed),hash(a+1,b,seed),u),mix(hash(a,b+1,seed),hash(a+1,b+1,seed),u),v)-1;}
function segmentsCross(a,b,c,d){const cross=(p,q,r)=>(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]);return cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0;}
function length2(x,z){const d=Math.hypot(x,z)||1;return[x/d,z/d];}
function binsPut(index,item,ax,az,bx,bz,pad,cell){
 for(let z=Math.floor((Math.min(az,bz)-pad)/cell);z<=Math.floor((Math.max(az,bz)+pad)/cell);z++)
  for(let x=Math.floor((Math.min(ax,bx)-pad)/cell);x<=Math.floor((Math.max(ax,bx)+pad)/cell);x++){
   const key=x+','+z;if(!index.has(key))index.set(key,[]);index.get(key).push(item);
  }
}
const binAt=(index,x,z,cell)=>index.get(Math.floor(x/cell)+','+Math.floor(z/cell))||[];
function segmentPoint(ax,az,bx,bz,x,z){const dx=bx-ax,dz=bz-az,t=clamp(((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz||1),0,1);return{t,x:ax+dx*t,z:az+dz*t,d:Math.hypot(x-ax-dx*t,z-az-dz*t)};}
function intersects(bounds,box,pad=0){return bounds.maxX+pad>=box.x&&bounds.minX-pad<=box.x+box.size&&bounds.maxZ+pad>=box.z&&bounds.minZ-pad<=box.z+box.size;}
const boundsFor=points=>({minX:Math.min(...points.map(p=>p[0])),maxX:Math.max(...points.map(p=>p[0])),minZ:Math.min(...points.map(p=>p[1])),maxZ:Math.max(...points.map(p=>p[1]))});

export function createRefinementContext(world){
 if(!world?.mesh?.triangles||!world.config||!world.height||world.height.length!==world.mesh.x.length||!world.ocean)throw new TypeError('Expected a physical parent world');
 if(contexts.has(world))return contexts.get(world);
 const {mesh,height}=world,N=height.length,grade=new Float32Array(N),weights=new Float64Array(N);
 // Continuous nodal relief density, derived from ALL actual adjacent faces.
 for(let k=0;k<mesh.triangles.length;k+=3){
  const [a,b,c]=mesh.triangles.subarray(k,k+3),dx=mesh.x[b]-mesh.x[a],dz=mesh.z[b]-mesh.z[a],ex=mesh.x[c]-mesh.x[a],ez=mesh.z[c]-mesh.z[a],den=dx*ez-dz*ex;
  if(den<=0)continue;
  const gx=((height[b]-height[a])*ez-(height[c]-height[a])*dz)/den/1000,gz=(dx*(height[c]-height[a])-ex*(height[b]-height[a]))/den/1000,g=Math.hypot(gx,gz);
  for(const id of [a,b,c]){grade[id]+=g*den;weights[id]+=den;}
 }
 for(let i=0;i<N;i++)grade[i]/=weights[i]||1;
 const ctx={world,index:indexMesh(mesh),seed:Number(world.config.seed)>>>0,grade,reaches:[],reachBins:new Map(),gullyBins:new Map(),gullies:[],built:new Set(),unresolved:[]};
 if(world.river&&world.receiver)for(let from=0;from<N;from++){
  const to=world.receiver[from];if(!world.river[from]||to<0||to>=N||world.ocean[from]||world.lake?.[from]&&world.lake?.[to])continue;
  const points=[[mesh.x[from],mesh.z[from]],[mesh.x[to],mesh.z[to]]],bounds=boundsFor(points);
  const h0=world.waterSurface?.[from]??height[from],h1=world.waterSurface?.[to]??height[to];
  // Do not disguise existing coarse uphill reaches with a new local routing.
  if(!Number.isFinite(h0)||!Number.isFinite(h1)||h1>h0+.001){ctx.unresolved.push({from,to,bounds});continue;}
  const r={from,to,points,levelsM:[h0,Math.min(h0,h1)],area0:Math.max(1,world.area?.[from]||1),area1:Math.max(1,world.area?.[to]||world.area?.[from]||1),bounds};
  r.lengthKm=Math.hypot(points[1][0]-points[0][0],points[1][1]-points[0][1]);if(r.lengthKm<1e-8)continue;
  ctx.reaches.push(r);binsPut(ctx.reachBins,r,...points[0],...points[1],REACH_MARGIN,REACH_CELL);
 }
 contexts.set(world,ctx);return ctx;
}

function baseAt(ctx,x,z){
 const w=ctx.world,q=locateTriangle(ctx.index,x,z);if(!q)return null;
 const sw=[[q.a,q.wa],[q.b,q.wb],[q.c,q.wc]].filter(([,v])=>v>1e-12),at=field=>sw.reduce((s,[id,a])=>s+(field?.[id]||0)*a,0);
 const baseHeightM=at(w.height),oceanWeight=at(w.ocean),lakeWeight=w.stage>=2?at(w.lake):0,waterWeight=Math.max(oceanWeight,lakeWeight);
 const dry=ease(1-waterWeight*2),pin=ease((1-Math.max(q.wa,q.wb,q.wc))/.025),g=at(ctx.grade),amplitudeM=clamp(8+g*2400,8,75);
 // Domain-warped residual wavelengths in kilometers; never tied to the viewport.
 const wx=x+.22*noise(x/.93,z/.93,ctx.seed^191),wz=z+.22*noise(x/.93+17,z/.93,ctx.seed^733);
 const u=wx*.819152-wz*.573576,v=wx*.573576+wz*.819152;
 const residual=.52*noise(u/1.5,v/1.5,ctx.seed^19)+.29*noise(u/.52,v/.52,ctx.seed^821)+.14*noise(u/.18,v/.18,ctx.seed^917)+.05*noise(u/.06,v/.06,ctx.seed^1723);
 const detail=amplitudeM*residual*pin*dry;
 const sourceSurface=sw.reduce((s,[id,a])=>s+a*(w.ocean[id]?0:w.stage>=2?(w.waterSurface?.[id]??w.filled?.[id]??w.height[id]):w.height[id]),0);
 return {sourceWeights:sw,baseHeightM,heightM:baseHeightM+detail,surfaceM:sourceSurface,oceanWeight,lakeWeight,dry,pin,amplitudeM,grade:g};
}
function section(r,t,seed){
 const area=mix(r.area0,r.area1,t),width=clamp(5+Math.sqrt(area)*.62,6,180),phase=hash(r.from,r.to,seed)*Math.PI*2;
 const variation=1+.16*Math.sin(t*r.lengthKm*9+phase)*Math.sin(Math.PI*t);
 const half=width*variation/2000,offset=half*.8*Math.sin(t*r.lengthKm*7+phase)*Math.sin(Math.PI*t);
 return {half,offset,depth:clamp(1+Math.log1p(area/1000)*.45,1,4.5),level:mix(...r.levelsM,t)};
}
function channelCenter(r,t,seed){
 const [a,b]=r.points,s=section(r,t,seed),[tx,tz]=length2(b[0]-a[0],b[1]-a[1]);
 if(t===0)return [...a];if(t===1)return [...b];
 return [mix(a[0],b[0],t)-tz*s.offset,mix(a[1],b[1],t)+tx*s.offset];
}
function ungullied(ctx,x,z){
 const b=baseAt(ctx,x,z);if(!b)return null;
 let h=b.heightM,waterLevel=null,bank=0,channelProtection=1;
 if(b.dry>0)for(const r of binAt(ctx.reachBins,x,z,REACH_CELL)){
  const p=segmentPoint(...r.points[0],...r.points[1],x,z),s=section(r,p.t,ctx.seed),center=channelCenter(r,p.t,ctx.seed);p.d=Math.hypot(x-center[0],z-center[1]);const flood=s.half+.025+s.half*.8,outer=Math.min(.85,Math.max(flood*2.4,.13+b.amplitudeM*.007));
  if(p.d>outer)continue;
  const target=p.d<=s.half?s.level-s.depth*(1-(p.d/s.half)**3):s.level+.7+(p.d-s.half)*18;
  const influence=1-ease((p.d-flood)/(outer-flood)),candidate=b.heightM+clamp(target-b.heightM,-30-b.amplitudeM*1.7,30+b.amplitudeM)*influence*b.dry*(p.d<=s.half?1:b.pin);
  h=Math.min(h,candidate);
  // A narrow channel may need a raised opposite bank on a tilted coarse face.
  if(p.d<flood)h=mix(h,candidate,(1-ease((p.d-s.half)/(flood-s.half)))*b.dry);
  bank=Math.max(bank,influence);channelProtection=Math.min(channelProtection,ease((p.d-s.half)/(s.half+.012)));
  if(p.d<=s.half&&b.dry>.98)waterLevel=waterLevel===null?s.level:Math.min(waterLevel,s.level);
 }
 if(Math.max(b.oceanWeight,b.lakeWeight)>=.5)return {...b,heightM:b.baseHeightM,surfaceM:b.surfaceM,waterDepthM:Math.max(0,b.surfaceM-b.baseHeightM),bank:0,water:true,channelProtection:0};
 return {...b,heightM:h,surfaceM:waterLevel===null?h:Math.max(h,waterLevel),waterDepthM:waterLevel===null?0:Math.max(0,waterLevel-h),bank,water:waterLevel!==null,channelProtection};
}

function storeGully(ctx,g){
 if(g.points.length<5)return;
 g.bounds=boundsFor(g.points);ctx.gullies.push(g);
 for(let i=1;i<g.points.length;i++){
  const a=g.points[i-1],b=g.points[i],radius=Math.max(a[3],b[3]);
  binsPut(ctx.gullyBins,{g,a,b},a[0],a[1],b[0],b[1],radius,GULLY_CELL);
 }
}
function traceUphill(ctx,r,key,start,direction,maxLength,level){
 let [x,z]=start,[dx,dz]=direction;const points=[[x,z,level,.012]],step=.025,steps=Math.round(maxLength/step),phase=hash(r.from,key,ctx.seed)*Math.PI*2;
 let bed=level;
 for(let i=1;i<=steps;i++){
  const here=ungullied(ctx,x,z);if(!here||here.dry<.95)break;
  if(i>2){
   const e=.012,a=ungullied(ctx,x+e,z),b=ungullied(ctx,x-e,z),c=ungullied(ctx,x,z+e),d=ungullied(ctx,x,z-e);if(!a||!b||!c||!d)break;
   const [gx,gz]=length2(a.heightM-b.heightM,c.heightM-d.heightM),bend=Math.sin(i*.22+phase)*.16;
   [dx,dz]=length2(dx*.7+gx*.3-dz*bend,dz*.7+gz*.3+dx*bend);
  }
  const nx=x+dx*step,nz=z+dz*step,next=ungullied(ctx,nx,nz);if(!next||next.dry<.95)break;
  // End at a crest or before revisiting the path; a gully is not a looping trail.
  if(i>3&&next.heightM<=here.heightM+.002)break;
  if(points.slice(0,-3).some((p,j)=>Math.hypot(nx-p[0],nz-p[1])<step*.8||j>0&&segmentsCross([x,z],[nx,nz],points[j-1],p)))break;
  const remaining=Math.min(1,(steps-i)/5),depth=clamp(1.5+next.amplitudeM*.17,1.5,9)*remaining;
  const nextBed=Math.max(bed+.008,next.heightM-depth);
  if(nextBed>next.heightM+.001)break;
  x=nx;z=nz;bed=nextBed;
  points.push([x,z,bed,(.012+next.amplitudeM*.00065)*(.4+.6*Math.sqrt(1-i/(steps+1)))]);
 }
 return {id:`${r.from}:${key}`,parentFrom:r.from,parentTo:r.to,kind:'dry-erosion-gully',points};
}
function buildGullies(ctx,r){
 if(ctx.built.has(r.from))return;ctx.built.add(r.from);
 const [a,b]=r.points,[tx,tz]=length2(b[0]-a[0],b[1]-a[1]),pitch=.72,offset=.25+hash(r.from,r.to,ctx.seed)*.4;
 // A reach's branch positions are fixed for its entire length, even off screen.
 for(let distance=offset,ordinal=0;distance<r.lengthKm-.1;distance+=pitch,ordinal++){
  const t=distance/r.lengthKm,[x,z]=channelCenter(r,t,ctx.seed),s=section(r,t,ctx.seed);
  for(const side of [-1,1]){
   const key=ordinal*4+(side+1),dir=length2(-tz*side+tx*.15,tx*side+tz*.15),start=[x+dir[0]*(s.half+.018),z+dir[1]*(s.half+.018)],at=ungullied(ctx,...start);
   if(!at||at.dry<.95)continue;
   const primary=traceUphill(ctx,r,key,start,dir,.45+hash(r.from,key,ctx.seed^17)*.34,s.level+.08);
   if(primary.points.length<5)continue;
   primary.points.unshift([x,z,s.level-.2,.014]);storeGully(ctx,primary);
   if(primary.points.length>14){
    const j=Math.floor(primary.points.length*.57),p=primary.points[j],prev=primary.points[j-1],[ux,uz]=length2(p[0]-prev[0],p[1]-prev[1]),turn=hash(r.from,key,ctx.seed^713)>.5?1:-1;
    const fork=traceUphill(ctx,r,key+1,[p[0],p[1]],length2(ux*.6-uz*.8*turn,uz*.6+ux*.8*turn),.22,p[2]);fork.parentGully=primary.id;storeGully(ctx,fork);
   }
  }
 }
}
function prepareAt(ctx,x,z){for(const r of binAt(ctx.reachBins,x,z,REACH_CELL))if(segmentPoint(...r.points[0],...r.points[1],x,z).d<REACH_MARGIN)buildGullies(ctx,r);}

export function sampleRefinement(context,xKm,zKm){
 const ctx=context;if(!ctx?.world||![xKm,zKm].every(Number.isFinite))throw new TypeError('Invalid refinement context or coordinates');
 const b=ungullied(ctx,xKm,zKm);if(!b)throw new RangeError('Refinement coordinates outside parent');
 if(b.dry>0&&b.channelProtection>0){
  prepareAt(ctx,xKm,zKm);let eroded=b.heightM;
  for(const s of binAt(ctx.gullyBins,xKm,zKm,GULLY_CELL)){
   const p=segmentPoint(s.a[0],s.a[1],s.b[0],s.b[1],xKm,zKm),radius=mix(s.a[3],s.b[3],p.t);if(p.d>=radius)continue;
   const bed=mix(s.a[2],s.b[2],p.t),influence=(1-ease(p.d/radius))*b.channelProtection*b.dry*b.pin;
   eroded=Math.min(eroded,b.heightM-Math.max(0,b.heightM-bed)*influence);
  }
  b.incisionM=b.heightM-eroded;b.heightM=eroded;if(!b.water)b.surfaceM=eroded;
 }else b.incisionM=0;
 return {...b,detailM:b.heightM-b.baseHeightM};
}

export function createRefinedWindow(world,requested,{n=161}={}){
 if(!Number.isInteger(n)||n<17||n>225)throw new RangeError('Refinement resolution must be an integer from 17 to 225');
 const ctx=createRefinementContext(world),box=normalizeWindow(world.config.sizeKm,requested),inherited=createInheritedWindow(world,box);
 // Prepare a fixed physical halo. Gully construction never sees these bounds.
 for(const r of ctx.reaches)if(intersects(r.bounds,box,REACH_MARGIN))buildGullies(ctx,r);
 const count=n*n,x=new Float64Array(count),z=new Float64Array(count),triangles=new Uint32Array((n-1)*(n-1)*6),sourceWeights=[],sourceIds=new Int32Array(count);
 const names=['heightM','baseHeightM','surfaceM','detailM','waterDepthM','incisionM','oceanWeight','lakeWeight','bank'],fields=Object.fromEntries(names.map(k=>[k,new Float32Array(count)])),slope=new Float32Array(count),ambient=new Float32Array(count).fill(1),waterMask=new Uint8Array(count),step=box.size/(n-1);
 let lo=Infinity,hi=-Infinity,maxAbsDeltaM=0,sumDelta=0,k=0;
 for(let row=0;row<n;row++)for(let col=0;col<n;col++){
  const i=row*n+col,px=col*step,pz=row*step,s=sampleRefinement(ctx,box.x+px,box.z+pz);x[i]=px;z[i]=pz;
  sourceWeights.push(s.sourceWeights);sourceIds[i]=s.sourceWeights.reduce((a,b)=>a[1]>b[1]?a:b)[0];for(const key of names)fields[key][i]=s[key];waterMask[i]=s.water?1:0;
  lo=Math.min(lo,s.heightM);hi=Math.max(hi,s.heightM);maxAbsDeltaM=Math.max(maxAbsDeltaM,Math.abs(s.detailM));sumDelta+=s.detailM*s.detailM;
  if(row<n-1&&col<n-1){const a=i,b=i+1,c=i+n,d=c+1;triangles.set([a,b,c,b,d,c],k);k+=6;}
 }
 for(let row=0;row<n;row++)for(let col=0;col<n;col++){
  const i=row*n+col,l=Math.max(0,col-1),r=Math.min(n-1,col+1),u=Math.max(0,row-1),d=Math.min(n-1,row+1);
  slope[i]=Math.hypot((fields.heightM[row*n+r]-fields.heightM[row*n+l])/((r-l)*step*1000),(fields.heightM[d*n+col]-fields.heightM[u*n+col])/((d-u)*step*1000));
 }
 // Local concavity shading makes shallow cuts readable without exaggerating height.
 const radius=Math.max(1,Math.round(.04/step));
 for(let row=radius;row<n-radius;row++)for(let col=radius;col<n-radius;col++){
  const i=row*n+col;let sum=0;
  for(const [dx,dz] of [[radius,0],[0,radius],[radius,radius],[radius,-radius]])sum+=(fields.heightM[(row+dz)*n+col+dx]+fields.heightM[(row-dz)*n+col-dx])*.5;
  ambient[i]=clamp(1-Math.max(0,sum/4-fields.heightM[i])*.045,.72,1);
 }
 const channels=ctx.reaches.filter(r=>intersects(r.bounds,box,.85)).map(r=>{
  const count=Math.max(2,Math.ceil(r.lengthKm/.025)),points=[],leftBank=[],rightBank=[],[a,b]=r.points,[tx,tz]=length2(b[0]-a[0],b[1]-a[1]);
  for(let i=0;i<=count;i++){const t=i/count,p=channelCenter(r,t,ctx.seed),s=section(r,t,ctx.seed);points.push(p);leftBank.push([p[0]-tz*s.half,p[1]+tx*s.half]);rightBank.push([p[0]+tz*s.half,p[1]-tx*s.half]);}
  return{from:r.from,to:r.to,parentPoints:r.points,points,leftBank,rightBank,levelsM:r.levelsM,upstreamAreaKm2:r.area0};
 });
 const gullies=ctx.gullies.filter(g=>intersects(g.bounds,box,.06)),unresolved=ctx.unresolved.filter(r=>intersects(r.bounds,box));
 const warnings=['Fine landforms are synthesized inside the inherited terrain; they are not measured local elevation.','Parent river anchors and upstream supply are inherited. Fine bends stay inside the channel corridor; widths, depths and dry gullies are modeled, not calibrated hydrology.'];
 if(unresolved.length)warnings.push(`${unresolved.length} unresolved uphill parent reach(es): inherited identity retained; no invented local water profile.`);
 return {...inherited,version:'watershed-refined-window-v1',mesh:{n,sizeKm:box.size,stepKm:step,x,z,triangles},...fields,slope,ambient,waterMask,sourceWeights,sourceIds,channels,gullies,
  refinement:{version:'parent-constrained-morphology-v1',coordinateSystem:'parent-world-km',spacingM:step*1000,maxAbsDeltaM,rmsDeltaM:Math.sqrt(sumDelta/count),channelCount:channels.length,gullyCount:gullies.length,unresolvedReachCount:unresolved.length},
  metrics:{minElevationM:lo,maxElevationM:hi,reliefM:hi-lo,displayTriangles:triangles.length/3},warnings,
  note:'baseHeightM and sourceWeights retain the original parent triangles. detailM is the synthesized difference. The parent solver, heights, receiver graph and parent river anchors are unchanged.'};
}
