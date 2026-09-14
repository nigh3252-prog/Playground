const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const percent=value=>`${Math.round((Number(value)||0)*100)}%`;

function hsl(h,s,l){
 const c=(1-Math.abs(2*l-1))*s,x=c*(1-Math.abs((h/60)%2-1)),m=l-c/2;
 let rgb;if(h<60)rgb=[c,x,0];else if(h<120)rgb=[x,c,0];else if(h<180)rgb=[0,c,x];else if(h<240)rgb=[0,x,c];else if(h<300)rgb=[x,0,c];else rgb=[c,0,x];
 return rgb.map(value=>Math.round((value+m)*255));
}

export const BOUNDARY_COLORS={subduction:'#e55f4a',collision:'#e4b04f',rift:'#54b9d1',transform:'#c989d9',inactive:'#89958d'};

export function tectonicColor(world,index){
 const tectonics=world?.geology?.tectonics,history=tectonics?.history;
 if(!history)return[70,82,78];
 const plateId=history.plateId[index]??0,crust=history.crust[index]??1,hue=(plateId*137.508+24)%360,saturation=crust===2?.46:crust===1?.35:.52,lightness=crust===2?.57:crust===1?.44:.31;
 return hsl(hue,saturation,lightness);
}

function segmentDistance(points,x,z){
 let best=Infinity;
 for(let i=1;i<points.length;i++){
  const a=points[i-1],b=points[i],dx=b.x-a.x,dz=b.z-a.z,t=clamp(((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz||1),0,1),distance=Math.hypot(x-a.x-t*dx,z-a.z-t*dz);
  best=Math.min(best,distance);
 }
 return best;
}

export function tectonicFacts(world,index){
 const tectonics=world?.geology?.tectonics,history=tectonics?.history;
 if(!tectonics||!history)return[['Tectonics','Not generated for measured terrain']];
 const plateId=history.plateId[index],plate=tectonics.plates.find(candidate=>candidate.id===plateId),x=world.mesh.x[index],z=world.mesh.z[index],boundary=tectonics.boundaries.reduce((best,candidate)=>{const distance=segmentDistance(candidate.points,x,z);return!best||distance<best.distance?{...candidate,distance}:best;},null),normal=boundary?.normalRate||0,motion=normal>.08?'convergence':normal<-.08?'extension':'lateral';
 return[
  ['Plate / crust',`${plateId} / ${plate?.crust||'unknown'}`],
  ['Plate velocity',`${(plate?.velocityX||0).toFixed(2)} / ${(plate?.velocityZ||0).toFixed(2)}`],
  ['Boundary class',boundary?.kind||'none nearby'],
  ['Relative motion',`${Math.abs(normal).toFixed(2)} ${motion} · ${(boundary?.shearRate||0).toFixed(2)} shear`],
  ['Tectonic age',`${Math.round(history.tectonicAge[index]||0)} Myr`],
  ['Tectonic response',`${percent(history.uplift[index])} uplift · ${percent(history.subsidence[index])} subsidence · ${percent(history.volcanism[index])} volcanism`]
 ];
}
