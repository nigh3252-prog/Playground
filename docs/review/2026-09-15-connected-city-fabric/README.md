# Cities as part of the region

The earlier city model used the settlement's location and exact population but imposed one warped, rotated grid over the entire footprint. Its separate pale background obscured regional geography. This update replaces that visible grid with connected street patterns and makes the local map a continuous camera over the parent.

The user's supplied `place_biography_worldgen_modern.html` informed the combination of inherited approaches, irregular older lanes, localized planned quarters, later arterials, and road-frontage buildings. Watershed retains its own parent terrain, dated settlement history, and route geometry. The reference's independently placed overlapping lots were not imported.

## Behavior

- **Explore map** opens at the current parent/window camera location and physical scale. Pan and zoom from the region into streets; details load for nearby visible cities. Tapping another town selects it without resetting the camera.
- **Cities** still provides direct access to any dated settlement. Neighborhood information starts collapsed and opens when a district is selected.
- Roads inherit eligible active land-route polylines. River travel remains a water connection, rather than becoming a road. Explicit narrow river crossings render as bridges; broad-water and long river-following segments do not become city streets.
- An irregular older center, neighborhood connections, independently oriented residential/planned quarters, industrial access, and later arteries replace the global grid streets. Local plans are joined across their boundaries.
- Neighboring cities reserve reciprocal boundaries weighted by their dated urban areas, preventing independent city footprints from overlapping. Streets and buildings stay within those reservations; regional road approaches can connect across them. Buildings also clear active dated land routes passing through their territory.
- Buildings use their frontage street's geometry and clear every road, neighboring roof, and parent water mask. Water and slope exclusions remain in force. District populations still sum exactly to their dated settlement population.

## Checks

All **200 Node tests** pass. The offline deployment build and browser app/worker module linking pass. Existing frozen real-data benchmarks remain unchanged.

Targeted regressions cover dated routes, actual approach continuity, diverse street bearings, local-plan connections, roof clearance, bounded generation, coastline/river exclusions, exact population, camera handoff, pinch continuity when detail arrives, cancellation after Back/reroll, background loading without changing selection, and bounded visible-city caching after panning.

Actual default parent: seed 431970387, 4,800 km across, 66,049 nodes, history seed 104729, modern Year 600. Population remains 357,013,380, with 256,983,983 urban and 100,029,397 rural residents. Four city maps were rendered with the real Canvas 2D drawing code at regional, city, neighborhood, and street scales:

| Place | Residents | Built km² | Streets | Building footprints |
|---|---:|---:|---:|---:|
| Woodland End | 7,813,471 | 1,805.6 | 2,836 | 48,000 |
| Zoya Parker High Ground | 2,858,470 | 727.9 | 2,792 | 34,039 |
| High Ground | 8,857,139 | 2,238.0 | 2,865 | 48,000 |
| Noah Lane Coast View | 7,572 | 4.2 | 119 | 1,230 |

Sampled generation took roughly 0.06–1.7 seconds in Node while other verification tasks were running. These are diagnostics, not phone performance claims.

## Hosted checks

The `918522c` preview was exercised through its actual controls. A shared Woodland End URL opens the correct city with the neighborhood panel collapsed. Nearby city detail loads without changing its title or selected place. Expanding the panel, selecting Downtown, zooming closer, and returning to the region work. Parent and window totals remain 357,013,380 residents.

From the 1,200 km window, Explore map preserves the camera's 1,986 km visible desktop width. Tapping Nora Dean Forest Green selects its 1,494,045 residents without changing that scale; Fit whole city and zoom then reach its streets. Regional terrain and the neighboring town network remain visible throughout. Entering Explore map from elevation mode also renders the regional terrain correctly. Browser checks use the Canvas fallback; touch gestures are covered by real pointer-handler tests.

## Scope

This is generated urban structure, not a building census or playable mech collision map. Street phases interpret the settlement's date and connections; they do not invent recorded historical construction events. Footprints remain capped at 48,000 per city and the hidden accounting mesh still determines neighborhood land area. Fine terrain remains an interpolation of the parent samples. Actual phone hardware and the regional WebGL renderer need device verification.
