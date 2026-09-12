# Watershed r6 — parent worlds and independent benchmark measurements

This extends PR #21, keeping the separate 410 m City Lab and other Playground demos intact. No settlements are generated. The entry remains `regional-world.html`. The previous mapped-water display remains at `regional-world-reference-r5.html`; its constrained lakes must not be used as independent water predictions.

## Parent worlds rather than fixed border scenery

Generated terrain is now a **3,600–6,000 km parent landmass**, not a rectangle with sea on two sides and mountains on the other two. Default: 4,800 km parent / 1,200 km window. Rotated continental bodies, independent mountain corridors and inherited geological features are seeded across the parent.

Terrain, spill levels, annual water budgets, drainage, climate, ecology and human potential are computed on the **entire parent domain**. Display triangles are clipped/interpolated without rebuilding the drainage graph. **New window** selects another deterministic crop of the SAME solved parent. **Parent** shows that full domain with the selected window outlined. Upstream land outside the window still contributes to visible rivers.

A rejection rule avoids almost-entirely-ocean windows (less than 15% sampled land). This is a useful-view sampling policy, not an unbiased sample of Earth. Finite PARENT edges still have boundary conditions; they are outside the interior window, not a claim of a complete globe.

**Resolution:** Standard uses 257² parent sites, 18.75 km nominal spacing at 4,800 km; Quick uses 193² and Fine 321². Cropping/zooming does NOT add physical detail. Future local refinement must preserve the macro river network. Small lakes/calderas remain unresolved. The 1× control changes only displayed height.

## Independent reference tests

The predictor receives an **unburned real elevation raster** from Mapzen/AWS Terrain Tiles and either explicitly selected synthetic climate or observed NOAA station normals. It does not reuse the r5 pack, which had known lakes flattened into it.

The blind adapter allow-lists inputs and strips lake masks, river vectors, town coordinates and population. Only AFTER Water, Ecology and Human complete does the scorer load observations. Tests check that poisoning observations changes scores, not predictions. Constrained/mapped-water inputs are refused by the scorer. Missing data produces unavailable/N/A, never fake dry land.

**Important DEM limitation:** elevations over real lakes often describe their WATER SURFACE, not bathymetry. Holding out polygons does not recover missing basin floors. Failure to rediscover a flat lake can therefore indicate an input limitation, not solely a retention error. Great Lakes and other large or boundary-truncated water systems are excluded from primary natural-lake scoring. This is not an independent Great Lakes formation model.

## Four fixed regions

| Region | Extent | Assigned use |
| --- | --- | --- |
| Michigan / Great Lakes | 700 km; 44.25 N, 85.5 W | Calibration: low relief / lake-rich |
| Great Basin / Nevada–Utah | 700 km; 39.5 N, 116 W | Calibration: dry basins / ranges |
| Cascades / Pacific Northwest | 650 km; 45 N, 121.8 W | Validation: volcanoes / coastal mountains |
| Central Appalachians | 650 km; 38.5 N, 80.5 W | Validation: ridges, valleys, passes |

The protocol is frozen in `benchmark-protocol.mjs`. **No automatic fitting** is performed; the same water/human model runs everywhere. Split labels do not prove generalization. Previously viewed Cascades are not honestly a never-seen historical holdout; avoid tuning to them and add fresh holdouts before stronger claims.

The panel runs all four regions or a **129 / 193 / 241 resolution sweep** on one real region. Every detail uses the SAME 257² analysis grid, size cutoffs and tolerance. Reports retain version, model/profile fingerprint, source digest, settings and climate forcing. Poor scores are not hidden. Generated worlds can be compared with reference physical statistics; they cannot receive an accuracy score against nonexistent observations.

## Observation sources and exclusions

### Water and rivers

**USGS NHD high-resolution waterbody polygons** provide lake/pond, reservoir, intermittent-water, marsh and playa classes. The builder enumerates IDs then fetches every ID in bounded batches. Missing records or transfer-limit responses abort preparation.

- Collect source water polygons at **1 km² and larger**.
- Score connected natural-water bodies at **25 km² and larger** on the analysis grid. Smaller lakes are diagnostics, below defensible regional resolution.
- Only explicit US observation coverage is scored; Canadian/unknown land is not silently dry.
- Exclude features CODED as reservoirs, intermittent water, marsh/playa, large or crop-truncated water, and a 25 km map-edge buffer. Source classifications may still misclassify some real impoundments.
- Counts are raster connected components, not a complete census of named lakes.

**NHDPlus HR flowlines** use a common 500 km² contributing-area threshold. Both model and observed lines are sampled with physical-length weights and an 8 km agreement tolerance (40 km capped-distance diagnostic). Mapped lake interiors are omitted; artificial connectors only enter comparison outside those masks. River density and confluence alignment are also reported. Geometric agreement is not full topology validation.

The scorer deliberately does NOT fabricate catchment IoU: HUC reporting subbasins are not our terminal-outlet partitions. Matching outlet-conditioned observed catchments needs a separate definition/data preparation step.

### Climate

**NOAA 1991–2020 annual station normals** provide temperature/precipitation. Spatially distributed available stations are selected around each region; missing normals are recorded and at least four valid stations are required. Four-nearest inverse-distance interpolation supplies the mesh, with a 6.5 °C/km temperature lapse adjustment.

This is NOT NOAA gridded climatology, orographic precipitation downscaling, or an 1850 climate reconstruction. Source Fahrenheit/inch values are converted to Celsius/mm and unit-tested. Station counts/distances are retained. Selecting real forcing never silently falls back to generated climate.

### Population

**2020 Census tract POP100** counts are located at each tract's Census internal point. These are not household positions or population rasters; large rural tracts are approximate. Coverage explicitly reports how many locations/population counts were scoreable instead of moving points away from modeled lakes.

**1850 history** uses the Census publication's 100 largest urban places, NOT total US or regional historical population. Exact name/state matches to modern Census Gazetteer places provide orientation points; unmatched/ambiguous/annexed places are recorded. Wheeling VA → WV is explicitly handled. Modern internal points are not reconstructed historical municipal boundaries. Rural and Indigenous populations are absent. Regions without sample locations return N/A, not zero inhabitants.

Modern population is a secondary geographic check, not proof that a preindustrial freight model explains industrialization, policy or current migration. Historical SAMPLE capture must not be reported as capture of all regional historical population.

## Metrics and interface

- Water-area error, precision, recall, F1, IoU, denominators and excluded area.
- Correct water / model-only water / missed mapped water / dry agreement / excluded coloring.
- Lake size bins and budget-vs-node-vs-raster water-area diagnostics, separating retention behavior from inflated blue display footprints.
- Length-weighted river alignment both directions, capped mean separation, density and confluence alignment.
- Sampled peak, area-weighted elevation quantiles, central-90% relief, slope quantiles and elevation bands in physical meters. Mesh peaks are not surveyed summit elevations.
- Population in the top 10%/20% of land potential, lift over area baseline, location-versus-land scores and Spearman correlation with 2020 tract density. Threshold ties receive fractional area: a flat potential map receives baseline lift, not a free perfect score.
- Benchmark JSON export, saved report rows, reproducible region/seed/crop URLs and build-time baseline rows so a phone need not initially recompute four regions.

## Build and validation

`node scripts/build-watershed.mjs` parses world/scripts modules, links browser app/worker import graphs without evaluating a fake DOM, runs focused unit/UI-contract tests, preserves the r5 reference data/integration checks, prepares four new real-source packs, runs new integration tests and computes real baseline reports before publishing `public/`.

Critical source failures fail the build rather than supplying procedural stand-ins. URLs, hashes, queries, source resolution, access times and coverage exclusions are retained. Data epochs differ; this is not a perfect contemporaneous ground truth.

Tests verify implementation properties, not accurate science. Passing parsing/conservation/benchmark math does not prove predictions match geography. Handset/browser WebGL appearance must be checked separately. The generated build-validation JSON is written only after all listed checks succeed.

## Sources / attribution

- Terrain: https://registry.opendata.aws/terrain-tiles/ ; https://github.com/tilezen/joerd/blob/master/docs/attribution.md
- NHD waterbodies: https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/12
- NHDPlus HR: https://hydro.nationalmap.gov/arcgis/rest/services/NHDPlus_HR/MapServer/3
- Census tract attributes: https://tigerweb.geo.census.gov/arcgis/rest/services/Census2020/Tracts_Blocks/MapServer/0
- Census 1850 table: https://www2.census.gov/library/working-papers/1998/demographics/pop-twps0027/tab08.txt
- Historical source limits: https://www.census.gov/library/working-papers/1998/demo/POP-twps0027.html
- Gazetteer: https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.2020.html
- NOAA normals: https://www.ncei.noaa.gov/products/land-based-station/us-climate-normals ; https://registry.opendata.aws/noaa-normals/
- Coverage: Natural Earth v5.1.2, public domain: https://www.naturalearthdata.com/about/terms-of-use/

Mapzen attribution includes USGS 3DEP/GMTED2010/SRTM, NOAA ETOPO1 and Canadian data under the Open Government Licence – Canada. Existing Delaunator attribution/license remain unchanged.
