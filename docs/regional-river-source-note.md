# River reference source correction (r6)

The NHDPlus HR ArcGIS view repeatedly timed out on small regional queries during build validation. The implemented river source is therefore the **official USGS NHDPlusV2 Fabric API**, not the HR river layer mentioned in the initial r6 design notes. Waterbody polygons continue to come from the NHD high-resolution waterbody service.

Source: https://api.water.usgs.gov/fabric/pygeoapi/collections/nhdflowline_network
Documentation: https://api.water.usgs.gov/docs/fabric-pygeoapi/
License: CC0 1.0, as provided by that service.

Every page of each bounded geographic request is fetched and its feature count verified before filtering at the shared 500 km² contributing-area threshold. `comid` identifiers deduplicate tiles; the observed geometry, drainage areas and network nodes are unchanged. River metadata explicitly identifies NHDPlusV2. This is a medium-resolution regional comparison, not a claim of complete high-resolution hydrography. No missing request is silently replaced with an empty river network.
