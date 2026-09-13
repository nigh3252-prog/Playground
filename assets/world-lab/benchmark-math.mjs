/** Pure benchmark math. No observations are used by the physical generator. */
export const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function quantile(values,p){const a=Array.from(values).filter(Number.isFinite).sort((a,b)=>a-b);if(!a.length)return null;const t=clamp(p,0,1)*(a.length-1),i=Math.floor(t);return a[i]+(a[Math.min(i+1,a.length-1)]-a[i])*(t-i);}
export function weightedQuantile(values,weights,p){const ids=Array.from(values,(_,i)=>i).filter(i=>Number.isFinite(values[i])&&weights[i]>0).sort((a,b)=>values[a]-values[b]);const total=ids.reduce((s,i)=>s+weights[i],0);if(!total)return null;let used=0;for(const i of ids){used+=weights[i];if(used>=p*total)return values[i];}return values[ids.at(-1)];}
export function confusion(pred,obs,mask,area=1){
 if(pred.length!==obs.length||mask.length!==pred.length)throw new Error('Mismatched evaluation grids');
 let tp=0,fp=0,fn=0,tn=0,excluded=0;for(let i=0;i<pred.length;i++){const a=typeof area==='number'?area:area[i];if(!mask[i]){excluded+=a;continue;}if(pred[i])obs[i]?tp+=a:fp+=a;else obs[i]?fn+=a:tn+=a;}
 const ratio=(a,b)=>b>0?a/b:null;return{truePositiveKm2:tp,falsePositiveKm2:fp,falseNegativeKm2:fn,trueNegativeKm2:tn,excludedKm2:excluded,evaluatedKm2:tp+fp+fn+tn,predictedKm2:tp+fp,observedKm2:tp+fn,precision:ratio(tp,tp+fp),recall:ratio(tp,tp+fn),iou:ratio(tp,tp+fp+fn),f1:ratio(2*tp,2*tp+fp+fn),areaBiasKm2:fp-fn,areaBiasPercent:ratio((fp-fn)*100,tp+fn)};
}
export function components(mask,n,pixelArea){
 if(mask.length!==n*n)throw new Error('Invalid component grid');const ids=new Int32Array(mask.length).fill(-1),out=[],q=new Int32Array(mask.length);
 for(let root=0;root<mask.length;root++)if(mask[root]&&ids[root]<0){let head=0,tail=0;const id=out.length;q[tail++]=root;ids[root]=id;let edge=false;
  while(head<tail){const i=q[head++],x=i%n,z=i/n|0;edge||=x===0||z===0||x===n-1||z===n-1;for(const [dx,dz]of[[1,0],[-1,0],[0,1],[0,-1]]){const xx=x+dx,zz=z+dz,j=zz*n+xx;if(xx<0||zz<0||xx>=n||zz>=n||!mask[j]||ids[j]>=0)continue;ids[j]=id;q[tail++]=j;}}
  out.push({id,pixels:tail,areaKm2:tail*pixelArea,touchesEdge:edge});
 }return{ids,bodies:out};
}
export function sizeBins(bodies,edges=[0,1,10,25,100,1000,Infinity]){return edges.slice(0,-1).map((lo,k)=>{const hi=edges[k+1],a=bodies.filter(b=>b.areaKm2>=lo&&b.areaKm2<hi);return{minKm2:lo,maxKm2:Number.isFinite(hi)?hi:null,count:a.length,areaKm2:a.reduce((s,b)=>s+b.areaKm2,0)};});}
export function midRanks(v){const ids=v.map((_,i)=>i).sort((a,b)=>v[a]-v[b]),r=new Float64Array(v.length);for(let i=0;i<ids.length;){let j=i+1;while(j<ids.length&&v[ids[j]]===v[ids[i]])j++;const mid=(i+j-1)/2;for(let k=i;k<j;k++)r[ids[k]]=mid;i=j;}return r;}
export function spearman(a,b){const pairs=a.map((x,i)=>[x,b[i]]).filter(p=>p.every(Number.isFinite));if(pairs.length<3)return null;const x=midRanks(pairs.map(p=>p[0])),y=midRanks(pairs.map(p=>p[1])),mx=x.reduce((s,v)=>s+v,0)/x.length,my=y.reduce((s,v)=>s+v,0)/y.length;let xy=0,xx=0,yy=0;for(let i=0;i<x.length;i++){const dx=x[i]-mx,dy=y[i]-my;xy+=dx*dy;xx+=dx*dx;yy+=dy*dy;}return xx&&yy?xy/Math.sqrt(xx*yy):null;}
/** Ties at the top-area threshold receive their exact fractional share.
 * This makes a flat-potential model achieve the baseline, not an invented lift.
 */
export function topAreaRule(scores,areas,fraction){const cut=weightedQuantile(scores,areas,1-fraction);if(cut===null)return null;let above=0,equal=0,total=0;for(let i=0;i<scores.length;i++){total+=areas[i];if(scores[i]>cut)above+=areas[i];else if(scores[i]===cut)equal+=areas[i];}return{threshold:cut,tieFraction:equal?clamp((total*fraction-above)/equal,0,1):0,fraction};}
export function populationMetrics(points,scores,areas){
 const good=points.filter(p=>Number.isFinite(p.score)&&p.population>=0),total=good.reduce((s,p)=>s+p.population,0),all=points.reduce((s,p)=>s+Math.max(0,p.population||0),0);
 const captures=[.1,.2].map(f=>{const r=topAreaRule(scores,areas,f);if(!r||!total)return{topLandFraction:f,populationShare:null,lift:null};let found=0;for(const p of good)found+=p.population*(p.score>r.threshold?1:p.score===r.threshold?r.tieFraction:0);return{topLandFraction:f,populationShare:found/total,lift:found/total/f,threshold:r.threshold,tieFraction:r.tieFraction};});
 return{sampleCount:points.length,matchedCount:good.length,representedPopulation:all,matchedPopulation:total,coverage:all?total/all:null,captures,rankCorrelation:spearman(good.map(p=>p.score),good.map(p=>p.landKm2>0?p.population/p.landKm2:NaN)),medianLocationScore:quantile(good.map(p=>p.score),.5),medianLandScore:weightedQuantile(scores,areas,.5)};
}
export function lineClip(a,b,box){let lo=0,hi=1;const dx=b[0]-a[0],dz=b[1]-a[1];for(const [p,q]of[[-dx,a[0]-box.x],[dx,box.x+box.size-a[0]],[-dz,a[1]-box.z],[dz,box.z+box.size-a[1]]]){if(Math.abs(p)<1e-12){if(q<0)return null;}else{const t=q/p;if(p<0)lo=Math.max(lo,t);else hi=Math.min(hi,t);if(lo>hi)return null;}}return[[a[0]+lo*dx,a[1]+lo*dz],[a[0]+hi*dx,a[1]+hi*dz]];}
export function sampleLines(lines,step=2,filter=()=>true){const out=[];for(const line of lines)for(let i=1;i<line.length;i++){const a=line[i-1],b=line[i],d=Math.hypot(b[0]-a[0],b[1]-a[1]);if(!d)continue;const n=Math.max(1,Math.ceil(d/step));for(let k=0;k<n;k++){const t=(k+.5)/n,p=[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];if(filter(p))out.push({x:p[0],z:p[1],weight:d/n});}}return out;}
export function pointIndex(points,binSize=8){const bins=new Map();for(const p of points){const key=`${Math.floor(p.x/binSize)},${Math.floor(p.z/binSize)}`;if(!bins.has(key))bins.set(key,[]);bins.get(key).push(p);}return{points,bins,binSize};}
export function nearestDistance(index,x,z,cap=40){const s=index.binSize,ix=Math.floor(x/s),iz=Math.floor(z/s),r=Math.ceil(cap/s);let best=cap;for(let dz=-r;dz<=r;dz++)for(let dx=-r;dx<=r;dx++)for(const p of index.bins.get(`${ix+dx},${iz+dz}`)||[])best=Math.min(best,Math.hypot(p.x-x,p.z-z));return best;}
export function alignment(predicted,observed,toleranceKm=8){
 const measure=(a,b)=>{if(!a.length||!b.length)return{withinTolerance:null,meanSeparationCappedKm:null,lengthKm:a.reduce((s,p)=>s+p.weight,0)};const index=pointIndex(b,toleranceKm),cap=toleranceKm*5;let total=0,hit=0,ds=0;for(const p of a){const d=nearestDistance(index,p.x,p.z,cap);total+=p.weight;ds+=d*p.weight;if(d<=toleranceKm)hit+=p.weight;}return{withinTolerance:hit/total,meanSeparationCappedKm:ds/total,lengthKm:total};};
 return{toleranceKm,distanceCapKm:toleranceKm*5,predictedToObserved:measure(predicted,observed),observedToPredicted:measure(observed,predicted)};
}
export function fingerprint(text){let hash=2166136261;for(const c of text){hash^=c.charCodeAt(0);hash=Math.imul(hash,16777619);}return(hash>>>0).toString(16).padStart(8,'0');}
