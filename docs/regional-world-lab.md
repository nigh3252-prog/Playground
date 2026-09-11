# Watershed — Regional World Lab, r2

Open `regional-world.html`. This is the independent regional generator in PR #21; it does not replace the 410 m City Lab in PR #20. Its purpose is geographic context for later Warden maps. No settlements, roads, buildings, individual trees or mech gameplay are generated here.

## What changed in r2

### Real off-grid drainage, not cosmetic smoothing

The v1 physical model used D8 raster receivers. In r2, the terrain itself is an **irregular Delaunay triangle mesh**, with strongly jittered, warped sampling sites. Triangulation determines adjacency from actual coordinates, not eight row/column offsets.

All physical and visual systems share that mesh:

- Terrain heights, slopes, sea connectivity and depression spill levels.
- Downhill receivers selected by elevation drop divided by actual link distance.
- Upstream area accumulated from geometric triangle-barycentric node areas; each triangle contributes one third of its area to each corner.
- Catchment labels, outlets, lake components, tributary confluences and runoff.
- Distance to water, environment classification, inspection traces and export data.
- The rendered terrain triangles, color atlas and terrain picking.

River strokes are the **actual drainage links**, not splines pasted over an unchanged D8 network. The optional **Show physical drainage mesh** overlay exposes this directly. Link bearings are no longer restricted to multiples of 45 degrees. This remains a finite-resolution, piecewise-linear mesh model: it does not eliminate every possible discretization artifact or simulate hydraulic flow continuously.

D-infinity was considered, but it estimates continuous directions and distributes raster flow between neighboring receivers. It is not automatically a single arbitrary-coordinate river graph. This implementation instead uses steepest routing on an irregular mesh, keeping one explicit downstream receiver for each site and unambiguous catchment IDs.

Priority-Flood calculates lake spill levels without modifying the original terrain snapshot. Lower flood rank resolves flat spill surfaces and guarantees acyclic drainage. Open land edges remain outlets, not sealed dams.

### Landscape histories change the terrain first

Choose a **Landscape history**, then **Generate**. Keep the seed unchanged to compare histories on the same sampling mesh.

| Preset | Physical terrain recipe |
| --- | --- |
| Regional mosaic | Different glacial, rift, volcanic and weathered features in different parts of the region. Default. |
| Glacial highlands | Long scoured valleys, overdeepened basins and sill-like barriers, favoring elongated valley lakes. |
| Rift country | A long subsiding basin with raised shoulders, favoring a dominant elongated lake system. |
| Volcanic plateau | An elevated volcanic field, cones and broad caldera depressions. Only regional-scale forms are resolved. |
| Old river country | Gentler old uplands and a broad descending river valley. |

These recipes alter elevation **before hydrology**, so receivers, lakes, catchments, climate and environments can change. They are not merely different colors or names. A **Landscape history** coloring mode and the inspector expose the landform tags.

A limited inherited-drainage pass can breach unmarked, shallow noise depressions rather than turning every mountain hollow into a lake. Deliberately tagged glacial/rift/caldera basins are preserved by the recipe. This cuts actual terrain and is part of Stage 1; it is not an erosion-over-geological-time solver. Lake occurrence and size still depend on the resulting spill topology.

### One-tap true mountain scale

Use **1× / True scale** beside the map/menu buttons. It toggles between true horizontal/vertical proportions and the last exaggerated view (18× initially). The menu also has **Exaggerate mountain heights** and a 2–30× slider.

This control changes the rendered height conversion and normals only. It does not regenerate the map, alter physical elevations, or change receivers, drainage areas, lakes or environments. The UI displays the current factor, and the choice is retained in the URL and local storage when browser permissions allow. At true scale a region this wide looks much flatter; that is expected. Rivers are still drawn symbolically wider for legibility.

## Scope, coordinates and export

Default extent: **1,200 × 1,200 km**; options: 600 and 2,400 km. This is synthetic regional geography, not a reconstruction of England, the Mississippi basin or a real lake district.

Standard uses 193² sampling sites with **6.25 km nominal spacing**. Actual mesh link lengths vary. Quick uses 129² sites; Fine uses 241². These are regional samples, not street-level terrain or individual lake banks. Changing detail changes physical discretization, not just rendering quality.

- X increases east and Z increases south, in kilometers, from the region's northwest corner.
- Elevations and spill heights are meters. Node and contributing areas are km².
- Rainfall and temperature are synthetic estimates in mm/year and °C. Runoff is a coarse mean-flow proxy in m³/s, not a forecast.
- Rendering centers the coordinates on the origin and converts meters to kilometers before applying visual exaggeration.

**r2 JSON exports use a new mesh schema**: coordinates, triangle indices, geometric node areas, original and spill elevations, node-ID receivers, flow bearings, river flags, catchments, lake IDs, runoff, climate, history tags and feature descriptors. Do not interpret IDs as old raster pixels. Nodes without a downstream bearing export `null` for that bearing. Version and units are explicit in the file.

## Three preserved stages

1. **Terrain:** seeded regional landforms, history recipes and inherited drainage cuts; western/southern coasts and northern/eastern mountain belts.
2. **Hydrology:** mesh spill surfaces, drainage receivers, tributaries, catchments and spill-level lakes. Original heights remain available separately.
3. **Environments:** simplified prevailing wind, moisture, temperature, elevation and water-distance rules distinguish forest, woodland, grassland, steppe, arid scrub, wetland, mountain forest, alpine ground and snow/ice.

Stage buttons restore the actual corresponding snapshot. **Watch build** replays cached phases with a pause between them, not a geological-time simulation. Generation normally runs in a local module worker; a yielding main-thread fallback handles environments that cannot load workers.

## Controls and use

Drag to orbit, pinch/wheel to zoom, right-drag or Shift-drag to pan. Two-finger touch drag pans. Map view gives overhead panning. Tap land to highlight its catchment and follow a gold drainage trace to sea or an open boundary; the inspector shows actual coordinates, flow bearing, upstream area and landform history.

Generation settings apply on **Generate**. **New seed** applies immediately. Stage, color mode and visual scale do not rerun generation. Watersheds and rainfall coloring require their respective stages. **Copy seed link** retains model parameters and current inspection stage/view preferences. **Export regional data** saves v2 JSON.

Serve as static files, e.g. `python -m http.server 8000`, then open `/regional-world.html`. No CDN, API keys, network-loaded renderer, textures or package installation are required. The locally bundled triangulation helper includes its license. WebGL renders 3D when available; the 2D fallback uses the same model and mesh-aware atlas.

## Deliberate limitations

This is still a coarse synthetic heightfield, now on an irregular mesh. Mountain/coast placement is a designed macro-layout with seeded variation, not plate tectonics. Glacial, rift and volcanic recipes imitate landform shapes rather than simulate their physical histories. The large calderas are regional-scale constructs, not claims that typical crater lakes are tens of kilometers across.

Depressions fill to their spill levels regardless of water budget; evaporation-limited terminal lakes, groundwater, seasons, floods, sediment transport and dynamic channel erosion are not modeled. Land-cover and climate are heuristics, not calibrated forecasts or scientific wetland delineations. Catchments and lake areas are estimates at mesh resolution. A lake-to-outlet trace indicates drainage connectivity, not a visible channel across the surface of the lake.

Natural boundaries provide context, not invisible collision barriers. No navigability, settlement suitability, city connection or Warden runtime integration is implemented.

## Algorithm / landform references

- Barnes, Lehman & Mulla, *Priority-Flood: An Optimal Depression-Filling and Watershed-Labeling Algorithm for Digital Elevation Models*, Computers & Geosciences 62 (2014), 117–127. [Author paper](https://arxiv.org/abs/1511.04463). The method also supports irregular meshes; this is an original JavaScript spill/routing implementation.
- [Landlab FlowDirectorSteepest](https://landlab.csdms.io/generated/api/landlab.components.flow_director.flow_director_steepest.html) and [diverse grid classes](https://landlab.csdms.io/tutorials/grids/diverse_grid_classes.html): flow routing on non-raster grids.
- [TauDEM D-infinity directions](https://hydrology.usu.edu/taudem/taudem5/help53/DInfinityFlowDirections.html) and [contributing area](https://hydrology.usu.edu/taudem/taudem5/help53/DInfinityContributingArea.html): distinction between continuous directional estimates and raster receivers. **This lab is not a D-infinity implementation.**
- [NPS glacial geology](https://home.nps.gov/glac/learn/nature/glacial-geology.htm), [USGS Lake Baikal](https://pubs.usgs.gov/fs/baikal/) and [USGS Crater Lake](https://www.usgs.gov/volcanoes/crater-lake): inspiration for contrasting lake-producing landforms, not validations of our synthetic output.

### Triangulator provenance

`assets/world-lab/triangulate.mjs` adapts the sweep-hull algorithm from [Mapbox Delaunator](https://github.com/mapbox/delaunator). The full ISC license and attribution are retained in the file. This compact local version uses double-precision orientation tests instead of upstream adaptive `robust-predicates`. It is tested for this lab's well-spaced synthetic samples, not advertised as a robust general-purpose GIS triangulator for pathological inputs.

## Validation completed for r2

- `node --test tests/regional-world.test.mjs`: **24/24 passed**. Checks include mesh area/coverage, real off-compass flow angles, exact link-slope selection, acyclic downhill routing, outlet conservation, preserved stages, known bowl/flat cases, confluences, independent shortest-path wet-distance comparison, history-dependent terrain/drainage/ecology, representative lake shape differences, export topology and Standard/Fine meshes.
- All six JavaScript modules passed `node --check`.
- Additional local triangulation checks: the default Standard mesh's 73,728 triangles exactly matched SciPy Delaunay connectivity; 80 extra seeded meshes passed positive-area/domain-coverage checks.
- Browser checks at **1440 × 960** and **393 × 852**: **18 checks per layout passed**. They cover stage/replay/pause, picking/traces, preset changes, true-scale and restore controls, no regeneration/model changes on visual scaling, numeric 1× height conversion, menu/settings, export, viewport fit and no page errors.
- **Testing limitation:** URL navigation is blocked in the execution browser (`ERR_BLOCKED_BY_ADMINISTRATOR`) and WebGL is unavailable there. The browser tests loaded the same authored code as in-memory modules and exercised the **2D/main-thread fallback**, not a physical phone's WebGL or a hosted module worker. Hosted deployment success is not a substitute for those device rendering checks.
