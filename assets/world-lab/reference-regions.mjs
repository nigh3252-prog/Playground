/** Reference extents are geographic benchmark inputs, not procedural presets.
 * Local spherical azimuthal-equidistant projection, kilometers from NW corner.
 */
export const REFERENCES = {
  michigan: {id:'michigan',name:'Michigan / Great Lakes',role:'calibration',lat:44.25,lon:-85.5,sizeKm:700,
    description:'Calibration region: low-relief glacial country with extraordinary freshwater density. Great Lakes are boundary water; inland lakes are withheld from the model for scoring.',
    landmarks:[
      ['Grand Rapids',42.963,-85.668,'city'],['Detroit',42.331,-83.046,'city'],['Lansing',42.733,-84.556,'city'],['Traverse City',44.764,-85.622,'city'],['Mackinac',45.85,-84.62,'place'],['Chicago',41.878,-87.630,'city'],
      ['Lake Michigan',43.6,-87.0,'water'],['Lake Huron',44.75,-82.55,'water'],['Lake Superior',47.05,-87.1,'water']
    ]},
  greatbasin: {id:'greatbasin',name:'Great Basin / Nevada–Utah',role:'calibration',lat:39.2,lon:-116.4,sizeKm:850,
    description:'Calibration region: dry internally drained basins, mountain ranges, playas and a few persistent lakes. It is deliberately hard on an over-eager lake model.',
    landmarks:[
      ['Reno',39.529,-119.814,'city'],['Salt Lake City',40.760,-111.891,'city'],['Las Vegas',36.172,-115.140,'city'],['Great Salt Lake',41.15,-112.55,'water'],['Lake Tahoe',39.10,-120.03,'water'],['Bonneville Salt Flats',40.76,-113.89,'place']
    ]},
  cascades: {id:'cascades',name:'Cascades / Pacific Northwest',role:'validation',lat:45.0,lon:-121.8,sizeKm:650,
    description:'Validation region: real coast, volcanic peaks, wet windward slopes and dry interior. Regional samples do not resolve every crater or summit.',
    landmarks:[
      ['Mount Rainier',46.853,-121.76,'volcano'],['Mount St. Helens',46.2,-122.18,'volcano'],['Mount Hood',45.374,-121.695,'volcano'],['Crater Lake',42.93,-122.12,'volcano'],['Portland',45.515,-122.679,'city'],['Seattle',47.606,-122.332,'city'],['Bend',44.058,-121.315,'city'],['Pacific Ocean',44.7,-124.85,'water']
    ]},
  appalachians: {id:'appalachians',name:'Central / Southern Appalachians',role:'validation',lat:37.7,lon:-81.5,sizeKm:700,
    description:'Validation region: long ridges, narrow valleys, passes and dense drainage with moderate peak elevation. Useful for testing transport-cost geography.',
    landmarks:[
      ['Charleston, WV',38.350,-81.633,'city'],['Roanoke',37.271,-79.941,'city'],['Knoxville',35.961,-83.921,'city'],['Asheville',35.595,-82.551,'city'],['Mount Mitchell',35.765,-82.265,'mountain'],['New River Gorge',38.070,-81.083,'place']
    ]}
};
export const REFERENCE_SOURCES = {
  terrain:'https://registry.opendata.aws/terrain-tiles/',
  tiles:'https://elevation-tiles-prod.s3.amazonaws.com/terrarium',
  attribution:'https://github.com/tilezen/joerd/blob/master/docs/attribution.md',
  lakes:'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_lakes.geojson',
  lakeInfo:'https://www.naturalearthdata.com/downloads/10m-physical-vectors/10m-lakes/',
  rivers:'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_rivers_lake_centerlines.geojson',
  populatedPlaces:'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_populated_places.geojson',
  usgs3dhp:'https://hydro.nationalmap.gov/arcgis/rest/services/3DHP_all/FeatureServer',
  usgsWaterbody:'https://hydro.nationalmap.gov/arcgis/rest/services/3DHP_all/FeatureServer/60',
  usgsFlowline:'https://hydro.nationalmap.gov/arcgis/rest/services/3DHP_all/FeatureServer/50',
  usgsInfo:'https://www.usgs.gov/3d-hydrography-program/about',
  license:'https://www.naturalearthdata.com/about/terms-of-use/'
};
const R=6371.0088,D=Math.PI/180;
export function toLonLat(region,x,z){
  const east=x-region.sizeKm/2,north=region.sizeKm/2-z,rho=Math.hypot(east,north),lat0=region.lat*D,lon0=region.lon*D;
  if(rho<1e-10)return[region.lon,region.lat];
  const c=rho/R,s=Math.sin(c),co=Math.cos(c),lat=Math.asin(co*Math.sin(lat0)+north*s*Math.cos(lat0)/rho);
  return[(lon0+Math.atan2(east*s,rho*Math.cos(lat0)*co-north*Math.sin(lat0)*s))/D,lat/D];
}
export function fromLonLat(region,lon,lat){
  const p=lat*D,p0=region.lat*D,d=(lon-region.lon)*D,co=Math.max(-1,Math.min(1,Math.sin(p0)*Math.sin(p)+Math.cos(p0)*Math.cos(p)*Math.cos(d))),c=Math.acos(co),k=c<1e-9?1:c/Math.sin(c);
  return[region.sizeKm/2+R*k*Math.cos(p)*Math.sin(d),region.sizeKm/2-R*k*(Math.cos(p0)*Math.sin(p)-Math.sin(p0)*Math.cos(p)*Math.cos(d))];
}
export function tilePosition(lon,lat,zoom=7){const tiles=2**zoom,p=Math.max(-85,Math.min(85,lat))*D;return[(lon+180)/360*tiles*256,(1-Math.asinh(Math.tan(p))/Math.PI)/2*tiles*256];}
export function pointInRing(x,y,ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;}
export function pointInPolygon(x,y,rings){return pointInRing(x,y,rings[0])&&!rings.slice(1).some(r=>pointInRing(x,y,r));}
export function bilinear(data,n,x,z,size){const u=Math.max(0,Math.min(n-1,x/size*(n-1))),v=Math.max(0,Math.min(n-1,z/size*(n-1))),ix=Math.min(n-2,Math.floor(u)),iz=Math.min(n-2,Math.floor(v)),a=u-ix,b=v-iz,i=iz*n+ix;return(data[i]*(1-a)+data[i+1]*a)*(1-b)+(data[i+n]*(1-a)+data[i+n+1]*a)*b;}
export function regionLonLatBounds(region,samples=24){const pts=[];for(let i=0;i<=samples;i++){const t=i/samples*region.sizeKm;pts.push(toLonLat(region,t,0),toLonLat(region,t,region.sizeKm),toLonLat(region,0,t),toLonLat(region,region.sizeKm,t));}return[Math.min(...pts.map(p=>p[0])),Math.min(...pts.map(p=>p[1])),Math.max(...pts.map(p=>p[0])),Math.max(...pts.map(p=>p[1]))];}
