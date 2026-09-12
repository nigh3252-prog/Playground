import {inflateRawSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
export const digest=b=>createHash('sha256').update(b).digest('hex');
const cacheDir='.cache/watershed-sources';
export async function fetchSource(url,{optional=false}={}){
 await mkdir(cacheDir,{recursive:true});const key=digest(url),path=`${cacheDir}/${key}.bin`;let bytes;
 try{bytes=await readFile(path);}catch{}
 if(!bytes){let error;for(let k=0;k<3;k++)try{const r=await fetch(url,{signal:AbortSignal.timeout(90000),headers:{'User-Agent':'Watershed-research-prototype/6'}});if(!r.ok){if(optional&&[403,404].includes(r.status))return{missing:true,url,error:`${r.status}: source record unavailable`};throw new Error(`${r.status}: ${url}`);}bytes=Buffer.from(await r.arrayBuffer());await writeFile(path,bytes);break;}catch(e){error=e;await new Promise(r=>setTimeout(r,700*(k+1)));}if(!bytes){if(optional)return{missing:true,url,error:error.message};throw error;}}
 return{bytes,provenance:{url,sha256:digest(bytes),bytes:bytes.length,accessed:new Date().toISOString()}};
}
export async function fetchJSON(url){const r=await fetchSource(url);let json;try{json=JSON.parse(r.bytes.toString());}catch{throw new Error(`Invalid JSON: ${url}`);}if(json.error)throw new Error(`Service error ${JSON.stringify(json.error)} from ${url}`);return{json,provenance:r.provenance};}
export function parseCSV(text,delimiter=','){
 const rows=[];let row=[],value='',quoted=false;for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){value+='"';i++;}else quoted=!quoted;}else if(!quoted&&(c===delimiter||c==='\n')){row.push(value.replace(/\r$/,''));value='';if(c==='\n'){if(row.some(Boolean))rows.push(row);row=[];}}else value+=c;}if(value||row.length){row.push(value.replace(/\r$/,''));rows.push(row);}return rows;
}
export function unzipText(zip,endsWith='.txt'){
 const b=Buffer.from(zip);let e=-1;for(let i=b.length-22;i>=Math.max(0,b.length-65557);i--)if(b.readUInt32LE(i)===0x06054b50){e=i;break;}if(e<0)throw new Error('Bad source ZIP');
 const count=b.readUInt16LE(e+10);let p=b.readUInt32LE(e+16);
 for(let j=0;j<count;j++){if(b.readUInt32LE(p)!==0x02014b50)throw new Error('Bad ZIP central directory');const method=b.readUInt16LE(p+10),length=b.readUInt32LE(p+20),nameLength=b.readUInt16LE(p+28),extra=b.readUInt16LE(p+30),comment=b.readUInt16LE(p+32),offset=b.readUInt32LE(p+42),name=b.toString('utf8',p+46,p+46+nameLength);p+=46+nameLength+extra+comment;
  if(!name.endsWith(endsWith))continue;const start=offset+30+b.readUInt16LE(offset+26)+b.readUInt16LE(offset+28),data=b.subarray(start,start+length);if(method===8)return inflateRawSync(data).toString('utf8');if(method===0)return data.toString('utf8');throw new Error('Unsupported ZIP compression');}
 throw new Error('Expected text file missing from source ZIP');
}
/** Fetch IDs first, then every returned ID exactly once. Missing records or a
 * transfer limit abort the dataset; they never become observed dry land. */
export async function queryAll(endpoint,parameters,{fields='*',geometry=true,batch=150}={}){
 const base={f:'json',...parameters};const make=p=>endpoint+'/query?'+new URLSearchParams({...base,...p});
 const idsResponse=await fetchJSON(make({returnIdsOnly:'true',returnGeometry:'false'})),ids=idsResponse.json.objectIds;
 if(!Array.isArray(ids))throw new Error('No object-ID enumeration from '+endpoint);const oid=idsResponse.json.objectIdFieldName||'OBJECTID',features=[],provenance=[idsResponse.provenance];
 const chunks=[];for(let i=0;i<ids.length;i+=batch)chunks.push(ids.slice(i,i+batch));
 for(let k=0;k<chunks.length;k+=3)await Promise.all(chunks.slice(k,k+3).map(async group=>{
  const request=await fetchJSON(make({objectIds:group.join(','),outFields:fields,returnIdsOnly:'false',returnGeometry:String(geometry),outSR:'4326',returnZ:'false',returnM:'false',maxAllowableOffset:geometry?'0.001':'0'}));
  if(request.json.exceededTransferLimit||!Array.isArray(request.json.features))throw new Error('Incomplete geometry batch');
  const returned=new Set(request.json.features.map(f=>Number(f.attributes[oid])));if(returned.size!==group.length||group.some(id=>!returned.has(Number(id))))throw new Error('Missing observation records');
  features.push(...request.json.features);provenance.push(request.provenance);
 }));features.sort((a,b)=>a.attributes[oid]-b.attributes[oid]);return{features,provenance,count:ids.length};
}
export function bounds(points){let a=Infinity,b=Infinity,c=-Infinity,d=-Infinity;for(const[x,z]of points){a=Math.min(a,x);b=Math.min(b,z);c=Math.max(c,x);d=Math.max(d,z);}return[a,b,c,d];}
export function rasterPolygon(rings,n,size,visit){
 const all=rings.flat();if(!all.length)return;const b=bounds(all),step=size/n,z0=Math.max(0,Math.ceil(b[1]/step-.5)),z1=Math.min(n-1,Math.floor(b[3]/step-.5));
 for(let row=z0;row<=z1;row++){const y=(row+.5)*step,crossings=[];for(const ring of rings)for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[j],b=ring[i];if((a[1]>y)===(b[1]>y))continue;crossings.push(a[0]+(y-a[1])*(b[0]-a[0])/(b[1]-a[1]));}crossings.sort((a,b)=>a-b);
  for(let j=0;j+1<crossings.length;j+=2){const x0=Math.max(0,Math.ceil(crossings[j]/step-.5)),x1=Math.min(n-1,Math.floor(crossings[j+1]/step-.5));for(let x=x0;x<=x1;x++)visit(row*n+x);}
 }
}
export function historyRows(text){
 const matches=[...text.matchAll(/(\d{1,3})\s{2,}([^\n]+?)\.{2,}\s*([\d,]+)/g)].map(m=>({rank:Number(m[1]),rawName:m[2].trim(),population:Number(m[3].replaceAll(',',''))})).filter(p=>p.rank>=1&&p.rank<=100);
 const seen=new Set();const rows=matches.filter(p=>{if(seen.has(p.rank))return false;seen.add(p.rank);return true;});if(rows.length!==100)throw new Error(`Historical source parse found ${rows.length}, not 100 records`);return rows;
}
export function normalFromCSV(text){
 const rows=parseCSV(text),h=rows[0];if(!h||rows.length<2)return null;const r=Object.fromEntries(h.map((key,i)=>[key.trim(),rows[1][i]])),temp=Number(r['ANN-TAVG-NORMAL']),rain=Number(r['ANN-PRCP-NORMAL']);
 if(!r['ANN-TAVG-NORMAL']||!r['ANN-PRCP-NORMAL']||!Number.isFinite(temp)||!Number.isFinite(rain)||temp< -60||temp>120||rain<0||rain>400)return null;
 const lat=Number(r.LATITUDE),lon=Number(r.LONGITUDE),elevationM=Number(r.ELEVATION);if(!Number.isFinite(lat)||!Number.isFinite(lon))return null;
 return{id:r.STATION,name:r.NAME,lat,lon,elevationM:Number.isFinite(elevationM)?elevationM:0,tempC:(temp-32)*5/9,rainMm:rain*25.4,sourceUnits:'NOAA access CSV: Fahrenheit and inches; converted to Celsius and millimeters'};
}
