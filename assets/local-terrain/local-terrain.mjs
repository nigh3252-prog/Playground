import {chooseLocalSite} from './local-site.mjs';
import {routeLocalDrainage} from './local-drainage.mjs';

const OUTPUT_SIZE_M=1200,OUTPUT_N=257,PADDED_N=385,SPACING_M=OUTPUT_SIZE_M/(OUTPUT_N-1),CROP_OFFSET=(PADDED_N-OUTPUT_N)/2;
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const smooth=value=>value*value*(3-2*value);
function hash2(x,z,seed){let h=(Math.imul(x,0x1f123bb5)^Math.imul(z,0x5f356495)^seed)>>>0;h^=h>>>16;h=Math.imul(h,0x7feb352d);h^=h>>>15;h=Math.imul(h,0x846ca68b);return((h^(h>>>16))>>>0)/2147483648-1;}
function valueNoise(x,z,seed){const ix=Math.floor(x),iz=Math.floor(z),fx=smooth(x-ix),fz=smooth(z-iz),a=hash2(ix,iz,seed),b=hash2(ix+1,iz,seed),c=hash2(ix,iz+1,seed),d=hash2(ix+1,iz+1,seed);return(a+(b-a)*fx)+((c+(d-c)*fx)-(a+(b-a)*fx))*fz;}
function terrainDetail(worldXM,worldZM,angle,seed){
 const ca=Math.cos(angle),sa=Math.sin(angle),rx=worldXM*ca-worldZM*sa,rz=(worldXM*sa+worldZM*ca)*1.55;
 return valueNoise(rx/720,rz/720,seed)*.48+valueNoise(rx/310,rz/310,seed^0x9e3779b9)*.28+valueNoise(rx/140,rz/140,seed^0x85ebca6b)*.16+valueNoise(rx/65,rz/65,seed^0xc2b2ae35)*.08;
}
function quantile(values,q){const copy=Array.from(values).sort((a,b)=>a-b),index=Math.min(copy.length-1,Math.max(0,Math.floor((copy.length-1)*q)));return copy[index];}
function validateParent(world){if(!world?.mesh||!world?.height||!world?.ocean||!world?.config||!world?.parentDomain)throw new TypeError('Expected a valid solved parent world');}

export function generateLocalTerrain(parentWorld,{windowIndex=0,siteIndex=0}={}){
 validateParent(parentWorld);const anchor=chooseLocalSite(parentWorld,{windowIndex,siteIndex}),count=PADDED_N*PADDED_N,raw=new Float32Array(count),seed=(anchor.parentSeed^Math.imul(anchor.siteIndex+1,0x9e3779b1))>>>0;
 const amplitude=clamp(7+anchor.ruggedness*.085+anchor.uplift*18-anchor.subsidence*8,7,65),structureAngle=anchor.downslopeBearingRad+Math.PI/2;
 for(let row=0;row<PADDED_N;row++)for(let col=0;col<PADDED_N;col++){
  const localXM=(col-(PADDED_N-1)/2)*SPACING_M,localZM=(row-(PADDED_N-1)/2)*SPACING_M,worldXM=anchor.centerXKm*1000+localXM,worldZM=anchor.centerZKm*1000+localZM;
  const trend=anchor.elevationM+anchor.slopeX*(localXM/1000)+anchor.slopeZ*(localZM/1000),detail=terrainDetail(worldXM,worldZM,structureAngle,seed);
  raw[row*PADDED_N+col]=trend+detail*amplitude;
 }
 let routed=routeLocalDrainage({heightM:raw,width:PADDED_N,height:PADDED_N,spacingM:SPACING_M,preferredOutletBearingRad:anchor.downslopeBearingRad});const paddedIncision=new Float32Array(count),eroded=Float32Array.from(routed.conditionedHeightM),cellAreaM2=SPACING_M*SPACING_M;
 for(let id=0;id<count;id++){const contributingCells=Math.max(1,routed.flowAccumulation[id]/cellAreaM2),incision=clamp((Math.log2(contributingCells)-5)*.45,0,2.5);paddedIncision[id]=incision;eroded[id]-=incision;}
 routed=routeLocalDrainage({heightM:eroded,width:PADDED_N,height:PADDED_N,spacingM:SPACING_M,preferredOutletBearingRad:anchor.downslopeBearingRad});const outputCount=OUTPUT_N*OUTPUT_N;
 const heightM=new Float32Array(outputCount),conditionedHeightM=new Float32Array(outputCount),incisionM=new Float32Array(outputCount),receiver=new Int32Array(outputCount).fill(-1),flowAccumulation=new Float32Array(outputCount);
 const paddedToOutput=new Int32Array(count).fill(-1);
 for(let row=0;row<OUTPUT_N;row++)for(let col=0;col<OUTPUT_N;col++){const out=row*OUTPUT_N+col,pad=(row+CROP_OFFSET)*PADDED_N+col+CROP_OFFSET;paddedToOutput[pad]=out;heightM[out]=routed.conditionedHeightM[pad];conditionedHeightM[out]=routed.conditionedHeightM[pad];incisionM[out]=paddedIncision[pad];flowAccumulation[out]=routed.flowAccumulation[pad];}
 for(let row=0;row<OUTPUT_N;row++)for(let col=0;col<OUTPUT_N;col++){const out=row*OUTPUT_N+col,pad=(row+CROP_OFFSET)*PADDED_N+col+CROP_OFFSET,next=routed.receiver[pad];receiver[out]=next>=0?paddedToOutput[next]:-1;}
 const slope=new Float32Array(outputCount),ruggedness=new Float32Array(outputCount),waterMask=new Uint8Array(outputCount),surfaceClass=new Uint8Array(outputCount),walkability=new Uint8Array(outputCount);
 const sourceNode=anchor.nearestNode,sourceWater=Boolean(parentWorld.lake?.[sourceNode])||Number(parentWorld.waterSurface?.[sourceNode])>Number(parentWorld.height?.[sourceNode])+.25,sourceWaterLevel=sourceWater?Number(parentWorld.waterSurface[sourceNode]):null;
 for(let row=0;row<OUTPUT_N;row++)for(let col=0;col<OUTPUT_N;col++){
  const id=row*OUTPUT_N+col,left=heightM[row*OUTPUT_N+Math.max(0,col-1)],right=heightM[row*OUTPUT_N+Math.min(OUTPUT_N-1,col+1)],up=heightM[Math.max(0,row-1)*OUTPUT_N+col],down=heightM[Math.min(OUTPUT_N-1,row+1)*OUTPUT_N+col],dx=(right-left)/(col===0||col===OUTPUT_N-1?SPACING_M:2*SPACING_M),dz=(down-up)/(row===0||row===OUTPUT_N-1?SPACING_M:2*SPACING_M);
  slope[id]=Math.hypot(dx,dz);let lo=Infinity,hi=-Infinity;for(let rz=Math.max(0,row-1);rz<=Math.min(OUTPUT_N-1,row+1);rz++)for(let cx=Math.max(0,col-1);cx<=Math.min(OUTPUT_N-1,col+1);cx++){const value=heightM[rz*OUTPUT_N+cx];lo=Math.min(lo,value);hi=Math.max(hi,value);}ruggedness[id]=hi-lo;
  waterMask[id]=sourceWater&&heightM[id]<=sourceWaterLevel+.15?1:0;const drainageCorridor=incisionM[id]>=.5||flowAccumulation[id]>=SPACING_M*SPACING_M*64&&slope[id]<.55;
  surfaceClass[id]=waterMask[id]?3:slope[id]>.55?1:drainageCorridor?2:0;walkability[id]=!waterMask[id]&&slope[id]<=.55&&ruggedness[id]<=18?1:0;
 }
 const boundaryTermini=[];for(let id=0;id<outputCount;id++)if(receiver[id]===-1){const row=Math.floor(id/OUTPUT_N),col=id-row*OUTPUT_N;if(row===0||row===OUTPUT_N-1||col===0||col===OUTPUT_N-1)boundaryTermini.push(id);}
 boundaryTermini.sort((a,b)=>flowAccumulation[b]-flowAccumulation[a]||a-b);const significantAreaM2=SPACING_M*SPACING_M*64,outlets=boundaryTermini.filter(id=>flowAccumulation[id]>=significantAreaM2);if(!outlets.length&&boundaryTermini.length)outlets.push(boundaryTermini[0]);let min=Infinity,max=-Infinity,walkable=0,wet=0;for(let i=0;i<outputCount;i++){min=Math.min(min,heightM[i]);max=Math.max(max,heightM[i]);walkable+=walkability[i];wet+=waterMask[i];}
 const warnings=[];if(routed.maxFillM>6)warnings.push(`Local pit conditioning raised terrain by up to ${routed.maxFillM.toFixed(1)} m.`);
 return{
  version:'local-terrain-v1',config:{windowIndex:Number(windowIndex),siteIndex:Number(siteIndex),algorithm:'parent-conditioned-v1'},anchor,
  grid:{width:OUTPUT_N,height:OUTPUT_N,sizeM:OUTPUT_SIZE_M,spacingM:SPACING_M,minXM:-600,maxXM:600,minZM:-600,maxZM:600},focus:{centerXM:0,centerZM:0,sizeM:410},
  heightM,conditionedHeightM,incisionM,slope,ruggedness,waterMask,surfaceClass,walkability,receiver,flowAccumulation,
  drainage:{outlets,primaryOutlet:outlets[0]??-1,maxFillM:routed.maxFillM,preferredOutletBearingRad:anchor.downslopeBearingRad},
  metrics:{minElevationM:min,maxElevationM:max,reliefM:max-min,medianSlope:quantile(slope,.5),p95Slope:quantile(slope,.95),walkableFraction:walkable/outputCount,waterFraction:wet/outputCount},
  surfaceClasses:{soil:0,steepRock:1,drainage:2,water:3},warnings
 };
}

export function serializeLocalTerrain(tile){
 if(!tile||tile.version!=='local-terrain-v1'||!tile.grid||!tile.anchor)throw new TypeError('Expected a local-terrain-v1 tile');
 const convert=value=>ArrayBuffer.isView(value)?Array.from(value):Array.isArray(value)?value.map(convert):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,convert(item)])):value;
 return convert(tile);
}
