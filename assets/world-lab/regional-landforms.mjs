import {clamp,noise,random32} from './world-utils.mjs';

const ease=value=>{const t=clamp(value,0,1);return t*t*(3-2*t);};

/** Regional drowned relief, not a sea-level or glacial simulation.
 * Plans are anchored to the parent coast before erosion/water. Connected
 * valleys and bedrock ribs cross the old shoreline, so sea level can expose
 * headlands/islands and flood tributaries. Quiet lowlands keep gentler coasts.
 * All feature dimensions are in km; no child window or display pixels enter.
 */
export function planRegionalLandforms({seed,sizeKm,baseAt}){
 const r=random32(seed^0x4d595df4),steps=40,step=sizeKm/steps,heights=new Float64Array((steps+1)**2),candidates=[];
 for(let row=0;row<=steps;row++)for(let col=0;col<=steps;col++)heights[row*(steps+1)+col]=baseAt(col*step,row*step).height;
 function crossing(x,z,dx,dz,a,b){
  if((a>0)===(b>0)||a===b)return;
  const t=clamp(a/(a-b),0,1),cx=x+dx*t,cz=z+dz*t,d=step*.6;
  const gx=baseAt(clamp(cx+d,0,sizeKm),cz).height-baseAt(clamp(cx-d,0,sizeKm),cz).height;
  const gz=baseAt(cx,clamp(cz+d,0,sizeKm)).height-baseAt(cx,clamp(cz-d,0,sizeKm)).height;
  const length=Math.hypot(gx,gz);if(length<1)return;
  candidates.push({x:cx,z:cz,nx:gx/length,nz:gz/length,priority:r()});
 }
 for(let row=0;row<=steps;row++)for(let col=0;col<=steps;col++){
  const i=row*(steps+1)+col;
  if(col<steps)crossing(col*step,row*step,step,0,heights[i],heights[i+1]);
  if(row<steps)crossing(col*step,row*step,0,step,heights[i],heights[i+steps+1]);
 }
 candidates.sort((a,b)=>b.priority-a.priority);
 const provinces=[];
 for(const c of candidates){
  const radiusKm=sizeKm*(.075+r()*.045);
  if(provinces.some(p=>Math.hypot(c.x-p.x,c.z-p.z)<(radiusKm+p.radiusKm)*.72))continue;
  const rocky=noise(c.x/900,c.z/900,seed+2861)>-.2,kind=rocky?'drowned-uplands':'coastal-lowland',ridges=[],channels=[];
  // Coherent bedrock ribs extend seaward as well as inland. Their irregular
  // spacing, lengths and heights leave gaps instead of an unbroken seawall.
  for(let k=0;k<(rocky?5:2);k++)ridges.push({
   u:(r()-.6)*radiusKm*.8,v:(k/(rocky?4:1)-.5)*radiusKm*1.5+(r()-.5)*radiusKm*.15,
   angle:(r()-.5)*1.2,lengthKm:radiusKm*(.36+r()*.32),widthKm:radiusKm*(.10+r()*.09),
   heightM:rocky?240+r()*420:40+r()*85,bendKm:radiusKm*(r()-.5)*.18,phase:r()*Math.PI*2
  });
  const bend=(r()-.5)*radiusKm*.4,trunk=[{u:-radiusKm*.9,v:-bend*.5},{u:-radiusKm*.12,v:bend},{u:radiusKm*.35,v:-bend*.6},{u:radiusKm*.85,v:bend*.3}];
  const widthKm=radiusKm*(rocky?.105:.18),depthM=rocky?380+r()*320:100+r()*100;
  channels.push({points:trunk,widthKm,depthM});
  if(rocky)for(const side of [-1,1]){
   const join=trunk[side===-1?1:2];
   channels.push({points:[{...join},{u:join.u+radiusKm*.16,v:side*radiusKm*.3},{u:radiusKm*(.45+r()*.3),v:side*radiusKm*(.55+r()*.2)}],widthKm:widthKm*(.58+r()*.16),depthM:depthM*.82});
  }
  provinces.push({id:provinces.length,kind,x:c.x,z:c.z,nx:c.nx,nz:c.nz,radiusKm,ridges,channels});
 }
 return{model:'regional-drowned-relief-v1',provinces};
}

function channelDistance(points,u,v){
 let best=Infinity,along=0,before=0;
 for(let i=1;i<points.length;i++){
  const a=points[i-1],b=points[i],du=b.u-a.u,dv=b.v-a.v,length=Math.hypot(du,dv),t=clamp(((u-a.u)*du+(v-a.v)*dv)/(length*length||1),0,1),distance=Math.hypot(u-a.u-du*t,v-a.v-dv*t);
  if(distance<best){best=distance;along=before+t*length;}
  before+=length;
 }
 return{distance:best,t:along/Math.max(1,before)};
}

export function applyRegionalLandforms(plan,x,z,baseHeight){
 const shelf=ease((baseHeight+1100)/700)*ease((1800-baseHeight)/1000);
 if(shelf===0)return baseHeight;
 let relief=0;
 for(const p of plan.provinces){
  const dx=x-p.x,dz=z-p.z,radius=Math.hypot(dx,dz)/p.radiusKm;
  if(radius>=1.25)continue;
  const envelope=ease((1.25-radius)/.5),u=dx*p.nx+dz*p.nz,v=-dx*p.nz+dz*p.nx;
  let bedrock=0,incision=0;
  for(const ridge of p.ridges){
   const a=u-ridge.u,b=v-ridge.v,c=Math.cos(ridge.angle),s=Math.sin(ridge.angle),along=a*c+b*s,across=-a*s+b*c-ridge.bendKm*Math.sin(along/ridge.lengthKm*2+ridge.phase);
   const shape=Math.exp(-((along/ridge.lengthKm)**4)-(across/ridge.widthKm)**2);
   bedrock=Math.max(bedrock,ridge.heightM*shape*(.84+.16*Math.cos(along/ridge.lengthKm*5+ridge.phase)));
  }
  for(const channel of p.channels){
   const q=channelDistance(channel.points,u,v),width=channel.widthKm*(1-.55*q.t),head=ease((1-q.t)/.24);
   incision=Math.max(incision,channel.depthM*Math.exp(-((q.distance/width)**2))*head);
  }
  relief+=(bedrock-incision)*envelope;
 }
 return baseHeight+relief*shelf;
}
