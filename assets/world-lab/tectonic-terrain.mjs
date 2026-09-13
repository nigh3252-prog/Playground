import {clamp,noise} from './world-utils.mjs';

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
  const x=mesh.x[i],z=mesh.z[i],u=x/sizeKm,v=z/sizeKm,broad=fbm(u*3.1,v*3.1,seed+5),detail=fbm(u*12.5,v*12.5,seed+81),grain=fbm(u*34,v*34,seed+44),wx=x+sizeKm*.048*fbm(u*4.2,v*4.2,seed+11),wz=z+sizeKm*.048*fbm(u*4.2+17,v*4.2-9,seed+19);
  let continent=0;
  for(const block of tectonics.continents){const dx=wx-block.x,dz=wz-block.z,c=Math.cos(block.angle),s=Math.sin(block.angle),distance=((dx*c+dz*s)/block.rx)**2+((-dx*s+dz*c)/block.rz)**2;continent=Math.max(continent,Math.exp(-distance));}
  const signal=continent-.38+broad*.13+detail*.045;
  const uplift=sampleGrid(history.uplift,width,height,x,z,sizeKm),subsidence=sampleGrid(history.subsidence,width,height,x,z,sizeKm),volcanism=sampleGrid(history.volcanism,width,height,x,z,sizeKm),shear=sampleGrid(history.shear,width,height,x,z,sizeKm);
  continentality[i]=signal;
  let base;
  if(signal<0){
   const shelf=clamp((.38-continent)*4.5,.08,1);
   base=signal*11200*shelf;
  }else base=55+signal*1080+detail*125+grain*42;
  const mountainTexture=.46+.58*Math.abs(fbm(u*21+uplift*2.7,v*8.5-u*3.2,seed+701))+.18*Math.max(0,grain);
  const relief=uplift*2180*mountainTexture-subsidence*1120+volcanism*760+shear*180*grain;
  ruggedness[i]=clamp(uplift*.78+volcanism*.55+shear*.3+Math.abs(grain)*.18,0,1.5);
  elevation[i]=base+relief;
 }
 return{elevation,continentality,ruggedness};
}
