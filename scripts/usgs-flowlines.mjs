/** Official USGS NHDPlusV2 Fabric API, CC0.
 * Fetch every bbox page, then filter contributing area client-side. Never
 * score truncated pages as missing observed rivers.
 *
 * IMPORTANT: OGC API Features returns the complete feature schema by default.
 * `properties=` is not a supported item-query parameter on this service and
 * caused HTTP 400 responses. The fields used below (including totdasqkm,
 * fromnode and tonode) are present in the collection schema/queryables.
 */
import {fetchJSON} from './benchmark-data-utils.mjs';
const endpoint='https://api.water.usgs.gov/fabric/pygeoapi/collections/nhdflowline_network/items';
export const RIVER_SOURCE={dataset:'USGS NHDPlusV2 Flowline Network',endpoint,license:'https://creativecommons.org/publicdomain/zero/1.0/',documentation:'https://api.water.usgs.gov/docs/fabric-pygeoapi/',selection:'StreamRiver/ArtificialPath with upstream drainage area >= 500 km2; complete bbox retrieval followed by client filtering'};
export async function fetchUSGSFlowlines(envelope,minimumArea=500){
 const[west,south,east,north]=envelope.map(Number),tiles=[],features=new Map(),provenance=[],tileChecks=[];
 if(![west,south,east,north].every(Number.isFinite)||west>=east||south>=north)throw new Error('Invalid river benchmark envelope');
 // Two-degree requests keep numberMatched bounded and make complete pagination
 // practical in build environments while preserving a simple deterministic
 // union across the region.
 for(let y=south;y<north;y+=2)for(let x=west;x<east;x+=2)tiles.push([x,y,Math.min(east,x+2),Math.min(north,y+2)]);
 async function tile(bbox){
  let url=endpoint+'?'+new URLSearchParams({f:'json',bbox:bbox.join(','),limit:'5000'}),expected=null,count=0;
  const seen=new Set(),visited=new Set();
  while(url){
   if(visited.has(url))throw new Error('USGS pagination loop');visited.add(url);
   const result=await fetchJSON(url),data=result.json;provenance.push({...result.provenance,dataset:RIVER_SOURCE.dataset});
   if(data.type!=='FeatureCollection'||!Array.isArray(data.features)||!Number.isInteger(data.numberMatched)||data.numberMatched<0||!Number.isInteger(data.numberReturned))throw new Error('Invalid USGS flowline result');
   if(data.numberReturned!==data.features.length)throw new Error('USGS numberReturned does not match features');
   if(expected===null)expected=data.numberMatched;else if(data.numberMatched!==expected)throw new Error('USGS feature count changed during download');
   if(expected>500000)throw new Error('USGS bbox appears not to have been applied');
   for(const f of data.features){
    const p=f.properties||{},id=Number(p.comid??f.id);if(!Number.isFinite(id)||seen.has(id))throw new Error('Missing/duplicate USGS river ID within page sequence');seen.add(id);count++;
    const drainage=Number(p.totdasqkm);if(!Number.isFinite(drainage))throw new Error('USGS flowline schema missing totdasqkm');
    if(drainage<minimumArea||!['StreamRiver','ArtificialPath'].includes(p.ftype))continue;
    const g=f.geometry,paths=g?.type==='MultiLineString'?g.coordinates:g?.type==='LineString'?[g.coordinates]:null;if(!paths)throw new Error('Missing selected USGS flowline geometry');
    const fromnode=Number(p.fromnode),tonode=Number(p.tonode);if(!Number.isFinite(fromnode)||!Number.isFinite(tonode))throw new Error('USGS flowline schema missing network nodes');
    features.set(id,{attributes:{OBJECTID:id,permanent_identifier:String(id),gnis_name:p.gnis_name,totdasqkm:drainage,ftype:p.ftype==='StreamRiver'?460:558,fromnode,tonode,flowdir:p.flowdir==='With Digitized'?1:0},geometry:{paths}});
   }
   if(count>expected)throw new Error('USGS pagination count overflow');
   if(count===expected){url=null;break;}
   const next=(data.links||[]).find(l=>l.rel==='next');if(!next||!data.features.length)throw new Error(`Incomplete USGS river pagination (${count}/${expected})`);
   const candidate=new URL(next.href,url);if(candidate.hostname!=='api.water.usgs.gov'||!candidate.pathname.includes('/nhdflowline_network/items'))throw new Error('Unexpected USGS pagination target');candidate.searchParams.set('f','json');url=candidate.href;
  }
  tileChecks.push({bbox,count,expected,pages:visited.size});console.log('USGS V2 TILE',bbox.join(','),count,'complete features');
 }
 for(let k=0;k<tiles.length;k+=3)await Promise.all(tiles.slice(k,k+3).map(tile));
 if(!features.size)throw new Error('No major observed river segments in requested region');
 return{features:[...features.values()].sort((a,b)=>a.attributes.OBJECTID-b.attributes.OBJECTID),count:features.size,provenance,source:{...RIVER_SOURCE,minimumAreaKm2:minimumArea,tileChecks}};
}
