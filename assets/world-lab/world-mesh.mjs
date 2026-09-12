/** Irregular Delaunay terrain mesh in km (east / south).
 * Stratified, strongly jittered sites preserve sampling density, not grid
 * connections. Triangulation chooses all adjacency from real coordinates.
 */
import {triangulate} from './triangulate.mjs';
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
function random32(seed){let s=seed>>>0;return()=>{s=(s+0x6D2B79F5)>>>0;let t=s;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}

export function createTerrainMesh(n,sizeKm,seed=1){
  if(!Number.isInteger(n)||n<3||!Number.isFinite(sizeKm)||sizeKm<=0)throw new TypeError('Invalid mesh dimensions');
  const count=n*n,x=new Float64Array(count),z=new Float64Array(count),boundary=new Uint8Array(count);
  const stepKm=sizeKm/(n-1),rnd=random32(seed^0x476A314F),phase=rnd()*Math.PI*2;
  for(let row=0;row<n;row++)for(let col=0;col<n;col++){
    const id=row*n+col,u=col/(n-1),v=row/(n-1),inside=col>0&&col<n-1&&row>0&&row<n-1;
    // Warping and strong jitter break global compass axes. Triangulation,
    // rather than row/column adjacency, creates the drainage connections.
    const taper=Math.sin(Math.PI*u)*Math.sin(Math.PI*v);
    const wx=.014*taper*Math.sin(v*8+phase),wz=.014*taper*Math.cos(u*7+phase);
    x[id]=(u+wx)*sizeKm+(inside?(rnd()-.5)*.92*stepKm:0);
    z[id]=(v+wz)*sizeKm+(inside?(rnd()-.5)*.92*stepKm:0);
    boundary[id]=inside?0:1;
  }
  const triangles=triangulate(x,z);
  return meshTopology({n,sizeKm,stepKm,x,z,triangles,boundary});
}

/** Area is the triangle-barycentric dual: each triangle contributes a third
 * to each vertex. It partitions the domain exactly, including boundary nodes.
 */
export function meshTopology(mesh){
  const {x,z,triangles}=mesh,N=x.length,lists=Array.from({length:N},()=>new Set()),nodeArea=new Float64Array(N);
  for(let i=0;i<triangles.length;i+=3){
    const a=triangles[i],b=triangles[i+1],c=triangles[i+2];
    const area=((x[b]-x[a])*(z[c]-z[a])-(z[b]-z[a])*(x[c]-x[a]))/2;
    if(!(area>1e-10))throw new Error('Inverted/degenerate terrain triangle');
    for(const [p,q,r] of [[a,b,c],[b,c,a],[c,a,b]]){lists[p].add(q);lists[p].add(r);nodeArea[p]+=area/3;}
  }
  const offsets=new Uint32Array(N+1);for(let i=0;i<N;i++)offsets[i+1]=offsets[i]+lists[i].size;
  const neighbors=new Uint32Array(offsets[N]),distances=new Float64Array(offsets[N]);
  for(let i=0;i<N;i++){
    let k=offsets[i];for(const j of [...lists[i]].sort((a,b)=>a-b)){neighbors[k]=j;distances[k++]=Math.hypot(x[i]-x[j],z[i]-z[j]);}
  }
  return{...mesh,nodeArea,offsets,neighbors,distances};
}

/** Flat array spatial index for actual triangles. Also used by picking so
 * inspector coordinates and the rendered surface agree with the hydrology.
 */
export function indexMesh(mesh){
  const cells=Math.max(8,mesh.n-1),size=mesh.sizeKm,scale=cells/size,bins=Array.from({length:cells*cells},()=>[]),{x,z,triangles:t}=mesh;
  for(let i=0;i<t.length;i+=3){const a=t[i],b=t[i+1],c=t[i+2];
    const minX=clamp(Math.floor(Math.min(x[a],x[b],x[c])*scale),0,cells-1),maxX=clamp(Math.floor(Math.max(x[a],x[b],x[c])*scale),0,cells-1);
    const minZ=clamp(Math.floor(Math.min(z[a],z[b],z[c])*scale),0,cells-1),maxZ=clamp(Math.floor(Math.max(z[a],z[b],z[c])*scale),0,cells-1);
    for(let iz=minZ;iz<=maxZ;iz++)for(let ix=minX;ix<=maxX;ix++)bins[iz*cells+ix].push(i);
  }
  return{mesh,cells,scale,bins};
}
export function locateTriangle(index,px,pz){
  const {mesh,cells,scale,bins}=index,{x,z,triangles:t,sizeKm}=mesh;
  if(px<0||pz<0||px>sizeKm||pz>sizeKm)return null;
  const ix=clamp(Math.floor(px*scale),0,cells-1),iz=clamp(Math.floor(pz*scale),0,cells-1);
  for(const i of bins[iz*cells+ix]){
    const a=t[i],b=t[i+1],c=t[i+2],den=(x[b]-x[a])*(z[c]-z[a])-(z[b]-z[a])*(x[c]-x[a]);
    const wb=((px-x[a])*(z[c]-z[a])-(pz-z[a])*(x[c]-x[a]))/den;
    const wc=((x[b]-x[a])*(pz-z[a])-(z[b]-z[a])*(px-x[a]))/den,wa=1-wb-wc;
    if(wa>=-1e-7&&wb>=-1e-7&&wc>=-1e-7)return{a,b,c,wa,wb,wc};
  }
  return null;
}
export function interpolateAt(index,values,x,z){const q=locateTriangle(index,x,z);return q?q.wa*values[q.a]+q.wb*values[q.b]+q.wc*values[q.c]:null;}
export function nearestNode(index,x,z){
  const q=locateTriangle(index,x,z);if(!q)return-1;
  const mesh=index.mesh;let best=q.a,d=Infinity;
  for(const id of [q.a,q.b,q.c]){const v=(mesh.x[id]-x)**2+(mesh.z[id]-z)**2;if(v<d){best=id;d=v;}}
  return best;
}

/** Draw nodal colors at their real world locations, not row/column pixels. */
export function rasterizeColors(mesh,colors,width=1024){
  const out=new Uint8ClampedArray(width*width*4),scale=(width-1)/mesh.sizeKm,{x,z,triangles:t}=mesh;
  for(let i=0;i<t.length;i+=3){
    const a=t[i],b=t[i+1],c=t[i+2],ax=x[a]*scale,az=z[a]*scale,bx=x[b]*scale,bz=z[b]*scale,cx=x[c]*scale,cz=z[c]*scale;
    const den=(bx-ax)*(cz-az)-(bz-az)*(cx-ax);
    const x0=Math.max(0,Math.ceil(Math.min(ax,bx,cx)-1e-7)),x1=Math.min(width-1,Math.floor(Math.max(ax,bx,cx)+1e-7));
    const z0=Math.max(0,Math.ceil(Math.min(az,bz,cz)-1e-7)),z1=Math.min(width-1,Math.floor(Math.max(az,bz,cz)+1e-7));
    for(let iz=z0;iz<=z1;iz++)for(let ix=x0;ix<=x1;ix++){
      const wb=((ix-ax)*(cz-az)-(iz-az)*(cx-ax))/den,wc=((bx-ax)*(iz-az)-(bz-az)*(ix-ax))/den,wa=1-wb-wc;
      if(wa< -1e-7||wb< -1e-7||wc< -1e-7)continue;
      const k=(iz*width+ix)*4;for(let ch=0;ch<4;ch++)out[k+ch]=wa*colors[a*4+ch]+wb*colors[b*4+ch]+wc*colors[c*4+ch];
    }
  }
  return out;
}
