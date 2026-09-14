# Watershed: continuous local exploration

## Status and base

This is the continuity-first replacement for PR #27, built directly on PR #26 at `95488ed692851807942b831565198a1c1c959066`.

**It is not a completed fine-terrain generator.** The implementation preserves and explores the existing parent surface at smaller scales; it does not synthesize new street-scale hills, riverbanks, erosion, or tributaries. Keep the replacement PR in draft until that distinction is reviewed and the next refinement step is agreed.

## What is implemented

- The existing `regional-world.html` and Terrain → Water → Ecology → Human stages remain the application. There is no separate local-terrain page or second world generator.
- Explore opens a collapsible panel with 120 km, 12 km, 1.2 km, and 410 m coordinate-based windows, a regional context inset, and a return to the overview.
- Local surface vertices clip and interpolate the actual original parent triangles. Every exported vertex retains its source-node IDs and barycentric weights; local terrain is not reconstructed from one elevation/slope sample.
- River edges retain their original endpoints, arbitrary-angle direction, and full upstream contributing area. Clipping includes rivers whose two source endpoints are outside the local window. No D8 rerouting is introduced.
- Parent heights, receiver links, contributing areas, ocean/lake fields, tectonic history, and solver modules are unchanged.
- Exact picking, elevated-local-area camera framing, and scale-aware near clipping support small windows. Local views start at true height, and returning to the overview restores its prior visual scale.
- View coordinates survive URL reload. JSON export includes the inherited mesh, physical heights, source weights, river identities, and explicit resolution warnings.

## How to inspect

Open Watershed on this branch. Tap a location, open **Explore**, choose a window width, then use **Focus here**. **Closer** and **Wider** change only the viewing window; **Back to overview** returns to the regional view. Generation-stage buttons still show the same selected area.

## Verified evidence

Verified code commit: `1f01e4e6b7ae67a40b798fbd0a10c020c307976c`.

GitHub Actions run: https://github.com/nigh3252-prog/Playground/actions/runs/34835909956

- `node --test`: **150 passed, 0 failed**, including real-parent integration fixtures with two seeds and the existing regression suite.
- `node --experimental-vm-modules scripts/check-browser-module-graph.mjs`: browser and worker graphs linked successfully.
- `python scripts/check-inherited-browser.py`: **8 real-parent WebGL scale checks passed**, covering all four scales on 1440 × 1000 desktop and 390 × 844 portrait Chromium. No mocked generator or replacement source modules are used by this check.
- Browser assertions cover unchanged parent data/generation, inherited river identity, source weights, camera framing, JSON export, URL reload, stage switching, overview return, and horizontal overflow. This is software-rendered Chromium validation, not physical Android-device testing.
- Screenshots, exports, and `browser-results.json` are in the run's `watershed-continuity-review` artifact.
- The full `scripts/build-watershed.mjs` packaging/baseline-recomputation command was not run for this change; do not describe these checks as a complete deployment build.

## Honest visual limit and next step

The browser fixture's source spacing is 25 km. A 1.2 km view can therefore contain only a few inherited triangles, and can look flat or feature-poor. The UI explicitly reports this. Zooming or subdividing triangles alone does not resolve missing terrain. River strokes are atlas symbols, not physical river widths or banks.

The next implementation must add genuine constrained refinement to this same coordinate-based pipeline: retain the inherited macro surface and river network as explicit constraints, add finer terrain at intermediate scales, and verify overlapping windows agree. Preserve parent river crossings, connectivity, downhill behavior, and upstream supply. Do not replace the world with locally seeded noise, introduce D8-only drainage, or create another standalone generator. Do not claim fine-scale detail is complete merely because continuity tests pass.

## Repository and deployment handling

PR #26 remains unchanged and unmerged. PR #27 should be closed as superseded, with its branch retained for history. The new branch's narrow `vercel.json` entry disables automatic deployment for `codex/watershed-continuous-local-view`; it does not change settings for other branches. No merge or preview deployment is part of this change.
