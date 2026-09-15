/** Requests select existing world-space plans; the camera never seeds a city. */
export const DETAIL_LEVELS=['parent','window','metro','streets'];
const limits={parent:{across:Infinity,sites:0},window:{across:1800,sites:0},metro:{across:360,sites:64},streets:{across:40,sites:8}};

export function planAreaDetail(sites,viewport,level){
 const rule=limits[level],{center,kmAcross,kmHigh=kmAcross}=viewport||{};
 const reject=reason=>({allowed:false,reason,siteIds:[],bounds:null,level});
 if(!rule||!center||![center.x,center.z,kmAcross,kmHigh].every(Number.isFinite)||kmAcross<=0||kmHigh<=0)return reject('Choose an area on the map first.');
 if(kmAcross>rule.across||kmHigh>rule.across*2.5)return reject(`Zoom closer for ${level} detail · ${rule.across} km across or less`);
 const margin=Math.min(kmAcross,kmHigh)*.1,bounds={x:center.x-kmAcross/2-margin,z:center.z-kmHigh/2-margin,right:center.x+kmAcross/2+margin,bottom:center.z+kmHigh/2+margin};
 // Radius is an area-equivalent estimate. A conservative envelope includes
 // elongated cities and centers just beyond the screen, not only town dots.
 const selected=rule.sites?sites.filter(s=>{
  const radius=s.radiusKm*3.5,b=s.bounds||{x:s.point.x-radius,z:s.point.z-radius,size:radius*2};
  return b.x<=bounds.right&&b.x+b.size>=bounds.x&&b.z<=bounds.bottom&&b.z+b.size>=bounds.z;
 }):[];
 if(selected.length>rule.sites)return reject(`Zoom closer · this area includes ${selected.length} places`);
 return{allowed:true,reason:'',level,bounds,siteIds:selected.map(s=>s.id).sort((a,b)=>a-b)};
}
