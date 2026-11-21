# Playground Model Review Bench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans, with independent verification. Steps use checkbox syntax.

**Goal:** One fast review bench for the actual Dot, Crocodilian and White Mech models.
**Architecture:** A static catalog indexes versioned self-contained GLBs. A single Three.js stage loads only the selected GLB, with immutable source assets and location-driven navigation.
**Tech Stack:** Static HTML, CSS, browser ES modules, vendored Three.js, GLB, Python and Node/Chromium QA.
**Spec:** docs/superpowers/specs/2026-11-20-playground-model-review-bench-design.md

## Global Constraints
- No review forms, recording, ratings, notes, or animal/game asset substitutions.
- Only original/cleared export bytes and no private reference images, links or identifiers.
- Leave existing Playground behavior unchanged; no cross-rig retargeting or modular mixing in this release.
- No all-model prefetch, iframe, separate viewer or CDN dependency; use shared local Three runtime when available.
- Each asset has a spoken short name and version plus an immutable direct link for later reuse. Stats hidden initially.

## Review Focus
- Rapid selection and rejected loads: last selection wins, with recoverable errors and no GPU objects retained by stale loads.
- Deep links: exact known asset/revision opens; invalid lookup falls back clearly; browser Back/Forward is coherent.
- Separate clip capability from rig status; clear all previous clip controls when opening static asset.
- Scrubbing paused clip changes its pose without resuming, replay/loop behave at clip end.
- Portrait: one stage and touch controls accessible without horizontal scrolling.

### Task 1: Assets and manifest
Files: models/assets/{dot-v1.glb,crocodilian-v1.glb,white-mech-v1.glb}, models/catalog.json, models/tools/{build_dot.py,verify_assets.py}.
- [ ] Write asset validation asserting published IDs/versions are unique; each local GLB magic and byte count/hash match, no external GLB resources, real clip names match the manifest, and Dot/Crocodilian/White Mech have one/zero/four expected clips.
- [ ] Run python3 models/tools/verify_assets.py: fail before assets exist.
- [ ] Generate original Dot as a small bright-eye workshop robot with an idle clip and separate semantic nodes; preserve verified extracted originals byte-for-byte and verify their publication provenance.
- [ ] Record only factual source credits and reuse limitations; if rights unclear, omit original rather than expose references. Build catalog IDs dot, crocodilian and white-mech, version v1, mesh/triangle/texture/rig metadata and counts from GLB, leaving unknown values null.
- [ ] Run verifier and commit after green.

### Task 2: Native review bench
Files: models/index.html, models/styles.css, models/viewer.mjs, models/tests/viewer.test.mjs, index.html.
- [ ] Write tests for exact selection/version query, circular next/prev, browser history, on-demand asset load, stale-selection coalescing, static state, and phone layout before implementing. Run and confirm initial failure.
- [ ] Implement single responsive stage with orbit/zoom/fit, model picker, next/previous, copy deep link, collapsed Details with download, and accessible clip play/pause, scrub and loop. Lock controls until the active asset is ready and clear resources on switches.
- [ ] Add one root homepage link without removing anything. Test at 390px portrait and desktop with real authored binaries, including animated pose and repeated switches; commit on green.
- [ ] Do independent diff review and end-to-end production-style static serve checks; open unrelated-work-free draft PR only after evidence is checked.
