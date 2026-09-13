/**
 * Shared road/terrain surface for City Lab. All distances are meters.
 * No renderer dependency: grading, junctions and paint use the same footprint.
 * The asphalt is a material on the graded terrain, NOT a stack of road ribbons.
 */
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const ease = t => { t = clamp(t, 0, 1); return t*t*t*(t*(t*6-15)+10); };
const mix = (a, b, t) => a + (b-a)*t;

export function projectToSegment(x, z, a, b) {
  const dx = b.x-a.x, dz = b.z-a.z, length2 = dx*dx+dz*dz;
  const t = length2 > 1e-12 ? clamp(((x-a.x)*dx+(z-a.z)*dz)/length2, 0, 1) : 0;
  const px = a.x+t*dx, pz = a.z+t*dz;
  return {x:px, z:pz, y:mix(a.y,b.y,t), distance:Math.hypot(x-px,z-pz), t};
}

/** Spatially indexed exact segment projection replaces nearest-vertex stairs. */
export function createRoadField(roads, baseHeight) {
  if (typeof baseHeight !== 'function') throw new TypeError('baseHeight must be a function');
  const cellSize = 24, bins = new Map(), segments = [], junctions = [];
  const key = (x,z) => `${Math.floor(x/cellSize)},${Math.floor(z/cellSize)}`;
  roads.forEach((road, roadId) => {
    if (!(road.width > 0) || !Array.isArray(road.points) || road.points.length < 2) {
      throw new TypeError('Every road needs a positive width and at least two points');
    }
    const flat = road.width/2+1.8;
    const outer = road.width/2+(road.type==='arterial'?11:road.type==='collector'?8:6);
    for (let i=1; i<road.points.length; i++) {
      const a=road.points[i-1], b=road.points[i];
      if (![a.x,a.y,a.z,b.x,b.y,b.z].every(Number.isFinite)) throw new TypeError('Non-finite road point');
      const length=Math.hypot(b.x-a.x,b.z-a.z);
      if (length<1e-6) continue;
      const segment={a,b,roadId,flat,outer,length,tx:(b.x-a.x)/length,tz:(b.z-a.z)/length};
      const id=segments.push(segment)-1;
      for (let iz=Math.floor((Math.min(a.z,b.z)-outer)/cellSize); iz<=Math.floor((Math.max(a.z,b.z)+outer)/cellSize); iz++) {
        for (let ix=Math.floor((Math.min(a.x,b.x)-outer)/cellSize); ix<=Math.floor((Math.max(a.x,b.x)+outer)/cellSize); ix++) {
          const k=`${ix},${iz}`;
          if (!bins.has(k)) bins.set(k,[]);
          bins.get(k).push(id);
        }
      }
    }
  });

  function nearest(x,z) {
    const found=new Map();
    for (const id of bins.get(key(x,z)) || []) {
      const segment=segments[id];
      const p=projectToSegment(x,z,segment.a,segment.b);
      if (p.distance>segment.outer) continue;
      const old=found.get(segment.roadId);
      if (!old || p.distance<old.distance) found.set(segment.roadId,{...p,...segment});
    }
    return found;
  }

  // Collect true crossings, plus branch endpoints touching a parent corridor.
  // Shared collinear spans are handled as a union, not as hundreds of junctions.
  const seenPairs=new Set();
  function addJunction(x,z,ids) {
    const width=Math.max(...ids.map(id=>roads[id].width));
    let joint=junctions.find(j=>Math.hypot(j.x-x,j.z-z)<Math.max(j.width,width)*.75);
    if (joint) {
      joint.x=(joint.x*joint.count+x)/(joint.count+1);
      joint.z=(joint.z*joint.count+z)/(joint.count+1);
      joint.count++;
      joint.width=Math.max(joint.width,width);
      ids.forEach(id=>joint.ids.add(id));
    } else junctions.push({x,z,width,count:1,ids:new Set(ids)});
  }
  for (const ids of bins.values()) {
    for (let i=0;i<ids.length;i++) for (let j=i+1;j<ids.length;j++) {
      const ai=ids[i],bi=ids[j],a=segments[ai],b=segments[bi];
      if (a.roadId===b.roadId) continue;
      if (Math.max(a.a.x,a.b.x)+1e-6<Math.min(b.a.x,b.b.x) || Math.max(b.a.x,b.b.x)+1e-6<Math.min(a.a.x,a.b.x) ||
          Math.max(a.a.z,a.b.z)+1e-6<Math.min(b.a.z,b.b.z) || Math.max(b.a.z,b.b.z)+1e-6<Math.min(a.a.z,a.b.z)) continue;
      const pair=ai<bi?`${ai}:${bi}`:`${bi}:${ai}`;
      if (seenPairs.has(pair)) continue;
      seenPairs.add(pair);
      const ax=a.b.x-a.a.x,az=a.b.z-a.a.z,bx=b.b.x-b.a.x,bz=b.b.z-b.a.z;
      const det=ax*bz-az*bx;
      if (Math.abs(det)<a.length*b.length*.08) continue;
      const dx=b.a.x-a.a.x,dz=b.a.z-a.a.z;
      const ta=(dx*bz-dz*bx)/det,tb=(dx*az-dz*ax)/det;
      if (ta>=-1e-6&&ta<=1+1e-6&&tb>=-1e-6&&tb<=1+1e-6) addJunction(a.a.x+ax*ta,a.a.z+az*ta,[a.roadId,b.roadId]);
    }
  }
  roads.forEach((road,id)=>{
    for (const p of [road.points[0],road.points[road.points.length-1]]) {
      for (const [otherId,hit] of nearest(p.x,p.z)) {
        if (id!==otherId && hit.distance<roads[otherId].width/2+.5) addJunction(p.x,p.z,[id,otherId]);
      }
    }
  });
  for (const joint of junctions) {
    let total=0,weight=0;
    for (const [id,hit] of nearest(joint.x,joint.z)) {
      if (!joint.ids.has(id)) continue;
      const w=roads[id].width;
      total+=hit.y*w; weight+=w;
    }
    joint.y=weight?total/weight:baseHeight(joint.x,joint.z);
    joint.inner=joint.width/2+1.8;
    joint.outer=joint.inner+16;
  }

  function height(x,z) {
    const base=baseHeight(x,z);
    let total=0,weight=0,influence=0;
    for (const hit of nearest(x,z).values()) {
      const w=1-ease((hit.distance-hit.flat)/(hit.outer-hit.flat));
      total+=hit.y*w*w; weight+=w*w;
      influence=Math.max(influence,w);
    }
    let h=weight>0?mix(base,total/weight,influence):base;
    // One shared elevation at a junction; gently blend its approaches, not
    // separate roads at competing levels or a winner-takes-all height switch.
    let junctionHeight=0,junctionWeight=0,junctionInfluence=0;
    for (const joint of junctions) {
      const d=Math.hypot(x-joint.x,z-joint.z);
      if (d>=joint.outer) continue;
      const w=1-ease((d-joint.inner)/(joint.outer-joint.inner));
      junctionHeight+=joint.y*w*w; junctionWeight+=w*w;
      junctionInfluence=Math.max(junctionInfluence,w);
    }
    if (junctionWeight) h=mix(h,junctionHeight/junctionWeight,junctionInfluence);
    return h;
  }

  function markingAllowed(x,z,roadId,tx,tz) {
    for (const joint of junctions) if (Math.hypot(x-joint.x,z-joint.z)<joint.inner+2) return false;
    for (const [otherId,hit] of nearest(x,z)) {
      if (otherId===roadId || hit.distance>roads[otherId].width/2+2) continue;
      const parallel=Math.abs(tx*hit.tx+tz*hit.tz)>.94;
      if (!parallel) return false;
      // In a coincident corridor keep exactly one marking, from the wider road.
      if (roads[otherId].width>roads[roadId].width || (roads[otherId].width===roads[roadId].width && otherId<roadId)) return false;
    }
    return true;
  }
  return {height,nearest,junctions,markingAllowed,segmentCount:segments.length};
}

/** All shoulders first, then a single-color asphalt union, then clipped paint.
 * Canvas coordinates are world X/Z after the caller applies its transform.
 * The resulting texture belongs to the ground mesh, eliminating depth overlap.
 */
export function paintRoadSurface(ctx,roads,field) {
  ctx.save();
  ctx.lineCap='round'; ctx.lineJoin='round';
  function trace(road,width,color) {
    ctx.lineWidth=width; ctx.strokeStyle=color; ctx.beginPath();
    road.points.forEach((p,i)=>i?ctx.lineTo(p.x,p.z):ctx.moveTo(p.x,p.z));
    ctx.stroke();
  }
  for (const road of roads) trace(road,road.width+2.2,'#857d69');
  for (const road of roads) trace(road,road.width,'#414744');
  ctx.lineCap='butt';
  roads.forEach((road,roadId)=>{
    let distance=0;
    const dash=road.type==='local'?2:3.2,period=road.type==='local'?10:12;
    ctx.lineWidth=.20;
    ctx.strokeStyle=road.type==='arterial'?'#e6c75b':'#d9d8cd';
    ctx.beginPath();
    for (let i=1;i<road.points.length;i++) {
      const a=road.points[i-1],b=road.points[i],length=Math.hypot(b.x-a.x,b.z-a.z);
      if (length<1e-6) continue;
      const tx=(b.x-a.x)/length,tz=(b.z-a.z)/length;
      // Split at actual dash boundaries: no phase reset at curve vertices.
      let at=0;
      while (at<length-1e-7) {
        const phase=(distance+at)%period;
        const on=phase<dash-1e-7;
        const boundary=on?dash-phase:period-phase;
        const step=Math.min(.45,length-at,Math.max(.0001,boundary));
        const middle=at+step/2;
        if (on && field.markingAllowed(a.x+tx*middle,a.z+tz*middle,roadId,tx,tz)) {
          ctx.moveTo(a.x+tx*at,a.z+tz*at);
          ctx.lineTo(a.x+tx*(at+step),a.z+tz*(at+step));
        }
        at+=step;
      }
      distance+=length;
    }
    ctx.stroke();
  });
  ctx.restore();
}
