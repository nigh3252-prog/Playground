# Watershed / Regional World Lab — Codex Handoff

## Start here

Repository: `nigh3252-prog/Playground`

Current implementation branch: `codex/local-terrain-foundation`

Parent dependency: **#26 — tectonic parent terrain and controls**

Parent PR URL: https://github.com/nigh3252-prog/Playground/pull/26

The local-terrain PR is intentionally stacked on PR #26 until the parent-world work lands. City Lab / PR #20 remains a separate earlier layer; do not replace its layout work with the local-terrain viewer.

The immediate goal is **not** to build settlements yet. The goal is to make the large-scale geography believable enough that later settlements, roads, districts, and Warden gameplay spaces inherit plausible causes instead of feeling random.

---

## Core design philosophy

The project is trying to generate believable geography through a causal chain:

**parent landmass / geology → terrain history → hydrology → climate / ecology → human productivity + transport economics → settlement opportunity → later towns / cities → later local playable areas**

The user prefers correcting the underlying model rather than hiding problems with visual smoothing or hand-authored exceptions.

The long-term idea is that a future ~400 m playable Warden map should sit inside a district, which sits inside a city, which sits inside a regional settlement network, which itself emerged from believable terrain, water, food, and transport geography.

---

## What exists now

### 1. Parent-world generation

Generated worlds are no longer forced into the old pattern of ocean on some rectangle edges and mountain belts on the others.

The current architecture generates a much larger **seeded parent landmass** first, roughly 3,000–6,000 km across. Terrain, drainage, water, ecology, and human geography are solved on that parent domain. A smaller ~1,200 km viewing window is selected afterward.

Important consequence: **the visible crop is only a view**. Rivers and basins are not rerouted at the crop boundary. A chosen window can be inland, coastal, flat, mountainous, lake-heavy, dry, etc.

Key files include:

- `assets/world-lab/parent-world.mjs`
- `assets/world-lab/world-core.mjs`
- `assets/world-lab/world-mesh.mjs`
- `assets/world-lab/geology-provinces.mjs`
- `assets/world-lab/world-pipeline.mjs`
- `assets/world-lab/world-app-v6.mjs`
- `assets/world-lab/world-worker-v6.mjs`

### 2. Current four-stage pipeline

1. **Terrain / geology**
2. **Water**
3. **Ecology**
4. **Human geography / potential**

There are still **no generated settlements**.

Stage 4 currently estimates things such as food productivity, overland friction, water / river transport access, reachable agricultural surplus, navigable reaches, and strategic opportunity points such as confluences, mouths, heads of navigation, passes, ferries / fords, and practical shore locations.

The important conceptual rule is that these are **opportunity signals, not towns**.

---

## Hydrology architecture

The project moved away from compass-locked D8 raster routing. Drainage now follows steepest-downhill relationships over an irregular Delaunay terrain mesh, allowing arbitrary river bearings and more natural confluences.

A major later correction was separating:

- **potential depression / spill capacity**
- **actual standing water**

Priority-Flood-like filling is now diagnostic capacity, not an instruction that every closed depression must become a lake.

Actual basin water depends on annual-budget plausibility using:

- precipitation / runoff
- evaporation
- geology-dependent leakage
- basin geometry
- inflow / through-flow

Possible outcomes include:

- dry / leaky basin
- seasonally wet basin
- retained permanent lake
- overflowing lake
- through-drainage where a coarse DEM likely missed a narrower outlet corridor

Key files:

- `assets/world-lab/drainage-conditioning.mjs`
- `assets/world-lab/water-balance.mjs`

The UI label for the coarse-resolution inferred outlet case is **“Through-drainage (coarse outlet)”**. Do not describe it as proof that literal erosion occurred; it is an inference that the regional mesh probably failed to resolve an outlet valley.

Intentional generated geology / landform history still matters. Generated glacial, rift, and volcanic basin features should not be casually erased by the generic drainage-conditioning logic.

---

## Real-world benchmark system

The real-world mode is primarily a **development calibration harness**, not a goal to reproduce the live Earth.

Frozen benchmark regions currently committed in the repo:

- Michigan / Great Lakes
- Great Basin / Nevada–Utah
- Cascades / Pacific Northwest
- Central Appalachians

Frozen processed inputs / observations live under:

`assets/world-lab/benchmarks/`

The benchmark architecture deliberately separates **prediction inputs** from **held-out observations**.

Prediction uses real regional elevation plus frozen climate normals. Observed inland water, reference river geometry, modern population, and historical population samples are withheld until after the model has produced Water → Ecology → Human output, then used only for scoring.

Normal builds use the committed frozen benchmark files. **Do not reintroduce live USGS / NOAA / Census / Natural Earth downloads into ordinary Vercel builds.** Source refresh should remain an explicit development action.

Relevant files:

- `assets/world-lab/benchmark-protocol.mjs`
- `assets/world-lab/benchmark-pipeline.mjs`
- `assets/world-lab/benchmark-evaluate.mjs`
- `scripts/verify-frozen-benchmarks.mjs`
- `scripts/run-benchmark-baselines.mjs`
- `.github/workflows/freeze-watershed-benchmarks.yml`
- `.github/workflows/calibrate-watershed-water.yml`
- `docs/frozen-benchmark-architecture.md`
- `docs/watershed-water-calibration-r6.md`

---

## What the calibration taught us

The original frozen Michigan baseline exposed a major problem: the model was **far too eager to make large permanent lakes**.

At the >=25 km² scored scale, the old Michigan result was approximately:

- predicted: **19,074 km²**
- observed: **1,914 km²**
- bias: roughly **+897%**

After drainage conditioning, water-budget corrections, climate-sensitive evaporation, and through-drainage inference, the current fixed-profile results are approximately:

| Region | Predicted lake area | Observed | Bias |
| --- | ---: | ---: | ---: |
| Michigan | 2,500.1 km² | 1,914.0 | +30.6% |
| Great Basin | 5,986.9 km² | 4,547.7 | +31.6% |
| Cascades | 1,247.4 km² | 1,004.3 | +24.2% |
| Appalachians | 211.1 km² | 358.2 | -41.1% |

This is considered **reasonable enough to keep building on**, but not scientifically validated or permanently locked.

The most recent targeted calibration run passed:

- **34 / 34** focused water + benchmark tests
- **13 / 13** parent-world / frozen-reference integration tests

Do not interpret those passing tests as proof that exact lake placement is correct. They establish consistency and guardrails, not geographic perfection.

### Important validation caveat

Michigan and Great Basin were the intended calibration pair. Cascades and Appalachians were originally held back, but we later inspected them while correcting terrain-regime behavior. Therefore they are now **secondary checks**, not pristine independent validation regions.

Before claiming general validation, add at least one new independent holdout region and do not tune against it first.

---

## Known limitations / what is still imperfect

The water model is now useful at **coarse regional plausibility**, but exact water placement remains weak.

Known issues:

- large-lake area statistics are much better than exact lake shape/location agreement
- small lakes below the 25 km² scored scale are not yet a strong calibration target
- narrow valleys / outlets can still be below mesh resolution
- groundwater / aquifer behavior is simplified
- permeability is still heuristic rather than real lithology
- no bathymetry model
- climate forcing in benchmark mode is much simpler than a full gridded climate model
- the Appalachians are still somewhat too dry at the scored large-lake scale

Do **not** keep tuning the existing four benchmarks until every error is near zero. That would risk overfitting.

---

## Human-geography model

Stage 4 is deliberately pre-settlement.

The current model combines:

- biome / temperature / rainfall / slope / elevation
- food-surplus potential
- overland travel friction
- generalized bulk-transport cost
- navigable river / practical shore access
- reachable productive hinterland
- strategic geography such as mouths, confluences, heads of navigation, passes, crossings, and ports

Water transport is intentionally much cheaper than land transport, inspired by preindustrial freight economics / wagon limitations rather than modern trucking.

Population data exists in the benchmark harness, but modern population is only a weak sanity check for this preindustrial model. Historical settlement/population comparisons are more conceptually valuable when available.

---

## Terrain / mountain scale

A prior visual concern was that generated mountains appeared much larger than the Pacific Northwest reference. Be careful to distinguish **physical elevation** from **rendering exaggeration**.

The UI supports 1× True Scale and exaggerated visual relief. The exaggeration must remain rendering-only and must never alter hydrology or benchmark metrics.

Future terrain calibration should compare distributions rather than screenshots alone:

- sampled peak elevation
- relief distribution
- slope distribution
- drainage density
- lake fraction / size distribution

### Tectonic parent terrain (September 13, 2026)

Generated parent worlds no longer paint mountains from arbitrary range polylines. The fictional terrain path now begins with a padded plate graph and derives relief from relative plate motion:

- `assets/world-lab/tectonic-plates.mjs` creates deterministic plate ownership, crust, age, velocity, continental crust blocks, and shared boundaries.
- `assets/world-lab/tectonic-history.mjs` classifies subduction, continental collision, rifting, transform motion, and inactive boundaries from normal/shear velocity, then accumulates uplift, subsidence, volcanism, shear, and deformation age.
- `assets/world-lab/tectonic-terrain.mjs` converts crustal buoyancy plus those deformation fields into parent elevation.
- `assets/world-lab/terrain-erosion.mjs` rounds old relief and moves a bounded amount of sediment downslope before regional drainage conditioning.
- `assets/world-lab/geology-provinces.mjs` anchors generated rift provinces to actual extensional boundaries and weights volcanic provinces toward the volcanic-arc field.

`generateParentTerrain()` keeps its downstream contract and exposes the causal model under `world.geology.tectonics`. Real frozen benchmark terrain still bypasses fictional plate generation.

The browser has a **Tectonic plates and boundaries** map. It shows plate/crust coloring, boundary classes, velocity arrows, and causal inspector fields for relative motion, uplift, subsidence, volcanism, and tectonic age.

Plate ownership and its traced margins are warped at continental and regional wavelengths before deformation is calculated. Boundary samples are reconstructed into deterministic curved centerlines, so collision, subduction, rift, and transform responses follow the same irregular geometry shown in the diagnostic map rather than axis-aligned grid steps or straight Voronoi chords.

Generated parents also expose two reproducible tuning inputs: **Continental blocks** (`1`–`4`) and **Crust footprint** (`0.75×`–`1.45×`). They alter the seeded initial continental crust before tectonic relief, erosion, drainage, ecology, or human geography runs; they do not move sea level after generation. The defaults are `3` blocks and `1.15×`. A 40-seed quick-mesh calibration with the curved margins produced about `35%` mean parent land with a roughly `30%`–`41%` middle-68% range. The browser reports measured land/water coverage for the current view, and the URL/export retain both inputs for exact replay.

Visual calibration used seed `431970387`, parent `4,800 km`, crop `2`, and true physical height (`1×`). The final crop sampled a `2,927 m` peak with `1,961 m` middle-90% relief at the browser's `18.75 km` parent spacing. It reads most closely as a coarse central/southern Andes–Altiplano or Patagonian-transition story: a broken convergent-margin cordillera, drier interior highland, enclosed lakes, and outward drainage. This is an analogue, not a reconstruction.

The visual loop caught and corrected three artifacts:

1. Whole-plate crust produced polygonal coastlines, so irregular continental blocks now ride on plates and allow passive margins away from plate boundaries.
2. Legacy rifts cut unrelated parallel troughs, so rift provinces now inherit real extensional boundaries.
3. Constant boundary response produced a white mountain ribbon, so convergence strength, belt width, and local offset now vary along strike before erosion.

Remaining limitations:

- The model uses several coarse geologic episodes, not continuous plate advection or spherical tectonics.
- Plate boundaries remain macro-scale; the debug map is intentionally schematic.
- The 18.75 km parent sampling cannot produce mech-scale cliffs, passes, talus, or walkable ground.
- Continental blocks are geologically motivated initial conditions, but they are not yet assembled through a long supercontinent cycle.
- Local terrain now has a physical foundation, but gameplay collision/navigation, settlements, roads, and Warden integration remain later layers.

### Local terrain foundation (September 13, 2026)

`local-terrain.html` is the deterministic bridge from a solved parent world to a future playable district. It generates a physical **1,200 m × 1,200 m** tile with a **257 × 257** height grid at **4.6875 m** spacing. A centered **410 m × 410 m** rectangle is shown as the near-term gameplay-composition focus; it is metadata and an overlay, not a second terrain solution.

The generator works on a **1,800 m**, **385 × 385** padded domain before cropping the central tile. This prevents the delivered edge from acting as the first drainage boundary. It preserves the parent anchor's absolute elevation and broad gradient, adds deterministic world-coordinate detail conditioned by parent ruggedness/uplift/age, runs priority-flood drainage conditioning, applies a bounded flow-driven incision of at most **2.5 m**, and reroutes once over the resulting physical surface.

Key files:

- `assets/local-terrain/local-site.mjs` — reproducible ranked terrestrial site selection inside a parent window.
- `assets/local-terrain/local-drainage.mjs` — padded grid routing, contributing area, and boundary outlet resolution.
- `assets/local-terrain/local-terrain.mjs` — physical synthesis, derived masks, provenance, metrics, and JSON serialization.
- `assets/local-terrain/local-rendering.mjs` — WebGL-safe diagnostic texture contract.
- `assets/local-terrain/local-terrain-app.mjs` and `local-terrain.html` — thin browser viewer and controls.

The browser accepts `seed`, `continentCount`, `crustScale`, `windowIndex`, `siteIndex`, and `mode` URL parameters. Watershed has a **Local terrain** handoff button that preserves the current generated parent controls and window. The viewer exposes natural, elevation, slope, drainage, surface-water, and terrain-walkability maps, plus measured relief, slope, water, walkability, and significant outlet counts. JSON export retains typed-array values as ordinary arrays with complete provenance.

Visual calibration used this reproducible base URL:

`local-terrain.html?seed=431970387&continentCount=3&crustScale=1.15&windowIndex=0&siteIndex=2&mode=natural`

Three consecutive sites were inspected in 3D and map views. The final site-2 pass measured about **884–922 m elevation**, **37.8 m local relief**, **26.7% P95 grade**, and **24 significant outlets**. It reads as a subdued dissected upland: broad rounded divides with branching shallow valleys. The closest morphology analogue is the lower-relief end of the Appalachian Piedmont/upland family, not a deeply incised mountain gorge. USGS describes the Piedmont upland as a low-relief surface undergoing dissection and Appalachian plateau settings as flat-lying uplands broken by dendritic drainage; this result matches the former more closely at the present 1.2 km scale: https://pubs.usgs.gov/publication/70015399 and https://pubs.usgs.gov/wri/wri99-4269/.

The browser loop caught and corrected three issues before handoff:

1. A 768-pixel non-power-of-two texture became incomplete when the shared WebGL1 viewer generated mipmaps, producing a black surface. Local textures now use a tested 1,024-pixel power-of-two size.
2. Every sheet-flow boundary terminus was labeled an outlet, producing counts near 400–500. The diagnostic now reports only termini draining at least 64 cells.
3. Drainage originally existed only as routing and map color. A bounded physical incision pass now cuts the derived channels into the heightfield and reroutes them.

Current local limitations:

- Site ranking seeks representative usable land, not a final city location.
- Local erosion is deliberately shallow and bounded; it is not a long-timescale sediment model.
- A visible surface-water mask requires parent lake/water evidence at the selected anchor; drainage corridors alone are not mislabeled as permanent rivers.
- Walkability is terrain-only. It does not yet include mech dimensions, roads, structures, or combat navigation.
- No adjacent-tile seam/export contract, settlements, roads, buildings, spawns, or Warden runtime adapter exists yet.

---

## User workflow / collaboration preferences

The user likes:

- frequent playable / visible checkpoints
- checking actual previews while work is in progress
- model fixes instead of visual cheats
- seed-driven causality
- concise UI and thin / collapsible controls
- mobile-friendly review, especially Android
- keeping promising systems flexible rather than prematurely locking them

The user removed the explicit Vercel preview workflow because it was intrusive. Keep `vercel.json` absent unless the user asks for a new deployment configuration. Do not make any deployment depend on live benchmark-source APIs.

When changing geography behavior, prefer this loop:

1. make one understandable model change
2. run focused unit tests
3. run frozen benchmark integration
4. compare the regional metrics
5. inspect generated worlds visually
6. avoid tuning purely to one benchmark region

---

## Suggested Codex starting point

1. Start from main after merged PRs #20 and #21, then inspect the tectonic-terrain branch/commit lineage if it has not yet been integrated.
2. Read this handoff plus:
   - `docs/frozen-benchmark-architecture.md`
   - `docs/watershed-water-calibration-r6.md`
3. Run the current water + benchmark tests before modifying behavior.
4. Open / serve `regional-world.html` and inspect both generated parent-world crops and the real benchmark regions.
5. Preserve the current causal architecture and frozen-data separation.

### Likely next development priorities

Unless the user redirects the work, the safest progression is:

**A. Settlement suitability and regional roads**
- rank local sites using the existing food, water, slope, and transport-opportunity fields
- place towns and connections at the regional scale before detailed city streets
- retain the selected parent/window/site provenance when opening a local tile

**B. City structure on the local terrain**
- replace City Lab's independent `baseHeight` with the exported local heightfield
- generate terrain-aware arterial roads, lots, and buildings inside the 1.2 km district
- keep the centered 410 m area as the first detailed gameplay focus

**C. Warden terrain adapter and first traversal route**
- convert physical meters to Warden's 10-meters-per-simulation-unit contract at the runtime boundary
- build collision and navigation from the same exported heightfield
- add deterministic spawn/test routes and verify the Warden mech against slopes, channels, and no-go terrain

**D. Add a new independent holdout region before further aggressive water tuning**
- useful choices would be a humid lake-rich / glaciated region or another arid closed-basin region
- do not fit against it before the first score

**E. Continue tectonic calibration without returning to range painting**
- compare generated elevation / relief / slope distributions with real benchmark ranges
- sample additional seeds across subduction, collision, and rift stories
- keep the generate → screenshot → analogue → causal-tuning loop for every terrain pass

**F. Continue Stage 4 human-geography calibration while settlement placement begins**
- benchmark the spatial relationship between human-potential output and historical settlement / population where data quality allows
- avoid jumping directly to town generation until the regional opportunity field looks credible

---

## Do not accidentally undo these decisions

- Do not go back to D8 compass-locked river routing.
- Do not treat every Priority-Flood depression as a real lake.
- Do not burn observed benchmark lakes / population into the prediction inputs.
- Do not fetch live government datasets during every Vercel build.
- Do not make crop edges behave like world boundaries.
- Do not make visual relief exaggeration affect physical calculations.
- Do not convert strategic opportunity points directly into towns yet.
- Do not claim Cascades / Appalachians are pristine validation holdouts anymore.
- Do not optimize benchmark numbers at the expense of plausible generated worlds.

---

## Current definition of success

The project does **not** need to reconstruct Earth exactly.

The target is:

> A fictional generated region should have terrain, drainage, lake frequency, water retention, ecology, transport geography, and human opportunity patterns that fall within believable real-world ranges and tell a coherent geographic story.

That is the standard to preserve as development continues.
