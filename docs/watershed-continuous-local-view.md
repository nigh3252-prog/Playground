# Watershed: inherited geography with finer local terrain

PR28 builds directly on PR26. The existing `regional-world.html` remains the app. PR27's separate local generator is not used. The parent terrain, tectonics, water, ecology and human-geography solver modules remain unchanged.

## Explore and compare

Open **Explore**, choose a location and focus at 120 km, 12 km, 1.2 km or 410 m. **Refine local terrain** adds detail at 12 km and closer; turning it off shows the original inherited surface at the same coordinates. **Find a river valley** navigates to an actual inland parent reach, without generating a different world. Repeated clicks visit other reaches. The four generation stages, regional context inset, map/orbit controls, exact picking and return to overview remain available.

The first implementation only enlarged the original triangles. The refinement now adds actual vertex-height variation, floodplain/bank cross-sections, bounded channel bends and dry erosion gullies. It is not just a texture or a camera effect.

## What remains inherited

- Every fine vertex retains its original parent-node weights and `baseHeightM`.
- The original river graph, centerline anchors, junctions, receiver IDs and upstream contributing areas remain intact.
- Finer channel bends remain within 0.8 of the modeled channel half-width of the inherited edge. Junctions are pinned, and the original centerline stays inside the channel corridor.
- Channel water profiles descend between inherited endpoint levels. Existing ambiguous/uphill parent reaches are reported and retained as inherited references, not silently rerouted.
- Ocean and retained-lake surfaces are protected. Parent arrays are not changed by focusing, toggling detail, changing scale, exporting or switching stages.
- Detail is keyed by parent seed, parent reach IDs and world coordinates, never by a tile ID, camera or crop boundary. Overlapping views sample the same underlying field.

## Added morphology

`terrain-refinement.mjs` interpolates the actual parent triangles at every query. Bounded, domain-warped residual landforms use continuously interpolated relief density from the full parent mesh. They are suppressed on water and pinned at nonwater parent samples. Actual inherited reaches shape channel beds, banks and floodplains. Deterministic tributary-shaped dry gullies ascend continuous terrain gradients from those reaches and receive downhill incision profiles. There is no eight-neighbor raster drainage solver.

A bounded render mesh samples the field at approximately 75 m for a 12 km view, 6.25 m for 1.2 km, and 2.14 m for 410 m. This is **render sampling**, not surveyed terrain accuracy. The height field is shared across scales; each render mesh approximates it at its own sampling density. The 120 km view and regional overview retain the original macro surface.

The inherited atlas colors stay in place. Local natural views add material cues for water, eroded banks and steep terrain; diagnostic layers remain based on the parent model.

## Export contract

`watershed-refined-window-v1` retains the inherited window contract and adds:

- `baseHeightM`, `heightM`, `detailM` and `surfaceM`: original interpolated terrain, refined bed/ground, their difference, and visible water/ground surface.
- `waterDepthM`, `incisionM`, `slope`, `waterMask`: modeled local fields; `incisionM` describes the added dry-gully cut.
- `rivers`: unchanged parent edge identities and clipped original anchor geometry.
- `channels`: bounded finer channel geometry, original parent points, endpoint water levels and upstream areas.
- `gullies`: deterministic dry morphology, parent reach IDs, ordered profiles and branch relationships.
- `refinement`: render spacing, terrain-change metrics and explicit unresolved-source counts.

The checkbox-off export stays `watershed-inherited-window-v1`.

## Verification

Local validation after the refinement implementation: **161 Node tests pass**, the browser/worker import graphs link, and the complete `node scripts/build-watershed.mjs` packaging command passes. Frozen benchmark areas remain 2500.1 / 5986.9 / 1247.4 / 211.1 square kilometers for Michigan / Great Basin / Cascades / Appalachians respectively; this change does not recalibrate them.

The branch's `Watershed continuity checks` workflow runs both `scripts/check-inherited-browser.py` and `scripts/check-refinement-browser.py` against the actual source and generated parent. Its `watershed-continuity-review` artifact contains screenshots, exports and browser results for desktop and portrait Chromium. The refinement check exercises comparison, all three fine scales, river/profile invariants, URL restoration, generation stages, exact source weights, finite geometry and UI overflow. This is software-rendered browser testing, not physical Android performance certification.

## Limits and deployment

This is procedural, erosion-shaped morphology constrained by existing geography, not measured local terrain and not a calibrated hydraulic/sediment simulation. River widths and depths are estimates. Dry gullies do not create a new water-budget solution. Fine ecology, settlement generation and Warden collision/runtime integration are not part of this change. A coarse region with low relief still looks like low-relief terrain, rather than being replaced by arbitrary mountains.

PR26 and PR28 are not merged. Normal automatic Vercel previews are enabled for PR28; the earlier explicit-permission-only restriction was removed at the user's request.
