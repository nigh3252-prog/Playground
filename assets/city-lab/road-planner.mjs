const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const lerp=(a,b,t)=>a+(b-a)*t;

/**
 * Terrain-aware any-angle path planner for the city lab.
 * The search still uses a coarse grid for inexpensive cost sampling, but
 * Theta*-style parent shortcuts mean the final path is not constrained to
 * 45/90-degree moves. A light collinearity pass removes tiny steering changes.
 */
export function createAnyAnglePlanner({worldSize,cells,heightAt,getWaterLevel}){
  if(!(worldSize>0&&cells>=4)||typeof heightAt!=='function'||typeof getWaterLevel!=='function') throw new TypeError('invalid planner inputs');
  const half=worldSize/2,step=worldSize/cells;
  const node=(ix,iz)=>({ix,iz,x:-half+ix*step,z:-half+iz*step});
  const key=(ix,iz)=>`${ix},${iz}`;
  const dirs=[[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]];
  const heuristic=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);

  function segmentCost(a,b,type='collector'){
    const length=Math.hypot(b.x-a.x,b.z-a.z);
    if(length<1e-8)return 0;
    const samples=Math.max(2,Math.ceil(length/(step*.45)));
    let cost=0,prevH=heightAt(a.x,a.z),prevX=a.x,prevZ=a.z;
    const slopeWeight=type==='arterial'?19:type==='collector'?17:14;
    const waterWeight=type==='arterial'?34:type==='collector'?30:24;
    for(let i=1;i<=samples;i++){
      const t=i/samples,x=lerp(a.x,b.x,t),z=lerp(a.z,b.z,t),h=heightAt(x,z);
      const ds=Math.hypot(x-prevX,z-prevZ),slope=Math.abs(h-prevH)/Math.max(ds,1e-6);
      const waterDepth=getWaterLevel()+.8-h;
      cost+=ds*(1+Math.min(7,slope*slopeWeight)+(waterDepth>0?waterWeight+waterDepth*9:0));
      prevH=h;prevX=x;prevZ=z;
    }
    return cost;
  }

  function simplify(path){
    if(path.length<=2)return path;
    const out=[path[0]];
    for(let i=1;i<path.length-1;i++){
      const a=out[out.length-1],b=path[i],c=path[i+1];
      const abx=b.x-a.x,abz=b.z-a.z,bcx=c.x-b.x,bcz=c.z-b.z;
      const ab=Math.hypot(abx,abz),bc=Math.hypot(bcx,bcz);
      if(ab<1e-6||bc<1e-6)continue;
      const dot=clamp((abx*bcx+abz*bcz)/(ab*bc),-1,1);
      const angle=Math.acos(dot);
      if(angle<0.16)continue;
      out.push(b);
    }
    out.push(path[path.length-1]);
    return out;
  }

  function plan(start,goal,{type='collector'}={}){
    const s={ix:clamp(Math.round(start.ix),0,cells),iz:clamp(Math.round(start.iz),0,cells)};
    const g={ix:clamp(Math.round(goal.ix),0,cells),iz:clamp(Math.round(goal.iz),0,cells)};
    const startKey=key(s.ix,s.iz),goalKey=key(g.ix,g.iz),startNode=node(s.ix,s.iz),goalNode=node(g.ix,g.iz);
    const open=new Map([[startKey,{...s,f:heuristic(startNode,goalNode)}]]),closed=new Set();
    const gScore=new Map([[startKey,0]]),parent=new Map([[startKey,startKey]]);
    while(open.size){
      let currentKey=null,current=null;
      for(const[k,item]of open){if(!current||item.f<current.f){current=item;currentKey=k;}}
      if(currentKey===goalKey){
        const path=[];let k=currentKey,guard=0;
        while(true){
          const[ix,iz]=k.split(',').map(Number);path.push(node(ix,iz));
          const p=parent.get(k);if(!p||p===k)break;
          k=p;if(++guard>cells*cells*4)throw new Error('planner parent cycle');
        }
        return simplify(path.reverse());
      }
      open.delete(currentKey);closed.add(currentKey);
      const currentNode=node(current.ix,current.iz),currentParentKey=parent.get(currentKey)??currentKey;
      const[pix,piz]=currentParentKey.split(',').map(Number),currentParentNode=node(pix,piz);
      for(const[dx,dz]of dirs){
        const nx=current.ix+dx,nz=current.iz+dz;
        if(nx<0||nz<0||nx>cells||nz>cells)continue;
        const nk=key(nx,nz);if(closed.has(nk))continue;
        const next=node(nx,nz);
        const fromCurrent=(gScore.get(currentKey)??Infinity)+segmentCost(currentNode,next,type);
        const viaParent=(gScore.get(currentParentKey)??Infinity)+segmentCost(currentParentNode,next,type);
        let tentative=fromCurrent,chosenParent=currentKey;
        if(viaParent<=fromCurrent*1.012){tentative=viaParent;chosenParent=currentParentKey;}
        if(chosenParent!==currentKey){
          const grandKey=parent.get(chosenParent);
          if(grandKey&&grandKey!==chosenParent){
            const[gix,giz]=grandKey.split(',').map(Number),grand=node(gix,giz),chosen=currentParentNode;
            const ux=chosen.x-grand.x,uz=chosen.z-grand.z,vx=next.x-chosen.x,vz=next.z-chosen.z;
            const ul=Math.hypot(ux,uz),vl=Math.hypot(vx,vz);
            if(ul>1e-6&&vl>1e-6){const turn=Math.acos(clamp((ux*vx+uz*vz)/(ul*vl),-1,1));tentative+=turn*turn*(type==='local'?3.5:7);}
          }
        }
        if(tentative<(gScore.get(nk)??Infinity)){
          gScore.set(nk,tentative);parent.set(nk,chosenParent);
          open.set(nk,{ix:nx,iz:nz,f:tentative+heuristic(next,goalNode)});
        }
      }
    }
    return[startNode,goalNode];
  }
  return{plan,node,segmentCost,step};
}
