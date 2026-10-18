import {createTerrainMesh} from './world-mesh.mjs';
import {random32,clamp} from './world-utils.mjs';
import {planGeology,applyGeology} from './geology-provinces.mjs';
import {conditionRegionalDrainage} from './drainage-conditioning.mjs';
import {planTectonicPlates} from './tectonic-plates.mjs';
import {buildTectonicHistory} from './tectonic-history.mjs';
import {synthesizeTectonicTerrain} from './tectonic-terrain.mjs';
import {erodeTerrain} from './terrain-erosion.mjs';
/** The parent domain is physical; a window is only a view of that solution.
 * No coast or plate boundary is tied to a child-window edge.
 */
export function planParent(seed=431970387,sizeKm=4800,{continentCount=3,crustScale=1.15}={}){
 return{seed:Number(seed)>>>0,sizeKm,tectonics:planTectonicPlates({seed,sizeKm,continentCount,crustScale})};
}
export function generateParentTerrain(options={}){
 const seed=Number(options.seed??431970387)>>>0,windowKm=Number(options.sizeKm||1200),sizeKm=Number(options.parentKm||Math.max(3600,Math.min(6000,windowKm*4))),n=options.parentN||({129:193,193:257,241:321}[options.n]||257),continentCount=options.continentCount===undefined?3:Number(options.continentCount),crustScale=options.crustScale===undefined?1.15:Number(options.crustScale);
 if(!Number.isFinite(windowKm)||!Number.isFinite(sizeKm)||windowKm<200||windowKm>=sizeKm*.94||sizeKm<3000||sizeKm>6000||!Number.isInteger(n)||n<17||n>321)throw new Error('Invalid parent/window dimensions');
 for(const [key,lo,hi] of [['relief',.5,1.6],['rain',.4,1.8]])if(options[key]!==undefined&&(!Number.isFinite(Number(options[key]))||Number(options[key])<lo||Number(options[key])>hi))throw new Error('Invalid '+key);
 if(options.wind!==undefined&&!['west','east'].includes(options.wind))throw new Error('Invalid wind');
 const plan=planParent(seed,sizeKm,{continentCount,crustScale}),mesh=createTerrainMesh(n,sizeKm,seed),history=buildTectonicHistory(plan.tectonics,{width:n,height:n,sizeKm}),base=synthesizeTectonicTerrain({seed,mesh,tectonics:plan.tectonics,history}),erosion=erodeTerrain({elevation:base.elevation,width:n,height:n},history.tectonicAge,{passes:4}),N=n*n,height=new Float32Array(N),landHistory=new Uint8Array(N),featureAt=new Int16Array(N).fill(-1),ocean=new Uint8Array(N);
 const baseAt=(x,z)=>{const column=clamp(Math.round(x/sizeKm*(n-1)),0,n-1),row=clamp(Math.round(z/sizeKm*(n-1)),0,n-1),value=erosion.elevation[row*n+column];return{height:value,landBlend:clamp((value+80)/260,0,1)};};
 const geologyPlan=planGeology({seed,sizeKm,northAxis:.2,eastAxis:.8,baseAt,tectonics:{...plan.tectonics,history}}),featurePlan={features:geologyPlan.features};
 for(let i=0;i<N;i++){const raw=erosion.elevation[i],g=raw>0?applyGeology(featurePlan,mesh.x[i],mesh.z[i],raw):{height:raw,landHistory:0,feature:-1};height[i]=g.height*Number(options.relief||1);landHistory[i]=g.landHistory;featureAt[i]=g.feature;}
 const queue=new Int32Array(N);let head=0,tail=0;for(let i=0;i<N;i++)if(mesh.boundary[i]&&height[i]<=0){ocean[i]=1;queue[tail++]=i;}
 while(head<tail){const i=queue[head++];for(let k=mesh.offsets[i];k<mesh.offsets[i+1];k++){const j=mesh.neighbors[k];if(!ocean[j]&&height[j]<=0){ocean[j]=1;queue[tail++]=j;}}}
 const terrain={version:'regional-world-v6',stage:1,n,stepKm:mesh.stepKm,config:{seed,n,sizeKm,continentCount,crustScale,relief:Number(options.relief||1),rain:Number(options.rain||1),wind:options.wind||'west',source:'generated'},mesh,height,ocean,landHistory,featureAt,features:geologyPlan.features,geology:{features:geologyPlan.features,tectonics:{...plan.tectonics,history},source:'Seeded plate history on a padded parent domain; no child-edge barriers'},erosion:{sediment:erosion.sediment,passes:erosion.passes},parentDomain:{sizeKm,windowKm,seed,continentCount,crustScale,nominalSpacingKm:mesh.stepKm,regionalDetail:options.n||193,solverExtent:'entire parent before cropping'}};
 // Conditioning happens on the complete parent before any child window is
 // chosen. Deliberate glacial/rift/volcanic basins stay protected, while
 // shallow sampling pits get sub-grid drainage outlets.
 return conditionRegionalDrainage(terrain);
}
export function chooseWindow(world,index=0){
 const size=world.parentDomain?.windowKm||world.config.sizeKm;if(!world.parentDomain)return{x:0,z:0,size,index:0};
 const extent=world.config.sizeKm,r=random32((world.config.seed^Math.imul(index+1,0x45d9f3b))>>>0),margin=extent*.025,span=extent-size-2*margin;
 // Reject only nearly empty ocean views, not inland/coastal/mountain types.
 // Rejection sampling is explicit; this is not an unbiased sample of Earth.
 let box;for(let attempt=0;attempt<16;attempt++){box={x:margin+r()*span,z:margin+r()*span,size,index};let land=0,total=0;for(let i=0;i<world.height.length;i+=3){const x=world.mesh.x[i],z=world.mesh.z[i];if(x>=box.x&&x<=box.x+size&&z>=box.z&&z<=box.z+size){total++;if(!world.ocean[i])land++;}}if(total&&land/total>=.15)break;}
 return box;
}
