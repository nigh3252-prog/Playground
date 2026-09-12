/** Reference extents are geographic data inputs, not procedural world presets.
 * Local spherical azimuthal-equidistant projection, kilometers from NW corner.
 */
export const REFERENCES = {
  michigan: {id:'michigan',name:'Michigan / Great Lakes',lat:44.25,lon:-85.5,sizeKm:700,
    description:'Lower Michigan, neighboring land and the Great Lakes. Freshwater is kept above sea level; these cropped lakes are boundary conditions, not predicted lakes.',
    landmarks:[
      ['Grand Rapids',42.963,-85.668,'city'],['Detroit',42.331,-83.046,'city'],['Lansing',42.733,-84.556,'city'],
      ['Traverse City',44.764,-85.622,'city'],['Mackinac',45.85,-84.62,'place'],['Chicago',41.878,-87.630,'city'],
      ['Lake Michigan',43.6,-87.0,'water'],['Lake Huron',44.75,-82.55,'water'],['Lake Superior',47.05,-87.1,'water']
    ]},
  cascades: {id:'cascades',name:'Cascades / Pacific Northwest',lat:45.0,lon:-121.8,sizeKm:650,
    description:'Real coast, mountain belts and volcanic peaks from Washington to southern Oregon. Regional samples do not resolve every crater or summit.',
    landmarks:[
      ['Mount Rainier',46.853,-121.76,'volcano'],['Mount St. Helens',46.2,-122.18,'volcano'],
      ['Mount Hood',45.374,-121.695,'volcano'],['Crater Lake',42.93,-122.12,'volcano'],
      ['Portland',45.515,-122.679,'city'],['Seattle',47.606,-122.332,'city'],['Bend',44.058,-121.315,'city'],['Pacific Ocean',44.7,-124.85,'water']
    ]}
};
export const REFERENCE_SOURCES = {
  terrain:'https://registry.opendata.aws/terrain-tiles/',
  tiles:'https://elevation-tiles-prod.s3.amazonaws.com/terrarium',
  attribution:'https://github.com/tilezen/joerd/blob/master/docs/attribution.md',
  lakes:'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_lakes.geojson',
  lakeInfo:'https://www.naturalearthdata.com/downloads/10m-physical-vectors/10m-lakes/',
  rivers:'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_rivers_lake_centerlines.geojson',
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
export function tilePosition(lon,lat,zoom=7){
  const tiles=2**zoom,p=Math.max(-85,Math.min(85,lat))*D;
  return[(lon+180)/360*tiles*256,(1-Math.asinh(Math.tan(p))/Math.PI)/2*tiles*256];
}
export function pointInRing(x,y,ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){
  const a=ring[i],b=ring[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])inside=!inside;
}return inside;}
export function pointInPolygon(x,y,rings){return pointInRing(x,y,rings[0])&&!rings.slice(1).some(r=>pointInRing(x,y,r));}
export function bilinear(data,n,x,z,size){
  const u=Math.max(0,Math.min(n-1,x/size*(n-1))),v=Math.max(0,Math.min(n-1,z/size*(n-1))),ix=Math.min(n-2,Math.floor(u)),iz=Math.min(n-2,Math.floor(v)),a=u-ix,b=v-iz,i=iz*n+ix;
  return (data[i]*(1-a)+data[i+1]*a)*(1-b)+(data[i+n]*(1-a)+data[i+n+1]*a)*b;
}
