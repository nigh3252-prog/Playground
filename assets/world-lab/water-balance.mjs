/** Annual basin water plausibility. Not a calibrated lake/groundwater model.
 * Spill topology and actual water are separate. Closed/dry basins terminate
 * surface flow; evaporation/leakage do not magically reappear downstream.
 */
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),YEAR=365.25*86400;
const each=(m,i,fn)=>{for(let k=m.offsets[i];k<m.offsets[i+1];k++)fn(m.neighbors[k],m.distances[k]);};
const random=id=>{let v=Math.imul(id^0x6534af,1597334677);v=Math.imul(v^(v>>>16),2246822519);return((v^(v>>>13))>>>0)/4294967296;};
export const WATER_STATES=[['Land','#879678'],['Permanent lake','#397b92'],['Seasonally wet basin','#769681'],['Dry / leaky basin','#c2a27b'],['Mapped reference lake','#467fac'],['Ocean','#244859'],['Through-drainage (coarse outlet)','#7f9275']];
export class MinHeap{
 constructor(){this.a=[];} push(id,key){const a=this.a,v={id,key};let i=a.length;a.push(v);while(i){const p=(i-1)>>1;if(a[p].key<key||a[p].key===key&&a[p].id<=id)break;a[i]=a[p];i=p;}a[i]=v;}
 pop(){const a=this.a,out=a[0],last=a.pop();if(a.length){let i=0;while(i*2+1<a.length){let c=i*2+1;if(c+1<a.length&&(a[c+1].key<a[c].key||a[c+1].key===a[c].key&&a[c+1].id<a[c].id))c++;if(a[c].key>last.key||a[c].key===last.key&&a[c].id>=last.id)break;a[i]=a[c];i=c;}a[i]=last;}return out;}
 get length(){return this.a.length;}
}
export function runoffFraction(temp){return 1-clamp(.68+temp*.012,.38,.90);}
export function retentionFor(history,seed){
 const r=random(seed),leak=history===3?2.5+9*r:history===2?.12+.8*r:history===1?.025+.35*r:.06+1.1*r;
 return{leakMYear:leak,headLeakPerM:history===3?.008+.012*r:.001+.005*r,floorLeakFactor:.25+.4*random(seed+117)};
}
export function evaporationMYear(rain,temp){
 return clamp(.22+Math.max(0,temp)*.037+clamp((800-rain)/800,0,.75),.16,2.1);
}
export function solveBasin(samples,spill,inflow,retention){
 if(!samples.length)throw new Error('Empty water basin');
 const bottom=samples.reduce((v,s)=>Math.min(v,s.height),Infinity),range=Math.max(.01,spill-bottom),area=samples.reduce((a,s)=>a+s.area,0);
 const floorArea=samples.filter(s=>s.height<=bottom+range*.15).reduce((a,s)=>a+s.area,0),dryCapacity=floorArea*1e6*retention.leakMYear*retention.floorLeakFactor;
 const estimate=level=>{let supply=inflow,wetArea=0,evap=0,seep=0,precip=0,landRunoff=0;
  for(const s of samples){const fraction=clamp((level-s.height)/Math.max(1,s.cellRelief),0,1),a=s.area*1e6*fraction;
   const direct=s.rain/1000*a,land=s.rain/1000*s.area*1e6*(1-fraction)*runoffFraction(s.temp);
   precip+=direct;landRunoff+=land;supply+=direct+land;wetArea+=a;
   evap+=a*evaporationMYear(s.rain,s.temp);
   seep+=a*(retention.leakMYear+retention.headLeakPerM*Math.max(0,level-bottom));
  }
  const floorLoss=Math.min(supply,dryCapacity),loss=evap+seep+floorLoss;
  return{level,inflowM3Year:inflow,supplyM3Year:supply,precipitationM3Year:precip,landRunoffM3Year:landRunoff,evaporationM3Year:evap,seepageM3Year:seep+floorLoss,wetAreaKm2:wetArea/1e6,balance:supply-loss};
 };
 let result=estimate(spill),status;
 if(result.supplyM3Year<=1e-8){result=estimate(bottom);status='dry';result.outflowM3Year=0;}
 else if(result.balance>=0){status='overflowing';result.outflowM3Year=result.balance;}
 else if(estimate(bottom).balance<=1e-8){result=estimate(bottom);status='dry';result.seepageM3Year=result.supplyM3Year;result.evaporationM3Year=0;result.outflowM3Year=0;}
 else{let lo=bottom,hi=spill;for(let k=0;k<40;k++){const mid=(lo+hi)/2;if(estimate(mid).balance>0)lo=mid;else hi=mid;}result=estimate((lo+hi)/2);result.outflowM3Year=0;
  status=result.level-bottom<2||result.wetAreaKm2/area<.025?'seasonal':'retained';
 }
 return{...result,status,bottomM:bottom,spillM:spill,depthM:result.level-bottom,basinAreaKm2:area,retention,overflowing:status==='overflowing'};
}
function routeBasin(world,members,root,exit,receiver){
 const allowed=new Set(members),visited=new Set([root]),heap=new MinHeap();heap.push(root,world.height[root]);receiver[root]=exit;
 while(heap.length){const {id:i,key}=heap.pop();each(world.mesh,i,j=>{if(!allowed.has(j)||visited.has(j))return;visited.add(j);receiver[j]=i;heap.push(j,Math.max(key,world.height[j]));});}
 if(visited.size!==members.length)throw new Error('Disconnected potential water basin');
}
export function topologicalOrder(receiver){
 const N=receiver.length,donors=new Uint32Array(N),queue=new Int32Array(N),upstream=[];
 for(let i=0;i<N;i++){const r=receiver[i];if(r>=N||r===i)throw new Error('Invalid drainage link');if(r>=0)donors[r]++;}
 let head=0,tail=0;for(let i=0;i<N;i++)if(!donors[i])queue[tail++]=i;
 while(head<tail){const i=queue[head++];upstream.push(i);const r=receiver[i];if(r>=0&&!--donors[r])queue[tail++]=r;}
 if(upstream.length!==N)throw new Error('Water balance introduced a drainage cycle');return Int32Array.from(upstream.reverse());
}
export function incisionDecision(world,b,samples){
 if([1,2,3].includes(b.history))return null;
 let rain=0,area=0;for(const s of samples){rain+=s.rain*s.area;area+=s.area;}rain/=Math.max(area,1e-9);
 const rugged=Number(world.erosion?.p95SlopePercent||0),throughflowRatio=b.inflowM3Year/Math.max(b.supplyM3Year,1);
 if(rain>=650&&rugged>=9){
  if(b.status==='overflowing'&&throughflowRatio>=.12)return{ruggednessPercent:rugged,meanRainMm:rain,throughflowRatio,regime:'very-rugged-overflow',reason:'Persistent humid through-flow on very rugged terrain implies a sub-grid incised outlet'};
  if(b.status==='retained'&&b.depthM>=220&&b.wetAreaKm2>=50&&throughflowRatio>=.20)return{ruggednessPercent:rugged,meanRainMm:rain,throughflowRatio,regime:'very-rugged-deep-closure',reason:'A very deep humid mountain closure on the regional mesh is more plausibly an unresolved incised valley than a permanent lake'};
 }
 if(b.status==='overflowing'&&rain>=650&&rugged>=4&&rugged<9&&throughflowRatio>=.35)return{ruggednessPercent:rugged,meanRainMm:rain,throughflowRatio,regime:'moderate-rugged-overflow',reason:'Strong humid through-flow on moderately rugged terrain implies a sub-grid incised outlet'};
 if(b.status==='overflowing'&&rugged<2&&rain>=650&&b.depthM<=45&&b.wetAreaKm2>=1000&&throughflowRatio>=.25)return{ruggednessPercent:rugged,meanRainMm:rain,throughflowRatio,regime:'low-relief-outlet',reason:'Very large shallow humid flow-through basin on low-relief coarse terrain implies an unresolved outlet corridor'};
 return null;
}
export function resolveSurfaceWater(potential,climate){
 const w=potential,{mesh,height,rank,order}=w,N=height.length,sourceLakeId=w.lakeId,groups=w.lakeBodies.map(()=>[]),observed=w.observedLake||new Uint8Array(N);
 for(let i=0;i<N;i++)if(sourceLakeId[i]>=0&&!observed[i])groups[sourceLakeId[i]].push(i);
 const comp=new Int32Array(N),first=new Int32Array(groups.length).fill(-1),floor=new Int32Array(groups.length).fill(-1),exit=new Int32Array(groups.length).fill(-1);
 for(let i=0;i<N;i++){const g=sourceLakeId[i];comp[i]=g>=0&&!observed[i]?N+g:i;if(g>=0&&!observed[i]){if(first[g]<0||rank[i]<rank[first[g]])first[g]=i;if(floor[g]<0||height[i]<height[floor[g]])floor[g]=i;}}
 for(let g=0;g<groups.length;g++)if(first[g]>=0)exit[g]=w.receiver[first[g]];
 const compOrder=[],seen=new Set();for(const i of order){const c=comp[i];if(!seen.has(c)){seen.add(c);compOrder.push(c);}}
 const supply=new Float64Array(N+groups.length),budgets=Array(groups.length).fill(null),local=new Float64Array(N),receiver=w.receiver.slice(),lossAt=new Float64Array(N);
 for(let i=0;i<N;i++)if(!w.ocean[i]&&!observed[i])local[i]=climate.rainfall[i]/1000*runoffFraction(climate.temperature[i])*mesh.nodeArea[i]*1e6;
 for(let k=compOrder.length-1;k>=0;k--){const c=compOrder[k];let amount,target=-1;
  if(c<N){if(w.ocean[c]||observed[c])continue;amount=supply[c]+local[c];target=receiver[c]>=0?comp[receiver[c]]:-1;}
  else{const g=c-N,members=groups[g];if(!members.length)continue;
   const samples=members.map(i=>({height:height[i],area:mesh.nodeArea[i],rain:climate.rainfall[i],temp:climate.temperature[i],cellRelief:Math.min(30,Math.max(1,w.slope[i]*w.stepKm*1000*.3))}));
   const b=solveBasin(samples,w.lakeBodies[g].level,supply[c],retentionFor(w.lakeBodies[g].history,w.config.seed+floor[g]*19));b.id=g;b.history=w.lakeBodies[g].history;
   const incision=incisionDecision(w,b,samples);
   if(incision){
    const landRunoff=members.reduce((sum,i)=>sum+local[i],0),through=supply[c]+landRunoff;
    b.potentialLake={status:b.status,levelM:b.level,wetAreaKm2:b.wetAreaKm2,depthM:b.depthM,evaporationM3Year:b.evaporationM3Year,seepageM3Year:b.seepageM3Year};
    Object.assign(b,{status:'through-drainage',incision,root:first[g],level:b.bottomM,depthM:0,wetAreaKm2:0,inflowM3Year:supply[c],supplyM3Year:through,precipitationM3Year:0,landRunoffM3Year:landRunoff,evaporationM3Year:0,seepageM3Year:0,balance:through,outflowM3Year:through,overflowing:false});
    budgets[g]=b;amount=through;target=exit[g]>=0?comp[exit[g]]:-1;
   }else{
    b.root=b.overflowing?first[g]:floor[g];budgets[g]=b;routeBasin(w,members,b.root,b.overflowing?exit[g]:-1,receiver);
    for(let j=0;j<members.length;j++){const i=members[j],s=samples[j],f=clamp((b.level-s.height)/s.cellRelief,0,1);local[i]=s.rain/1000*mesh.nodeArea[i]*1e6*(f+(1-f)*runoffFraction(s.temp));}
    lossAt[b.root]=Math.max(0,b.supplyM3Year-b.outflowM3Year);amount=b.outflowM3Year;target=b.overflowing&&exit[g]>=0?comp[exit[g]]:-1;
   }
  }
  if(target>=0&&target!==c)supply[target]+=amount;
 }
 const actualOrder=topologicalOrder(receiver),actualRank=new Int32Array(N),area=new Float64Array(N),discharge=local.slice(),lake=new Uint8Array(N),waterSurface=height.slice(),waterState=new Uint8Array(N),lakeId=new Int32Array(N).fill(-1),lakeBodies=[];
 for(let g=0;g<groups.length;g++){const b=budgets[g];if(!b)continue;const id=lakeBodies.length;let visible=0;
  for(const i of groups[g]){waterState[i]=b.status==='dry'?3:b.status==='seasonal'?2:b.status==='through-drainage'?6:0;
   if((b.status==='retained'||b.status==='overflowing')&&height[i]<b.level-.75){lake[i]=1;lakeId[i]=id;waterSurface[i]=b.level;waterState[i]=1;visible++;}}
  if(visible)lakeBodies.push({id,potentialId:g,status:b.status,areaKm2:b.wetAreaKm2,level:b.level,maxDepth:b.depthM,nodes:visible,history:b.history});
 }
 const observedIdToActual=new Map();
 for(let i=0;i<N;i++){
  if(w.ocean[i]){waterSurface[i]=0;waterState[i]=5;receiver[i]=-1;continue;}
  if(observed[i]){const refId=w.observedLakeId[i];if(!observedIdToActual.has(refId)){const ref=w.referenceLakes.find(l=>l.id===refId);const id=lakeBodies.length;observedIdToActual.set(refId,id);lakeBodies.push({id,status:'observed',name:ref?.name||'Mapped lake',level:w.observedLevel[i],areaKm2:0,maxDepth:null,nodes:0,history:0,source:'Mapped freshwater boundary; depth unknown'});}
   const id=observedIdToActual.get(refId);lake[i]=1;lakeId[i]=id;waterSurface[i]=w.observedLevel[i];waterState[i]=4;receiver[i]=-1;lakeBodies[id].nodes++;lakeBodies[id].areaKm2+=mesh.nodeArea[i];
  }else area[i]=mesh.nodeArea[i];
 }
 for(let k=actualOrder.length-1;k>=0;k--){const i=actualOrder[k],r=receiver[i];discharge[i]=Math.max(0,discharge[i]-lossAt[i]);if(r>=0){if(!w.ocean[r]&&!observed[r])area[r]+=area[i];discharge[r]+=discharge[i];}}
 const basin=new Int32Array(N).fill(-1),flowAngle=new Float32Array(N).fill(NaN),outlets=[],river=new Uint8Array(N),threshold=w.riverThresholdKm2,donors=new Uint16Array(N),confluences=[];
 for(let k=0;k<actualOrder.length;k++){const i=actualOrder[k];actualRank[i]=k;if(w.ocean[i]||observed[i])continue;const r=receiver[i];
  basin[i]=r<0||w.ocean[r]||observed[r]?i:basin[r];if(r>=0)flowAngle[i]=Math.atan2(mesh.z[r]-mesh.z[i],mesh.x[r]-mesh.x[i]);
  if(r<0||w.ocean[r]||observed[r]){const kind=r<0?(mesh.boundary[i]?'edge':'inland'):w.ocean[r]?'sea':'reference-lake';outlets.push({id:i,areaKm2:area[i],kind,name:kind==='inland'?'Closed inland basin':kind==='reference-lake'?'Mapped lake catchment':'Coastal catchment',xKm:mesh.x[i],zKm:mesh.z[i]});}
  if(r>=0&&area[i]>=threshold&&discharge[i]/YEAR>.01)river[i]=1;
 }
 for(let i=0;i<N;i++)if(river[i]&&receiver[i]>=0)donors[receiver[i]]++;
 for(let i=0;i<N;i++)if(donors[i]>=2&&!lake[i]&&!w.ocean[i])confluences.push(i);
 outlets.sort((a,b)=>b.areaKm2-a.areaKm2);
 return{...w,stage:2,version:'regional-world-v6',potentialSpill:w.filled,potentialReceiver:w.receiver,potentialBasinId:sourceLakeId,potentialLakeBodies:w.lakeBodies,
  filled:waterSurface,waterSurface,lake,lakeId,lakeBodies,waterState,basinWater:budgets,receiver,rank:actualRank,order:actualOrder,area,runoff:Float64Array.from(discharge,v=>v/YEAR),river,basin,flowAngle,outlets,confluences,
  rainfall:climate.rainfall,temperature:climate.temperature,waterModel:'annual-budget-with-subgrid-incision-v4',waterBudgetNote:'Annual precipitation/runoff, climate-sensitive evaporation and geology-dependent leakage determine closed-basin water. Coarse-grid closures can become through-drainage when low-relief outlets, strong humid flow-through, or implausibly deep very-rugged mountain closures indicate an unresolved valley. This is a plausibility model, not measured groundwater or a calibrated erosion forecast.'};
}