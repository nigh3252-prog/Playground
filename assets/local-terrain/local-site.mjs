import {chooseWindow} from '../world-lab/parent-world.mjs';
import {indexMesh,interpolateAt,nearestNode as findNearestNode} from '../world-lab/world-mesh.mjs';

const FOCUS_HALF_KM=.205,SYNTHESIS_HALF_KM=.9;
const finite=value=>Number.isFinite(Number(value));
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));

function hash32(value){
 let x=value>>>0;x^=x>>>16;x=Math.imul(x,0x7feb352d);x^=x>>>15;x=Math.imul(x,0x846ca68b);return(x^(x>>>16))>>>0;
}
function unitHash(seed,index){return hash32((seed^Math.imul(index+1,0x9e3779b1))>>>0)/4294967296;}
function primitiveConfig(config={}){
 const result={};for(const [key,value] of Object.entries(config))if(['string','number','boolean'].includes(typeof value))result[key]=value;return result;
}
function fieldAt(meshIndex,values,x,z,fallback=0){
 if(!values||values.length!==meshIndex.mesh.x.length)return fallback;
 const value=interpolateAt(meshIndex,values,x,z);return finite(value)?Number(value):fallback;
}
function validateParent(world){
 if(!world||!world.mesh||!world.height||!world.ocean||!world.config||!world.parentDomain||world.height.length!==world.mesh.x?.length||world.ocean.length!==world.height.length)throw new TypeError('Expected a valid solved parent world');
 if(!finite(world.config.seed)||!finite(world.config.sizeKm)||!finite(world.parentDomain.windowKm))throw new TypeError('Expected a valid solved parent world');
}
function sampleLand(meshIndex,world,x,z){
 const elevation=interpolateAt(meshIndex,world.height,x,z),ocean=interpolateAt(meshIndex,world.ocean,x,z);
 return finite(elevation)&&finite(ocean)&&ocean<.5?Number(elevation):null;
}

export function chooseLocalSite(parentWorld,{windowIndex=0,siteIndex=0}={}){
 validateParent(parentWorld);
 windowIndex=Number(windowIndex);siteIndex=Number(siteIndex);
 if(!Number.isInteger(windowIndex)||windowIndex<0||!Number.isInteger(siteIndex)||siteIndex<0)throw new TypeError('Window and site indices must be non-negative integers');
 const meshIndex=indexMesh(parentWorld.mesh),window=chooseWindow(parentWorld,windowIndex),seed=Number(parentWorld.config.seed)>>>0;
 const history=parentWorld.geology?.tectonics?.history||{},margin=Math.max(SYNTHESIS_HALF_KM,window.size*.06),span=window.size-2*margin;
 if(!(span>0))throw new Error('No usable local terrain site: regional window is too small');
 const gradientStep=clamp(window.size/12,.5,9.375),candidates=[];
 for(let row=0;row<9;row++)for(let col=0;col<9;col++){
  const ordinal=row*9+col,jx=(unitHash(seed^Math.imul(windowIndex+1,0x85ebca6b),ordinal*2)-.5)*.42,jz=(unitHash(seed^0xc2b2ae35,ordinal*2+1)-.5)*.42;
  const u=clamp((col+.5+jx)/9,0,1),v=clamp((row+.5+jz)/9,0,1),x=window.x+margin+u*span,z=window.z+margin+v*span;
  const center=sampleLand(meshIndex,parentWorld,x,z);if(center===null)continue;
  let focusLand=true;for(const dx of [-FOCUS_HALF_KM,FOCUS_HALF_KM])for(const dz of [-FOCUS_HALF_KM,FOCUS_HALF_KM])if(sampleLand(meshIndex,parentWorld,x+dx,z+dz)===null)focusLand=false;
  if(!focusLand)continue;
  const left=sampleLand(meshIndex,parentWorld,x-gradientStep,z),right=sampleLand(meshIndex,parentWorld,x+gradientStep,z),up=sampleLand(meshIndex,parentWorld,x,z-gradientStep),down=sampleLand(meshIndex,parentWorld,x,z+gradientStep);
  if([left,right,up,down].some(value=>value===null))continue;
  const slopeX=(right-left)/(2*gradientStep),slopeZ=(down-up)/(2*gradientStep),grade=Math.hypot(slopeX,slopeZ)/1000;
  const relief=Math.max(center,left,right,up,down)-Math.min(center,left,right,up,down);
  const edgeDistance=Math.min(x-window.x,window.x+window.size-x,z-window.z,window.z+window.size-z);
  const score=-Math.abs(grade-.035)*34+Math.min(relief,500)/500+edgeDistance/window.size*.2+unitHash(seed^0x27d4eb2f,ordinal)*1e-5;
  candidates.push({ordinal,score,x,z,center,slopeX,slopeZ,relief});
 }
 if(!candidates.length)throw new Error('No usable local terrain site in the selected regional window');
 candidates.sort((a,b)=>b.score-a.score||a.ordinal-b.ordinal);
 const chosen=candidates[siteIndex%candidates.length],node=findNearestNode(meshIndex,chosen.x,chosen.z);
 return{
  version:'local-site-v1',parentSeed:seed,parentConfig:primitiveConfig(parentWorld.config),windowIndex,siteIndex,
  candidateRank:siteIndex%candidates.length,candidateCount:candidates.length,centerXKm:chosen.x,centerZKm:chosen.z,
  elevationM:chosen.center,slopeX:chosen.slopeX,slopeZ:chosen.slopeZ,downslopeBearingRad:Math.atan2(-chosen.slopeZ,-chosen.slopeX),
  ruggedness:chosen.relief,uplift:fieldAt(meshIndex,history.uplift,chosen.x,chosen.z),subsidence:fieldAt(meshIndex,history.subsidence,chosen.x,chosen.z),
  tectonicAge:fieldAt(meshIndex,history.tectonicAge,chosen.x,chosen.z,.5),rainfall:fieldAt(meshIndex,parentWorld.rainfall,chosen.x,chosen.z,0),
  ocean:false,nearestNode:node,window:{x:window.x,z:window.z,size:window.size,index:window.index}
 };
}
