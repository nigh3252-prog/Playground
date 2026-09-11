# Regional World Lab — Watershed

Open `regional-world.html`. This is a **second, independent generator**, not a replacement for the 410 m City Lab. Its purpose is continental/regional context for future Warden environments. No settlements, roads, parcels, errands, or mech model are generated here.

## Scope and units

Default extent is **1,200 × 1,200 km** (1,440,000 km²). The menu also offers 600 km and 2,400 km extents. This is a fictional geographic region, not a reconstruction of England or the Mississippi basin.

The default 193 × 193 grid samples every **6.25 km**. Quick uses 129 samples; Fine uses 241. This data cannot resolve streets, individual trees, banks, or local terrain under a mech. Later local generators must refine selected patches while preserving the large-scale drainage constraints.

X points east, Z points south, both in kilometers. Elevation and spill levels are meters. Contributing area is km². Temperature and rainfall are synthetic model estimates displayed in °C and mm/year. `runoff` is a coarse mean-flow proxy, not a forecast. The renderer uses horizontal kilometers and converts elevation from meters; its **18× default vertical exaggeration is visual only**. Set it to 1× for true-scale relief. River strokes are also widened for legibility, not claimed as real channel widths.

## Three preserved stages

1. **Terrain:** seeded, warped noise combined with continental lowlands, an interior highland belt, northern/eastern mountain ranges, and irregular western/southern coasts. Ocean is identified by edge-connected below-sea-level cells. The ranges/coasts provide natural regional boundaries, rather than a uniform raised wall. Open land boundaries can still drain out of the region.
2. **Hydrology:** a Priority-Flood pass calculates depression spill levels without overwriting the original heightfield. D8 steepest descent chooses receivers on that surface. Flood rank resolves flat areas with strictly decreasing rank, so flow cannot cycle. Contributing area accumulates downstream. River segments, confluences, coastal outlets, edge outlets, catchments and spill-level lake components are then derived. Lake water replaces the depressed surface in the stage-2 visualization, not in the original terrain array.
3. **Environments:** a small prevailing-wind/moisture model gives wetter windward land and drier lee/interior land. Temperature varies with a north-to-south gradient and altitude. Land-cover rules combine these with drainage proximity and slope. Colors distinguish ocean, lake, wetland, wet forest, temperate forest, woodland, grassland, steppe, arid scrub, mountain forest, alpine tundra and snow/ice. These are regional land-cover indications, not individual vegetation assets.

Stage buttons restore actual earlier-stage data. **Watch build** replays the cached stages for the same seed, with a pause between each; it is not a geological-time simulation. Generation normally runs in a module worker, with a main-thread yielding fallback where workers cannot load.

## Controls

- Drag to orbit; wheel/pinch to zoom. Right-drag or Shift-drag pans; two-finger drag pans on touch. Map view uses overhead panning.
- Tap terrain to inspect conditions. From stage 2 onward, the selected catchment is highlighted and a gold line traces drainage toward the sea or a regional edge.
- Use Watersheds, Rainfall estimate or Elevation coloring to inspect why regions differ. A coloring requiring a later stage falls back to the current stage's natural view until that data exists.
- Generation settings apply on **Generate**. **New seed** generates immediately. Visual exaggeration is immediate and never affects drainage.
- Seed, resolution, scale, relief, moisture and wind are retained in the URL. Same version + same parameters + same grid = same result. Changing the grid changes the drainage discretization; it is not merely a display-quality setting.
- Export regional data saves a JSON with units, configuration, heightfield, spill surface, water masks, downstream receivers, basin IDs, contributing area, climate fields, biomes and outlet metadata for later generators.

No CDN, API token, package installation, external textures or external renderer is required. The viewer uses a small local WebGL renderer; a shaded 2D map remains available if WebGL cannot initialize. Serve the repository as static files for module loading, e.g. `python -m http.server 8000`.

## Deliberate limitations

Terrain is a synthetic heightfield, not plate tectonics or erosion. Mountain belts/coastal orientation are a designed macro-layout with seeded variation. Hydrology is drainage connectivity and spill filling, not time-varying water volume, sediment transport, groundwater or a flood model. All depressions are filled to their outlet levels, including dry-climate basins: the model does not yet solve evaporation-limited closed lakes. D8 drainage retains grid-scale angularity; river lines are an atlas abstraction. Coastlines and lake boundaries have kilometer-scale discretization.

Climate is heuristic, not a circulation model: no seasons, calibrated latitude, winds around a globe, or ocean currents. Extent settings do not add a globe projection. Wetland classification is a regional proxy, not a scientific wetland delineation. No suitability for settlement or navigability is inferred yet. No connection to Warden runtime/collisions is implemented.

## Algorithm references

- Barnes, Lehman & Mulla (2014), *Priority-Flood: An Optimal Depression-Filling and Watershed-Labeling Algorithm for Digital Elevation Models*, Computers & Geosciences 62, 117–127. [Author paper](https://arxiv.org/abs/1511.04463), DOI 10.1016/j.cageo.2013.04.024. This project's implementation is original JavaScript based on the method, not copied source code.
- [Landlab LakeMapperBarnes documentation](https://landlab.readthedocs.io/en/latest/generated/api/landlab.components.lake_fill.lake_fill_barnes.html): depression filling, D8 connectivity and treatment of flat water surfaces.

## Validation

Run `node --test tests/regional-world.test.mjs` using Node 22 or newer. **14/14 tests passed** during implementation: determinism, bounds, preserved stages, ocean connectivity, monotonic/cycle-free drainage, end-to-end traces, known spill-level bowl, flat terrain, confluences, ecology and wind response, area conservation, runoff accumulation, 14 varied seed/parameter cases, and Standard/Fine grids. All four JavaScript modules passed syntax checks.

Browser checks used the same authored code bundled in memory at **1440 × 980** and **393 × 852**. Stage switching, watch/replay/pause, inspector, catchment coloring, mobile menu, seed/moisture/resolution changes, regeneration and viewport fit passed with no page errors. This execution environment blocks URL navigation (`ERR_BLOCKED_BY_ADMINISTRATOR`) and returns no WebGL context, so those browser checks exercised the **2D + worker-fallback path**. They are not a claim of hosted module-worker or phone WebGL visual validation. The hosted preview is the remaining 3D device check.
