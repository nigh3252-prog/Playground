/** Regional World Lab v1. Synthetic geography, NOT survey/forecast data.
 * Coordinates: grid X east, Z south; horizontal km; elevations meters.
 * Hydrology: Priority-Flood spill levels + D8 descent, ranked flat resolution.
 * Climate is a deliberately small rain-shadow heuristic, not a climate model.
 */
export const VERSION = 'regional-world-v1';
export const BIOMES = [
  ['Ocean', '#244859'], ['Lake', '#397b92'], ['Wetland', '#547e68'],
  ['Wet forest', '#285c49'], ['Temperate forest', '#49784f'],
  ['Open woodland', '#7d925e'], ['Grassland', '#a8af70'],
  ['Dry steppe', '#b4a177'], ['Arid scrub', '#ccb491'],
  ['Mountain forest', '#4d6860'], ['Alpine tundra', '#92988c'],
  ['Snow / ice', '#e5e8df']
];
export const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
const mix=(a,b,t)=>a+(b-a)*t, ease=t=>{t=clamp(t,0,1);return t*t*(3-2*t);};
export function random32(seed){let s=seed>>>0;return()=>{s=(s+0x6D2B79F5)>>>0;let t=s;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}
function hash(x,z,s){let k=Math.imul(x^s,374761393)+Math.imul(z^(s>>>7),668265263);k=Math.imul(k^(k>>>13),1274126177);return((k^(k>>>16))>>>0)/4294967295;}
export function noise(x,z,s){const ix=Math.floor(x),iz=Math.floor(z),a=ease(x-ix),b=ease(z-iz);return mix(mix(hash(ix,iz,s),hash(ix+1,iz,s),a),mix(hash(ix,iz+1,s),hash(ix+1,iz+1,s),a),b)*2-1;}
function fbm(x,z,s,octaves=5){let v=0,a=.55,sum=0;for(let k=0;k<octaves;k++){v+=a*noise(x,z,s+k*9173);sum+=a;x=x*2.03+11.3;z=z*2.03-4.7;a*=.49;}return v/sum;}
export function normalizeConfig(input={}){
  const c={seed:431970387,n:193,sizeKm:1200,relief:1,rain:1,wind:'west',...input};
  if(!Number.isFinite(Number(c.seed)))throw new TypeError('Seed must be a number');
  c.seed=Number(c.seed)>>>0;
  if(!Number.isInteger(c.n)||c.n<17||c.n>321)throw new RangeError('Grid must be 17–321 samples across');
  for(const [k,lo,hi] of [['sizeKm',400,3000],['relief',.5,1.6],['rain',.4,1.8]]){
    if(!Number.isFinite(c[k])||c[k]<lo||c[k]>hi)throw new RangeError(`Invalid ${k}`);
  }
  if(!['west','east'].includes(c.wind))throw new RangeError('Wind must be west or east');
  return c;
}
function neighbors(i,n,fn){const x=i%n,z=(i/n)|0;for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++){
  if(!(dx||dz)||x+dx<0||x+dx>=n||z+dz<0||z+dz>=n)continue;
  fn(i+dz*n+dx,dx&&dz?Math.SQRT2:1);
}}
function boundary(i,n){return i<n||i>=n*(n-1)||i%n===0||i%n===n-1;}
export function cellArea(i,n,sizeKm){const x=i%n,z=(i/n)|0;return(sizeKm/(n-1))**2*(x===0||x===n-1?.5:1)*(z===0||z===n-1?.5:1);}

export function generateTerrain(input={}){
  const config=normalizeConfig(input),{n,seed,relief,sizeKm}=config,rand=random32(seed);
  const phase=rand()*6.28,phase2=rand()*6.28,north=.12+rand()*.055,east=.77+rand()*.09;
  const h=new Float32Array(n*n);
  for(let z=0;z<n;z++)for(let x=0;x<n;x++){
    const u=x/(n-1),v=z/(n-1),wx=u+.035*fbm(u*4,v*4,seed+92),wz=v+.035*fbm(u*4,v*4,seed+183);
    const coast=.09+.045*Math.sin(v*8+phase)+.045*fbm(u*5,v*6,seed+100);
    const south=.87+.045*Math.sin(u*7+phase2)+.035*fbm(u*5,v*5,seed+888);
    const landDistance=Math.min(u-coast,south-v),landBlend=ease((landDistance+.04)/.13);
    const continental=140+650*(1-v)+110*u+210*fbm(wx*2.6,wz*2.6,seed+11);
    const nAxis=north+.045*Math.sin(wx*9+phase)+.02*noise(wx*6,0,seed+12);
    const eAxis=east+.055*Math.sin(wz*7+phase2);
    const nBand=Math.exp(-(((wz-nAxis)/.095)**2)),eBand=Math.exp(-(((wx-eAxis)/.088)**2));
    const ridges=(1-Math.abs(fbm(wx*15,wz*15,seed+222,4)))**2;
    const highlands=Math.max(nBand,eBand)*(1500+2100*ridges)+Math.min(nBand,eBand)*370;
    const diagonal=Math.exp(-(((wx-.37-wz*.25)/.078)**2))*Math.exp(-(((wz-.47)/.33)**2));
    const oldRange=diagonal*(180+450*(1-Math.abs(fbm(wx*9,wz*9,seed+434)))**2);
    const basin=-110*Math.exp(-(((wx-.53)/.20)**2)-((wz-.60)/.23)**2);
    const detail=100*fbm(wx*22,wz*22,seed+32,3)*(1+highlands/900);
    const land=(continental+highlands+oldRange+basin+detail)*relief;
    const seabed=-120-2000*clamp(-landDistance*6,0,1)+100*fbm(u*6,v*6,seed+54);
    h[z*n+x]=mix(seabed,land,landBlend);
  }
  // One gentle talus pass: keep large ridges, reduce single-cell spikes.
  const original=h.slice();
  for(let z=1;z<n-1;z++)for(let x=1;x<n-1;x++){
    const i=z*n+x;h[i]=original[i]*.82+(original[i-1]+original[i+1]+original[i-n]+original[i+n])*.045;
  }
  const ocean=new Uint8Array(n*n),queue=new Int32Array(n*n);let head=0,tail=0;
  for(let i=0;i<h.length;i++)if(boundary(i,n)&&h[i]<=0){ocean[i]=1;queue[tail++]=i;}
  while(head<tail){const i=queue[head++];neighbors(i,n,j=>{if(!ocean[j]&&h[j]<=0){ocean[j]=1;queue[tail++]=j;}});}
  const slope=new Float32Array(n*n),stepM=sizeKm/(n-1)*1000;
  for(let i=0;i<h.length;i++){let s=0;neighbors(i,n,(j,d)=>s=Math.max(s,Math.abs(h[i]-h[j])/(d*stepM)));slope[i]=s;}
  return{version:VERSION,config,n,stepKm:sizeKm/(n-1),height:h,ocean,slope,stage:1};
}

/** Stable binary min-heap. Same seed has the same tie-breaking on every run. */
class Heap{
  constructor(values){this.a=[];this.v=values;}
  less(a,b){return this.v[a]<this.v[b]||(this.v[a]===this.v[b]&&a<b);}
  push(id){const a=this.a;let i=a.length;a.push(id);while(i>0){const p=(i-1)>>1;if(!this.less(id,a[p]))break;a[i]=a[p];i=p;}a[i]=id;}
  pop(){const a=this.a,out=a[0],last=a.pop();if(a.length){let i=0;while(i*2+1<a.length){let c=i*2+1;if(c+1<a.length&&this.less(a[c+1],a[c]))c++;if(!this.less(a[c],last))break;a[i]=a[c];i=c;}a[i]=last;}return out;}
  get length(){return this.a.length;}
}
/** An outlet-resolved surface is kept SEPARATE from pristine physical terrain.
 * Lake water fills real depressions to their spill height; routing across flats
 * follows earlier flood rank, ensuring no cycles without a fictitious slope.
 * Land at map edges can drain out of the region: borders are NOT sealed dams.
 */
export function generateHydrology(terrain){
  const {n,height:h,ocean,config}=terrain,N=n*n,filled=new Float64Array(N),seen=new Uint8Array(N);
  const rank=new Int32Array(N),order=new Int32Array(N),parent=new Int32Array(N).fill(-1),heap=new Heap(filled);
  for(let i=0;i<N;i++)if(ocean[i]||boundary(i,n)){filled[i]=ocean[i]?0:h[i];seen[i]=1;heap.push(i);}
  let count=0;
  while(heap.length){const i=heap.pop();rank[i]=count;order[count++]=i;neighbors(i,n,j=>{
    if(seen[j])return;seen[j]=1;filled[j]=Math.max(h[j],filled[i]);parent[j]=i;heap.push(j);
  });}
  if(count!==N)throw new Error('Incomplete drainage coverage');
  const receiver=new Int32Array(N).fill(-1),area=new Float64Array(N),basin=new Int32Array(N).fill(-1),lake=new Uint8Array(N);
  for(let i=0;i<N;i++){
    if(ocean[i])continue;area[i]=cellArea(i,n,config.sizeKm);
    lake[i]=filled[i]-h[i]>.5?1:0;
    let best=-1,bestSlope=0;
    neighbors(i,n,(j,d)=>{if(rank[j]>=rank[i])return;const slope=(filled[i]-filled[j])/d;
      if(slope>bestSlope+1e-9){bestSlope=slope;best=j;}
    });
    if(best<0){
      // Rank descent on plateaus / lakes; parent gives a guaranteed spill route.
      if(parent[i]>=0)best=parent[i];
      else neighbors(i,n,j=>{if(filled[j]<=filled[i]&&rank[j]<rank[i]&&(best<0||rank[j]<rank[best]))best=j;});
    }
    receiver[i]=best;
  }
  for(let k=N-1;k>=0;k--){const i=order[k],r=receiver[i];if(r>=0&&!ocean[r])area[r]+=area[i];}
  const outlets=[];
  for(let k=0;k<N;k++){
    const i=order[k];if(ocean[i])continue;const r=receiver[i];
    basin[i]=r<0||ocean[r]?i:basin[r];
    if(r<0||ocean[r])outlets.push({id:i,areaKm2:area[i],kind:r>=0?'sea':'edge',x:i%n,z:(i/n)|0});
  }
  outlets.sort((a,b)=>b.areaKm2-a.areaKm2);
  const words=['Alder','Morrow','Kestrel','Bracken','Rook','Sable','Vale','Elowen','Tarn','Rowan','Lark','Cairn'];
  const shift=config.seed%words.length;
  outlets.forEach((o,i)=>{o.name=i<12?`${words[(i+shift)%words.length]} basin`:`Coastal catchment ${i+1}`;});
  const threshold=Math.max(500,config.sizeKm**2*.00055),river=new Uint8Array(N),confluences=[];
  for(let i=0;i<N;i++)if(!ocean[i]&&area[i]>=threshold&&receiver[i]>=0)river[i]=1;
  const tributaries=new Uint8Array(N);
  for(let i=0;i<N;i++){const r=receiver[i];if(river[i]&&r>=0&&!ocean[r])tributaries[r]++;}
  for(let i=0;i<N;i++)if(tributaries[i]>=2&&!lake[i])confluences.push(i);
  const lakeSeen=new Uint8Array(N),lakeBodies=[],queue=new Int32Array(N);
  for(let start=0;start<N;start++)if(lake[start]&&!lakeSeen[start]){
    let head=0,tail=0,areaKm2=0,maxDepth=0;queue[tail++]=start;lakeSeen[start]=1;
    while(head<tail){const i=queue[head++];areaKm2+=cellArea(i,n,config.sizeKm);maxDepth=Math.max(maxDepth,filled[i]-h[i]);neighbors(i,n,j=>{
      if(lake[j]&&!lakeSeen[j]&&Math.abs(filled[j]-filled[i])<.01){lakeSeen[j]=1;queue[tail++]=j;}
    });}
    lakeBodies.push({id:start,areaKm2,maxDepth,level:filled[start],cells:tail});
  }
  lakeBodies.sort((a,b)=>b.areaKm2-a.areaKm2);
  return{...terrain,filled,receiver,rank,order,area,basin,lake,outlets,river,confluences,lakeBodies,riverThresholdKm2:threshold,stage:2};
}

/** Approximate west/east wind, ocean moisture, windward uplift and lee drying.
 * Values are synthetic long-term indices expressed in familiar units.
 * Climate changes runoff magnitude, not the deterministic drainage topology.
 */
export function generateEcology(world){
  if(world.stage<2)throw new Error('Hydrology required before ecology');
  const {n,height:h,ocean,lake,slope,river,receiver,order,config}=world,N=n*n;
  const rainfall=new Float32Array(N),temperature=new Float32Array(N),biome=new Uint8Array(N),runoff=new Float64Array(N);
  for(let z=0;z<n;z++){
    let humidity=1,last=0;const v=z/(n-1);
    for(let k=0;k<n;k++){
      const x=config.wind==='west'?k:n-1-k,i=z*n+x,u=x/(n-1),e=Math.max(0,h[i]);
      const rise=Math.max(0,(e-last)/1000),fall=Math.max(0,(last-e)/1000);
      if(ocean[i])humidity=1;
      else humidity=clamp(humidity*Math.exp(-rise*.75-fall*.25-1.1/(n-1))+(lake[i]?.025:.13/(n-1)),.04,1);
      const coastal=80+80*(1-v),texture=1+.18*fbm(u*4,v*4,config.seed+907);
      rainfall[i]=clamp((coastal+humidity*1250+humidity*rise*2700)*texture*config.rain,70,3600);
      temperature[i]=7+v*12-e*.0058+noise(u*3,v*3,config.seed+399)*1.4;
      last=e;
    }
  }
  // Distance to major wet surfaces; a regional saturation proxy, not a wetland delineation.
  const wetDist=new Int32Array(N).fill(1e6),queue=new Int32Array(N);let head=0,tail=0;
  for(let i=0;i<N;i++)if(ocean[i]||lake[i]||river[i]){wetDist[i]=0;queue[tail++]=i;}
  while(head<tail){const i=queue[head++];if(wetDist[i]>=3)continue;neighbors(i,n,j=>{if(wetDist[j]>wetDist[i]+1){wetDist[j]=wetDist[i]+1;queue[tail++]=j;}});}
  const counts=new Float64Array(BIOMES.length);
  for(let i=0;i<N;i++){
    const rain=rainfall[i],temp=temperature[i],e=h[i];let b;
    if(ocean[i])b=0;else if(lake[i])b=1;
    else if(temp<-5||(e>3700&&temp<1))b=11;
    else if(temp<1.5||e>2900)b=10;
    else if(wetDist[i]<=1&&slope[i]<.004&&rain>850&&e<600)b=2;
    else if(e>1300&&rain>550)b=9;
    else if(rain>1350)b=3;
    else if(rain>980)b=4;
    else if(rain>720)b=5;
    else if(rain>490)b=6;
    else if(rain>300)b=7;else b=8;
    biome[i]=b;counts[b]+=cellArea(i,n,config.sizeKm);
    if(!ocean[i]){
      const evap=clamp(.68+temp*.012,.38,.90),mm=rain*(1-evap);
      runoff[i]=mm/1000*cellArea(i,n,config.sizeKm)*1e6/(365.25*24*3600);
    }
  }
  for(let k=N-1;k>=0;k--){const i=order[k],r=receiver[i];if(r>=0&&!ocean[r])runoff[r]+=runoff[i];}
  return{...world,rainfall,temperature,biome,runoff,biomeAreas:counts,stage:3};
}
export function generateWorld(config={}){return generateEcology(generateHydrology(generateTerrain(config)));}
export function drainageTrace(world,start){
  if(!world.receiver||!Number.isInteger(start)||start<0||start>=world.height.length)return[];
  const path=[];let i=start;
  while(i>=0&&path.length<=world.height.length){path.push(i);if(world.ocean[i])break;i=world.receiver[i];}
  if(path.length>world.height.length)throw new Error('Drainage cycle');
  return path;
}
export function summary(world){
  let land=0,wet=0,highest=-Infinity;for(let i=0;i<world.height.length;i++){
    highest=Math.max(highest,world.height[i]);if(!world.ocean[i])land+=cellArea(i,world.n,world.config.sizeKm);
    if(world.lake?.[i])wet+=cellArea(i,world.n,world.config.sizeKm);
  }
  return{landKm2:land,landPercent:land/world.config.sizeKm**2*100,peakM:highest,lakeKm2:wet,
    majorBasins:world.outlets?.filter(o=>o.areaKm2>=world.config.sizeKm**2*.01).length??0,
    confluences:world.confluences?.length??0};
}
