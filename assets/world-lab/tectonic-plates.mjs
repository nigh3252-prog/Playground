import {noise,random32} from './world-utils.mjs';

const pairKey=(a,b)=>a<b?`${a}:${b}`:`${b}:${a}`;

function shuffledSlots(r){
 const slots=[];
 for(let z=0;z<3;z++)for(let x=0;x<3;x++)slots.push([x,z]);
 for(let i=slots.length-1;i>0;i--){const j=Math.floor(r()*(i+1));[slots[i],slots[j]]=[slots[j],slots[i]];}
 return slots;
}

function crustBuoyancy(crust,ageMyr){
 if(crust==='continental')return .68+Math.min(2000,ageMyr)*.00004;
 if(crust==='mixed')return .43+Math.min(1000,ageMyr)*.000025;
 return Math.max(.08,.23-ageMyr*.00075);
}

function assignPlate(tectonics,xKm,zKm){
 const {sizeKm,warpSeed,plates}=tectonics;
 const broadFrequency=1.65/sizeKm,middleFrequency=4.8/sizeKm,fineFrequency=11.2/sizeKm,broadAmplitude=sizeKm*.105,middleAmplitude=sizeKm*.035,fineAmplitude=sizeKm*.012;
 const x=xKm+noise(xKm*broadFrequency,zKm*broadFrequency,warpSeed)*broadAmplitude+noise(xKm*middleFrequency+7,zKm*middleFrequency-5,warpSeed^0x6a09e667)*middleAmplitude+noise(xKm*fineFrequency-13,zKm*fineFrequency+17,warpSeed^0xbb67ae85)*fineAmplitude;
 const z=zKm+noise(xKm*broadFrequency+19,zKm*broadFrequency-11,warpSeed^0x3c6ef372)*broadAmplitude+noise(xKm*middleFrequency-17,zKm*middleFrequency+23,warpSeed^0xa54ff53a)*middleAmplitude+noise(xKm*fineFrequency+29,zKm*fineFrequency-31,warpSeed^0x510e527f)*fineAmplitude;
 let best=plates[0],bestDistance=Infinity;
 for(const plate of plates){
  const dx=x-plate.centerX,dz=z-plate.centerZ;
  const distance=dx*dx+dz*dz;
  if(distance<bestDistance){bestDistance=distance;best=plate;}
 }
 return best;
}

function smoothPolyline(points,passes=1){
 let result=points;
 for(let pass=0;pass<passes;pass++)result=result.map((point,i)=>i===0||i===result.length-1?point:{x:(result[i-1].x+point.x*2+result[i+1].x)/4,z:(result[i-1].z+point.z*2+result[i+1].z)/4});
 return result;
}

function curveBoundary(samples,{tx,tz,step,seed}){
 samples.sort((p,q)=>(p.x*tx+p.z*tz)-(q.x*tx+q.z*tz));
 const start=samples[0].x*tx+samples[0].z*tz,end=samples.at(-1).x*tx+samples.at(-1).z*tz,span=Math.max(step,end-start),bucketCount=Math.max(4,Math.min(24,Math.round(span/step)+1)),buckets=Array.from({length:bucketCount},()=>[]);
 for(const point of samples){const along=point.x*tx+point.z*tz,index=Math.min(bucketCount-1,Math.floor((along-start)/span*bucketCount));buckets[index].push(point);}
 let points=buckets.filter(bucket=>bucket.length).map(bucket=>({x:bucket.reduce((sum,p)=>sum+p.x,0)/bucket.length,z:bucket.reduce((sum,p)=>sum+p.z,0)/bucket.length}));
 if(points.length<3)return points;
 points=smoothPolyline(points,2);
 points=points.map((point,i)=>{
  if(i===0||i===points.length-1)return point;
  const before=points[i-1],after=points[i+1],dx=after.x-before.x,dz=after.z-before.z,length=Math.hypot(dx,dz)||1,t=i/(points.length-1),envelope=Math.sin(Math.PI*t),broad=noise(t*2.4,seed*.000001,seed),fine=noise(t*7.1+13,seed*.000002-9,seed^0x6a09e667),offset=step*(broad*.42+fine*.16)*envelope;
  return{x:point.x-dz/length*offset,z:point.z+dx/length*offset};
 });
 return smoothPolyline(points,1);
}

function polylineLength(points){let length=0;for(let i=1;i<points.length;i++)length+=Math.hypot(points[i].x-points[i-1].x,points[i].z-points[i-1].z);return length;}

function traceBoundaries(tectonics){
 const groups=new Map(),steps=72,min=-tectonics.paddingKm,max=tectonics.sizeKm+tectonics.paddingKm,step=(max-min)/steps;
 const ids=new Int16Array((steps+1)*(steps+1));
 for(let z=0;z<=steps;z++)for(let x=0;x<=steps;x++)ids[z*(steps+1)+x]=assignPlate(tectonics,min+x*step,min+z*step).id;
 const record=(a,b,x,z)=>{
  if(a===b)return;
  const key=pairKey(a,b);
  if(!groups.has(key))groups.set(key,[]);
  groups.get(key).push({x,z});
 };
 for(let z=0;z<=steps;z++)for(let x=0;x<=steps;x++){
  const i=z*(steps+1)+x,a=ids[i];
  if(x<steps)record(a,ids[i+1],min+(x+.5)*step,min+z*step);
  if(z<steps)record(a,ids[i+steps+1],min+x*step,min+(z+.5)*step);
 }
 const boundaries=[];
 for(const [key,samples] of groups){
  if(samples.length<3)continue;
  const [plateA,plateB]=key.split(':').map(Number),a=tectonics.plates[plateA],b=tectonics.plates[plateB];
  const dx=b.centerX-a.centerX,dz=b.centerZ-a.centerZ,length=Math.hypot(dx,dz)||1,nx=dx/length,nz=dz/length,tx=-nz,tz=nx;
  const curveSeed=(tectonics.warpSeed^Math.imul(plateA+1,73856093)^Math.imul(plateB+1,19349663))>>>0,points=curveBoundary(samples,{tx,tz,step,seed:curveSeed});
  if(points.length>=3)boundaries.push({plateA,plateB,nx,nz,tx,tz,points,lengthKm:polylineLength(points)});
 }
 return boundaries;
}

function boundaryKind(a,b,normalRate,shearRate){
 if(normalRate>.08)return a.crust==='continental'&&b.crust==='continental'?'collision':'subduction';
 if(normalRate<-.08)return'rift';
 return shearRate>.09?'transform':'inactive';
}

/** Plan a deterministic, padded plate graph for a fictional parent world. */
export function planTectonicPlates({seed=431970387,sizeKm=4800,padding=.22,continentCount=3,crustScale=1.15}={}){
 if(!Number.isFinite(sizeKm)||sizeKm<=0)throw new Error('Invalid tectonic domain size');
 if(!Number.isFinite(padding)||padding<0||padding>.5)throw new Error('Invalid tectonic padding');
 if(!Number.isInteger(continentCount)||continentCount<1||continentCount>4)throw new Error('Invalid continent block count');
 if(!Number.isFinite(crustScale)||crustScale<.6||crustScale>1.6)throw new Error('Invalid continental crust footprint');
 seed=Number(seed)>>>0;
 const r=random32(seed^0x9e3779b9),paddingKm=sizeKm*padding,count=7+Math.floor(r()*3),domain=sizeKm+paddingKm*2,slots=shuffledSlots(r),plates=[];
 for(let id=0;id<count;id++){
  const [sx,sz]=slots[id],cell=domain/3,centerX=-paddingKm+(sx+.18+r()*.64)*cell,centerZ=-paddingKm+(sz+.18+r()*.64)*cell;
  const roll=r(),crust=roll<.43?'continental':roll<.74?'oceanic':'mixed',ageMyr=crust==='oceanic'?8+r()*165:120+r()*1750,angle=r()*Math.PI*2,speed=.035+r()*.17;
  plates.push({id,centerX,centerZ,crust,ageMyr,buoyancy:crustBuoyancy(crust,ageMyr),velocityX:Math.cos(angle)*speed,velocityZ:Math.sin(angle)*speed});
 }
 const tectonics={seed,sizeKm,paddingKm,continentCount,crustScale,warpSeed:(seed^0x85ebca6b)>>>0,plates,boundaries:[],continents:[]};
 const raw=traceBoundaries(tectonics);
 if(!raw.length)throw new Error('Tectonic plate plan has no boundaries');

 // Select one long shared margin as the world's dominant active system. The
 // boundary class below is still derived from the resulting relative motion.
 const dominant=raw.reduce((best,item)=>item.lengthKm>best.lengthKm?item:best,raw[0]),a=plates[dominant.plateA],b=plates[dominant.plateB];
 a.crust='continental';a.ageMyr=450+r()*900;a.buoyancy=crustBuoyancy(a.crust,a.ageMyr);
 b.crust='oceanic';b.ageMyr=20+r()*110;b.buoyancy=crustBuoyancy(b.crust,b.ageMyr);
 const convergence=.13+r()*.08;
 a.velocityX=dominant.nx*convergence;a.velocityZ=dominant.nz*convergence;
 b.velocityX=-dominant.nx*convergence;b.velocityZ=-dominant.nz*convergence;

 const middle=dominant.points[Math.floor(dominant.points.length/2)],primaryAcross=(.15+r()*.035)*sizeKm*crustScale,primaryAlong=(.29+r()*.055)*sizeKm*crustScale,primaryAngle=Math.atan2(dominant.tz,dominant.tx);
 const primaryMargin=primaryAcross*.45,primaryX=Math.max(primaryMargin,Math.min(sizeKm-primaryMargin,middle.x-dominant.nx*primaryAcross*.48)),primaryZ=Math.max(primaryMargin,Math.min(sizeKm-primaryMargin,middle.z-dominant.nz*primaryAcross*.48));
 tectonics.continents.push({id:0,plateId:a.id,x:primaryX,z:primaryZ,angle:primaryAngle,rx:primaryAlong,rz:primaryAcross,ageMyr:a.ageMyr});
 const hosts=plates.filter(plate=>plate.id!==b.id);
 while(tectonics.continents.length<continentCount){
  const host=hosts[Math.floor(r()*hosts.length)];host.crust='continental';host.ageMyr=280+r()*1450;host.buoyancy=crustBuoyancy(host.crust,host.ageMyr);
  const rx=(.2+r()*.12)*sizeKm*crustScale,rz=(.12+r()*.1)*sizeKm*crustScale,margin=rz*.45,x=Math.max(margin,Math.min(sizeKm-margin,host.centerX+(r()-.5)*sizeKm*.11)),z=Math.max(margin,Math.min(sizeKm-margin,host.centerZ+(r()-.5)*sizeKm*.11));
  tectonics.continents.push({id:tectonics.continents.length,plateId:host.id,x,z,angle:r()*Math.PI,rx,rz,ageMyr:host.ageMyr});
 }

 tectonics.boundaries=raw.map((boundary,id)=>{
  const pa=plates[boundary.plateA],pb=plates[boundary.plateB],relativeX=pa.velocityX-pb.velocityX,relativeZ=pa.velocityZ-pb.velocityZ,normalRate=relativeX*boundary.nx+relativeZ*boundary.nz,signedShear=relativeX*boundary.tx+relativeZ*boundary.tz,shearRate=Math.abs(signedShear),kind=boundaryKind(pa,pb,normalRate,shearRate),polarity=kind==='subduction'?(pa.buoyancy>=pb.buoyancy?pa.id:pb.id):null;
  return{id,plateA:boundary.plateA,plateB:boundary.plateB,kind,polarity,normalRate,shearRate,signedShear,lengthKm:boundary.lengthKm,points:boundary.points};
 });
 return tectonics;
}

export function plateAt(tectonics,xKm,zKm){
 if(!tectonics?.plates?.length)throw new Error('Invalid tectonic plan');
 return assignPlate(tectonics,Number(xKm),Number(zKm));
}
