# Explore one map at increasing detail

The default entry is the full parent map. Pan or zoom to a place, then explicitly load **Window**, **Metro**, or **Streets** for that area. Each request keeps the camera's position and physical scale. The existing city chooser and direct city URLs remain available.

## What changed

- Window sharpens the map texture for the selected area using the existing parent terrain. It does not synthesize smaller landforms.
- Metro builds broad urban districts and principal roads, with no local streets or buildings. Streets refines the same dated plan: occupied cells, district boundaries, and principal road IDs and geometry match exactly.
- Requests include the visible area and a small margin, including city edges whose centers are offscreen. Excessively broad or dense requests ask for a closer view. Panning alone does not generate city geometry. Progress appears before queued work, and Back, date changes, and rerolls invalidate pending jobs.
- Controls retain up to 64 metro models and eight street models for the current dated context. The model's shared plan cache is also bounded to eight plans; generation is independent of the camera and request order.
- River transport no longer consumes land-road connection budgets. New land access follows the existing dry terrain graph and receives dated trail, road, and arterial upgrades. Population and geography budgets are unchanged.
- Cities grow toward inherited land corridors. Eligible approaches and through routes connect into principal city roads. Ordinary planned quarters share a cardinal survey, with terrain-contour exceptions; organic neighborhoods retain their curved character.
- Up to three historical growth milestones contribute stable early lanes, capped at 21 paths. Their geometry and source dates survive later expansion where terrain and neighboring territory permit.

## Default-world evidence

Parent seed 431970387, 4,800 km across, 257² nodes; history seed 104729, Year 600. Total population remains **357,013,380** across 1,000 cities and towns. The new network contains 1,536 land routes and 29 river routes.

High Ground retains its 8,857,139 residents and gains five land connections without losing its original three river connections. Three of seven nearby clipped corridors meet the existing terrain and water rules for urban paving. The remainder retain regional provenance; the model does not pave long routes through rivers to inflate access counts.

Actual Canvas renderer captures:

| View | Evidence |
| --- | --- |
| Neighboring cities and their connections | [neighboring-metros.png](neighboring-metros.png) |
| High Ground district overview | [high-ground-metro.png](high-ground-metro.png) |
| Refined streets in that same plan | [high-ground-streets.png](high-ground-streets.png) |

[diagnostics.json](diagnostics.json) records exact plan identity, counts and sampled runtime timings. High Ground Metro generated zero roofs; Streets generated the capped 48,000 footprints. All seven lanes from its earliest inhabited generation reappear unchanged at the final date. Runtime timings are diagnostics, not phone performance promises.

## Verification and limits

Behavioral tests cover land-only connectivity, dated road upgrades, Metro/Street identity, no eager local geometry, historical lanes, shared survey directions, road-led growth, city-edge selection, camera continuity, cache reuse, and stale-request cancellation. Existing population reconciliation, terrain and roof clearance, neighboring territory, and pointer gesture tests remain in place. The deployment build validates frozen benchmark inputs without external data requests.

The terrain still has nominal 18.75 km parent sample spacing. Urban geometry is a procedural interpretation of that terrain, not a new physical terrain simulation, road traffic model, or building census. Later neighborhoods and roofs are regenerated; retained lanes are a bounded history approximation rather than full replay of every street's construction. Local playable mech terrain remains a separate future layer.

The [phone review page](phone.html) embeds the actual application at 390 × 844 CSS pixels for hosted layout checks. It does not substitute for testing performance or WebGL on an actual phone.
