# Area Detail and Road History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Explore the parent by requesting progressively finer detail in place, with cities shaped by persistent roads and shared street plans.

**Architecture:** Keep the existing parent as the sole geography. Separate cheap dated city plans/metro geometry from street and building realization. The existing Canvas map becomes a four-level explorer with explicit bounded area requests; all models remain independent of viewport.

**Tech Stack:** Browser ES modules, Canvas 2D, typed-array terrain, Node test runner, static Vercel preview.

**Spec:** docs/superpowers/specs/2026-09-15-area-detail-and-road-history.md

## Global Constraints

- Keep geography, population budgets, and frozen benchmark inputs unchanged.
- Use the current clean dedicated checkout/PR branch, not main. User has authorized updating this PR and preview; no merge.
- Use parent kilometers, dated sources, deterministic generation, and explicit source provenance.
- Do not generate local streets or buildings for Metro.
- Generation must not depend on viewport position or request order.

### Task 1: Dated regional land access

**Files:** assets/world-lab/modern-history.mjs, tests/modern-history.test.mjs; a focused road helper/test module if needed.

**Interfaces:** Keep simulateWorldHistory(world,options,progress,cancelled) compatible. Routes retain {id,a,b,nodes,kind,founded}; dated routeStates may add roadClass and widthKm. Early agrarian snapshots and population distribution remain intact. Consumers filter route.founded and active dated routeStates.

- [ ] Reproduce missing modern land approaches when an early city already has three river routes; assert a connected dry-world modern city obtains a land route while its older river links remain.
- [ ] Run the focused test to confirm the old connection policy fails.
- [ ] Separate land degree/connectivity and known land pairs from water transport; give larger dated centers more overland access and retain meaningful dated road upgrades. Bound graph work with the existing land ownership search.
- [ ] Verify no water crossing, deterministic replay, no future routes/upgrades, exact population conservation, and modern/early regression suite.
- [ ] Self-review and commit only owned files. Report changes, verification, and remaining limitations.

### Task 2: City plan and road inheritance

**Files:** assets/world-lab/city-model.mjs, city-structure.mjs; focused city-plan helper if useful; tests/city-model.test.mjs.

**Interfaces:** generateCity(world,history,frame,siteId,options={detail:'streets'}). detail is 'metro' or 'streets'. Both return existing city fields plus detailLevel. Metro returns identical districts/blocks/major roads but empty buildings and no local roads. Streets retains default compatibility. Reuse per-world/history/dated-site plan data without viewport keys. Honor route-state widths where present, fallback existing widths otherwise.

- [ ] Add a regression comparing Metro to Streets: deep-equal footprints/districts and matching major-road polylines; Metro buildings=[] and no local roads. Add dated old-path retention and shared planned-direction tests.
- [ ] Watch the tests fail on the old generator.
- [ ] Establish inherited road corridors before growth, bias growth toward access, connect existing approaches/through routes into the urban skeleton, and split principal-plan generation from detailed frontage generation.
- [ ] Keep historic local paths stable across expansion with dated provenance; share planned survey axes across adjacent districts. Explain limited historical approximation honestly in the model note.
- [ ] Preserve water, terrain, building clearance, neighboring city boundary, population, and deterministic regression checks; commit owned files and report timings for a large city.

### Task 3: Explicit area-based exploration

**Files:** assets/world-lab/city-controls.mjs, city-view.mjs, city-context.mjs, city.css, world-app-v6.mjs, regional-world.html; new area-detail.mjs and tests/area-detail.test.mjs; controls/view regressions.

**Interfaces:** Pure area selection takes parent-space {center,kmAcross,kmHigh}, context sites with estimated radius, and requested level; intersects city footprints even when centers lie offscreen. Controls request generateCity(...,{detail}) and preserve the camera on level changes. View supports setDetailLevel(level), manual requests, and current viewport extents.

- [ ] Add failing tests for explicit detail, intersection-based selection, bounded requests, camera preservation, cancellation, and reuse across overlapping requests.
- [ ] Add Parent/Window/Metro/Streets controls and a Load area button with visible loading/progress state. Keep current chooser as optional search, not required navigation.
- [ ] Disable automatic model generation in the area explorer; generate each selected site sequentially with event-loop yields. Cache Metro separately from Streets, bound high-detail capacity, and display an actionable zoom hint for overly broad requests.
- [ ] Render Metro with district fills and principal roads only; preserve broad context at all levels, never show roofs when a lower level is selected. Add a parent-start entry and carry the current camera into Window.
- [ ] Verify phone-sized controls, input gestures, stale queue behavior, and browser module graph.

### Task 4: Integration review and preview

**Files:** review notes and docs/codex-watershed-handoff.md; task fixes as needed.

- [ ] Recompute history from the cached default parent; verify High Ground now has inherited land approaches and inspect Metro and Streets in the same coordinates.
- [ ] Run all Node tests and the existing offline build; inspect real Canvas screenshots and live browser interactions.
- [ ] Review the complete diff against the spec and resolve concrete failures.
- [ ] Commit, push to the existing PR, verify Vercel READY for that commit, and provide a concise preview link with known limits.
