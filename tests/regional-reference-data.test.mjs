import test from 'node:test';import assert from 'node:assert/strict';import {deflateSync} from 'node:zlib';
import {REFERENCES,toLonLat,fromLonLat,tilePosition,pointInPolygon,bilinear} from '../assets/world-lab/reference-regions.mjs';
import {decodeTerrarium} from '../scripts/terrain-png.mjs';
const near=(a,b,t=1e-6)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
test('reference projections round-trip kilometers and geographic coordinates',()=>{for(const r of Object.values(REFERENCES))for(const x of [0,r.sizeKm/2,r.sizeKm])for(const z of [0,r.sizeKm/2,r.sizeKm]){const p=fromLonLat(r,...toLonLat(r,x,z));near(p[0],x);near(p[1],z);}});
test('Michigan places and Cascade volcanoes fall inside the selected crops',()=>{for(const r of Object.values(REFERENCES))for(const p of r.landmarks){const [x,z]=fromLonLat(r,p[2],p[1]);assert.ok(x>=0&&x<=r.sizeKm&&z>=0&&z<=r.sizeKm,p[0]);}});
test('tile coordinates use the real Mercator layout',()=>{const p=tilePosition(0,0,1);near(p[0],256);near(p[1],256);});
test('water polygons respect holes rather than flooding islands',()=>{const poly=[[[0,0],[4,0],[4,4],[0,4],[0,0]],[[1,1],[3,1],[3,3],[1,3],[1,1]]];assert.equal(pointInPolygon(.5,.5,poly),true);assert.equal(pointInPolygon(2,2,poly),false);});
test('terrain resampling interpolates supplied data, not noise',()=>{near(bilinear([0,10,20,30],2,5,5,10),15);});
function chunk(name,data){const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);b.write(name,4);data.copy(b,8);return b;}
test('PNG/Terrarium bytes decode elevation, including negative and fractional values',()=>{const head=Buffer.alloc(13);head.writeUInt32BE(2,0);head.writeUInt32BE(1,4);head[8]=8;head[9]=2;const raw=Buffer.from([0,128,176,0,127,255,128]);const png=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',head),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);const out=decodeTerrarium(png);near(out.heightM[0],176);near(out.heightM[1],-.5);});
test('a failed data response cannot masquerade as valid elevation',()=>assert.throws(()=>decodeTerrarium(Buffer.from('<html>error</html>'))));
