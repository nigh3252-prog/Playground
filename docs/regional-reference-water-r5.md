# Watershed r5 — real reference regions and plausible basin water

This update stays in PR #21 / `regional-world-lab`. It leaves the generated terrain/geology recipes, irregular mesh, earlier City Lab and existing Playground demos intact. It does not place settlements.

## Reference geography

The World input menu adds two **geographic inputs**, not geological-style presets:

- **Michigan / Great Lakes:** 700 km square centered at 44.25° N, 85.5° W. Covers Lower Michigan and adjacent Great Lakes/neighboring land. Grand Rapids, Detroit, Lansing and Traverse City are orientation labels.
- **Cascades / Pacific Northwest:** 650 km square centered at 45° N, 121.8° W. Includes Mount Rainier, Mount St. Helens, Mount Hood and Crater Lake, as well as coast and inland terrain. These volcanoes are in the real elevation data; no generated cones are added.

### What is real, and what is still modeled?

**Inputs:** Mapzen/AWS Terrain Tiles elevations and Natural Earth mapped lake outlines/reference rivers. Data is reprojected into a local spherical azimuthal-equidistant square (R=6371.0088 km). Build-time preprocessing samples zoom-7 Terrarium source tiles into 513² compact regional rasters. The runtime samples these onto the existing irregular mesh. Extent/detail and aliasing mean summits, narrow channels and small calderas can be underresolved; this is not survey-grade local terrain.

**Modeled:** derived river routing, climate, land cover, basin leakage, agricultural potential and transport suitability. This release DOES NOT import observed climate normals or soils. It is not a calibrated ecological/historical model. Bright human-potential areas are explanatory model output, not a claim of accurate city prediction. City and volcano labels are annotation only and never enter human-potential scores.

**Reference overlay:** pink dashed lines are cartographic reference rivers from Natural Earth, separate from blue modeled rivers. This is useful for a visual comparison but is not a complete USGS hydrography network or a quantitative river-accuracy test.

### Freshwater and boundaries

Mapped lakes are **prescribed reference water**, not lakes independently discovered by the simulation. Great Lakes surfaces remain above sea level (rounded IGLD85 chart-datum reference values, not today's observed levels). Other lake levels use the Natural Earth elevation attribute where supplied, otherwise an approximate DEM-derived water surface. Elevation inside mapped lakes means surface elevation, not bathymetry. We do not invent a lake bottom and call it measured terrain.

The crop does not include whole upstream Great Lakes watersheds. Known lake nodes therefore act as freshwater boundary sinks. External inflows, Great Lakes connecting channels, outlet controls and full inter-lake water budgets are not reconstructed. Do not mistake this benchmark for an independent prediction of the Great Lakes. The known water constraint is labeled in the UI and exports.

Reference data loading is same-origin from the finished static deployment, not hundreds of requests from a phone. `node scripts/prepare-reference-data.mjs` downloads open data once at build, crops it and writes the packs. Source URL/hash metadata is included. A data failure fails the build; it never falls back to fake/generated Michigan.

## Basin water plausibility

The old Priority-Flood spill surface remains available as **potential capacity**, not automatically rendered water. An annual budget separately accounts for upstream runoff, direct rainfall, evaporation and geology-dependent leakage. These quantities share m³/year units and geometric mesh areas.

The budget can produce:

- a dry/leaky basin,
- a seasonally wet/subgrid basin,
- a retained lake below its spill rim,
- an overflowing lake.

Volcanic land generally gets a higher leakage prior, but not a rule that prohibits crater lakes. These leakage rates are seeded plausibility parameters, NOT measured permeability. A simple level-dependent wetted-area approximation supports partial filling. The model has no groundwater table, detailed seasonal simulation, lava dynamics, calibrated evaporation or measured fracture network.

Critically, dry and non-overflowing basins terminate surface drainage. Inflow lost by leakage/evaporation does not reappear along the former forced spill route. Receivers, contributing areas, surface discharge, river flags, wetness, ecology and Stage 4 all use the resolved state. The original spill topology is kept separately for inspection/export. Inside a basin, a ranked mesh tree resolves pooling and flat drainage; sub-basins below mesh resolution remain approximations.

Known reference lakes are kept as mapped constraints instead of being erased by uncalibrated leakage. Their origin is explicit in the inspector.

## UI and export

- Select **Michigan** or **Cascades** under World input; switching loads the reference and starts at Terrain.
- Step through Terrain → Water → Ecology → Human or use Watch build.
- **Basin water: wet / seasonal / dry** coloring exposes the new states. Tap a potential basin to inspect its status, actual level, spill threshold, annual supply, losses and overflow.
- Reference rivers/place labels toggle independently of modeled river/navigation/opportunity overlays.
- **1× True scale** still changes rendering only; it does not regenerate or change real elevations, runoff or basin states.
- Region/source and settings are in shared URLs. Exports are `regional-world-v5` and include reference provenance, water-budget states and preserved potential spill levels.

## Sources and license attribution

- Mapzen / AWS Terrain Tiles: https://registry.opendata.aws/terrain-tiles/
- Provider attribution: https://github.com/tilezen/joerd/blob/master/docs/attribution.md
- US 3DEP, GMTED2010 and SRTM: courtesy of USGS; ETOPO1: NOAA. Canadian terrain contains information licensed under the Open Government Licence – Canada: https://open.canada.ca/en/open-government-licence-canada
- Natural Earth v5.1.2 lakes and river vectors (public domain): https://www.naturalearthdata.com/downloads/10m-physical-vectors/10m-lakes/ and https://www.naturalearthdata.com/about/terms-of-use/
- USGS volcano reference positions: https://www.usgs.gov/volcanoes/mount-rainier/ ; https://www.usgs.gov/volcanoes/mount-st.-helens ; https://www.usgs.gov/volcanoes/mount-hood/ ; https://www.usgs.gov/volcanoes/crater-lake
- Water-budget motivation: USGS, *Water balance for Crater Lake, Oregon*: https://pubs.usgs.gov/publication/ofr92505 ; *Hydrology of Crater, East and Davis Lakes, Oregon*: https://pubs.usgs.gov/publication/wsp1859E . These support considering precipitation/evaporation/seepage, not this prototype's numerical parameter choices.

## Build and tests

`node scripts/build-watershed.mjs` parses every world module, runs the 17 focused unit checks, prepares real data, and runs six integration checks on generated worlds and both real packs. Only then does it copy the existing static demos/assets into `public/` for deployment. No account settings or production domains are changed.

The tests cover dry/retained/overflowing budgets, mass balance, source topology preservation, actual flow termination, projection/PNG decoding, real source hashes, Michigan freshwater levels, real elevation near Rainier, nonnegative discharge and all four stages. `assets/world-lab/build-validation.json` records a completed build's model/data checks. This is not a substitute for device WebGL visual review.
