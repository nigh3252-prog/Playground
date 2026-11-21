# Tectonic Terrain Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task, and superpowers:test-driven-development for every behavior change.

**Goal:** Replace decorative parent-world mountain paths with deterministic plate-boundary history that creates mountain belts, rifts, volcanic arcs, basins, and aged terrain from plausible tectonic causes while preserving the downstream watershed simulation.

**Architecture:** Generate a small padded Voronoi plate graph with crust and velocity metadata, derive boundary kinematics from relative motion, accumulate several coarse deformation episodes, then convert those fields into elevation before the existing drainage and climate pipeline runs. Keep secondary geology and erosion as bounded post-processes, and expose the causal fields through a tectonics debug map and inspector.

**Tech Stack:** Browser ES modules, deterministic seeded JavaScript, typed arrays, Node's built-in test runner, existing watershed build and browser preview.

---

## Delivery constraints

- Work from `origin/main` at `62475f336464c0107b4bfeb18eda39e9085c5709`; re-check before integration.
- Preserve `generateParentTerrain()` compatibility: existing terrain fields, `landHistory`, `featureAt`, `features`, and `geology` remain available.
- Add tectonic metadata under `geology.tectonics`; do not add `vercel.json`.
- Frozen real benchmark terrain bypasses fictional tectonics.
- Every stochastic choice derives from the supplied seed.
- Keep computation bounded for the existing 257×257 parent mesh; no live data or build-time downloads.
- Run focused tests while developing, then `node --test`, `node scripts/build-watershed.mjs`, and one browser visual pass at true scale.
- The visual pass must save a screenshot, name a defensible real-world analogue, identify any visibly artificial structure, and tune the cause rather than painting over the output.

## Task 1: Plate topology and kinematics

**Files:**
- Create: `assets/world-lab/tectonic-plates.mjs`
- Create: `tests/tectonic-plates.test.mjs`

**Step 1: Write the failing deterministic topology tests**

Cover these observable contracts:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { planTectonicPlates } from '../assets/world-lab/tectonic-plates.mjs';

test('plate plans are deterministic and cover the padded parent domain', () => {
  const a = planTectonicPlates({ seed: 431970387, sizeKm: 4096 });
  const b = planTectonicPlates({ seed: 431970387, sizeKm: 4096 });
  assert.deepEqual(a, b);
  assert.ok(a.plates.length >= 6 && a.plates.length <= 10);
  assert.ok(a.boundaries.length > 0);
});

test('boundary classes follow relative normal motion', () => {
  const plan = planTectonicPlates({ seed: 431970387, sizeKm: 4096 });
  for (const boundary of plan.boundaries) {
    if (boundary.normalRate > 0.08) assert.match(boundary.kind, /subduction|collision/);
    else if (boundary.normalRate < -0.08) assert.equal(boundary.kind, 'rift');
    else assert.match(boundary.kind, /transform|inactive/);
  }
});

test('the plan contains at least one mountain-forming boundary', () => {
  const plan = planTectonicPlates({ seed: 431970387, sizeKm: 4096 });
  assert.ok(plan.boundaries.some(({ kind }) => kind === 'subduction' || kind === 'collision'));
});
```

Run: `node --test tests/tectonic-plates.test.mjs`

Expected: failure because the module does not exist.

**Step 2: Implement the plate planner**

Export:

```js
export function planTectonicPlates({ seed, sizeKm, padding = 0.22 })
export function plateAt(tectonics, xKm, zKm)
```

The returned serializable structure contains:

```js
{
  seed,
  sizeKm,
  paddingKm,
  plates: [{ id, centerX, centerZ, crust, ageMyr, buoyancy, velocityX, velocityZ }],
  boundaries: [{
    id, plateA, plateB, kind, polarity, normalRate, shearRate,
    points: [{ x, z }]
  }]
}
```

Implementation details:

- Place 6–10 jittered plate seeds over a domain padded on every edge.
- Assign `continental`, `oceanic`, or `mixed` crust, age, buoyancy, and a slow 2D velocity.
- Make the largest neighboring continental/oceanic pair the dominant convergent system by adjusting their velocities toward their shared normal; this is initial-condition design, while final classification still comes only from measured relative motion.
- Sample a coarse grid, assign each sample to its nearest distorted plate seed, and trace adjacency into ordered boundary polylines.
- Compute the local normal, relative normal rate, and tangent shear rate from the two plate velocities.
- Classify positive convergence as `subduction` for oceanic–continental/oceanic pairs or `collision` for continental pairs; negative convergence as `rift`; near-zero normal motion with material shear as `transform`; otherwise `inactive`.
- Set subduction polarity toward the overriding plate, preferring continental and then younger/more buoyant crust.

Run: `node --test tests/tectonic-plates.test.mjs`

Expected: pass.

**Step 3: Commit**

```bash
git add assets/world-lab/tectonic-plates.mjs tests/tectonic-plates.test.mjs
git commit -m "Add deterministic tectonic plate model"
```

## Task 2: Coarse tectonic history and deformation fields

**Files:**
- Create: `assets/world-lab/tectonic-history.mjs`
- Create: `tests/tectonic-history.test.mjs`

**Step 1: Write the failing response tests**

Test a handcrafted straight boundary so the sign and asymmetry are unambiguous:

```js
test('ocean-continent convergence raises an overriding mountain belt and volcanic arc', () => {
  const history = buildTectonicHistory(handcraftedSubductionPlan(), {
    width: 81, height: 41, sizeKm: 800
  });
  const trench = sampleField(history.subsidence, 0.43, 0.5);
  const mountains = sampleField(history.uplift, 0.57, 0.5);
  const arc = sampleField(history.volcanism, 0.63, 0.5);
  assert.ok(trench > 0.2);
  assert.ok(mountains > 0.35);
  assert.ok(arc > 0.2);
});

test('continental collision is broad and lacks a dominant volcanic arc', () => {
  const history = buildTectonicHistory(handcraftedCollisionPlan(), meshOptions);
  assert.ok(max(history.uplift) > 0.4);
  assert.ok(max(history.volcanism) < 0.12);
});

test('rifting produces a subsiding axial valley with uplifted shoulders', () => {
  const history = buildTectonicHistory(handcraftedRiftPlan(), meshOptions);
  assert.ok(sampleField(history.subsidence, 0.5, 0.5) > 0.25);
  assert.ok(sampleField(history.uplift, 0.62, 0.5) > 0.1);
});
```

Run: `node --test tests/tectonic-history.test.mjs`

Expected: failure because the history module does not exist.

**Step 2: Implement boundary-distance deformation**

Export:

```js
export function buildTectonicHistory(tectonics, { width, height, sizeKm, eras = 3 })
```

Return typed arrays for `plateId`, `crust`, `tectonicAge`, `uplift`, `subsidence`, `volcanism`, `shear`, and `boundaryDistance`, plus a compact `episodes` array for inspection.

- Build a spatial bin index for boundary line segments so each mesh sample checks nearby segments rather than every segment.
- Accumulate 2–4 seeded episodes from oldest to youngest, with bounded drift in rates and boundary activity.
- Apply asymmetric kernels by class:
  - subduction: narrow trench on downgoing side, broad forearc/arc uplift on overriding side, volcanic arc farther inland;
  - collision: broad paired uplift and central high plateau with no strong volcanic arc;
  - rift: narrow axial subsidence with gentler shoulders;
  - transform: narrow shear corridor and restrained local relief;
  - inactive: no new deformation, only retained age.
- Store the age of the most recent material deformation at every sample.

Run: `node --test tests/tectonic-history.test.mjs`

Expected: pass.

**Step 3: Commit**

```bash
git add assets/world-lab/tectonic-history.mjs tests/tectonic-history.test.mjs
git commit -m "Model tectonic deformation history"
```

## Task 3: Replace range painting in parent terrain

**Files:**
- Create: `assets/world-lab/tectonic-terrain.mjs`
- Modify: `assets/world-lab/parent-world.mjs`
- Modify: `tests/regional-benchmark-integration.test.mjs`

**Step 1: Add failing parent-world acceptance tests**

Add assertions that generated fictional parents:

```js
assert.ok(parent.geology.tectonics);
assert.ok(parent.geology.tectonics.plates.length >= 6);
assert.ok(parent.geology.tectonics.boundaries.some(({ kind }) =>
  kind === 'subduction' || kind === 'collision'));
assert.equal(parent.geology.ranges, undefined);
assert.ok(parent.elevation.some((value) => value > 1500));
```

Also retain the existing deterministic crop, hydrology, edge-diversity, and benchmark-bypass assertions.

Run: `node --test tests/regional-benchmark-integration.test.mjs`

Expected: fail because fictional parents still expose painted `ranges` and no tectonic plan.

**Step 2: Implement tectonic base terrain synthesis**

Export from `tectonic-terrain.mjs`:

```js
export function synthesizeTectonicTerrain({ seed, mesh, tectonics, history })
```

Return `{ elevation, continentality, ruggedness }` typed arrays.

- Replace ellipsoidal `lands` and Gaussian `ranges` as the primary elevation source.
- Use plate crust/buoyancy and low-frequency deterministic noise for continental shelves and ocean basins.
- Add deformation response from `uplift - subsidence`, with elevation amplitude scaled by boundary rate and tectonic age.
- Use multi-frequency, directionally biased roughness inside uplift zones so mountain chains branch and vary in width rather than reading as uniform tubes.
- Keep relief continuous across parent edges by evaluating on the padded coordinate domain.
- Preserve the existing ocean flooding, climate, and regional drainage conditioning order.
- Keep legacy range helpers private only long enough to compare outputs during development, then remove them before commit.

**Step 3: Integrate with `generateParentTerrain()`**

The fictional path becomes:

```js
const tectonics = planTectonicPlates({ seed: parentSeed, sizeKm });
const history = buildTectonicHistory(tectonics, mesh);
const base = synthesizeTectonicTerrain({ seed: parentSeed, mesh, tectonics, history });
```

Expose compact serializable plates, boundaries, episodes, and mesh fields under `geology.tectonics`. Continue to populate `landHistory`, `featureAt`, and `features` for downstream consumers.

Run:

```bash
node --test tests/tectonic-plates.test.mjs tests/tectonic-history.test.mjs tests/regional-benchmark-integration.test.mjs
```

Expected: pass.

**Step 4: Commit**

```bash
git add assets/world-lab/tectonic-terrain.mjs assets/world-lab/parent-world.mjs tests/regional-benchmark-integration.test.mjs
git commit -m "Generate parent relief from plate tectonics"
```

## Task 4: Age, erosion, sediment, and secondary provinces

**Files:**
- Create: `assets/world-lab/terrain-erosion.mjs`
- Modify: `assets/world-lab/geology-provinces.mjs`
- Modify: `assets/world-lab/parent-world.mjs`
- Create: `tests/terrain-erosion.test.mjs`

**Step 1: Write failing conservation and age tests**

```js
test('erosion lowers young steep relief and deposits sediment downslope', () => {
  const result = erodeTerrain(fixtureTerrain(), fixtureHistory(), { passes: 4 });
  assert.ok(result.elevation[peakIndex] < fixture.elevation[peakIndex]);
  assert.ok(result.sediment[basinIndex] > 0);
});

test('old inactive mountains become rounder than equally high young mountains', () => {
  const result = erodeTerrain(twinRidges(), twinAges(), { passes: 5 });
  assert.ok(localRoughness(result.elevation, oldRidge) < localRoughness(result.elevation, youngRidge));
});

test('erosion remains bounded and finite', () => {
  const result = erodeTerrain(fixtureTerrain(), fixtureHistory(), { passes: 5 });
  assert.ok(result.elevation.every(Number.isFinite));
  assert.ok(result.sediment.every((value) => Number.isFinite(value) && value >= 0));
});
```

Run: `node --test tests/terrain-erosion.test.mjs`

Expected: failure because the erosion module does not exist.

**Step 2: Implement bounded geomorphic aging**

Export:

```js
export function erodeTerrain({ elevation, width, height }, tectonicAge, options = {})
```

- Use 3–6 bounded passes of steepest-neighbor transport.
- Scale incision and diffusion with slope, water exposure proxy, rock age, and uplift recency.
- Track transported material in a non-negative `sediment` typed array.
- Deposit material where local slope and carrying capacity fall.
- Clamp per-pass elevation change and preserve finite outputs.

**Step 3: Make secondary geology depend on tectonic context**

- Place volcanic provinces preferentially along the volcanic-arc field.
- Place rift valleys along rift boundaries rather than unrelated paths.
- Retain glacial modification only at suitable elevation/latitude proxy.
- Retain old-valley incision as an erosional overprint in older terrain.
- Keep `features`, `featureAt`, and `landHistory` compatible.

Run:

```bash
node --test tests/terrain-erosion.test.mjs tests/regional-benchmark-integration.test.mjs tests/regional-world.test.mjs
```

Expected: pass.

**Step 4: Commit**

```bash
git add assets/world-lab/terrain-erosion.mjs assets/world-lab/geology-provinces.mjs assets/world-lab/parent-world.mjs tests/terrain-erosion.test.mjs
git commit -m "Age and erode tectonic terrain"
```

## Task 5: Tectonic debug map and inspector

**Files:**
- Modify: `regional-world.html`
- Modify: `assets/world-lab/world-app-v6.mjs`
- Modify: `tests/regional-benchmark-integration.test.mjs`

**Step 1: Add a failing UI contract test**

Assert the HTML and module expose a `tectonics` map mode and causal inspector labels:

```js
assert.match(html, /value="tectonics"/);
assert.match(appSource, /Boundary class/);
assert.match(appSource, /Relative motion/);
assert.match(appSource, /Tectonic age/);
```

Run: `node --test tests/regional-benchmark-integration.test.mjs`

Expected: fail before UI implementation.

**Step 2: Render causal metadata**

- Add a `Tectonics` map option.
- Color plate ownership by stable plate ID and differentiate crust with value/saturation.
- Overlay boundary polylines by class and subduction polarity ticks.
- Draw plate velocity arrows at plate centers.
- On hover/click, show plate/crust, boundary class, relative normal/shear motion, uplift, subsidence, volcanism, and tectonic age for the selected location.
- Gracefully state that tectonic metadata is unavailable for real benchmark worlds.

Run: `node --test tests/regional-benchmark-integration.test.mjs`

Expected: pass.

**Step 3: Commit**

```bash
git add regional-world.html assets/world-lab/world-app-v6.mjs tests/regional-benchmark-integration.test.mjs
git commit -m "Expose tectonic history in world debug view"
```

## Task 6: Verification, visual calibration, and handoff

**Files:**
- Modify if behavior changed materially: `docs/codex-watershed-handoff.md`
- Create screenshot evidence outside the repository in the task visualization directory.

**Step 1: Run focused and full automated checks**

```bash
node --test tests/tectonic-plates.test.mjs tests/tectonic-history.test.mjs tests/terrain-erosion.test.mjs tests/regional-benchmark-integration.test.mjs tests/regional-world.test.mjs
node --test
node scripts/build-watershed.mjs
git diff --check
```

Expected: all pass; build completes without network access.

**Step 2: Run the required visual loop**

- Serve the repository locally.
- Open `regional-world.html` with seed `431970387` and true-scale mode.
- Capture the natural map, tectonics debug map, terrain layer, and true-scale 3D world.
- Inspect continuity, coast placement, boundary/relief causality, mountain width/branching/endings, rain-shadow response, drainage direction, and crop-edge diversity.
- Compare the generated setting with one explicit analogue chosen from visible structure, such as the Andes–Patagonia subduction margin, Himalaya–Tibet collision, East African Rift, or Basin and Range extension.
- If the image shows a causal defect, adjust plate initial conditions or deformation/erosion parameters, rerun the focused tests, regenerate, and capture the tuned result.

**Step 3: Update durable handoff state**

Document:

- tectonic modules and stable public interfaces;
- visual seed and screenshot paths;
- the analogue used and the resulting assessment;
- executed tests/build results;
- known limitations and the next simulation step.

Run: `git diff --check`

**Step 4: Final commit and branch review**

```bash
git add docs/codex-watershed-handoff.md
git commit -m "Document tectonic terrain handoff"
git status --short
git log --oneline origin/main..HEAD
git diff --stat origin/main...HEAD
```

Review every changed file against the approved design, confirm no `vercel.json` exists, and report the branch and evidence. Do not merge or push without explicit user direction.
