# Watershed / Regional World Lab — Codex Handoff

## Start here

Repository: `nigh3252-prog/Playground`

Current branch: `regional-world-lab`

Current PR: **#21 — Watershed r6: parent worlds + frozen benchmark calibration**

PR URL: https://github.com/nigh3252-prog/Playground/pull/21

This work is intentionally separate from City Lab / PR #20. Do not collapse or replace PR #20.

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

The user recently removed the strict “only deploy when explicitly requested” Vercel restriction, so previews may happen more freely again. However, do not make Vercel depend on live benchmark-source APIs.

When changing geography behavior, prefer this loop:

1. make one understandable model change
2. run focused unit tests
3. run frozen benchmark integration
4. compare the regional metrics
5. inspect generated worlds visually
6. avoid tuning purely to one benchmark region

---

## Suggested Codex starting point

1. Checkout / inspect `regional-world-lab` and PR #21.
2. Read this handoff plus:
   - `docs/frozen-benchmark-architecture.md`
   - `docs/watershed-water-calibration-r6.md`
3. Run the current water + benchmark tests before modifying behavior.
4. Open / serve `regional-world.html` and inspect both generated parent-world crops and the real benchmark regions.
5. Preserve the current causal architecture and frozen-data separation.

### Likely next development priorities

Unless the user redirects the work, the safest progression is:

**A. Visual / browser verification of r6**
- inspect generated parent-world windows
- inspect Michigan / Great Basin / Cascades / Appalachians maps
- check the new Through-drainage state reads sensibly
- confirm no obvious new river / lake artifacts on phone

**B. Add a new independent holdout region before further aggressive water tuning**
- useful choices would be a humid lake-rich / glaciated region or another arid closed-basin region
- do not fit against it before the first score

**C. Terrain calibration next**
- compare generated elevation / relief / slope distributions with the real benchmark ranges
- especially verify generated mountain amplitudes are physically plausible

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