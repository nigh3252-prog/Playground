import {meshTopology} from './world-mesh.mjs';
import {triangulate} from './triangulate.mjs';
import {random32} from './world-utils.mjs';

const NODE_FIELDS=['height','ocean','slope','landHistory','featureAt','filled','waterSurface','lake','lakeId','waterState','potentialSpill','potentialBasinId','area','runoff','river','flowAngle','rainfall','temperature','biome','wetDistanceKm'];
function cloneField(field,ids){if(!field)return field;const C=field.constructor,out=new C(ids.length);for(let i=0;i<ids.length;i++)out[i]=field[ids[i]];return out;}

/** The visible region is a deterministic crop from a larger physical parent.
 * Parent resolution is capped so the Worker remains phone-friendly; nominal
 * sample spacing is held constant until the 321×321 cap is reached.
 */
export function planGeneratedCrop({seed=1,n=193,sizeKm=1200}={}){
  const maxParentN=321,desiredScale=1.75,parentN=Math.min(maxParentN,1+Math.round((n-1)*desiredScale));
  const parentScale=(parentN-1)/(n-1),parentSizeKm=sizeKm*parentScale,available=parentN-n,rnd=random32((Number(seed)>>>0)^0x7250c4a1);
  // Use independent random offsets. A crop may contain coast/mountains or be
  // fully inland; touching a parent edge is allowed but no longer guaranteed.
  const colStart=Math.floor(rnd()*(available+1)),rowStart=Math.floor(rnd()*(available+1));
  return{cropN:n,cropSizeKm:sizeKm,parentN,parentSizeKm,parentScale,colStart,rowStart,stepKm:sizeKm/(n-1),
    touchesParent:{north:rowStart===0,west:colStart===0,south:rowStart+n===parentN,east:colStart+n===parentN}};
}

function rebuildLakeBodies(parent,ids,mesh,lakeId){
  if(!parent.lakeBodies||!parent.lakeId)return{lakeBodies:parent.lakeBodies,lakeId};
  const present=new Map();for(let i=0;i<ids.length;i++){const g=parent.lakeId[ids[i]];if(g>=0&&!present.has(g))present.set(g,present.size);}
  const bodies=Array.from(present.entries()).map(([g,id])=>({...parent.lakeBodies[g],id,parentId:g,nodes:0,areaKm2:0}));
  for(let i=0;i<ids.length;i++){const g=parent.lakeId[ids[i]];if(g<0){lakeId[i]=-1;continue;}const id=present.get(g);lakeId[i]=id;bodies[id].nodes++;bodies[id].areaKm2+=mesh.nodeArea[i];}
  return{lakeBodies:bodies,lakeId};
}

/** Crop already-solved physical fields. Upstream area/runoff retain parent
 * contributions. A receiver that leaves the window becomes a visible edge
 * outlet, but its area/value was computed before cropping.
 */
export function cropSolvedWorld(parent,plan){
  const pn=parent.n,n=plan.cropN,ids=new Int32Array(n*n),oldToNew=new Int32Array(parent.height.length).fill(-1),x=new Float64Array(n*n),z=new Float64Array(n*n),boundary=new Uint8Array(n*n);
  const ox=plan.colStart*parent.stepKm,oz=plan.rowStart*parent.stepKm;
  for(let r=0;r<n;r++)for(let c=0;c<n;c++){
    const local=r*n+c,old=(plan.rowStart+r)*pn+plan.colStart+c;ids[local]=old;oldToNew[old]=local;x[local]=parent.mesh.x[old]-ox;z[local]=parent.mesh.z[old]-oz;boundary[local]=r===0||c===0||r===n-1||c===n-1?1:0;
  }
  const triangles=triangulate(x,z),mesh=meshTopology({n,sizeKm:plan.cropSizeKm,stepKm:parent.stepKm,x,z,triangles,boundary});
  const out={...parent,n,stepKm:parent.stepKm,mesh,config:{...parent.config,n,sizeKm:plan.cropSizeKm,parentGenerated:true},
    parentContext:{parentSizeKm:plan.parentSizeKm,parentN:plan.parentN,cropXKm:ox,cropZKm:oz,cropSizeKm:plan.cropSizeKm,touchesParent:plan.touchesParent,note:'Terrain, drainage, water and ecology were solved on this larger parent before the visible crop was selected.'}};
  for(const key of NODE_FIELDS)if(parent[key])out[key]=cloneField(parent[key],ids);
  if(parent.receiver){out.receiver=new Int32Array(ids.length).fill(-1);for(let i=0;i<ids.length;i++){const r=parent.receiver[ids[i]];out.receiver[i]=r>=0?oldToNew[r]:-1;}}
  if(parent.rank){const sorted=Array.from(ids,old=>old).sort((a,b)=>parent.rank[a]-parent.rank[b]),order=new Int32Array(ids.length),rank=new Int32Array(ids.length);for(let k=0;k<sorted.length;k++){const i=oldToNew[sorted[k]];order[k]=i;rank[i]=k;}out.order=order;out.rank=rank;}
  if(out.receiver){
    const basin=new Int32Array(ids.length).fill(-1),outlets=[],donors=new Uint16Array(ids.length),confluences=[];
    const order=out.order||Int32Array.from({length:ids.length},(_,i)=>i);
    for(const i of order){if(out.ocean?.[i]||out.lake?.[i])continue;const r=out.receiver[i];basin[i]=r<0||out.ocean?.[r]||out.lake?.[r]?i:basin[r];if(r<0||out.ocean?.[r]||out.lake?.[r])outlets.push({id:i,areaKm2:out.area?.[i]||mesh.nodeArea[i],kind:r<0?'crop-edge':out.ocean?.[r]?'sea':'lake',name:r<0?'Continues beyond visible crop':out.ocean?.[r]?'Sea outlet':'Lake outlet',xKm:x[i],zKm:z[i]});if(out.river?.[i]&&r>=0)donors[r]++;}
    for(let i=0;i<donors.length;i++)if(donors[i]>=2&&!out.lake?.[i])confluences.push(i);out.basin=basin;out.outlets=outlets.sort((a,b)=>b.areaKm2-a.areaKm2);out.confluences=confluences;
  }
  if(out.lakeId){const rebuilt=rebuildLakeBodies(parent,ids,mesh,out.lakeId);out.lakeId=rebuilt.lakeId;out.lakeBodies=rebuilt.lakeBodies;}
  if(out.biome){const count=Math.max(12,parent.biomeAreas?.length||0),areas=new Float64Array(count);for(let i=0;i<out.biome.length;i++)areas[out.biome[i]]+=mesh.nodeArea[i];out.biomeAreas=areas;}
  // Do not expose the large typed parent arrays in exports/runtime state.
  out.features=parent.features||[];out.version='regional-world-v6';return out;
}
