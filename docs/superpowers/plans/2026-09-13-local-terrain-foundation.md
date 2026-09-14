# Local Terrain Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate and inspect a deterministic 1.2 km local terrain tile whose elevation, relief, water context, and drainage derive from a solved Watershed parent world.

**Architecture:** A pure site-selection module chooses reproducible land anchors inside an existing 1,200 km regional window. A pure terrain module samples the parent's low-frequency trend, adds parent-conditioned world-space detail on a 1.8 km padded regular grid, routes local drainage, crops the central 1.2 km tile, and emits a versioned physical data contract. A thin browser lab renders that output and exposes reproducible controls and diagnostics without duplicating generator logic.

**Tech Stack:** Browser ES modules, deterministic JavaScript, typed arrays, Three.js through the existing `AtlasView`, Node's built-in test runner, and the repository's offline Watershed build.

**Spec:** `docs/superpowers/specs/2026-09-13-local-terrain-foundation-design.md`

## Global Constraints

- Work on `codex/local-terrain-foundation`, stacked on parent-world PR #26 at `95488ed692851807942b831565198a1c1c959066`; live `main` was `62475f336464c0107b4bfeb18eda39e9085c5709` at implementation start.
- The delivered grid is 257 by 257 over exactly 1,200 m, with 4.6875 m spacing and centered bounds of -600 m to +600 m.
- Synthesis runs on a 385 by 385, 1,800 m padded grid and crops the central 257 by 257 samples.
- The 410 m focus is centered metadata and a browser overlay, not a second terrain grid.
- Parent world arrays are immutable; all local randomness derives from parent provenance and world coordinates.
- No settlements, roads, lots, buildings, Warden integration, or `vercel.json` are added.
- Generator code must not depend on the DOM or renderer.
- Test each behavior through a witnessed red-green cycle.

---

### Task 1: Deterministic parent-site selection

**Files:**
- Create: `assets/local-terrain/local-site.mjs`
- Create: `tests/local-terrain-site.test.mjs`

**Interfaces:**
- Consumes: `indexMesh(mesh)`, `interpolateAt(index, values, xKm, zKm)`, and `nearestNode(index, xKm, zKm)` from `assets/world-lab/world-mesh.mjs`; `chooseWindow(world, windowIndex)` from `assets/world-lab/parent-world.mjs`.
- Produces: `chooseLocalSite(parentWorld, { windowIndex = 0, siteIndex = 0 })` returning `{ version, parentSeed, parentConfig, windowIndex, siteIndex, centerXKm, centerZKm, elevationM, slopeX, slopeZ, downslopeBearingRad, ruggedness, uplift, subsidence, tectonicAge, rainfall, ocean, nearestNode }`.

- [ ] **Step 1: Write tests that name the site-selection failures**

Use a small handcrafted parent mesh so expected anchors are independent of generator internals, plus one real generated parent fixture:

```js
test('site selection is deterministic and keeps the 410 m focus on land', () => {
  const parent = fixtureParent();
  const a = chooseLocalSite(parent, { windowIndex: 0, siteIndex: 0 });
  const b = chooseLocalSite(parent, { windowIndex: 0, siteIndex: 0 });
  assert.deepEqual(a, b);
  assert.equal(a.ocean, false);
  assert.ok(a.centerXKm >= 0.205 && a.centerXKm <= 0.795);
  assert.ok(a.centerZKm >= 0.205 && a.centerZKm <= 0.795);
});

test('site index cycles reproducibly through distinct ranked candidates', () => {
  const parent = fixtureParent();
  const first = chooseLocalSite(parent, { siteIndex: 0 });
  const second = chooseLocalSite(parent, { siteIndex: 1 });
  assert.notDeepEqual([first.centerXKm, first.centerZKm], [second.centerXKm, second.centerZKm]);
  assert.deepEqual(second, chooseLocalSite(parent, { siteIndex: 1 }));
});

test('site selection rejects parents without a usable terrestrial candidate', () => {
  assert.throws(() => chooseLocalSite(oceanFixture()), /No usable local terrain site/);
});
```

- [ ] **Step 2: Run the site tests and verify RED**

Run: `node --test tests/local-terrain-site.test.mjs`

Expected: FAIL because `assets/local-terrain/local-site.mjs` does not exist.

- [ ] **Step 3: Implement ranked deterministic selection**

Build the parent mesh index once per call. Generate a fixed 9 by 9 candidate lattice inside the chosen window, jitter each candidate by a deterministic hash of the parent seed/window/candidate, and reject candidates whose 410 m focus corners are outside the parent domain, ocean, or invalid. Estimate the broad gradient from parent elevation samples 9.375 km apart. Rank by finite land status, moderate slope, local relief, and distance from window edges; stable-sort by score and candidate ordinal. Select `siteIndex mod candidateCount` and record only serializable provenance values.

- [ ] **Step 4: Run the site tests and verify GREEN**

Run: `node --test tests/local-terrain-site.test.mjs`

Expected: all site-selection tests pass.

- [ ] **Step 5: Commit the site selector**

```powershell
git add -- assets/local-terrain/local-site.mjs tests/local-terrain-site.test.mjs
git commit -m "Add deterministic local terrain site selection"
```

### Task 2: Padded parent-conditioned terrain and drainage

**Files:**
- Create: `assets/local-terrain/local-drainage.mjs`
- Create: `assets/local-terrain/local-terrain.mjs`
- Create: `tests/local-terrain.test.mjs`

**Interfaces:**
- Consumes: the site object from Task 1 and an immutable solved parent world.
- Produces: `routeLocalDrainage({ heightM, width, height, spacingM, preferredOutletBearingRad })` and `generateLocalTerrain(parentWorld, { windowIndex = 0, siteIndex = 0 })`.

- [ ] **Step 1: Write failing physical-contract tests**

```js
test('local terrain has the fixed physical grid and centered focus contract', () => {
  const tile = generateLocalTerrain(fixtureParent(), { siteIndex: 0 });
  assert.deepEqual(tile.grid, {
    width: 257, height: 257, sizeM: 1200, spacingM: 4.6875,
    minXM: -600, maxXM: 600, minZM: -600, maxZM: 600
  });
  assert.deepEqual(tile.focus, { centerXM: 0, centerZM: 0, sizeM: 410 });
  assert.equal(tile.heightM.length, 257 * 257);
});

test('terrain is deterministic, finite, parent anchored, and does not mutate its parent', () => {
  const parent = fixtureParent();
  const before = Array.from(parent.height);
  const a = generateLocalTerrain(parent, { siteIndex: 0 });
  const b = generateLocalTerrain(parent, { siteIndex: 0 });
  assert.deepEqual(Array.from(a.heightM), Array.from(b.heightM));
  assert.ok(a.heightM.every(Number.isFinite));
  assert.ok(Math.abs(a.heightM[128 * 257 + 128] - a.anchor.elevationM) < 35);
  assert.deepEqual(Array.from(parent.height), before);
});

test('every receiver path terminates at a boundary outlet without climbing', () => {
  const tile = generateLocalTerrain(fixtureParent(), { siteIndex: 0 });
  for (let start = 0; start < tile.receiver.length; start += 977) {
    let node = start;
    for (let hops = 0; hops < tile.receiver.length; hops++) {
      const next = tile.receiver[node];
      if (next < 0) break;
      assert.ok(tile.conditionedHeightM[next] <= tile.conditionedHeightM[node] + 1e-3);
      node = next;
      if (hops === tile.receiver.length - 1) assert.fail('receiver cycle');
    }
  }
  assert.ok(tile.drainage.outlets.length > 0);
});
```

Also cover array lengths, non-negative accumulation, water/walkability consistency, a different `siteIndex` producing a different tile, and explicit errors for invalid parents.

- [ ] **Step 2: Run terrain tests and verify RED**

Run: `node --test tests/local-terrain.test.mjs`

Expected: FAIL because the terrain modules do not exist.

- [ ] **Step 3: Implement drainage on a rectangular grid**

`routeLocalDrainage` first applies a deterministic priority-flood from every boundary sample, using the preferred macro outlet bearing to break equal-height ties. It then assigns each interior cell to the lowest of its eight neighbors in the conditioned surface, marks boundary termini with receiver `-1`, accumulates contributing area in descending elevation order, and returns `{ conditionedHeightM, receiver, flowAccumulation, outlets, primaryOutlet }`. Per-cell raising is bounded and reported as a warning if it exceeds a documented threshold.

- [ ] **Step 4: Implement local synthesis and crop**

`generateLocalTerrain`:

1. validates parent mesh and fields;
2. calls `chooseLocalSite`;
3. samples the parent height plane and source fields around the anchor;
4. creates a 385 by 385 padded surface with parent trend plus deterministic world-coordinate fractal detail;
5. derives detail amplitude and anisotropy from uplift, ruggedness, tectonic age, and downslope direction;
6. routes drainage over the padded surface;
7. crops the central indices `[64, 320]` in both axes to 257 by 257;
8. remaps receiver paths that leave the crop to explicit local boundary outlets;
9. derives slope, ruggedness, water, surface class, and terrain-only walkability in physical units;
10. returns `local-terrain-v1` provenance, metrics, arrays, warnings, and `focus`.

Use deterministic integer hashing and continuous value noise evaluated from parent-space meter coordinates. Do not call `Math.random()`.

- [ ] **Step 5: Run terrain tests and verify GREEN**

Run: `node --test tests/local-terrain-site.test.mjs tests/local-terrain.test.mjs`

Expected: all local-terrain tests pass.

- [ ] **Step 6: Commit the pure terrain foundation**

```powershell
git add -- assets/local-terrain/local-drainage.mjs assets/local-terrain/local-terrain.mjs tests/local-terrain.test.mjs
git commit -m "Generate parent-conditioned local terrain"
```

### Task 3: Export contract and browser inspection lab

**Files:**
- Create: `assets/local-terrain/local-terrain-app.mjs`
- Create: `local-terrain.html`
- Create: `tests/local-terrain-browser-contract.test.mjs`
- Modify: `regional-world.html`
- Modify: `assets/world-lab/world-app-v6.mjs`
- Modify: `index.html`
- Modify: `scripts/check-browser-module-graph.mjs`

**Interfaces:**
- Consumes: `generateParentTerrain`, `predictFromTerrain`, `generateLocalTerrain`, and existing `AtlasView`.
- Produces: reproducible `local-terrain.html?seed=&continentCount=&crustScale=&window=&site=` URLs, `serializeLocalTerrain(tile)`, and `window.__localTerrainLab` for browser verification.

- [ ] **Step 1: Write failing browser/export contract tests**

Test observable behavior rather than exact source wording:

```js
test('serialized terrain retains physical dimensions, arrays, and provenance', () => {
  const payload = serializeLocalTerrain(generateLocalTerrain(fixtureParent()));
  const parsed = JSON.parse(JSON.stringify(payload));
  assert.equal(parsed.version, 'local-terrain-v1');
  assert.equal(parsed.grid.sizeM, 1200);
  assert.equal(parsed.heightM.length, 257 * 257);
  assert.equal(parsed.anchor.parentSeed, fixtureParent().config.seed);
});

test('the local lab and Watershed handoff are linked by the offline module graph', async () => {
  const result = await inspectBrowserGraph('local-terrain.html');
  assert.equal(result.missing.length, 0);
  assert.ok(result.modules.includes('assets/local-terrain/local-terrain-app.mjs'));
});
```

Also assert the rendered document exposes controls for seed, parent controls, window/site indices, map mode, next site, export, and an accessible 3D canvas.

- [ ] **Step 2: Run browser-contract tests and verify RED**

Run: `node --test tests/local-terrain-browser-contract.test.mjs`

Expected: FAIL because the lab and serializer do not exist.

- [ ] **Step 3: Implement serialization and the thin lab**

Create `serializeLocalTerrain(tile)` in the pure terrain module; convert typed arrays to ordinary arrays and preserve configuration/provenance/metrics exactly.

Build `local-terrain.html` with a full-screen canvas, compact generation controls, metrics panel, overlay selector, next-site button, link-copy button, and export button. `local-terrain-app.mjs` parses and validates URL values, generates the parent through stage 4, generates the local tile, adapts the regular grid to the geometry shape expected by `AtlasView`, draws a centered 410 m focus outline, and maps elevation/slope/water/drainage/walkability to colors. Expose the current tile, generation status, selected mode, and regeneration methods under `window.__localTerrainLab`.

- [ ] **Step 4: Add navigation without coupling generators**

Add an `Open local terrain` button to Watershed. It constructs the local-lab URL from the current generated world's configuration plus current window index. Do not show it for frozen reference worlds. Add the local lab to `index.html` and extend the offline module-graph script to validate its entry module.

- [ ] **Step 5: Run browser-contract and focused integration tests GREEN**

Run:

```powershell
node --test tests/local-terrain-browser-contract.test.mjs tests/local-terrain-site.test.mjs tests/local-terrain.test.mjs tests/regional-benchmark-integration.test.mjs
node scripts/check-browser-module-graph.mjs
```

Expected: all tests pass and both browser entry graphs link without missing local imports.

- [ ] **Step 6: Commit the browser lab**

```powershell
git add -- assets/local-terrain/local-terrain.mjs assets/local-terrain/local-terrain-app.mjs local-terrain.html tests/local-terrain-browser-contract.test.mjs regional-world.html assets/world-lab/world-app-v6.mjs index.html scripts/check-browser-module-graph.mjs
git commit -m "Add local terrain inspection lab"
```

### Task 4: Visual calibration, durable handoff, and PR

**Files:**
- Modify: `docs/codex-watershed-handoff.md`
- Create screenshots outside the repository in the task visualization directory.

**Interfaces:**
- Consumes: the completed pure generator and browser lab.
- Produces: documented evidence, a pushed branch, and a stacked GitHub PR targeting `codex/tectonic-terrain-design` until PR #26 lands.

- [ ] **Step 1: Run focused and full automated verification**

```powershell
node --test tests/local-terrain-site.test.mjs tests/local-terrain.test.mjs tests/local-terrain-browser-contract.test.mjs
node --test
node scripts/build-watershed.mjs
git diff --check
```

Expected: all tests pass, the offline build completes, and no whitespace errors are reported.

- [ ] **Step 2: Run the browser visual loop**

Serve the worktree locally, open a fixed local-terrain URL, wait for `window.__localTerrainLab.status === 'ready'`, verify meaningful content and absence of an error overlay, capture 3D/elevation/drainage views, and inspect the 410 m outline. Repeat for at least three site indices. Name a real-world analogue appropriate to the parent setting and record visible similarities and discrepancies. If a causal defect appears, add a failing regression test before tuning the model and repeat verification.

- [ ] **Step 3: Update the handoff**

Document public interfaces, units, fixed grid dimensions, screenshot paths, analogue assessment, executed verification, limitations, and the next step of settlement suitability/regional roads. State explicitly that Warden integration and cities remain future work.

- [ ] **Step 4: Review the complete diff against the spec**

Run:

```powershell
git status --short
git diff --check 95488ed...HEAD
git diff --stat 95488ed...HEAD
git log --oneline 95488ed..HEAD
Test-Path -LiteralPath vercel.json
```

Expected: only scoped files changed, clean whitespace, coherent commits, and `vercel.json` is absent.

- [ ] **Step 5: Commit evidence and handoff**

```powershell
git add -- docs/codex-watershed-handoff.md
git commit -m "Document local terrain foundation"
```

- [ ] **Step 6: Re-query the live remote and create the stacked PR**

Verify live `main` and `codex/tectonic-terrain-design` SHAs again. Push `codex/local-terrain-foundation` and create a PR whose base is `codex/tectonic-terrain-design`, so it contains only the local-terrain work while PR #26 remains open. The PR description lists dependency, scope, tests/build, browser evidence, analogue assessment, and deferred work.
