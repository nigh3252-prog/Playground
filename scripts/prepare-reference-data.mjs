/** Run once at deploy/local build. Phones download only the cropped packs.
 * No credentials or paid data services. A failed fetch fails the build rather
 * than silently substituting invented terrain for a real region.
 */
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {REFERENCES,REFERENCE_SOURCES,toLonLat,fromLonLat,tilePosition,pointInPolygon} from '../assets/world-lab/reference-regions.mjs';
import {decodeTerrarium} from './terrain-png.mjs';
const folder=fileURLToPath(new URL('../assets/world-lab/references/',import.meta.url));
const cache=new Map(),zoom=7,n=513;
async function fetchBytes(url){let error;for(let attempt=0;attempt<3;attempt++)try{
  const r=await fetch(url,{signal:AbortSignal.timeout(35000)});if(!r.ok)throw new Error(`${r.status} ${url}`);
  return Buffer.from(await r.arrayBuffer());
}catch(e){error=e;await new Promise(r=>setTimeout(r,300*(attempt+1)));}throw error;}
async function getTile(tx,ty){const key=`${zoom}/${tx}/${ty}`;if(!cache.has(key))cache.set(key,fetchBytes(`${REFERENCE_SOURCES.tiles}/${key}.png`).then(b=>{
 const decoded=decodeTerrarium(b);if(decoded.width!==256||decoded.height!==256)throw new Error('Expected 256 px terrain tile');return{...decoded,sha256:createHash('sha256').update(b).digest('hex'),url:`${REFERENCE_SOURCES.tiles}/${key}.png`};
}));return cache.get(key);}
function geometryPolygons(geometry){if(geometry.type==='Polygon')return[geometry.coordinates];if(geometry.type==='MultiPolygon')return geometry.coordinates;return[];}
function bounds(points){return[Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))];}
function inRegion(b,size){return b[2]>=0&&b[0]<=size&&b[3]>=0&&b[1]<=size;}
function sampleTile(tiles,lon,lat){const [px,py]=tilePosition(lon,lat,zoom),x=Math.floor(px),y=Math.floor(py),u=px-x,v=py-y;
  const at=(x,y)=>{const t=tiles.get(`${x>>8}/${y>>8}`);if(!t)throw new Error('Missing requested terrain tile');return t.heightM[(y&255)*256+(x&255)];};
  return(at(x,y)*(1-u)+at(x+1,y)*u)*(1-v)+(at(x,y+1)*(1-u)+at(x+1,y+1)*u)*v;
}
// Rounded reference surfaces, not real-time water levels. Michigan/Huron are
// one hydraulic lake; metadata identifies this approximation explicitly.
const nominalGreatLakes=[[/superior/i,183.2],[/michigan|huron/i,176],[/st\.?\s*clair/i,174.4],[/erie/i,173.5],[/ontario/i,74.2]];
function encode16(values,signed){const b=Buffer.alloc(values.length*2);for(let i=0;i<values.length;i++)signed?b.writeInt16LE(values[i],i*2):b.writeUInt16LE(values[i],i*2);return b.toString('base64');}
export async function buildReference(region,lakeData,riverData){
  const latlon=new Float64Array(n*n*2),tileKeys=new Set();
  for(let z=0;z<n;z++)for(let x=0;x<n;x++){
    const i=z*n+x,[lon,lat]=toLonLat(region,x*region.sizeKm/(n-1),z*region.sizeKm/(n-1));latlon[i*2]=lon;latlon[i*2+1]=lat;
    const [px,py]=tilePosition(lon,lat,zoom);for(const dx of [0,1])for(const dy of [0,1])tileKeys.add(`${Math.floor(px+dx)>>8}/${Math.floor(py+dy)>>8}`);
  }
  const keys=[...tileKeys],tiles=new Map();let done=0;
  for(let k=0;k<keys.length;k+=6)await Promise.all(keys.slice(k,k+6).map(async key=>{const[x,y]=key.split('/').map(Number);tiles.set(key,await getTile(x,y));done++;}));
  console.log(`${region.id}: loaded ${done} real elevation tiles`);
  const elevation=new Int16Array(n*n);for(let i=0;i<elevation.length;i++){const h=sampleTile(tiles,latlon[i*2],latlon[i*2+1]);if(!Number.isFinite(h)||h< -12000||h>10000)throw new Error('Invalid source height');elevation[i]=Math.round(h);}
  const lakeIndex=new Uint16Array(n*n),lakes=[],scale=(n-1)/region.sizeKm;
  for(const feature of lakeData.features){
    const props=feature.properties||{},name=props.name_en||props.name||props.NAME||'Mapped lake';
    const polygons=geometryPolygons(feature.geometry).map(rings=>rings.map(ring=>ring.map(([lon,lat])=>fromLonLat(region,lon,lat)))).filter(rings=>inRegion(bounds(rings[0]),region.sizeKm));
    if(!polygons.length)continue;
    const id=lakes.length+1,samples=[],members=[];
    for(const rings of polygons){const b=bounds(rings[0]);for(let z=Math.max(0,Math.floor(b[1]*scale));z<=Math.min(n-1,Math.ceil(b[3]*scale));z++)for(let x=Math.max(0,Math.floor(b[0]*scale));x<=Math.min(n-1,Math.ceil(b[2]*scale));x++){
      if(pointInPolygon(x/scale,z/scale,rings)){const i=z*n+x;lakeIndex[i]=id;members.push(i);samples.push(elevation[i]);}
    }}
    if(!members.length)continue;
    const datum=nominalGreatLakes.find(([regex])=>regex.test(name));samples.sort((a,b)=>a-b);
    const tagged=Number(props.elevation),level=datum?datum[1]:tagged>0?tagged:Math.max(1,samples[Math.floor(samples.length*.30)]);
    const source=datum?'Nominal IGLD85 chart-datum reference, not current lake level':tagged>0?'Natural Earth elevation attribute':'DEM-derived approximate water-surface elevation';
    for(const i of members)elevation[i]=Math.round(level);
    lakes.push({id,name,level,levelSource:source,polygons,source:'Natural Earth v5.1.2',boundaryCondition:true});
  }
  const rivers=[];
  for(const f of riverData.features){const g=f.geometry;if(!g)continue;const lines=g.type==='LineString'?[g.coordinates]:g.type==='MultiLineString'?g.coordinates:[];
    for(const line of lines){const xy=line.map(([lon,lat])=>fromLonLat(region,lon,lat));if(inRegion(bounds(xy),region.sizeKm))rivers.push({name:f.properties?.name_en||f.properties?.name||'Reference river',points:xy});}
  }
  const packed={schema:'watershed-reference-v1',region,n,encoding:'base64 little-endian int16 meters / uint16 lake ID (0 = not mapped lake)',height:encode16(elevation,true),lakeIndex:encode16(lakeIndex,false),lakes,rivers,
    provenance:{accessed:new Date().toISOString(),terrain:'Mapzen / AWS Terrain Tiles',terrainZoom:zoom,sourcePixelKmApprox:Math.cos(region.lat*Math.PI/180)*40075/(2**zoom*256),packSpacingKm:region.sizeKm/(n-1),projection:'Spherical azimuthal equidistant centered on region.lat/lon; R=6371.0088 km',
      sources:REFERENCE_SOURCES,tiles:[...tiles.values()].map(t=>({url:t.url,sha256:t.sha256})),
      attribution:'Mapzen. United States 3DEP and global GMTED2010/SRTM data courtesy of USGS; ETOPO1: NOAA. Contains information licensed under the Open Government Licence – Canada. Water outlines and reference rivers: Natural Earth (public domain).',
      limitations:'Terrain is regional, resampled and not current survey data. Mapped lake surfaces, not bathymetry. Great Lakes are prescribed open boundaries; cross-region inflows and connecting channels are unresolved. Climate, ecology and human potential remain model outputs; cities are annotation only.'}};
  const text=JSON.stringify(packed);await writeFile(`${folder}${region.id}.json`,text);
  const meta={...packed.provenance,region:region.name,bytes:Buffer.byteLength(text),heightSamples:n*n,lakeCount:lakes.length,riverLines:rivers.length,minHeight:elevation.reduce((a,b)=>Math.min(a,b),Infinity),maxHeight:elevation.reduce((a,b)=>Math.max(a,b),-Infinity)};
  // Avoid argument-count limits with larger grids when finding extrema.
  await writeFile(`${folder}${region.id}.meta.json`,JSON.stringify(meta,null,2));
  console.log(`${region.id}: ${(meta.bytes/1e6).toFixed(2)} MB pack; ${lakes.length} mapped lakes; ${rivers.length} reference lines`);
  return packed;
}
async function main(){
  await mkdir(folder,{recursive:true});
  const [lakes,rivers]=await Promise.all([REFERENCE_SOURCES.lakes,REFERENCE_SOURCES.rivers].map(async u=>JSON.parse((await fetchBytes(u)).toString('utf8'))));
  if(!Array.isArray(lakes.features)||!Array.isArray(rivers.features))throw new Error('Invalid Natural Earth source data');
  for(const region of Object.values(REFERENCES))await buildReference(region,lakes,rivers);
}
if(process.argv[1]===fileURLToPath(import.meta.url))main().catch(e=>{console.error('Reference data build failed:',e);process.exitCode=1;});
