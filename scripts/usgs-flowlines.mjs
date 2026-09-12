/** Official USGS NHDPlusV2 fabric API, CC0. The HR ArcGIS view times out
 * on these regional filters; V2 is an explicit, versioned regional comparator.
 * Fetch every bbox page, then filter contributing area client-side. Never
 * score truncated pages as missing observed rivers.
 */
import {fetchJSON} from './benchmark-data-utils.mjs';
const endpoint='https://api.water.usgs.gov/fabric/pygeoapi/collections/nhdflowline_network/items';
export const RIVER_SOURCE={dataset:'USGS NHDPlusV2 Flowline Network',endpoint,license:'https://creativecommons.org/publicdomain/zero/1.0/',documentation:'https://api.water.usgs.gov/docs/fabric-pygeoapi/',selection:'StreamRiver/ArtificialPath with upstream drainage area >= 500 km2; client filtering AFTER complete regional retrieval'};
export async function fetchUSGSFlowlines(envelope,minimumArea=500){
 const[west,south,east,north]=envelope.map(Number),tiles=[],features=new Map(),provenance=[],tileChecks=[];
 for(let y=south;y<north;y+=2)for(let x=west;x<east;x+=2)tiles.push([x,y,Math.min(east,x+2),Math.min(north,y+2)]);
 async function tile(bbox){
  let url=endpoint+'?'+new URLSearchParams({f:'json',bbox:bbox.join(','),limit:'5000',properties:'comid,gnis_name,totdasqkm,ftype,fromnode,tonode,flowdir'}),expected=null,count=0;
  const seen=new Set(),visited=new Set();
  while(url){
   if(visited.has(url))throw new Error('USGS pagination loop');visited.add(url);
   const result=await fetchJSON(url),data=result.json;provenance.push({...result.provenance,dataset:RIVER_SOURCE.dataset});
   if(data.type!=='FeatureCollection'||!Array.isArray(data.features)||!Number.isInteger(data.numberMatched)||data.numberMatched<0)throw new Error('Invalid USGS flowline result');
   if(expected===null)expected=data.numberMatched;else if(data.numberMatched!==expected)throw new Error('USGS feature count changed during download');
   if(expected>500000)throw new Error('USGS bbox appears not to have been applied');
   for(const f of data.features){const p=f.properties||{},id=Number(p.comid??f.id);if(!Number.isFinite(id)||seen.has(id))throw new Error('Missing/duplicate USGS river ID within page sequence');seen.add(id);count++;
    if(Number(p.totdasqkm)<minimumArea||!['StreamRiver','ArtificialPath'].includes(p.ftype))continue;
    const g=f.geometry,paths=g?.type==='MultiLineString'?g.coordinates:g?.type==='LineString'?[g.coordinates]:null;
    if(!paths)throw new Error('Missing selected USGS flowline geometry');
    features.set(id,{attributes:{OBJECTID:id,permanent_identifier:String(id),gnis_name:p.gnis_name,totdasqkm:Number(p.totdasqkm),ftype:p.ftype==='StreamRiver'?460:558,fromnode:Number(p.fromnode),tonode:Number(p.tonode),flowdir:p.flowdir==='With Digitized'?1:0},geometry:{paths}});
   }
   if(count>expected)throw new Error('USGS pagination count overflow');
   if(count===expected){url=null;break;}
   const next=(data.links||[]).find(l=>l.rel==='next');if(!next||!data.features.length)throw new Error('Incomplete USGS river pagination');
   const candidate=new URL(next.href,url);if(candidate.hostname!=='api.water.usgs.gov'||!candidate.pathname.includes('/nhdflowline_network/items'))throw new Error('Unexpected USGS pagination target');candidate.searchParams.set('f','json');url=candidate.href;
  }
  tileChecks.push({bbox,count,expected,pages:visited.size});console.log('USGS V2 TILE',bbox.join(','),count,'complete features');
 }
 for(let k=0;k<tiles.length;k+=3)await Promise.all(tiles.slice(k,k+3).map(tile));
 if(!features.size)throw new Error('No major observed river segments in requested region');
 return{features:[...features.values()].sort((a,b)=>a.attributes.OBJECTID-b.attributes.OBJECTID),count:features.size,provenance,source:{...RIVER_SOURCE,minimumAreaKm2:minimumArea,tileChecks}};
}
