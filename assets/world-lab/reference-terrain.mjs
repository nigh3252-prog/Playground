import {createTerrainMesh} from './world-mesh.mjs';
import {REFERENCES,bilinear,fromLonLat,toLonLat} from './reference-regions.mjs';
import {MinHeap} from './water-balance.mjs';
const each=(m,i,fn)=>{for(let k=m.offsets[i];k<m.offsets[i+1];k++)fn(m.neighbors[k],m.distances[k]);};
const packs=new Map();
export async function loadReference(id){
 if(!REFERENCES[id])throw new Error('Unknown reference region');
 if(!packs.has(id))packs.set(id,fetch(new URL(`./references/${id}.json`,import.meta.url)).then(async r=>{if(!r.ok)throw new Error(`Reference data unavailable (${r.status}). No generated fallback is allowed.`);const pack=await r.json();if(pack.schema!=='watershed-reference-v2'||pack.region.id!==id)throw new Error('Incorrect reference dataset version');return pack;}).catch(e=>{packs.delete(id);throw e;}));return packs.get(id);
}
function base64Bytes(text){return Uint8Array.from(atob(text),c=>c.charCodeAt(0));}
export function decode16(text,signed,n){const bytes=base64Bytes(text);if(bytes.length!==n*n*2)throw new Error('Invalid reference raster length');const view=new DataView(bytes.buffer),out=signed?new Int16Array(n*n):new Uint16Array(n*n);for(let i=0;i<out.length;i++)out[i]=signed?view.getInt16(i*2,true):view.getUint16(i*2,true);return out;}
export function decode8(text,n){const bytes=base64Bytes(text);if(bytes.length!==n*n)throw new Error('Invalid benchmark raster length');return bytes;}
function nearestRaster(mask,n,x,z,size){const ix=Math.max(0,Math.min(n-1,Math.round(x/size*(n-1)))),iz=Math.max(0,Math.min(n-1,Math.round(z/size*(n-1))));return mask[iz*n+ix];}
export function generateReferenceTerrain(pack,options={}){
 const region=pack.region,n=options.n||193,mesh=createTerrainMesh(n,region.sizeKm,1),N=n*n,dem=decode16(pack.height,true,pack.n),boundaryIndex=decode16(pack.lakeIndex,false,pack.n),truthLake=decode8(pack.benchmarkLake,pack.n),truthBoundary=decode8(pack.benchmarkBoundaryWater,pack.n),truthRiver=decode8(pack.benchmarkRiver,pack.n);
 const height=new Float32Array(N),observedLake=new Uint8Array(N),observedLakeId=new Int32Array(N).fill(-1),observedLevel=new Float32Array(N),benchmarkLake=new Uint8Array(N),benchmarkBoundaryWater=new Uint8Array(N),benchmarkRiver=new Uint8Array(N),ocean=new Uint8Array(N),landHistory=new Uint8Array(N),featureAt=new Int16Array(N).fill(-1),slope=new Float32Array(N);
 const levels=new Map(pack.lakes.filter(l=>l.boundaryCondition).map(l=>[l.id,l.level]));
 for(let i=0;i<N;i++){
  const x=mesh.x[i],z=mesh.z[i],rx=Math.max(0,Math.min(pack.n-1,Math.round(x/region.sizeKm*(pack.n-1)))),rz=Math.max(0,Math.min(pack.n-1,Math.round(z/region.sizeKm*(pack.n-1)))),id=boundaryIndex[rz*pack.n+rx];
  height[i]=bilinear(dem,pack.n,x,z,region.sizeKm);benchmarkLake[i]=truthLake[rz*pack.n+rx]?1:0;benchmarkBoundaryWater[i]=truthBoundary[rz*pack.n+rx]?1:0;benchmarkRiver[i]=truthRiver[rz*pack.n+rx]?1:0;
  // Only explicitly designated crop-boundary freshwater (Great Lakes) enters
  // the model. Inland USGS lake truth is withheld for scoring.
  if(id&&levels.has(id)){observedLake[i]=1;observedLakeId[i]=id;observedLevel[i]=levels.get(id);height[i]=levels.get(id);benchmarkLake[i]=0;}
 }
 const queue=new Int32Array(N);let head=0,tail=0;for(let i=0;i<N;i++)if(mesh.boundary[i]&&!observedLake[i]&&height[i]<=0){ocean[i]=1;queue[tail++]=i;}
 while(head<tail){const i=queue[head++];each(mesh,i,j=>{if(!ocean[j]&&!observedLake[j]&&height[j]<=0){ocean[j]=1;queue[tail++]=j;}});}
 for(let i=0;i<N;i++)each(mesh,i,(j,d)=>slope[i]=Math.max(slope[i],Math.abs(height[i]-height[j])/(d*1000)));
 const landmarks=region.landmarks.map(([name,lat,lon,type])=>{const[xKm,zKm]=fromLonLat(region,lon,lat);return{name,lat,lon,type,xKm,zKm};});
 // This is explicitly a leakage prior, not imported geology. It lets the
 // Cascades benchmark exercise the same water plausibility code around known
 // volcanic highlands without telling the model where crater lakes are.
 landmarks.filter(p=>p.type==='volcano').forEach(p=>{for(let i=0;i<N;i++)if(Math.hypot(mesh.x[i]-p.xKm,mesh.z[i]-p.zKm)<18)landHistory[i]=3;});
 return{version:'regional-world-v6',stage:1,config:{seed:1,n,sizeKm:region.sizeKm,relief:1,rain:options.rain||1,wind:options.wind||'west',source:region.id},n,stepKm:mesh.stepKm,mesh,height,ocean,slope,landHistory,featureAt,features:[],geology:{source:'No synthetic landforms applied'},erosion:null,
  observedLake,observedLakeId,observedLevel,benchmarkLake,benchmarkBoundaryWater,benchmarkRiver,referenceLakes:pack.lakes,referenceRivers:pack.rivers,referencePopulation:pack.population,benchmarkMeta:pack.benchmarkMeta,landmarks,
  reference:{region,provenance:pack.provenance,measuredInputs:'Real DEM. Great-Lake boundary water is prescribed. USGS inland lakes / major flowlines are withheld benchmark truth.',modeledOutputs:'Inland water, rivers, climate, ecology, navigability and human potential are model outputs. Modern population is score-only and never an input.',edgeWarning:'The crop still truncates external catchments. Great Lakes are freshwater boundary sinks; complete inter-lake channels and outside inflows are not reconstructed.'}};
}
/** Reference drainage knows only DEM + explicit Great-Lake/ocean boundaries.
 * Inland USGS lake truth stays out of Priority-Flood and is scored later.
 */
export function referenceHydrology(w){
 const {mesh,height:h,ocean,observedLake,observedLevel}=w,N=h.length,filled=new Float64Array(N),seen=new Uint8Array(N),rank=new Int32Array(N),order=new Int32Array(N),parent=new Int32Array(N).fill(-1),heap=new MinHeap();
 for(let i=0;i<N;i++)if(ocean[i]||observedLake[i]||mesh.boundary[i]){filled[i]=ocean[i]?0:observedLake[i]?observedLevel[i]:h[i];seen[i]=1;heap.push(i,filled[i]);}
 let count=0;while(heap.length){const i=heap.pop().id;rank[i]=count;order[count++]=i;each(mesh,i,j=>{if(!seen[j]){seen[j]=1;filled[j]=Math.max(h[j],filled[i]);parent[j]=i;heap.push(j,filled[j]);}});}if(count!==N)throw new Error('Incomplete reference drainage mesh');
 const receiver=new Int32Array(N).fill(-1),lake=new Uint8Array(N),area=new Float64Array(N),basin=new Int32Array(N).fill(-1),flowAngle=new Float32Array(N).fill(NaN),lakeId=new Int32Array(N).fill(-1);
 for(let i=0;i<N;i++){if(ocean[i]||observedLake[i])continue;area[i]=mesh.nodeArea[i];lake[i]=filled[i]-h[i]>.5?1:0;let best=-1,grade=0;each(mesh,i,(j,d)=>{const s=(filled[i]-filled[j])/d;if(rank[j]<rank[i]&&s>grade+1e-9){best=j;grade=s;}});if(best<0){best=parent[i];if(best<0)each(mesh,i,j=>{if(rank[j]<rank[i]&&filled[j]<=filled[i]&&(best<0||rank[j]<rank[best]))best=j;});}receiver[i]=best;if(best>=0)flowAngle[i]=Math.atan2(mesh.z[best]-mesh.z[i],mesh.x[best]-mesh.x[i]);}
 for(let k=N-1;k>=0;k--){const i=order[k],r=receiver[i];if(r>=0&&!ocean[r]&&!observedLake[r])area[r]+=area[i];}
 const outlets=[];for(const i of order){if(ocean[i]||observedLake[i])continue;const r=receiver[i];basin[i]=r<0||ocean[r]||observedLake[r]?i:basin[r];if(r<0||ocean[r]||observedLake[r])outlets.push({id:i,areaKm2:area[i],kind:r<0?'edge':ocean[r]?'sea':'reference-lake',name:'Reference catchment'});}outlets.sort((a,b)=>b.areaKm2-a.areaKm2);
 const threshold=Math.max(100,w.config.sizeKm**2*.00055),river=new Uint8Array(N),donors=new Uint8Array(N),confluences=[];for(let i=0;i<N;i++)if(area[i]>=threshold&&receiver[i]>=0)river[i]=1;for(let i=0;i<N;i++)if(river[i])donors[receiver[i]]++;for(let i=0;i<N;i++)if(donors[i]>=2&&!lake[i]&&!observedLake[i])confluences.push(i);
 const lakeBodies=[],queue=new Int32Array(N);for(let start=0;start<N;start++)if(lake[start]&&lakeId[start]<0){const id=lakeBodies.length,historyArea=new Float64Array(5);let head=0,tail=0,areaKm2=0,maxDepth=0;queue[tail++]=start;lakeId[start]=id;while(head<tail){const i=queue[head++];areaKm2+=mesh.nodeArea[i];maxDepth=Math.max(maxDepth,filled[i]-h[i]);historyArea[w.landHistory[i]]+=mesh.nodeArea[i];each(mesh,i,j=>{if(lake[j]&&lakeId[j]<0&&Math.abs(filled[j]-filled[i])<.01){lakeId[j]=id;queue[tail++]=j;}});}lakeBodies.push({id,seedNode:start,areaKm2,maxDepth,level:filled[start],nodes:tail,history:historyArea.indexOf(Math.max(...historyArea))});}
 return{...w,stage:2,filled,receiver,rank,order,area,basin,lake,lakeId,lakeBodies,flowAngle,outlets,river,confluences,riverThresholdKm2:threshold,routing:'reference-mesh-blind-inland-water'};
}
export function geographicLocation(w,index){return w.reference?toLonLat(w.reference.region,w.mesh.x[index],w.mesh.z[index]):null;}
