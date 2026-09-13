import {clamp,noise,random32} from './world-utils.mjs';
import {plateAt} from './tectonic-plates.mjs';

const gauss=value=>Math.exp(-(value*value));

function closestOnBoundary(boundary,plates,x,z){
 const a=plates[boundary.plateA],b=plates[boundary.plateB],cdx=b.centerX-a.centerX,cdz=b.centerZ-a.centerZ,centerLength=Math.hypot(cdx,cdz)||1,nx=cdx/centerLength,nz=cdz/centerLength;
 let bestDistance=Infinity,bestSigned=0,bestAlong=0,travelled=0;
 for(let i=1;i<boundary.points.length;i++){
  const p=boundary.points[i-1],q=boundary.points[i],dx=q.x-p.x,dz=q.z-p.z,length2=dx*dx+dz*dz||1,length=Math.sqrt(length2),t=clamp(((x-p.x)*dx+(z-p.z)*dz)/length2,0,1),cx=p.x+t*dx,cz=p.z+t*dz,ox=x-cx,oz=z-cz,distance=Math.hypot(ox,oz);
  if(distance<bestDistance){bestDistance=distance;bestSigned=ox*nx+oz*nz;bestAlong=travelled+t*length;}
  travelled+=length;
 }
 return{distance:bestDistance,signed:bestSigned,along:bestAlong};
}

function crustCode(crust){return crust==='continental'?2:crust==='mixed'?1:0;}

/** Build coarse deformation fields from the relative motion at plate margins. */
export function buildTectonicHistory(tectonics,{width,height,sizeKm,eras=3}={}){
 if(!tectonics?.plates?.length||!tectonics?.boundaries)throw new Error('Invalid tectonic plan');
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<2||height<2||!Number.isFinite(sizeKm)||sizeKm<=0)throw new Error('Invalid tectonic history mesh');
 const count=width*height,plateId=new Int16Array(count),crust=new Uint8Array(count),tectonicAge=new Float32Array(count),uplift=new Float32Array(count),subsidence=new Float32Array(count),volcanism=new Float32Array(count),shear=new Float32Array(count),boundaryDistance=new Float32Array(count).fill(Infinity),r=random32(tectonics.seed^0xc2b2ae35),episodeCount=clamp(Math.round(eras),2,4),episodes=[];
 for(let era=0;era<episodeCount;era++)episodes.push({id:era,ageMyr:Math.round(12+(episodeCount-era-1)*42+r()*12),strength:.18+era/(episodeCount-1)*.34});
 const episodeStrength=episodes.reduce((sum,episode)=>sum+episode.strength,0);

 for(let row=0;row<height;row++)for(let column=0;column<width;column++){
  const i=row*width+column,x=column/(width-1)*sizeKm,z=row/(height-1)*sizeKm,owner=plateAt(tectonics,x,z);
  plateId[i]=owner.id;crust[i]=crustCode(owner.crust);tectonicAge[i]=Math.max(80,owner.ageMyr*.42);
  for(const boundary of tectonics.boundaries){
   const nearest=closestOnBoundary(boundary,tectonics.plates,x,z),distance=nearest.distance,signed=nearest.signed;
   boundaryDistance[i]=Math.min(boundaryDistance[i],distance);
   const alongScale=Math.max(70,(boundary.lengthKm||sizeKm*.3)*.18),along=nearest.along/alongScale,variation=clamp(.82+.34*noise(along,boundary.id*1.71,tectonics.seed+913),.48,1.24),widthVariation=clamp(.92+.42*noise(along*.63+7,boundary.id*.91,tectonics.seed+1217),.58,1.42),offset=42*noise(along*.77-5,boundary.id*2.13,tectonics.seed+1597),warpedSigned=signed-offset,rate=clamp(Math.abs(boundary.normalRate)/.34,.2,1.25),activity=episodeStrength*rate*variation;
   if(boundary.kind==='subduction'){
    const overridingSign=boundary.polarity===boundary.plateB?1:-1,side=warpedSigned*overridingSign;
    subsidence[i]+=gauss((side+38)/(44*widthVariation))*.76*activity;
    uplift[i]+=gauss((side-92)/(128*widthVariation))*.82*activity;
    volcanism[i]+=gauss((side-158)/(62*widthVariation))*.7*activity;
   }else if(boundary.kind==='collision'){
    const core=gauss(warpedSigned/(190*widthVariation)),splay=gauss((warpedSigned-(55+35*noise(along*.4,4,tectonics.seed+1777)))/(105*widthVariation));
    uplift[i]+=(core*.78+splay*.2)*activity;
   }else if(boundary.kind==='rift'){
    subsidence[i]+=gauss(warpedSigned/(48*widthVariation))*.72*activity;
    uplift[i]+=gauss((Math.abs(warpedSigned)-82)/(58*widthVariation))*.34*activity;
   }else if(boundary.kind==='transform'){
    shear[i]+=gauss(distance/38)*clamp(boundary.shearRate/.25,.15,1.1)*episodeStrength;
   }
   if(boundary.kind!=='inactive')tectonicAge[i]=Math.min(tectonicAge[i],8+distance*.34);
  }
  uplift[i]=clamp(uplift[i],0,1.5);subsidence[i]=clamp(subsidence[i],0,1.5);volcanism[i]=clamp(volcanism[i],0,1.25);shear[i]=clamp(shear[i],0,1.25);
 }
 return{width,height,sizeKm,plateId,crust,tectonicAge,uplift,subsidence,volcanism,shear,boundaryDistance,episodes};
}
