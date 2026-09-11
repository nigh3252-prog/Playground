const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const mix=(a,b,t)=>a+(b-a)*t;

function rng32(seed){let s=seed>>>0;return()=>{s=(s+0x6D2B79F5)>>>0;let t=s;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296}}

function roadProfile(type){
  if(type==='arterial')return{frontage:[34,52],depth:[46,68],setback:9,gap:[3,7],relief:7,weights:[.78,.14,.08]};
  if(type==='collector')return{frontage:[25,38],depth:[36,54],setback:7,gap:[2.5,6],relief:6,weights:[.34,.46,.20]};
  return{frontage:[19,29],depth:[29,43],setback:5,gap:[2,5],relief:5,weights:[.08,.84,.08]};
}

function cumulative(points){const c=[0];for(let i=1;i<points.length;i++)c.push(c[i-1]+Math.hypot(points[i].x-points[i-1].x,points[i].z-points[i-1].z));return c}
function sampleRoad(points,cum,d){
  d=clamp(d,0,cum[cum.length-1]);let i=1;while(i<cum.length-1&&cum[i]<d)i++;
  const a=points[i-1],b=points[i],len=Math.max(1e-9,cum[i]-cum[i-1]),t=(d-cum[i-1])/len,dx=b.x-a.x,dz=b.z-a.z,h=Math.max(1e-9,Math.hypot(dx,dz));
  return{x:mix(a.x,b.x,t),z:mix(a.z,b.z,t),tx:dx/h,tz:dz/h};
}
function rect(center,tangent,normal,frontage,depth){
  const hf=frontage/2,hd=depth/2;
  return[
    {x:center.x-tangent.x*hf-normal.x*hd,z:center.z-tangent.z*hf-normal.z*hd},
    {x:center.x+tangent.x*hf-normal.x*hd,z:center.z+tangent.z*hf-normal.z*hd},
    {x:center.x+tangent.x*hf+normal.x*hd,z:center.z+tangent.z*hf+normal.z*hd},
    {x:center.x-tangent.x*hf+normal.x*hd,z:center.z-tangent.z*hf+normal.z*hd}
  ];
}
function bbox(poly){let minX=Infinity,minZ=Infinity,maxX=-Infinity,maxZ=-Infinity;for(const p of poly){minX=Math.min(minX,p.x);minZ=Math.min(minZ,p.z);maxX=Math.max(maxX,p.x);maxZ=Math.max(maxZ,p.z)}return{minX,minZ,maxX,maxZ}}
function boxesOverlap(a,b){return a.minX<b.maxX&&a.maxX>b.minX&&a.minZ<b.maxZ&&a.maxZ>b.minZ}
function project(poly,ax,az){let min=Infinity,max=-Infinity;for(const p of poly){const q=p.x*ax+p.z*az;min=Math.min(min,q);max=Math.max(max,q)}return[min,max]}
export function polygonsOverlap(a,b,padding=0){
  const axes=[];for(const poly of[a,b])for(let i=0;i<poly.length;i++){const p=poly[i],q=poly[(i+1)%poly.length],dx=q.x-p.x,dz=q.z-p.z,h=Math.hypot(dx,dz);if(h>1e-9)axes.push({x:-dz/h,z:dx/h})}
  for(const axis of axes){const A=project(a,axis.x,axis.z),B=project(b,axis.x,axis.z);if(A[1]+padding<=B[0]||B[1]+padding<=A[0])return false}return true;
}
function distancePointSegment(x,z,a,b){const dx=b.x-a.x,dz=b.z-a.z,l2=dx*dx+dz*dz,t=l2?clamp(((x-a.x)*dx+(z-a.z)*dz)/l2,0,1):0;return Math.hypot(x-(a.x+t*dx),z-(a.z+t*dz))}
function nearestRoadClearance(x,z,roads){let best=Infinity;for(const road of roads)for(let i=1;i<road.points.length;i++)best=Math.min(best,distancePointSegment(x,z,road.points[i-1],road.points[i])-road.width/2);return best}
function samples(poly,center){const out=[center,...poly];for(let i=0;i<4;i++)out.push({x:(poly[i].x+poly[(i+1)%4].x)/2,z:(poly[i].z+poly[(i+1)%4].z)/2});return out}
function landUse(type,r){const p=roadProfile(type),x=r();if(type==='arterial')return x<p.weights[0]?'commercial':x<p.weights[0]+p.weights[1]?'mixed':'civic';if(type==='collector')return x<p.weights[0]?'commercial':x<p.weights[0]+p.weights[1]?'residential':'mixed';return x<p.weights[0]?'neighborhood':x<p.weights[0]+p.weights[1]?'residential':'mixed'}

export function generateLots({roads,worldSize,heightAt,waterLevel,seed=1,maxLots=180}){
  if(!Array.isArray(roads)||typeof heightAt!=='function'||!(worldSize>0))throw new TypeError('Invalid lot generator inputs');
  const random=rng32(seed^0x51F15EED),half=worldSize/2,lots=[];
  for(let roadId=0;roadId<roads.length&&lots.length<maxLots;roadId++){
    const road=roads[roadId],profile=roadProfile(road.type),cum=cumulative(road.points),length=cum[cum.length-1];if(length<22)continue;
    for(const side of[-1,1]){
      let d=8+random()*18;
      while(d<length-8&&lots.length<maxLots){
        const frontage=mix(profile.frontage[0],profile.frontage[1],random()),depth=mix(profile.depth[0],profile.depth[1],random()),gap=mix(profile.gap[0],profile.gap[1],random());
        const hit=sampleRoad(road.points,cum,d+frontage/2),normal={x:-hit.tz*side,z:hit.tx*side},tangent={x:hit.tx,z:hit.tz},offset=road.width/2+profile.setback+depth/2,center={x:hit.x+normal.x*offset,z:hit.z+normal.z*offset},poly=rect(center,tangent,normal,frontage,depth),box=bbox(poly);
        let valid=box.minX>-half+4&&box.maxX<half-4&&box.minZ>-half+4&&box.maxZ<half-4;
        const pts=samples(poly,center),heights=[];
        if(valid){for(const s of pts){const h=heightAt(s.x,s.z);if(!Number.isFinite(h)){valid=false;break}heights.push(h);if(h<=waterLevel+1.4){valid=false;break}if(nearestRoadClearance(s.x,s.z,roads)<1.5){valid=false;break}}}
        if(valid&&Math.max(...heights)-Math.min(...heights)>profile.relief)valid=false;
        if(valid){for(const lot of lots){if(!boxesOverlap(box,lot.bbox))continue;if(polygonsOverlap(poly,lot.polygon,.8)){valid=false;break}}}
        if(valid){
          const use=landUse(road.type,random),elevation=heights.reduce((a,b)=>a+b,0)/heights.length;
          lots.push({id:lots.length,roadId,roadName:road.name,roadType:road.type,side,frontage,depth,setback:profile.setback,center,polygon:poly,bbox:box,elevation,landUse:use});
        }
        d+=frontage+gap;
      }
    }
  }
  return lots;
}

export function paintLots(ctx,lots){
  const fills={residential:'#899a72',commercial:'#a28d67',mixed:'#8e7f7e',civic:'#71878b',neighborhood:'#879578'};
  ctx.save();ctx.lineJoin='round';ctx.lineWidth=.42;ctx.strokeStyle='rgba(238,235,213,.62)';
  for(const lot of lots){ctx.beginPath();lot.polygon.forEach((p,i)=>i?ctx.lineTo(p.x,p.z):ctx.moveTo(p.x,p.z));ctx.closePath();ctx.globalAlpha=.72;ctx.fillStyle=fills[lot.landUse]||fills.residential;ctx.fill();ctx.globalAlpha=1;ctx.stroke()}
  ctx.restore();
}
