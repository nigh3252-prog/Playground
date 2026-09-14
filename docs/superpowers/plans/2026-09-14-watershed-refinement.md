# Watershed Constrained Refinement Implementation Plan

> Execute task-by-task using the executing-plans workflow.

**Goal:** Make local views visibly detailed without replacing the parent geography.
**Architecture:** Immutable parent triangles and directed river edges feed one world-coordinate surface evaluator. A bounded render mesh samples that evaluator inside the existing viewer; parent solver modules stay untouched.
**Tech Stack:** Dependency-free ES modules, existing WebGL viewer, Node tests, Playwright.
**Spec:** `docs/superpowers/specs/2026-09-14-watershed-refinement-design.md`

## Global constraints
- Keep PR28 on PR26; do not merge either PR.
- No D8 rerouting, second generator, tile seeds or new page.
- Preserve source weights, base heights, river identity and upstream supply.
- Keep actual parent arrays, benchmarks and regional view unchanged.
- Expose modeled detail honestly and deploy through the normal existing Vercel flow.

## Task 1: World-coordinate refinement field and bounded local mesh
Files: new `assets/world-lab/terrain-refinement.mjs`, new `tests/terrain-refinement.test.mjs`.
Interfaces: `createRefinementContext(world)`; `sampleRefinement(context,xKm,zKm)` returns source weights, base/physical/surface height, water depth and incision; `createRefinedWindow(world,box,{n=161})` extends the inherited export contract.
- [x] Write and observe failing tests for actual nonplanar relief, immutable parent arrays, exact base weights, node/water protection, overlap/zoom continuity and invalid inputs.
- [x] Build continuous seeded residuals on the full inherited field; index actual directed river edges and protect water surfaces.
- [x] Build deterministic gradient-directed gullies anchored to inherited reaches; verify descending profiles and no window-specific decisions.
- [x] Sample a bounded mesh (at most 225 squared vertices), retain provenance, and report synthesized quantities and unresolved source reaches.
- [x] Run focused tests and real-parent fixtures, then commit locally.

## Task 2: Existing viewer integration
Files: `atlas-view.mjs`, `world-app-v6.mjs`, `local-explorer.mjs`; new `refinement-rendering.mjs`; browser check script and integration tests.
- [x] Add failing checks for detail toggle, same-world identity and physical bank rendering.
- [x] Add `AtlasView.setLocalSurface(data)`, preserving original picking source IDs and local height framing.
- [x] Add cached local refinement below 12 km, on/off comparison, exact-location navigation and URL state.
- [x] Paint inherited colors on the refined mesh with water/rock/eroded bank cues; keep diagnostic modes and overview intact.
- [ ] Verify export includes both base and refined heights; stage changes must not replace the parent generation.

## Task 3: Verification and delivery
Files: `scripts/check-refinement-browser.py`, current continuity workflow and `docs/watershed-continuous-local-view.md`.
- [ ] Run `node --test` and browser/worker module linking.
- [ ] Run genuine desktop/portrait browser checks and inspect before/after screenshots at river and inland sites.
- [ ] Verify no UI overflow, console errors, broken URLs or nonfinite geometry; measure local preparation times and retain screenshots.
- [ ] Run full Watershed packaging build; recheck source diffs for unintended generated baseline changes.
- [ ] Publish an atomic commit with verified Gmail attribution, update PR28's scope/evidence, and verify Vercel READY plus served changed modules.
