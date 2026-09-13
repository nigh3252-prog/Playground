# Watershed — Regional World Lab, r3

Open `regional-world.html`. This is the independent regional generator in PR #21; it does not replace the 410 m City Lab in PR #20. Its purpose is geographic context for later Warden maps. No settlements, roads, buildings, individual trees or mech gameplay are generated here.

## Scale

Default extent is **1,200 × 1,200 km**; 600 and 2,400 km extents are also available. Standard detail uses 193² irregular mesh sites, about **6.25 km nominal spacing**. This is regional geography, not playable local terrain. Later generators should refine a selected patch while preserving the regional drainage and landform constraints.

## Three preserved stages

1. **Terrain** — broad continental relief plus geological provinces selected automatically from the seed.
2. **Hydrology** — spill-level lakes, off-grid drainage, tributaries, catchments and outlets on the same physical irregular mesh.
3. **Environments** — simplified prevailing wind, moisture, temperature, altitude and drainage proximity classify regional land cover.

**Watch build** replays these actual cached stages for the same seed. It is not a geological-time simulation.

## r3: geology is part of generation, not a selector

The user no longer chooses a world-wide landscape history. A seed automatically chooses several **overlapping geological provinces** and places them on the same broad regional relief. The current family weights favor a mixture of:

- **Glacial troughs** in the northern/eastern mountain belts.
- **Rift basins** crossing part of the interior.
- **Volcanic complexes** preferentially placed on already elevated terrain.
- **Inherited river lowlands** cut across older country.
- **Weathered terrain** as the background where no younger process dominates.

Each seed chooses three to five province families, with one or more individual features in a family. The menu reports the generated mix instead of asking the user to choose one. Keep a seed to reproduce the same geology; choose a new seed for a different mix and placement.

The **Landform history** map coloring remains available as an inspection/debug view. It shows the strongest local process, not mutually exclusive continent-sized zones.

### Volcanic complexes

A volcano is not generated as a lowland circular lake stamp. Candidate centers are chosen from relatively high pre-volcanic terrain. The recipe builds a broad asymmetric edifice, then creates a smaller summit collapse plus an irregular raised rim and a subsidiary cone. If hydrology later fills the collapse, the lake sits **inside a high volcanic massif**, closer to the relationship seen at real caldera systems.

The implementation is still a regional landform recipe, not a magma/eruption simulator. At 6 km sampling, a caldera is necessarily much larger and simpler than many real crater lakes.

### Rift basins

Rifts now follow a **wandering centerline** with seed-driven width variation, roughness and raised shoulders. Ends feather out instead of stopping as a rectangular trench. Hydrology determines whether some portion of that depression becomes a lake; the rift recipe itself does not draw a rectangular water body.

### Glacial troughs

Glacial valleys are curved multi-segment corridors that widen toward lower country. They carve a U-shaped regional trough, include a downstream overdeepened section and can retain a sill near the outlet. This favors long valley lakes when the spill topology supports one, rather than square mountain ponds.

### Old river country and inherited drainage

Broad meandering river valleys produce gentler lowland corridors. A separate limited inherited-drainage cleanup can breach **shallow, untagged** procedural hollows so every random mountain depression does not automatically become a lake. Deliberate glacial/rift/volcanic basins are protected from that cleanup.

This is not a full erosion model. It is an explicit attempt to make the regional terrain imply different landscape histories before city or settlement logic is added.

## Hydrology: real off-grid routing

r2 replaced D8 raster flow with **steepest downhill routing on an irregular Delaunay terrain mesh**. r3 keeps that physical model.

Terrain heights, spill surfaces, receivers, contributing area, catchments, confluences, runoff, wet-distance/ecology, inspection traces and rendering all share the same mesh. River strokes draw the actual receiver links rather than smoothing a hidden 45°/90° model. The optional **Show physical drainage mesh** overlay exposes the routing topology.

Priority-Flood calculates depression spill levels without overwriting the original terrain snapshot. Lower flood rank resolves flat spill surfaces and guarantees acyclic drainage. Geometric triangle-barycentric node areas partition the full region and are accumulated downstream. Open land edges remain possible outlets instead of being sealed by an artificial wall.

This remains a finite-resolution, piecewise-linear model. It is not continuous hydraulics, groundwater, sediment transport or D-infinity.

## Environments

A deliberately small climate heuristic provides a west/east prevailing-wind option, windward uplift, lee drying, an altitude lapse rate and a broad north/south temperature trend. Drainage proximity and slope help classify:

- wetland
- wet / temperate forest
- open woodland
- grassland
- dry steppe / arid scrub
- mountain forest
- alpine tundra
- snow / ice

These are regional land-cover indications, not individual trees and not climate forecasts.

## True mountain scale

The visible **1× / True scale** button switches between real vertical proportions and the last exaggerated view. The menu also provides an exaggeration checkbox and a 2–30× slider.

This changes **rendered height and surface normals only**. It never regenerates terrain or changes rivers, lake spill levels, geology, ecology or the seed. At 1×, a 1,200 km region correctly appears much flatter. River strokes remain symbolically wide for readability.

## Coordinates and export

- X increases east; Z increases south, both in kilometers from the northwest regional corner.
- Terrain / water elevations are meters.
- Contributing and mesh-node areas are km².
- Rainfall and temperature are synthetic estimates; runoff is a coarse mean-flow proxy, not a forecast.
- JSON exports are `regional-world-v3` and include actual mesh coordinates / triangle indices, physical heights, spill surface, receiver IDs, flow bearings, catchments, rivers, climate fields, biome IDs, automatic geology features and local landform tags.
- Mesh node IDs are **not raster pixels**.

## Natural boundaries

Western/southern seas and northern/eastern mountain belts give the region broad ecological/geographic boundaries without a square collision wall. Land at an outer edge can still drain beyond the sampled region. The world is intentionally much larger than an eventual Warden play area.

## Deliberate limitations

- Synthetic heightfield + geological recipes, not plate tectonics, ice dynamics or geological-time erosion.
- All depressions fill to spill height; evaporation-limited terminal lakes are not solved.
- No seasons, ocean circulation, calibrated latitude, floods, sediment, groundwater or dynamic river carving.
- Lake boundaries and narrow valleys are kilometer-scale approximations.
- No navigability, settlement suitability, human history or transport model yet.
- No Warden runtime/collision integration yet.

## References / provenance

- Barnes, Lehman & Mulla (2014), *Priority-Flood: An Optimal Depression-Filling and Watershed-Labeling Algorithm for Digital Elevation Models*, Computers & Geosciences 62, 117–127. [Author paper](https://arxiv.org/abs/1511.04463).
- [Landlab FlowDirectorSteepest](https://landlab.csdms.io/generated/api/landlab.components.flow_director.flow_director_steepest.html) and [grid classes](https://landlab.csdms.io/tutorials/grids/diverse_grid_classes.html): non-raster flow-routing context.
- [NPS glacial geology](https://home.nps.gov/glac/learn/nature/glacial-geology.htm), [USGS Lake Baikal](https://pubs.usgs.gov/fs/baikal/) and [USGS Crater Lake](https://www.usgs.gov/volcanoes/crater-lake): landform references for glacial, rift and caldera relationships; not validation of synthetic output.
- `assets/world-lab/triangulate.mjs` adapts the Delaunator sweep-hull algorithm under its retained ISC license.

## Validation notes

The test suite now checks deterministic automatic geology, removal of the old physical history selector, seed-to-seed geological variation, elevated volcanic rims, non-rectangular rift metadata, curved glacial paths, off-compass river bearings, drainage conservation, spill-level bowls, cycle-free flats, wetness paths, ecology, exports and Standard/Fine meshes.

The hosted phone/WebGL view remains the most important visual check for whether lake and mountain shapes read naturally. Algorithmic tests can catch topology and invariants, but they cannot prove that a generated landscape looks geologically convincing.
