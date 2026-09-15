# Watershed / Regional World Lab — Codex Handoff

## Start here

Repository: `nigh3252-prog/Playground`

Current branch: `codex/parent-settlement-history` (branched directly from PR #26)

Current PR: **#29 — Parent settlement history and regional landforms**

PR URL: https://github.com/nigh3252-prog/Playground/pull/29

This work is intentionally separate from City Lab / PR #20. Do not collapse or replace PR #20.

Ryan approved parent-level inhabitants and generations of history on September 14. The first version adds settlement growth, migration, finite food sharing, route disputes, abandonment/reoccupation, cultivation and woodland recovery. He then approved improving overly straight parent coastlines and lakes after a comparison with real 1,200 km maps. The September 15 update corrects infinite fault deformation, adds drowned coastal relief, and separates rifts into basins. Detailed streets, districts and buildings remain future work. The independent real-data benchmark pipeline is unchanged.

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
- `assets/world-lab/regional-landforms.mjs`
- `assets/world-lab/world-pipeline.mjs`
- `assets/world-lab/world-app-v6.mjs`
- `assets/world-lab/world-worker-v6.mjs`

The September 15 geography update changes the generated elevations for existing seeds:

- `tectonic-history.mjs` measures distance to finite fault polylines. Local normals determine polarity, with a continuous cross-track coordinate and separate decay beyond each endpoint. Previously, projection onto the plate-center direction extended troughs/mountains beyond fault endpoints and broadened them at bends. Endpoint continuity has explicit rift and subduction regressions.
- `regional-landforms.mjs` anchors coastal provinces to the actual parent terrain triangles. Submerged shelf and adjacent land receive bedrock ribs and connected valley branches before erosion. Sea level then determines exposed headlands/islands and flooded inlets. Gentler coastal lowlands use lower relief. The process has no child-window input.
- `geology-provinces.mjs` follows the source rift polyline with offset, variable-depth basins, side lobes, and intervening higher ground. A source fault receives one basin chain, even if rifting is drawn repeatedly. Inland glacial and volcanic basins retain their drainage protection.
- Parent mesh resolution and the four-stage geography pipeline are unchanged. Water, ecology, potential and human history use the modified physical terrain. The province plan remains on `world.geology.regionalLandforms` with model identifier `regional-drowned-relief-v1`.

These are bounded procedural landform approximations, not simulated ice sheets, sea-level history, sediment transport, or a reconstruction of Earth's geography. At the default 4,800 km / 257² parent, nominal spacing is 18.75 km; tiny islands and channels remain below the model's resolution. Long simple shores can still occur.

Review evidence: [same-scale parent and window comparisons](review/2026-09-15-regional-landforms/README.md). Fixed seeds 431970387, 1, 42, and 0 show removed radial streaks, new islands and branching embayments, and retained gentler stretches. The first default window becomes simpler when the false faults disappear; the update does not force every window to contain an archipelago.

### 2. Current stages

1. **Terrain / geology**
2. **Water**
3. **Ecology**
4. **Human geography / potential**
5. **Inhabitants** (generated parents only)

The original geography pipeline still returns four stages. The worker caches its Stage 4 result, then runs `simulateHumanHistory()` separately. Human history never changes the geographic input.

Stage 4 currently estimates things such as food productivity, overland friction, water / river transport access, reachable agricultural surplus, navigable reaches, and strategic opportunity points such as confluences, mouths, heads of navigation, passes, ferries / fords, and practical shore locations.

The important conceptual rule is that these are **opportunity signals, not towns**.

### 3. Parent history controls and model

- `regional-world.html` opens a generated parent at Inhabitants by default, with 12 generations of 25 years. Use the slider, previous/next, or play to inspect a date. Date selection only repaints stored snapshots.
- Settlement marker size follows population; abandoned sites are hollow. Land use follows reachable countryside on the physical graph. Routes follow traversable graph edges; disused routes are dashed. Community influence is optional and is not a national border.
- Tap a settlement or use Explore a place for a collapsible history card. Event buttons jump to the recorded date and place. If a generation event is outside the current window, selecting it reveals the parent.
- History options contains a separate seed, 4/8/12/20 generations, layer toggles, New history, and Apply settings. History regeneration reuses solved terrain. `historySeed`, `historyGenerations`, and `generation` are saved in the URL; `mode=history` still means geological families.
- Export includes the complete parent graph, all human-history frames and events, model version, history seed, and viewed generation/window. Export waits for a completed history.
- `human-history.mjs` owns simulation; `history-presentation.mjs` owns date filtering and map overlays; `history-controls.mjs` owns timeline/card state. Tests cover deterministic replay, immutable geography, migration/population/food accounting, finite land cover, reachable routes, abandonment/reuse, no future leaks, and stale reroll controls.

This is an exploratory game model: aggregate populations, five-year internal updates, at most 240 sites, no individual biographies or calibrated historical forecasts. Routes support land travel and navigable river links. Sea travel is not implemented. Woodland recovery approaches the original biome's capacity; farms and woodland cannot occupy more than the available cell area. Trade events report accounted transfers, not forecast route capacity. The model does not schedule a mandatory collapse.

A normal 66,049-node parent history runs in roughly 0.2 seconds in the Node runtime (browser hardware varies). After the geography update, all 159 Node tests pass and the offline deployment build passes. Six complete terrain → water → ecology → potential → history runs cover the four comparison seeds plus 103,041-node dry/high-relief/east-wind and 37,249-node wet/low-relief cases. They preserve finite fields, acyclic flow, catchment accounting, immutable geography, and dry settlement/route nodes. Complete runs took about 0.75–2.95 seconds in this Node runtime.

The initial history Vercel preview was exercised for playback, earlier dates, place selection, seed changes and window continuity; the cloud browser used the 2D fallback. Mobile CSS is included, but this browser exposes no phone viewport or WebGL context, so phone rendering and 3D still need a device check.


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
- Local terrain synthesis and gameplay collision/navigation are still the next layer before a Warden can traverse these regions.

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

**A. Local terrain synthesis for a playable level**
- choose a bounded gameplay tile from a solved parent crop
- synthesize meter-scale relief constrained by parent elevation, drainage, geology, and tectonic ruggedness
- produce stable collision terrain, walkable slopes, and explicit no-go cliffs without changing parent hydrology
- add deterministic spawn/test routes for the Warden mech

**B. Add a new independent holdout region before further aggressive water tuning**
- useful choices would be a humid lake-rich / glaciated region or another arid closed-basin region
- do not fit against it before the first score

**C. Continue tectonic calibration without returning to range painting**
- compare generated elevation / relief / slope distributions with real benchmark ranges
- sample additional seeds across subduction, collision, and rift stories
- keep the generate → screenshot → analogue → causal-tuning loop for every terrain pass

**D. Then return to Stage 4 human geography**
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
