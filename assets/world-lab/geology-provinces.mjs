import {clamp,random32,noise} from './world-utils.mjs';

const TYPE_NAMES=['Weathered land','Glacial trough','Rift basin','Volcanic complex','River lowland'];
const mix=(a,b,t)=>a+(b-a)*t;
const ease=t=>{t=clamp(t,0,1);return t*t*(3-2*t);};

function weightedType(r){
  const x=r();
  if(x<.30)return 1;
  if(x<.49)return 2;
  if(x<.70)return 3;
  return 4;
}
function distance2(a,b){return(a.x-b.x)**2+(a.z-b.z)**2;}

export function planGeology({seed,sizeKm,northAxis,eastAxis,baseAt}){
  const r=random32(seed^0x7249A31D),families=3+Math.floor(r()*3),types=[];
  for(let i=0;i<families;i++)types.push(weightedType(r));
  if(new Set(types).size===1)types[types.length-1]=types[0]===4?1:4;
  const features=[];
  const add=f=>features.push({...f,id:features.length,typeName:TYPE_NAMES[f.type],salt:(seed+features.length*104729)>>>0});

  function glacialProvince(){
    const count=1+Math.floor(r()*2);
    for(let k=0;k<count;k++){
      const north=r()<.58;let start,end;
      if(north){
        start={x:(.18+r()*.62)*sizeKm,z:(northAxis+(r()-.5)*.035)*sizeKm};
        end={x:clamp(start.x+(r()-.5)*.20*sizeKm,.12*sizeKm,.82*sizeKm),z:(.40+r()*.25)*sizeKm};
      }else{
        start={x:(eastAxis+(r()-.5)*.035)*sizeKm,z:(.20+r()*.53)*sizeKm};
        end={x:(.45+r()*.22)*sizeKm,z:clamp(start.z+(r()-.5)*.20*sizeKm,.16*sizeKm,.80*sizeKm)};
      }
      const dx=end.x-start.x,dz=end.z-start.z,L=Math.max(1,Math.hypot(dx,dz)),nx=-dz/L,nz=dx/L,bend=(r()-.5)*.10*sizeKm;
      const points=[start,
        {x:mix(start.x,end.x,.30)+nx*bend,z:mix(start.z,end.z,.30)+nz*bend},
        {x:mix(start.x,end.x,.64)-nx*bend*.45,z:mix(start.z,end.z,.64)-nz*bend*.45},end];
      add({type:1,label:'Glacial valley',points,widthKm:(.010+r()*.007)*sizeKm,overdeepM:260+r()*360,sillM:70+r()*150});
    }
  }
  function riftProvince(){
    const angle=(r()-.5)*1.1+Math.PI/2,center={x:(.35+r()*.34)*sizeKm,z:(.35+r()*.32)*sizeKm};
    add({type:2,label:'Meandering rift',...center,angle,lengthKm:(.30+r()*.18)*sizeKm,widthKm:(.018+r()*.017)*sizeKm,
      depthM:320+r()*430,shoulderM:260+r()*440,wiggleKm:(.012+r()*.020)*sizeKm,wiggles:1.3+r()*1.7,phase:r()*Math.PI*2});
  }
  function volcanicProvince(){
    const wanted=1+Math.floor(r()*2),candidates=[];
    for(let iz=0;iz<19;iz++)for(let ix=0;ix<19;ix++){
      const x=(.12+ix/18*.75)*sizeKm,z=(.12+iz/18*.70)*sizeKm,b=baseAt(x,z);
      if(b.landBlend<.90||b.height<480)continue;
      const score=b.height+320*noise(ix*.43,iz*.43,seed+553)+r()*70;
      candidates.push({x,z,score,height:b.height});
    }
    candidates.sort((a,b)=>b.score-a.score);const chosen=[];
    for(const c of candidates){if(chosen.some(q=>distance2(c,q)<(.13*sizeKm)**2))continue;chosen.push(c);if(chosen.length===wanted)break;}
    for(const c of chosen){
      const uplift=1800+r()*1800,collapse=uplift*(.58+r()*.22);
      add({type:3,label:'Volcanic massif',x:c.x,z:c.z,hostElevationM:c.height,angle:r()*Math.PI,
        radiusKm:(.026+r()*.024)*sizeKm,axis:.72+r()*.20,upliftM:uplift,collapseM:collapse,rimM:360+r()*520,
        offsetAngle:r()*Math.PI*2,offsetRadius:.45+r()*.22});
    }
  }
  function riverProvince(){
    const angle=Math.PI/2+(r()-.5)*.48,center={x:(.31+r()*.35)*sizeKm,z:(.45+r()*.12)*sizeKm};
    add({type:4,label:'Inherited river valley',...center,angle,lengthKm:(.52+r()*.25)*sizeKm,widthKm:(.030+r()*.035)*sizeKm,
      depthM:60+r()*105,wiggleKm:(.018+r()*.026)*sizeKm,wiggles:1.4+r()*2.1,phase:r()*Math.PI*2});
  }
  for(const type of types){if(type===1)glacialProvince();else if(type===2)riftProvince();else if(type===3)volcanicProvince();else riverProvince();}
  const counts=new Uint8Array(TYPE_NAMES.length);for(const f of features)counts[f.type]++;
  return{features,counts,types:[...new Set(types)],typeNames:TYPE_NAMES};
}

function nearestPolyline(feature,x,z){
  const p=feature.points;let best=Infinity,bestT=0,total=0,lengths=[];
  for(let i=1;i<p.length;i++){const L=Math.hypot(p[i].x-p[i-1].x,p[i].z-p[i-1].z);lengths.push(L);total+=L;}
  let before=0;
  for(let i=1;i<p.length;i++){
    const a=p[i-1],b=p[i],dx=b.x-a.x,dz=b.z-a.z,L2=dx*dx+dz*dz,t=L2?clamp(((x-a.x)*dx+(z-a.z)*dz)/L2,0,1):0,px=a.x+t*dx,pz=a.z+t*dz,d=Math.hypot(x-px,z-pz);
    if(d<best){best=d;bestT=(before+t*lengths[i-1])/Math.max(1e-9,total);}before+=lengths[i-1];
  }
  return{distance:best,t:bestT};
}
function corridor(feature,x,z){
  const dx=x-feature.x,dz=z-feature.z,c=Math.cos(feature.angle),s=Math.sin(feature.angle),along=dx*c+dz*s,across=-dx*s+dz*c,t=along/(feature.lengthKm/2);
  const envelope=ease((1-Math.abs(t))/.20),meander=feature.wiggleKm*(Math.sin(t*Math.PI*feature.wiggles+feature.phase)+.24*Math.sin(t*Math.PI*(feature.wiggles*2.37)-feature.phase));
  const width=feature.widthKm*(.78+.20*Math.sin(t*5.1+feature.phase)+.16*noise(t*2.7,feature.id*.31,feature.salt));
  const rough=feature.type===2?.16:.09,dist=(across-meander)/Math.max(1,width)+rough*noise(x/feature.widthKm,z/feature.widthKm,feature.salt+71);
  return{t,envelope,dist,width};
}

export function applyGeology(plan,x,z,baseHeight){
  let land=baseHeight,strongest=.08,landHistory=0,feature=-1;
  for(const f of plan.features){let influence=0;
    if(f.type===1){
      const q=nearestPolyline(f,x,z),width=f.widthKm*(.58+.62*q.t)*(1+.15*noise(q.t*4,0,f.salt)),d=q.distance/Math.max(1,width),envelope=ease(q.t/.08)*ease((1-q.t)/.08);
      influence=Math.exp(-(d**3.2))*envelope;
      const overdeep=f.overdeepM*Math.exp(-(((q.t-.68)/.15)**2)),carve=(120+210*q.t+overdeep)*influence,sill=f.sillM*Math.exp(-(((q.t-.91)/.055)**2))*Math.exp(-((d/.85)**4));
      land+=-carve+sill;
    }else if(f.type===2){
      const q=corridor(f,x,z),d=Math.abs(q.dist);influence=Math.exp(-(d**3.3))*q.envelope;
      land-=f.depthM*Math.exp(-((d/.78)**3.5))*q.envelope;
      land+=f.shoulderM*Math.exp(-(((d-1.45)/.34)**2))*q.envelope;
    }else if(f.type===3){
      const dx=x-f.x,dz=z-f.z,c=Math.cos(f.angle),s=Math.sin(f.angle),a=(dx*c+dz*s)/f.radiusKm,b=(-dx*s+dz*c)/(f.radiusKm*f.axis),theta=Math.atan2(b,a);
      let rr=Math.hypot(a,b);rr*=1+.10*noise(x/f.radiusKm,z/f.radiusKm,f.salt)+.045*Math.sin(theta*5+f.offsetAngle);
      influence=Math.exp(-((rr/1.48)**4));
      const edifice=f.upliftM*Math.exp(-((rr/.92)**2)),rim=f.rimM*Math.exp(-(((rr-.35)/.105)**2)),collapse=f.collapseM*Math.exp(-((rr/.225)**4));
      const ox=Math.cos(f.offsetAngle)*f.offsetRadius,oz=Math.sin(f.offsetAngle)*f.offsetRadius,parasite=.14*f.upliftM*Math.exp(-(((a-ox)/.18)**2)-(((b-oz)/.18)**2));
      land+=edifice+rim-collapse+parasite;
    }else if(f.type===4){
      const q=corridor(f,x,z),d=Math.abs(q.dist);influence=Math.exp(-(d**2.8))*q.envelope;
      land-=f.depthM*Math.exp(-((d/.9)**2.8))*q.envelope;
    }
    if(influence>strongest){strongest=influence;landHistory=f.type;feature=f.id;}
  }
  return{height:land,landHistory,feature};
}
