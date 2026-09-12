/** Clip only DISPLAY triangles. Source elevations, receivers and drainage
 * areas remain on the untouched parent graph; no crop boundary is a dam. */
export function clipMesh(mesh,box){
 const x=[],z=[],tri=[],samples=[],lookup=new Map(),{triangles:t}=mesh;
 const add=p=>{const key=p.x.toFixed(7)+','+p.z.toFixed(7);if(lookup.has(key))return lookup.get(key);const id=x.length;lookup.set(key,id);x.push(p.x-box.x);z.push(p.z-box.z);samples.push(p.w);return id;};
 function cut(poly,axis,limit,above){const out=[];for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],insideA=above?a[axis]>=limit-1e-9:a[axis]<=limit+1e-9,insideB=above?b[axis]>=limit-1e-9:b[axis]<=limit+1e-9;
  if(insideA)out.push(a);if(insideA!==insideB){const u=(limit-a[axis])/(b[axis]-a[axis]),weights=new Map(a.w.map(([id,w])=>[id,w*(1-u)]));for(const[id,w]of b.w)weights.set(id,(weights.get(id)||0)+w*u);out.push({x:a.x+(b.x-a.x)*u,z:a.z+(b.z-a.z)*u,w:[...weights].filter(([,w])=>w>1e-10)});}}
  return out;
 }
 for(let k=0;k<t.length;k+=3){const a=t[k],b=t[k+1],c=t[k+2];if(Math.max(mesh.x[a],mesh.x[b],mesh.x[c])<box.x||Math.min(mesh.x[a],mesh.x[b],mesh.x[c])>box.x+box.size||Math.max(mesh.z[a],mesh.z[b],mesh.z[c])<box.z||Math.min(mesh.z[a],mesh.z[b],mesh.z[c])>box.z+box.size)continue;
  let poly=[a,b,c].map(i=>({x:mesh.x[i],z:mesh.z[i],w:[[i,1]]}));for(const[axis,limit,above]of[['x',box.x,true],['x',box.x+box.size,false],['z',box.z,true],['z',box.z+box.size,false]]){poly=cut(poly,axis,limit,above);if(!poly.length)break;}
  for(let j=1;j<poly.length-1;j++){const p=poly[0],q=poly[j],r=poly[j+1],area=(q.x-p.x)*(r.z-p.z)-(r.x-p.x)*(q.z-p.z);if(area>1e-8)tri.push(add(p),add(q),add(r));}
 }
 if(!tri.length)throw new Error('Window has no terrain triangles');
 return{mesh:{x:Float64Array.from(x),z:Float64Array.from(z),triangles:Uint32Array.from(tri),sizeKm:box.size,n:Math.max(17,Math.round(Math.sqrt(x.length)))},samples,sourceIds:Int32Array.from(samples,s=>s.reduce((a,b)=>a[1]>b[1]?a:b)[0]),box};
}
export function interpolateClip(clip,values){return Float32Array.from(clip.samples,s=>s.reduce((a,[id,w])=>a+values[id]*w,0));}
/** Raster atlas honors the crop but never reruns drainage on its contents. */
export function rasterizeWindow(mesh,colors,width,box){
 const out=new Uint8ClampedArray(width*width*4),scale=(width-1)/box.size,{triangles:t}=mesh;
 for(let k=0;k<t.length;k+=3){const a=t[k],b=t[k+1],c=t[k+2],ax=(mesh.x[a]-box.x)*scale,az=(mesh.z[a]-box.z)*scale,bx=(mesh.x[b]-box.x)*scale,bz=(mesh.z[b]-box.z)*scale,cx=(mesh.x[c]-box.x)*scale,cz=(mesh.z[c]-box.z)*scale,den=(bx-ax)*(cz-az)-(bz-az)*(cx-ax);
  const x0=Math.max(0,Math.ceil(Math.min(ax,bx,cx)-1e-7)),x1=Math.min(width-1,Math.floor(Math.max(ax,bx,cx)+1e-7)),z0=Math.max(0,Math.ceil(Math.min(az,bz,cz)-1e-7)),z1=Math.min(width-1,Math.floor(Math.max(az,bz,cz)+1e-7));
  for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++){const wb=((x-ax)*(cz-az)-(z-az)*(cx-ax))/den,wc=((bx-ax)*(z-az)-(bz-az)*(x-ax))/den,wa=1-wb-wc;if(Math.min(wa,wb,wc)<-1e-7)continue;const i=(z*width+x)*4;for(let ch=0;ch<4;ch++)out[i+ch]=wa*colors[a*4+ch]+wb*colors[b*4+ch]+wc*colors[c*4+ch];}
 }return out;
}
