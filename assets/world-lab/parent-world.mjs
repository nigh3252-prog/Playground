import {createTerrainMesh} from './world-mesh.mjs';
import {random32,noise,clamp} from './world-utils.mjs';
import {applyGeology} from './geology-provinces.mjs';
import {conditionRegionalDrainage} from './drainage-conditioning.mjs';
const mix=(a,b,t)=>a+(b-a)*t,gauss=x=>Math.exp(-(x*x));
function fbm(x,z,s){let out=0,a=.55,total=0;for(let k=0;k<5;k++){out+=a*noise(x,z,s+k*977);total+=a;x=x*2.03+13;z=z*2.03-7;a*=.5;}return out/total;}
function pathDistance(points,x,z){let best=Infinity;for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],dx=b.x-a.x,dz=b.z-a.z,t=clamp(((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz||1),0,1);best=Math.min(best,Math.hypot(x-a.x-t*dx,z-a.z-t*dz));}return best;}
/** The parent domain is physical; a window is only a view of that solution.
 * No coast/range is tied to the north/east/south/west edges of a child window.
 */
export function planParent(seed=431970387,sizeKm=4800){
 const r=random32(seed^0x263A172D),lands=[],ranges=[],features=[];
 for(let k=0;k<2+Math.floor(r()*2);k++)lands.push({x:(.12+.76*r())*sizeKm,z:(.12+.76*r())*sizeKm,angle:r()*Math.PI,rx:(.28+.3*r())*sizeKm,rz:(.18+.25*r())*sizeKm});
 for(let k=0;k<3+Math.floor(r()*4);k++){
  const x=(.12+.76*r())*sizeKm,z=(.12+.76*r())*sizeKm,a=r()*Math.PI,L=(.25+.55*r())*sizeKm,points=[];
  for(let j=0;j<5;j++){const t=j/4-.5,bend=(r()-.5)*L*.22;points.push({x:x+Math.cos(a)*t*L-Math.sin(a)*bend,z:z+Math.sin(a)*t*L+Math.cos(a)*bend});}
  ranges.push({points,width:65+r()*135,height:1700+r()*1800});
 }
 function baseAt(x,z){
  const u=x/sizeKm,v=z/sizeKm,wx=x+sizeKm*.033*fbm(u*4,v*4,seed+11),wz=z+sizeKm*.033*fbm(u*4,v*4,seed+19);
  let continent=0;for(const l of lands){const dx=wx-l.x,dz=wz-l.z,c=Math.cos(l.angle),s=Math.sin(l.angle),d=((dx*c+dz*s)/l.rx)**2+((-dx*s+dz*c)/l.rz)**2;continent=Math.max(continent,Math.exp(-d));}
  const signal=continent-.37+.12*fbm(u*4,v*4,seed+5),coastFade=clamp(signal/.13,0,1);
  if(signal<0)return{height:Math.max(-4200,signal*12500),landBlend:0};
  let ridge=0;for(let k=0;k<ranges.length;k++){const range=ranges[k],d=pathDistance(range.points,wx,wz)/range.width,h=range.height*(.76+.28*fbm(u*12,v*12,seed+k*91));ridge=Math.max(ridge,h*gauss(d));}
  const plain=80+signal*800+135*fbm(u*12,v*12,seed+81)+60*fbm(u*38,v*38,seed+44);
  return{height:Math.max(0,plain+ridge)*coastFade,landBlend:coastFade};
 }
 const add=f=>features.push({...f,id:features.length,salt:(seed+features.length*104729)>>>0});
 for(let k=0;k<ranges.length;k++){
  const p=ranges[k].points[1+Math.floor(r()*3)],host=baseAt(p.x,p.z);if(host.landBlend<.95||host.height<900)continue;
  if(r()<.7){let end=null,h=Infinity;for(let j=0;j<12;j++){const a=j*Math.PI/6,L=180+r()*180,q={x:p.x+Math.cos(a)*L,z:p.z+Math.sin(a)*L},v=baseAt(q.x,q.z).height;if(v<h&&v>50){h=v;end=q;}}if(end){const dx=end.x-p.x,dz=end.z-p.z,L=Math.hypot(dx,dz),bend=(r()-.5)*70;add({type:1,label:'Glaciated mountain valley',points:[p,{x:mix(p.x,end.x,.35)-dz/L*bend,z:mix(p.z,end.z,.35)+dx/L*bend},{x:mix(p.x,end.x,.7)+dz/L*bend*.4,z:mix(p.z,end.z,.7)-dx/L*bend*.4},end],widthKm:10+r()*13,overdeepM:130+r()*260,sillM:25+r()*80});}}
  if(r()<.48){add({type:3,label:'Volcanic mountain complex',x:p.x,z:p.z,hostElevationM:host.height,angle:r()*Math.PI,radiusKm:30+r()*35,axis:.7+r()*.25,upliftM:850+r()*1400,collapseM:550+r()*700,rimM:180+r()*280,offsetAngle:r()*Math.PI*2,offsetRadius:.45+r()*.2});}
 }
 for(let k=0;k<2+Math.floor(r()*3);k++){const x=(.15+.7*r())*sizeKm,z=(.15+.7*r())*sizeKm,b=baseAt(x,z);if(b.landBlend<.98)continue;const type=r()<.42?2:4;add({type,label:type===2?'Inherited rift province':'Old valley province',x,z,angle:r()*Math.PI,lengthKm:300+r()*600,widthKm:15+r()*35,depthM:type===2?180+r()*390:40+r()*110,shoulderM:type===2?120+r()*260:0,wiggleKm:15+r()*40,wiggles:1+r()*2,phase:r()*Math.PI*2});}
 return{seed,sizeKm,lands,ranges,features,baseAt};
}
export function generateParentTerrain(options={}){
 const seed=Number(options.seed??431970387)>>>0,windowKm=Number(options.sizeKm||1200),sizeKm=Number(options.parentKm||Math.max(3600,Math.min(6000,windowKm*4))),n=options.parentN||({129:193,193:257,241:321}[options.n]||257);
 if(!Number.isFinite(windowKm)||!Number.isFinite(sizeKm)||windowKm<200||windowKm>=sizeKm*.94||sizeKm<3000||sizeKm>6000||!Number.isInteger(n)||n<17||n>321)throw new Error('Invalid parent/window dimensions');
 for(const [key,lo,hi] of [['relief',.5,1.6],['rain',.4,1.8]])if(options[key]!==undefined&&(!Number.isFinite(Number(options[key]))||Number(options[key])<lo||Number(options[key])>hi))throw new Error('Invalid '+key);
 if(options.wind!==undefined&&!['west','east'].includes(options.wind))throw new Error('Invalid wind');
 const plan=planParent(seed,sizeKm),mesh=createTerrainMesh(n,sizeKm,seed),N=n*n,height=new Float32Array(N),landHistory=new Uint8Array(N),featureAt=new Int16Array(N).fill(-1),ocean=new Uint8Array(N);
 for(let i=0;i<N;i++){const b=plan.baseAt(mesh.x[i],mesh.z[i]),g=b.landBlend>.9?applyGeology(plan,mesh.x[i],mesh.z[i],b.height):{height:b.height,landHistory:0,feature:-1};height[i]=g.height*Number(options.relief||1);landHistory[i]=g.landHistory;featureAt[i]=g.feature;}
 const queue=new Int32Array(N);let head=0,tail=0;for(let i=0;i<N;i++)if(mesh.boundary[i]&&height[i]<=0){ocean[i]=1;queue[tail++]=i;}
 while(head<tail){const i=queue[head++];for(let k=mesh.offsets[i];k<mesh.offsets[i+1];k++){const j=mesh.neighbors[k];if(!ocean[j]&&height[j]<=0){ocean[j]=1;queue[tail++]=j;}}}
 const terrain={version:'regional-world-v6',stage:1,n,stepKm:mesh.stepKm,config:{seed,n,sizeKm,relief:Number(options.relief||1),rain:Number(options.rain||1),wind:options.wind||'west',source:'generated'},mesh,height,ocean,landHistory,featureAt,features:plan.features,geology:{lands:plan.lands,ranges:plan.ranges,features:plan.features,source:'Seeded continental parent; no child-edge barriers'},erosion:null,parentDomain:{sizeKm,windowKm,seed,nominalSpacingKm:mesh.stepKm,regionalDetail:options.n||193,solverExtent:'entire parent before cropping'}};
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
