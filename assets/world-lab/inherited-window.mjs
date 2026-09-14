/** A smaller view of the SAME physical parent. This module never generates
 * heights or routes water. Clipping weights and river identities are retained
 * so later refinement has explicit, testable constraints to build upon. */
import {clipMesh,interpolateClip} from './window-geometry.mjs';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function normalizeWindow(domainSizeKm,box){
 if(!Number.isFinite(domainSizeKm)||domainSizeKm<=0||!box||![box.x,box.z,box.size].every(Number.isFinite)||box.size<=0)throw new TypeError('Invalid window: coordinates and positive width must be finite');
 const size=clamp(box.size,Math.min(.41,domainSizeKm),domainSizeKm);
 return {x:clamp(box.x,0,domainSizeKm-size),z:clamp(box.z,0,domainSizeKm-size),size};
}
export function windowAround(domainSizeKm,x,z,size){
 if(![x,z,size].every(Number.isFinite)||size<=0)throw new TypeError('Invalid window: center and width must be finite');
 const width=clamp(size,Math.min(.41,domainSizeKm),domainSizeKm);
 return normalizeWindow(domainSizeKm,{x:x-width/2,z:z-width/2,size:width});
}

// Liang–Barsky clipping preserves the original segment direction. In particular,
// include a river whose endpoints are BOTH outside a small window.
function segmentInBox(ax,az,bx,bz,box){
 const dx=bx-ax,dz=bz-az,p=[-dx,dx,-dz,dz],q=[ax-box.x,box.x+box.size-ax,az-box.z,box.z+box.size-az];let t0=0,t1=1;
 for(let i=0;i<4;i++){
  if(Math.abs(p[i])<1e-14){if(q[i]<0)return null;continue;}
  const t=q[i]/p[i];if(p[i]<0)t0=Math.max(t0,t);else t1=Math.min(t1,t);
  if(t0>t1)return null;
 }
 if(t1-t0<1e-12)return null;
 return {t0,t1,points:[[ax+dx*t0,az+dz*t0],[ax+dx*t1,az+dz*t1]]};
}
export function clipRiverEdges(world,requested){
 const box=normalizeWindow(world.config.sizeKm,requested),edges=[];
 if(world.stage<2||!world.river||!world.receiver)return edges;
 const {x,z}=world.mesh;
 for(let from=0;from<x.length;from++){
  const to=world.receiver[from];
  if(!world.river[from]||to<0||to>=x.length||world.lake?.[from]&&world.lake?.[to])continue;
  const cut=segmentInBox(x[from],z[from],x[to],z[to],box);if(!cut)continue;
  const heightsM=[cut.t0,cut.t1].map(t=>world.height[from]*(1-t)+world.height[to]*t);
  edges.push({from,to,...cut,heightsM,upstreamAreaKm2:world.area?.[from]??null,enters:cut.t0>1e-10,exits:cut.t1<1-1e-10});
 }
 return edges;
}
export function createInheritedWindow(world,requested){
 if(!world?.mesh||!world?.config||!world.height||world.height.length!==world.mesh.x.length||!world.ocean)throw new TypeError('Expected a physical parent world');
 const window=normalizeWindow(world.config.sizeKm,requested),clip=clipMesh(world.mesh,window),heightM=interpolateClip(clip,world.height);
 const sourceSurface=Float32Array.from(world.height,(v,i)=>world.ocean[i]?0:world.stage>=2?(world.waterSurface?.[i]??world.filled?.[i]??v):v);
 const surfaceM=interpolateClip(clip,sourceSurface),oceanWeight=interpolateClip(clip,world.ocean),lakeWeight=world.lake?interpolateClip(clip,world.lake):new Float32Array(heightM.length);
 let low=Infinity,high=-Infinity;for(const h of heightM){low=Math.min(low,h);high=Math.max(high,h);}
 const spacingKm=world.stepKm??world.mesh.stepKm??null,warnings=[];
 if(spacingKm!==null&&window.size<spacingKm*4)warnings.push(`Source spacing is ${spacingKm.toFixed(2)} km. This is inherited terrain, not newly resolved street-level detail.`);
 warnings.push('River centerlines and upstream areas are inherited. Atlas stroke widths are symbolic, not physical riverbank widths.');
 return {version:'watershed-inherited-window-v1',window,
  source:{version:world.version,seed:world.config.seed,stage:world.stage,spacingKm,routing:'inherited-parent-edges',config:{...world.config}},
  mesh:clip.mesh,heightM,surfaceM,oceanWeight,lakeWeight,
  sourceWeights:clip.samples,sourceIds:clip.sourceIds,rivers:clipRiverEdges(world,window),
  metrics:{minElevationM:low,maxElevationM:high,reliefM:high-low,displayTriangles:clip.mesh.triangles.length/3},warnings,
  note:'Display vertices interpolate the original parent triangles. Water and drainage are not recalculated at the window boundary.'};
}
