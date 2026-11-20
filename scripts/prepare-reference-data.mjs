/** Build compact real-world benchmark packs once at deploy/local build.
 * Phones download only same-origin JSON. Missing real data fails the build;
 * generated geography is never substituted for a benchmark source.
 */
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {REFERENCES,REFERENCE_SOURCES,toLonLat,fromLonLat,tilePosition,pointInPolygon,regionLonLatBounds} from '../assets/world-lab/reference-regions.mjs';
import {decodeTerrarium} from './terrain-png.mjs';
const folder=fileURLToPath(new URL('../assets/world-lab/references/',import.meta.url)),cache=new Map(),zoom=7,n=513;
async function fetchBytes(url){let error;for(let attempt=0;attempt<3;attempt++)try{const r=await fetch(url,{signal:AbortSignal.timeout(45000)});if(!r.ok)throw new Error(`${r.status} ${url}`);return Buffer.from(await r.arrayBuffer());}catch(e){error=e;await new Promise(r=>setTimeout(r,400*(attempt+1)));}throw error;}
async function fetchJSON(url){return JSON.parse((await fetchBytes(url)).toString('utf8'));}
async function getTile(tx,ty){const key=`${zoom}/${tx}/${ty}`;if(!cache.has(key))cache.set(key,fetchBytes(`${REFERENCE_SOURCES.tiles}/${key}.png`).then(b=>{const decoded=decodeTerrarium(b);if(decoded.width!==256||decoded.height!==256)throw new Error('Expected 256 px terrain tile');return{...decoded,sha256:createHash('sha256').update(b).digest('hex'),url:`${REFERENCE_SOURCES.tiles}/${key}.png`};}));return cache.get(key);}
function geometryPolygons(g){if(!g)return[];if(g.type==='Polygon')return[g.coordinates];if(g.type==='MultiPolygon')return g.coordinates;return[];}
function geometryLines(g){if(!g)return[];if(g.type==='LineString')return[g.coordinates];if(g.type==='MultiLineString')return g.coordinates;return[];}
function bounds(points){return[Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))];}
function inRegion(b,size){return b[2]>=0&&b[0]<=size&&b[3]>=0&&b[1]<=size;}
function sampleTile(tiles,lon,lat){const[px,py]=tilePosition(lon,lat,zoom),x=Math.floor(px),y=Math.floor(py),u=px-x,v=py-y;const at=(xx,yy)=>{const t=tiles.get(`${xx>>8}/${yy>>8}`);if(!t)throw new Error('Missing requested terrain tile');return t.heightM[(yy&255)*256+(xx&255)];};return(at(x,y)*(1-u)+at(x+1,y)*u)*(1-v)+(at(x,y+1)*(1-u)+at(x+1,y+1)*u)*v;}
const nominalGreatLakes=[[/superior/i,183.2],[/michigan|huron/i,176],[/st\.?\s*clair/i,174.4],[/erie/i,173.5],[/ontario/i,74.2]];
function encode16(values,signed){const b=Buffer.alloc(values.length*2);for(let i=0;i<values.length;i++)signed?b.writeInt16LE(values[i],i*2):b.writeUInt16LE(values[i],i*2);return b.toString('base64');}
function encode8(values){return Buffer.from(values.buffer,values.byteOffset,values.byteLength).toString('base64');}
async function query3DHP(layer,region,where,outFields){
 const bbox=regionLonLatBounds(region),features=[];let offset=0;
 while(true){const p=new URLSearchParams({where,geometry:bbox.join(','),geometryType:'esriGeometryEnvelope',inSR:'4326',outSR:'4326',spatialRel:'esriSpatialRelIntersects',outFields,returnGeometry:'true',resultRecordCount:'2500',resultOffset:String(offset),f:'geojson'}),url=`${REFERENCE_SOURCES.usgs3dhp}/${layer}/query?${p}`,data=await fetchJSON(url);
  if(data.error)throw new Error(`USGS 3DHP query failed: ${JSON.stringify(data.error)}`);const rows=data.features||[];features.push(...rows);if(rows.length<2500)break;offset+=rows.length;if(offset>100000)throw new Error('3DHP pagination guard exceeded');
 }
 return{type:'FeatureCollection',features};
}
function rasterizePolygons(region,features,predicate){const mask=new Uint8Array(n*n),scale=(n-1)/region.sizeKm;let polygons=0,areaAttributeKm2=0;
 for(const f of features){if(!predicate(f))continue;const a=Number(f.properties?.areasqkm);if(Number.isFinite(a))areaAttributeKm2+=a;
  for(const rings0 of geometryPolygons(f.geometry)){const rings=rings0.map(r=>r.map(([lon,lat])=>fromLonLat(region,lon,lat))),b=bounds(rings[0]);if(!inRegion(b,region.sizeKm))continue;polygons++;
   for(let z=Math.max(0,Math.floor(b[1]*scale));z<=Math.min(n-1,Math.ceil(b[3]*scale));z++)for(let x=Math.max(0,Math.floor(b[0]*scale));x<=Math.min(n-1,Math.ceil(b[2]*scale));x++)if(pointInPolygon(x/scale,z/scale,rings))mask[z*n+x]=1;
  }
 }return{mask,polygons,areaAttributeKm2};}
function rasterizeLines(region,features){const mask=new Uint8Array(n*n),scale=(n-1)/region.sizeKm;let lines=0;
 const mark=(x,z)=>{const ix=Math.round(x*scale),iz=Math.round(z*scale);for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++){const xx=ix+dx,zz=iz+dz;if(xx>=0&&xx<n&&zz>=0&&zz<n)mask[zz*n+xx]=1;}};
 for(const f of features)for(const line0 of geometryLines(f.geometry)){const line=line0.map(([lon,lat])=>fromLonLat(region,lon,lat)),b=bounds(line);if(!inRegion(b,region.sizeKm))continue;lines++;for(let k=1;k<line.length;k++){const[a,b]=[line[k-1],line[k]],steps=Math.max(1,Math.ceil(Math.max(Math.abs(b[0]-a[0]),Math.abs(b[1]-a[1]))*scale));for(let s=0;s<=steps;s++){const t=s/steps;mark(a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t);}}}
 return{mask,lines};}
function populationPoints(region,data){const out=[];for(const f of data.features||[]){if(f.geometry?.type!=='Point')continue;const p=f.properties||{},population=Number(p.POP_MAX??p.pop_max??p.POP_MIN??p.pop_min);if(!(population>0))continue;const[lon,lat]=f.geometry.coordinates,[xKm,zKm]=fromLonLat(region,lon,lat);if(xKm<0||zKm<0||xKm>region.sizeKm||zKm>region.sizeKm)continue;out.push({name:p.NAMEASCII||p.NAME||p.name||'Populated place',population,xKm,zKm,lon,lat});}return out.sort((a,b)=>b.population-a.population);}
export async function buildReference(region,lakeData,riverData,placeData){
 const latlon=new Float64Array(n*n*2),tileKeys=new Set();for(let z=0;z<n;z++)for(let x=0;x<n;x++){const i=z*n+x,[lon,lat]=toLonLat(region,x*region.sizeKm/(n-1),z*region.sizeKm/(n-1));latlon[i*2]=lon;latlon[i*2+1]=lat;const[px,py]=tilePosition(lon,lat,zoom);for(const dx of[0,1])for(const dy of[0,1])tileKeys.add(`${Math.floor(px+dx)>>8}/${Math.floor(py+dy)>>8}`);}
 const keys=[...tileKeys],tiles=new Map();for(let k=0;k<keys.length;k+=6)await Promise.all(keys.slice(k,k+6).map(async key=>{const[x,y]=key.split('/').map(Number);tiles.set(key,await getTile(x,y));}));console.log(`${region.id}: ${keys.length} elevation tiles`);
 const elevation=new Int16Array(n*n);for(let i=0;i<elevation.length;i++){const h=sampleTile(tiles,latlon[i*2],latlon[i*2+1]);if(!Number.isFinite(h)||h< -12000||h>10000)throw new Error('Invalid source height');elevation[i]=Math.round(h);}
 // Natural Earth supplies named large-lake boundary surfaces for familiar
 // orientation and Great-Lake freshwater boundary conditions. Inland lakes
 // are NOT fed to the model; USGS 3DHP is held out as benchmark truth.
 const lakeIndex=new Uint16Array(n*n),lakes=[],scale=(n-1)/region.sizeKm;
 for(const feature of lakeData.features){const props=feature.properties||{},name=props.name_en||props.name||props.NAME||'Mapped lake',polygons=geometryPolygons(feature.geometry).map(r=>r.map(ring=>ring.map(([lon,lat])=>fromLonLat(region,lon,lat)))).filter(r=>inRegion(bounds(r[0]),region.sizeKm));if(!polygons.length)continue;
  const datum=nominalGreatLakes.find(([regex])=>regex.test(name)),boundaryCondition=!!datum,id=lakes.length+1,samples=[],members=[];
  for(const rings of polygons){const b=bounds(rings[0]);for(let z=Math.max(0,Math.floor(b[1]*scale));z<=Math.min(n-1,Math.ceil(b[3]*scale));z++)for(let x=Math.max(0,Math.floor(b[0]*scale));x<=Math.min(n-1,Math.ceil(b[2]*scale));x++)if(pointInPolygon(x/scale,z/scale,rings)){const i=z*n+x;if(boundaryCondition)lakeIndex[i]=id;members.push(i);samples.push(elevation[i]);}}
  if(!members.length)continue;samples.sort((a,b)=>a-b);const tagged=Number(props.elevation),level=datum?datum[1]:tagged>0?tagged:Math.max(1,samples[Math.floor(samples.length*.30)]);
  if(boundaryCondition)for(const i of members)elevation[i]=Math.round(level);lakes.push({id,name,level,levelSource:datum?'Nominal IGLD85 chart-datum reference, not current lake level':tagged>0?'Natural Earth elevation attribute':'DEM-derived approximate surface',polygons,source:'Natural Earth v5.1.2',boundaryCondition});
 }
 const rivers=[];for(const f of riverData.features){const lines=geometryLines(f.geometry);for(const line0 of lines){const xy=line0.map(([lon,lat])=>fromLonLat(region,lon,lat));if(inRegion(bounds(xy),region.sizeKm))rivers.push({name:f.properties?.name_en||f.properties?.name||'Reference river',points:xy});}}
 console.log(`${region.id}: requesting USGS 3DHP benchmark truth…`);
 const [water3d,flow3d]=await Promise.all([
  query3DHP(60,region,'featuretype = 4 OR (featuretype = 3 AND areasqkm >= 0.15)','OBJECTID,featuretype,featuretypelabel,areasqkm,gnisid'),
  query3DHP(50,region,'featuretype = 1 AND streamlevel <= 5','OBJECTID,featuretype,streamlevel,gnisid')
 ]);
 const observed=rasterizePolygons(region,water3d.features,f=>Number(f.properties?.featuretype)===3),boundary=rasterizePolygons(region,water3d.features,f=>Number(f.properties?.featuretype)===4),flow=rasterizeLines(region,flow3d.features),population=populationPoints(region,placeData);
 // Model boundary water is deliberately narrower than benchmark truth. Great
 // Lakes come from named Natural Earth constraints; ocean remains terrain <=0.
 const packed={schema:'watershed-reference-v2',region,n,encoding:'height=int16 LE; lakeIndex=uint16 LE; benchmark masks=uint8 base64',height:encode16(elevation,true),lakeIndex:encode16(lakeIndex,false),lakes,rivers,
  benchmarkLake:encode8(observed.mask),benchmarkBoundaryWater:encode8(boundary.mask),benchmarkRiver:encode8(flow.mask),population,
  benchmarkMeta:{source:'USGS 3DHP_all, refreshed service; held out from inland-lake/river generation',minimumLakeAreaKm2:.15,waterbodyFeatures:water3d.features.length,observedLakePolygons:observed.polygons,observedLakeAreaAttributeKm2:observed.areaAttributeKm2,majorFlowlineFeatures:flow3d.features.length,majorFlowlineLines:flow.lines,populationSource:'Natural Earth v5.1.2 populated places POP_MAX; modern weak sanity check only',populationPlaces:population.length},
  provenance:{accessed:new Date().toISOString(),terrain:'Mapzen / AWS Terrain Tiles',terrainZoom:zoom,sourcePixelKmApprox:Math.cos(region.lat*Math.PI/180)*40075/(2**zoom*256),packSpacingKm:region.sizeKm/(n-1),projection:'Spherical azimuthal equidistant centered on region.lat/lon; R=6371.0088 km',sources:REFERENCE_SOURCES,tiles:[...tiles.values()].map(t=>({url:t.url,sha256:t.sha256})),
   attribution:'Terrain: Mapzen/AWS; USGS 3DEP/GMTED2010/SRTM, NOAA ETOPO1 and Open Government Licence – Canada sources per provider attribution. Benchmark hydrography: USGS 3DHP (public domain). Reference labels/rivers/populated places: Natural Earth (public domain).',
   limitations:'Regional resampling is not survey-grade. USGS inland water and major flowlines are held out for scoring, not used to tune a single run. Great Lakes are explicit boundary water. Natural Earth population is modern and sparse; it is a weak Stage-4 sanity metric, not a historical settlement target.'}};
 const text=JSON.stringify(packed);await writeFile(`${folder}${region.id}.json`,text);const meta={...packed.provenance,region:region.name,role:region.role,bytes:Buffer.byteLength(text),heightSamples:n*n,naturalEarthLakes:lakes.length,referenceRiverLines:rivers.length,...packed.benchmarkMeta,minHeight:elevation.reduce((a,b)=>Math.min(a,b),Infinity),maxHeight:elevation.reduce((a,b)=>Math.max(a,b),-Infinity)};await writeFile(`${folder}${region.id}.meta.json`,JSON.stringify(meta,null,2));console.log(`${region.id}: ${(meta.bytes/1e6).toFixed(2)} MB; ${observed.polygons} USGS lake polygons; ${flow.lines} major flowlines; ${population.length} population points`);return packed;
}
async function main(){await mkdir(folder,{recursive:true});const[lakes,rivers,places]=await Promise.all([REFERENCE_SOURCES.lakes,REFERENCE_SOURCES.rivers,REFERENCE_SOURCES.populatedPlaces].map(fetchJSON));if(!Array.isArray(lakes.features)||!Array.isArray(rivers.features)||!Array.isArray(places.features))throw new Error('Invalid Natural Earth source data');for(const region of Object.values(REFERENCES))await buildReference(region,lakes,rivers,places);}
if(process.argv[1]===fileURLToPath(import.meta.url))main().catch(e=>{console.error('Reference data build failed:',e);process.exitCode=1;});
