# Parent History Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for the simulation task and review; the controller owns the browser integration. Steps use checkbox tracking.

**Goal:** Show a replayable parent-wide history of habitation, connections, land use, and abandoned places in Watershed.

**Architecture:** A deterministic history engine consumes the existing Stage 4 parent without mutating it. A worker runs it and returns generation snapshots; separate presentation helpers and controls render those snapshots on the existing atlas.

**Tech Stack:** Native JavaScript ES modules, typed arrays, Canvas/WebGL, Web Workers, Node test runner. No new dependencies.

**Spec:** `docs/research/2026-09-14-parent-settlement-history.md`, approved by Ryan with the subsequent visual design: population markers, irregular countryside tint, weighted transport lines, land-cover change, hollow abandoned markers, optional affiliation tint, timeline, and a collapsible place panel.

## Global Constraints

- Simulate the whole parent. Window, camera, map mode, and relief exaggeration are display-only.
- Keep terrain, hydrology, and benchmark generation unchanged.
- Default to 12 generations of 25 years; run smaller internal updates.
- Use finite food/land accounting and conserved migration; allow stability, decline, and recovery.
- Keep dates, history seed, generation count, and model version reproducible.
- Keep mobile controls compact. Never label affiliation as precise political control.
- Preserve `mode=history` for geology; use distinct human-history parameters.
- Update existing PR #29 on `codex/parent-settlement-history`; no merge and no new deployment configuration.

## Task 1: Deterministic history engine

**Owner:** simulation implementer. **Files:** create `assets/world-lab/human-history.mjs`, optional `history-transport.mjs` / `history-land-use.mjs`, and `tests/human-history.test.mjs`. Do not modify browser, worker, pipeline, HTML, or presentation files.

**Interface:** Export async `simulateHumanHistory(world, options={}, progress=()=>{}, cancelled=()=>false)`. `options` accepts `seed` (uint32), `generations` (1–20, default 12), and `yearsPerGeneration` (25). The world is generated Stage 4 with parentDomain and the existing physical/human arrays. Invalid inputs must throw a useful error. Cancellation returns null.

Return the following structured-clone-safe shape (no Maps/functions):

```js
({version:'human-history-v1',seed,generations,yearsPerGeneration,
 groups:[{id,name,color}],
 sites:[{id,nodeId,name,groupId,founded,reason}],
 routes:[{id,a,b,nodes,kind,founded}],
 snapshots:[{generation,year,
   siteStates:[{siteId,population,peakPopulation,status,groupId,farmAreaKm2,foodRatio}],
   routeStates:[{routeId,traffic,active,lastUsed}],
   cultivation,woodland,soil,influence,settled,
   events:[{id,generation,year,type,siteIds,routeId,text}],
   summary:{population,settlements,abandoned,routeCount,cultivatedKm2}}]
})
```

`id` values and endpoints are integers indexing the corresponding static arrays. `founded`, `lastUsed` are generation numbers. Route `nodes` are parent mesh node IDs and `kind` is land/river/sea. Site `status` is village/town/city/abandoned. `siteStates` may omit sites not yet founded; it must never include future sites. The five land fields are parent-node-length typed arrays: cultivation/woodland/soil/settled in [0,1], influence is an integer group ID or -1. Frame 0 exists. Each frame owns its arrays. `progress({generation,generations})` can be sent after each generation. Site histories are reconstructed from snapshot events, filtering by viewed generation.

- [x] Write failing tests for deterministic replay, terrain/input immutability, historical snapshot independence, geography-constrained settlement placement, conserved migration/population accounting, finite food/land allocation, unreachable water barriers, and abandonment/recovery under controlled fixtures.
- [x] Run `node --test tests/human-history.test.mjs` and record the expected initial failure.
- [x] Implement founding from weighted viable land with several origin clusters. Use reasonable bounded site counts (at most 240) so normal parent histories remain affordable. Approximate coordinates are mesh nodes.
- [x] Implement small-step food support, birth/death/migration budgets, sparse graph routes with finite trade benefits, land use/recovery, and conditional pressure/cooperation/conflict events. Paths respect real adjacency, accessible embarkation, and maximum travel costs. Do not use arbitrary straight lines as routes or duplicate hinterland harvests.
- [x] Make meaningful changing histories across ordinary seeds without scheduling a mandatory disaster/collapse. Keep numerical parameters documented as game heuristics. Site IDs persist through abandonment and reuse. World 0 / dry or isolated cases must be valid.
- [x] Run focused tests plus a generated default parent history. Report observed runtime, site counts, route counts, events, and variation across generations. Commit only owned files and write the report into this plan's workspace.

## Task 2: Timeline and atlas presentation

**Owner:** controller. **Files:** create `assets/world-lab/history-presentation.mjs`, `assets/world-lab/history-controls.mjs`, `assets/world-lab/history.css`, `tests/history-presentation.test.mjs`; modify `regional-world.html`, `assets/world-lab/world-app-v6.mjs`, and `assets/world-lab/world-worker-v6.mjs`.

**Consumes:** the exact Task 1 history shape. **Produces:** a fifth Inhabitants stage, view-only generation selection, history regeneration without recomputing terrain, and history export.

- [x] Write and run failing tests for finding an extant site near a tap within the visible crop, hiding future sites/routes/events, and deriving correct age/status/trace information at earlier dates.
- [x] Implement pure presentation helpers and Canvas overlays. Countryside tint comes from graph-based land fields; vegetation respects original biomes; markers use area-scaled population and major labels; route widths depend on traffic; abandoned sites are hollow and disused routes dashed.
- [x] Extend worker orchestration to cache solved Stage 4 and run history on generated worlds only. A new-history request reuses it; token/cancel checks stop stale jobs. Keep benchmark suite separate.
- [x] Integrate stage 5 without changing the existing four-stage pipeline. At stage 5, natural coloring shows underlying ecology plus selected history overlays. Default the new view to the parent. Add optional affiliation coloring labeled influence, no hard borders.
- [x] Add generation slider, previous/next, play/pause, seed/generation settings, reroll history, date-sensitive events, a place selector, and a collapsible bottom place card with event jump buttons. Use textContent/escaping for text. A selected abandoned place remains inspectable.
- [x] Save `historySeed`, `historyYears`/generation count, and `generation` in URL; keep old parameters compatible. Exports include full history plus viewed date/window. Changing date only repaints the texture and controls.

## Task 3: Integration, review, and publication

**Files:** the preceding files plus the research proposal status and `docs/codex-watershed-handoff.md` if needed to describe current controls accurately.

- [x] Run `node --test tests/human-history.test.mjs tests/history-presentation.test.mjs` and the full existing Node suite once to check geographic regressions.
- [x] Use the supported browser on the existing Vercel PR preview for timeline, earlier dates, alternative history, place selection, windows, geological mode, benchmarks, and export. Inspect screenshots. Localhost/file access is unavailable in the cloud browser; its desktop 2D surface also cannot verify phone/WebGL rendering. Responsive CSS remains subject to a device check.
- [x] Get a scoped simulation review and a final whole-change review. Address concrete correctness issues and rerun affected checks.
- [x] Verify remote PR head, publish a tree/commit through the GitHub connector if shell credentials remain unavailable, and move only this branch forward. Preserve the user's GitHub identity. Update PR #29 title/body with implemented behavior and verification.
- [x] Check the available Vercel preview result, obtain its URL if successful, and provide the PR and usable preview link. No merge or new deployment configuration.

Implementation note: v1 intentionally omits sea travel and keeps the existing four-stage geography pipeline intact. Review corrections enforce combined cultivation/woodland area, actual trade-event accounting, unique place names, and cleared/disabled controls during rerolls.
