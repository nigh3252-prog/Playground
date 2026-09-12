/** Fixed protocol. Calibration roles are labels for development, not a claim
 * that these displayed regions have remained statistically untouched. */
export const PROTOCOL=Object.freeze({version:'watershed-benchmark-1',waterDataset:'USGS NHD high-resolution (download snapshot)',riverDataset:'USGS NHDPlusV2 (Fabric API)',populationDataset:'US Census 2020 tract population at representative points',historicalDataset:'Census 1850 largest-100 urban-place sample',evaluationN:257,minimumLakeKm2:25,riverDrainageKm2:500,riverToleranceKm:8,edgeBufferKm:25,parameterProfile:'water-budget-r5-unfitted',climatePeriod:'1991-2020',noAutomaticFitting:true});
export const BENCHMARK_REGIONS={
 michigan:{id:'michigan',name:'Michigan / Great Lakes',lat:44.25,lon:-85.5,sizeKm:700,role:'calibration',landmarks:[['Grand Rapids',42.963,-85.668,'city'],['Detroit',42.331,-83.046,'city'],['Lansing',42.733,-84.556,'city'],['Traverse City',44.764,-85.622,'city'],['Mackinac',45.85,-84.62,'place'],['Chicago',41.878,-87.630,'city']]},
 greatbasin:{id:'greatbasin',name:'Great Basin / Nevada–Utah',lat:39.5,lon:-116,sizeKm:700,role:'calibration',landmarks:[['Reno',39.53,-119.814,'city'],['Elko',40.833,-115.763,'city'],['Wheeler Peak',38.985,-114.314,'peak'],['Great Salt Lake',41.2,-112.5,'water']]},
 cascades:{id:'cascades',name:'Cascades / Pacific Northwest',lat:45,lon:-121.8,sizeKm:650,role:'validation',landmarks:[['Mount Rainier',46.853,-121.76,'volcano'],['Mount St. Helens',46.2,-122.18,'volcano'],['Mount Hood',45.374,-121.695,'volcano'],['Crater Lake',42.93,-122.12,'volcano'],['Portland',45.515,-122.679,'city'],['Seattle',47.606,-122.332,'city'],['Bend',44.058,-121.315,'city']]},
 appalachians:{id:'appalachians',name:'Central Appalachians',lat:38.5,lon:-80.5,sizeKm:650,role:'validation',landmarks:[['Pittsburgh',40.44,-79.996,'city'],['Charleston WV',38.35,-81.63,'city'],['Roanoke',37.27,-79.94,'city'],['Richmond',37.54,-77.436,'city'],['Spruce Knob',38.70,-79.53,'peak']]}
};
export const BENCHMARK_SOURCES={
 water:'https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/12',
 rivers:'https://api.water.usgs.gov/fabric/pygeoapi/collections/nhdflowline_network/items',
 population:'https://tigerweb.geo.census.gov/arcgis/rest/services/Census2020/Tracts_Blocks/MapServer/0',
 country:'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_admin_0_countries.geojson',
 history:'https://www2.census.gov/library/working-papers/1998/demographics/pop-twps0027/tab08.txt',
 historyNotes:'https://www.census.gov/library/working-papers/1998/demo/POP-twps0027.html',
 places:'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2020_Gazetteer/2020_Gaz_place_national.zip',
 climate:'https://noaa-normals-pds.s3.amazonaws.com/normals-annualseasonal/1991-2020/access/',
 stationInventory:'https://www.ncei.noaa.gov/pub/data/ghcn/daily/ghcnd-stations.txt'
};
