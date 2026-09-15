# Connected city fabric

The parent terrain, regional settlement distribution, and modern population model are accepted. The individual city view is not: one gently warped grid dominates every city and the pale isolated backdrop hides the regional geography.

The supplied `place_biography_worldgen_modern.html` contributes a useful structure: inherited approaches, an older irregular core, neighborhood connectors, localized planned districts, later arterials, and lots aligned to their streets. Its independently placed buildings and roads overlap. Adapt that structure to Watershed's real parent coordinates and dated transport graph, rather than importing its independent world or fictional historical explanations.

## Changes

- Preserve parent geography, settlement identity, dated population, water, and exact neighborhood population allocation.
- Replace visible whole-city grid streets with several connected street patterns. Retain a hidden land accounting mesh if useful.
- Feed dated regional route polylines into city approaches. Use common street geometry and clearance checks for building footprints.
- Draw the same regional terrain palette behind local detail, with actual routes and neighboring settlements. Let the local map zoom out into its region and select other towns without resetting the map.
- Provide an Explore map entry from the window at its current map coordinates. Generate local detail on demand as the camera approaches a settlement.
- Make neighborhood information collapsible on mobile.

## Limits

Street and building geometry is generated detail; it does not imply new measured terrain below the existing parent sample spacing. Urban forms may be suggested by settlement age and dated routes, but should not invent wars or planning events and present them as recorded history.

## Verification

Exercise population reconciliation, deterministic replay, dated approaches, street variety and connectivity, water/slope exclusions, and building clearance. Check gesture anchoring, region/city camera handoff, stale generation cancellation, and neighborhood selection. Verify the real default metropolis and a smaller/coastal town, run the existing regression suite and offline build, then inspect the hosted preview. Publish to PR #29 without merging.
