import {clamp,noise} from './world-utils.mjs';
import {plateAt} from './tectonic-plates.mjs';

function fbm(x,z,seed){
 let value=0,amplitude=.56,total=0;
 for(let octave=0;octave<5;octave++){
  value+=noise(x,z,seed+octave*977)*amplitude;
  total+=amplitude;x=x*2.03+13;z=z*2.03-7;amplitude*=.5;
 }
 return value/total;
}

function sampleGrid(field,width,height,x,z,sizeKm){
 const u=clamp(x/sizeKm*(width-1),0,width-1),v=clamp(z/sizeKm*(height-1),0,height-1),column=Math.min(width-2,Math.floor(u)),row=Math.min(height-2,Math.floor(v)),a=u-column,b=v-row,i=row*width+column;
 return(field[i]*(1-a)+field[i+1]*a)*(1-b)+(field[i+width]*(1-a)+field[i+width+1]*a)*b;
}

/** Convert crustal buoyancy and accumulated deformation into physical relief. */
export function synthesizeTectonicTerrain({seed,mesh,tectonics,history}){
 if(!mesh?.x||!mesh?.z||!history?.uplift)throw new Error('Invalid tectonic terrain input');
 const count=mesh.x.length,elevation=new Float32Array(count),continentality=new Float32Array(count),ruggedness=new Float32Array(count),{width,height,sizeKm}=history;
 for(let i=0;i<count;i++){
  const x=mesh.x[i],z=mesh.z[i],u=x/sizeKm,v=z/sizeKm,plate=plateAt(tectonics,x,z),broad=fbm(u*3.1,v*3.1,seed+5),detail=fbm(u*12.5,v*12.5,seed+81),grain=fbm(u*34,v*34,seed+44),signal=plate.buoyancy-.35+broad*.15+detail*.045;
  const uplift=sampleGrid(history.uplift,width,height,x,z,sizeKm),subsidence=sampleGrid(history.subsidence,width,height,x,z,sizeKm),volcanism=sampleGrid(history.volcanism,width,height,x,z,sizeKm),shear=sampleGrid(history.shear,width,height,x,z,sizeKm),boundaryDistance=sampleGrid(history.boundaryDistance,width,height,x,z,sizeKm);
  continentality[i]=signal;
  let base;
  if(signal<0){
   const shelf=plate.crust==='oceanic'?clamp(boundaryDistance/330,.1,1):clamp(boundaryDistance/180,.18,1);
   base=signal*11200*shelf;
  }else base=55+signal*1080+detail*125+grain*42;
  const mountainTexture=.73+.31*Math.abs(fbm(u*21+uplift*2.7,v*8.5-u*3.2,seed+701))+.13*grain;
  const relief=uplift*2580*mountainTexture-subsidence*1120+volcanism*760+shear*180*grain;
  ruggedness[i]=clamp(uplift*.78+volcanism*.55+shear*.3+Math.abs(grain)*.18,0,1.5);
  elevation[i]=base+relief;
 }
 return{elevation,continentality,ruggedness};
}
