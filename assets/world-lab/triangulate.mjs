/* Adapted from Delaunator, https://github.com/mapbox/delaunator (index.js).
 * ISC License
 * Copyright (c) 2026, Mapbox
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
 * ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION
 * OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN
 * CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 *
 * Local adaptation: reduced public API, local double-precision orientation,
 * descriptive validation and positive X/Z winding. This is for the lab's
 * well-spaced synthetic sites, not a general robust GIS predicate library.
 */
const EPSILON=2**-52,EDGE_STACK=new Uint32Array(512);
const orient=(ax,ay,bx,by,cx,cy)=>(ay-cy)*(bx-cx)-(ax-cx)*(by-cy);
const dist=(ax,ay,bx,by)=>(ax-bx)**2+(ay-by)**2;
const pseudoAngle=(dx,dy)=>{const p=dx/(Math.abs(dx)+Math.abs(dy));return(dy>0?3-p:1+p)/4;};
function inCircle(ax,ay,bx,by,cx,cy,px,py){const dx=ax-px,dy=ay-py,ex=bx-px,ey=by-py,fx=cx-px,fy=cy-py,ap=dx*dx+dy*dy,bp=ex*ex+ey*ey,cp=fx*fx+fy*fy;return dx*(ey*cp-bp*fy)-dy*(ex*cp-bp*fx)+ap*(ex*fy-ey*fx)<0;}
function circumradius(ax,ay,bx,by,cx,cy){const dx=bx-ax,dy=by-ay,ex=cx-ax,ey=cy-ay,bl=dx*dx+dy*dy,cl=ex*ex+ey*ey,d=.5/(dx*ey-dy*ex),x=(ey*bl-dy*cl)*d,y=(dx*cl-ex*bl)*d;return x*x+y*y;}
function circumcenter(ax,ay,bx,by,cx,cy){const dx=bx-ax,dy=by-ay,ex=cx-ax,ey=cy-ay,bl=dx*dx+dy*dy,cl=ex*ex+ey*ey,d=.5/(dx*ey-dy*ex);return{x:ax+(ey*bl-dy*cl)*d,y:ay+(dx*cl-ex*bl)*d};}
function swap(a,i,j){const t=a[i];a[i]=a[j];a[j]=t;}
function quicksort(ids,dists,left,right){
  if(right-left<=20){for(let i=left+1;i<=right;i++){const temp=ids[i],v=dists[temp];let j=i-1;while(j>=left&&dists[ids[j]]>v)ids[j+1]=ids[j--];ids[j+1]=temp;}}
  else{const median=(left+right)>>1;let i=left+1,j=right;swap(ids,median,i);if(dists[ids[left]]>dists[ids[right]])swap(ids,left,right);if(dists[ids[i]]>dists[ids[right]])swap(ids,i,right);if(dists[ids[left]]>dists[ids[i]])swap(ids,left,i);const temp=ids[i],v=dists[temp];while(true){do i++;while(dists[ids[i]]<v);do j--;while(dists[ids[j]]>v);if(j<i)break;swap(ids,i,j);}ids[left+1]=ids[j];ids[j]=temp;if(right-i+1>=j-left){quicksort(ids,dists,i,right);quicksort(ids,dists,left,j-1);}else{quicksort(ids,dists,left,j-1);quicksort(ids,dists,i,right);}}
}
class Delaunator{
  constructor(coords){
    const n=coords.length>>1;this.coords=coords;this._triangles=new Uint32Array(Math.max(2*n-5,0)*3);this._halfedges=new Int32Array(this._triangles.length);
    this._hashSize=Math.ceil(Math.sqrt(n));this._hullPrev=new Uint32Array(n);this._hullNext=new Uint32Array(n);this._hullTri=new Uint32Array(n);this._hullHash=new Int32Array(this._hashSize);this._ids=new Uint32Array(n);this._dists=new Float64Array(n);this.trianglesLen=0;this._cx=0;this._cy=0;this._hullStart=0;this.update();
  }
  update(){
    const{coords,_hullPrev:hullPrev,_hullNext:hullNext,_hullTri:hullTri,_hullHash:hullHash}=this,n=coords.length>>1;let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for(let i=0;i<n;i++){const x=coords[2*i],y=coords[2*i+1];minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);this._ids[i]=i;}
    const cx=(minX+maxX)/2,cy=(minY+maxY)/2;let i0=0,i1=0,i2=0;
    for(let i=0,minDist=Infinity;i<n;i++){const d=dist(cx,cy,coords[2*i],coords[2*i+1]);if(d<minDist){i0=i;minDist=d;}}
    const i0x=coords[2*i0],i0y=coords[2*i0+1];
    for(let i=0,minDist=Infinity;i<n;i++){if(i===i0)continue;const d=dist(i0x,i0y,coords[2*i],coords[2*i+1]);if(d<minDist&&d>0){i1=i;minDist=d;}}
    let i1x=coords[2*i1],i1y=coords[2*i1+1],minRadius=Infinity;
    for(let i=0;i<n;i++){if(i===i0||i===i1)continue;const r=circumradius(i0x,i0y,i1x,i1y,coords[2*i],coords[2*i+1]);if(r<minRadius){i2=i;minRadius=r;}}
    let i2x=coords[2*i2],i2y=coords[2*i2+1];if(minRadius===Infinity)throw new Error('Collinear mesh sites');
    if(orient(i0x,i0y,i1x,i1y,i2x,i2y)<0){[i1,i2]=[i2,i1];[i1x,i2x]=[i2x,i1x];[i1y,i2y]=[i2y,i1y];}
    const center=circumcenter(i0x,i0y,i1x,i1y,i2x,i2y);this._cx=center.x;this._cy=center.y;
    for(let i=0;i<n;i++)this._dists[i]=dist(coords[2*i],coords[2*i+1],center.x,center.y);quicksort(this._ids,this._dists,0,n-1);
    this._hullStart=i0;let hullSize=3;hullNext[i0]=hullPrev[i2]=i1;hullNext[i1]=hullPrev[i0]=i2;hullNext[i2]=hullPrev[i1]=i0;hullTri[i0]=0;hullTri[i1]=1;hullTri[i2]=2;
    hullHash.fill(-1);hullHash[this._hashKey(i0x,i0y)]=i0;hullHash[this._hashKey(i1x,i1y)]=i1;hullHash[this._hashKey(i2x,i2y)]=i2;this.trianglesLen=0;this._addTriangle(i0,i1,i2,-1,-1,-1);
    for(let k=0,xp=0,yp=0;k<this._ids.length;k++){
      const i=this._ids[k],x=coords[2*i],y=coords[2*i+1];if(k>0&&Math.abs(x-xp)<=EPSILON&&Math.abs(y-yp)<=EPSILON)continue;xp=x;yp=y;if(i===i0||i===i1||i===i2)continue;
      let start=0;for(let j=0,key=this._hashKey(x,y);j<this._hashSize;j++){start=hullHash[(key+j)%this._hashSize];if(start!==-1&&start!==hullNext[start])break;}start=hullPrev[start];
      let e=start,q;while(q=hullNext[e],orient(x,y,coords[2*e],coords[2*e+1],coords[2*q],coords[2*q+1])>=0){e=q;if(e===start){e=-1;break;}}if(e===-1)continue;
      let t=this._addTriangle(e,i,hullNext[e],-1,-1,hullTri[e]);hullTri[i]=this._legalize(t+2);hullTri[e]=t;hullSize++;
      let next=hullNext[e];while(q=hullNext[next],orient(x,y,coords[2*next],coords[2*next+1],coords[2*q],coords[2*q+1])<0){t=this._addTriangle(next,i,q,hullTri[i],-1,hullTri[next]);hullTri[i]=this._legalize(t+2);hullNext[next]=next;hullSize--;next=q;}
      if(e===start){while(q=hullPrev[e],orient(x,y,coords[2*q],coords[2*q+1],coords[2*e],coords[2*e+1])<0){t=this._addTriangle(q,i,e,-1,hullTri[e],hullTri[q]);this._legalize(t+2);hullTri[q]=t;hullNext[e]=e;hullSize--;e=q;}}
      this._hullStart=hullPrev[i]=e;hullNext[e]=hullPrev[next]=i;hullNext[i]=next;hullHash[this._hashKey(x,y)]=i;hullHash[this._hashKey(coords[2*e],coords[2*e+1])]=e;
    }
    this.hull=new Uint32Array(hullSize);for(let i=0,e=this._hullStart;i<hullSize;i++){this.hull[i]=e;e=hullNext[e];}
    this.triangles=this._triangles.subarray(0,this.trianglesLen);
  }
  _hashKey(x,y){return Math.floor(pseudoAngle(x-this._cx,y-this._cy)*this._hashSize)%this._hashSize;}
  _legalize(a){
    const{_triangles:triangles,_halfedges:halfedges,coords}=this;let i=0,ar=0;
    while(true){const b=halfedges[a],a0=a-a%3;ar=a0+(a+2)%3;if(b===-1){if(i===0)break;a=EDGE_STACK[--i];continue;}
      const b0=b-b%3,al=a0+(a+1)%3,bl=b0+(b+2)%3,p0=triangles[ar],pr=triangles[a],pl=triangles[al],p1=triangles[bl];
      if(inCircle(coords[2*p0],coords[2*p0+1],coords[2*pr],coords[2*pr+1],coords[2*pl],coords[2*pl+1],coords[2*p1],coords[2*p1+1])){
        triangles[a]=p1;triangles[b]=p0;const hbl=halfedges[bl];if(hbl===-1){let e=this._hullStart;do{if(this._hullTri[e]===bl){this._hullTri[e]=a;break;}e=this._hullPrev[e];}while(e!==this._hullStart);}
        this._link(a,hbl);this._link(b,halfedges[ar]);this._link(ar,bl);const br=b0+(b+1)%3;if(i>=EDGE_STACK.length)throw new Error('Degenerate mesh: triangulation stack overflow');EDGE_STACK[i++]=br;
      }else{if(i===0)break;a=EDGE_STACK[--i];}
    }return ar;
  }
  _link(a,b){this._halfedges[a]=b;if(b!==-1)this._halfedges[b]=a;}
  _addTriangle(i0,i1,i2,a,b,c){const t=this.trianglesLen;this._triangles[t]=i0;this._triangles[t+1]=i1;this._triangles[t+2]=i2;this._link(t,a);this._link(t+1,b);this._link(t+2,c);this.trianglesLen+=3;return t;}
}
export function triangulate(x,z){
  if(x.length!==z.length||x.length<3)throw new TypeError('Invalid triangulation sites');const xy=new Float64Array(x.length*2);
  for(let i=0;i<x.length;i++){if(!Number.isFinite(x[i])||!Number.isFinite(z[i]))throw new TypeError('Non-finite mesh site');xy[2*i]=x[i];xy[2*i+1]=z[i];}
  const raw=new Delaunator(xy).triangles,out=raw.slice();
  for(let k=0;k<out.length;k+=3){const a=out[k],b=out[k+1],c=out[k+2];if((x[b]-x[a])*(z[c]-z[a])-(z[b]-z[a])*(x[c]-x[a])<0){out[k+1]=c;out[k+2]=b;}}
  return out;
}
