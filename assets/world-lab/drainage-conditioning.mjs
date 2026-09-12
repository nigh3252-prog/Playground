/** Terrain-only hydrologic conditioning for coarse regional meshes.
 *
 * A 3–20 km regional sample can close narrow real valleys that would drain at
 * finer resolution. Treating every such mesh pit as a permanent lake creates
 * huge false lakes. This pass breaches only shallow, unprotected depressions
 * using terrain topology alone. It never reads observed lakes, rivers,
 * population, benchmark roles, or place labels.
 */
import {generateHydrology} from './world-core.mjs';

const each=(mesh,i,fn)=>{for(let k=mesh.offsets[i];k<mesh.offsets[i+1];k++)fn(mesh.neighbors[k],mesh.distances[k]);};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

export const DEFAULT_DRAINAGE_CONDITIONING=Object.freeze({
  passes:2,
  // Coarse mountainous terrain is much more likely than flat terrain to hide
  // a narrow outlet between samples. Scale the breach depth with the terrain's
  // 95th-percentile slope rather than using one global depth threshold.
  baseMaxFillDepthM:8,
  slopeDepthScaleM:1600,
  maxFillDepthCapM:220,
  minFloorElevationM:20,
  outletGradeMPerKm:.02,
  neighborCutFraction:.12,
  protectIntentional:true
});

function slopeField(mesh,height){
  const slope=new Float32Array(height.length);
  for(let i=0;i<height.length;i++)each(mesh,i,(j,d)=>{slope[i]=Math.max(slope[i],Math.abs(height[i]-height[j])/(d*1000));});
  return slope;
}
function percentile(values,q){const a=[...values].sort((x,y)=>x-y);return a.length?a[Math.min(a.length-1,Math.floor((a.length-1)*q))]:0;}

/** Return a conditioned copy of a terrain object. The input height array is
 * never mutated, which keeps benchmark inputs reproducible and makes this safe
 * to call from generated-parent and blind-reference pipelines alike.
 */
export function conditionRegionalDrainage(terrain,overrides={}){
  if(!terrain?.mesh||!terrain.height||!terrain.ocean)throw new TypeError('Drainage conditioning requires terrain mesh, height and ocean fields');
  const cfg={...DEFAULT_DRAINAGE_CONDITIONING,...overrides},height=Float32Array.from(terrain.height),mesh=terrain.mesh,history=terrain.landHistory||new Uint8Array(height.length),work={...terrain,height};
  const initialSlope=slopeField(mesh,height),landSlope=[];for(let i=0;i<height.length;i++)if(!terrain.ocean[i])landSlope.push(initialSlope[i]);
  const p95Slope=percentile(landSlope,.95),adaptiveMaxFillDepthM=Number.isFinite(cfg.maxFillDepthM)?cfg.maxFillDepthM:clamp(cfg.baseMaxFillDepthM+p95Slope*cfg.slopeDepthScaleM,cfg.baseMaxFillDepthM,cfg.maxFillDepthCapM);
  let breachedBasins=0,totalCutNodes=0,maxCutM=0,maxBreachedFillDepthM=0;

  for(let pass=0;pass<cfg.passes;pass++){
    const currentSlope=slopeField(mesh,height),hydro=generateHydrology({...work,slope:currentSlope}),deepest=new Int32Array(hydro.lakeBodies.length).fill(-1);
    for(let i=0;i<height.length;i++){
      const basin=hydro.lakeId[i];
      if(basin>=0&&(deepest[basin]<0||height[i]<height[deepest[basin]]))deepest[basin]=i;
    }
    for(const floorNode of deepest){
      if(floorNode<0||height[floorNode]<cfg.minFloorElevationM)continue;
      const htype=history[floorNode]||0;
      if(cfg.protectIntentional&&htype>=1&&htype<=3)continue;
      const fillDepth=hydro.filled[floorNode]-height[floorNode];
      if(!(fillDepth>.5)||fillDepth>adaptiveMaxFillDepthM)continue;

      const floor=height[floorNode];let distance=0,node=floorNode,cuts=0,guard=0;
      while(node>=0&&guard++<height.length){
        const next=hydro.receiver[node];if(next<0)break;
        distance+=Math.hypot(mesh.x[next]-mesh.x[node],mesh.z[next]-mesh.z[node]);
        if(hydro.ocean[next])break;
        const target=floor-cfg.outletGradeMPerKm*distance;
        if(height[next]<target)break;
        const cut=height[next]-target;
        if(cut>0){
          height[next]=target;cuts++;totalCutNodes++;maxCutM=Math.max(maxCutM,cut);
          each(mesh,next,j=>{
            if(hydro.ocean[j]||(cfg.protectIntentional&&(history[j]===2||history[j]===3)))return;
            const neighborCut=Math.max(0,Math.min(height[j]-target,cut))*cfg.neighborCutFraction;
            if(neighborCut>0)height[j]-=neighborCut;
          });
        }
        node=next;
      }
      if(cuts){breachedBasins++;maxBreachedFillDepthM=Math.max(maxBreachedFillDepthM,fillDepth);}
    }
  }

  const slope=slopeField(mesh,height);
  return{...terrain,height,slope,erosion:{kind:'regional-ruggedness-aware-breach-v2',breachedBasins,totalCutNodes,maxCutM,maxBreachedFillDepthM,p95SlopePercent:p95Slope*100,adaptiveMaxFillDepthM,settings:cfg}};
}
