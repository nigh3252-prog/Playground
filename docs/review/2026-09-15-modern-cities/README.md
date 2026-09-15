# Modern populations and city neighborhoods

The September 15 update advances the parent history to a modern population era and opens individual places as neighborhood maps. It also replaces fantasy-compound settlement names with names tied to geography or generated founding communities.

## Population assumptions

The early settlement simulator is retained. Twelve additional 25-year frames describe an industrial transition, urban expansion, and modern endpoint. The endpoint targets 65 residents per habitability-weighted dry km² and approximately 72% urban residents. These are procedural game parameters, not a demographic forecast.

Urban and rural residents are separate budgets. Every modern frame reconciles site populations with its urban total and all parent-node populations with its overall total. The model represents up to 1,000 urban centers, plus rural residents distributed over suitable land.

Urban density references were checked against the [GHSL degree-of-urbanization definitions](https://human-settlement.emergency.copernicus.eu/degurbaDefinitions.php) and [UN World Urbanization Prospects](https://population.un.org/wup/). Their statistical definitions are context for scale; the prototype's urbanization share and density target are independent assumptions.

## Actual parent checks

Each run uses a 4,800 km parent with 66,049 irregular-mesh nodes, Standard detail, and history seed 104729. Each samples the largest city, a middle-ranked place, the smallest inhabited place, and a water-adjacent place. City district sums and complete urban/rural/nodal totals reconcile exactly.

| World seed | Parent residents | Urban residents | Rural residents | Largest city |
|---|---:|---:|---:|---:|
| 431970387 | 357,013,380 | 256,983,983 | 100,029,397 | 8,857,139 |
| 1 | 230,499,867 | 165,959,905 | 64,539,962 | 10,325,326 |
| 42 | 377,198,361 | 271,582,820 | 105,615,541 | 19,770,069 |
| 0 | 131,088,062 | 94,383,404 | 36,704,658 | 6,946,710 |

All four parents have 1,000 representative centers. Sampled city generation took approximately 7–159 ms in the Node runtime, including terrain extraction. Large metros have 96 neighborhoods and 21,330 block polygons in these runs. Smaller sampled towns have five neighborhoods. The default largest city occupies approximately 2,238 km² at 3,958 residents/km²; its regional footprint target differs slightly because city detail uses whole buildable blocks.

An independent history review also exercised a 103,041-node water-separated parent with 1,000 centers and 1,524 routes. All modern frames conserved residents, route endpoints matched their sites, and land routes avoided water.

## City detail and limits

The city model uses the parent mesh's actual triangles, water masks, and inherited river segments. It excludes development from water and steep land, grows connected neighborhoods, and orients streets using dated active routes. Each city has a dense center, housing, industrial/logistics areas, and parks. District populations add up to its selected dated population; parks contain no residents.

Neighborhoods and street/building fabric are procedural content. Terrain remains an interpolation of the coarse parent. This does not provide new measured terrain, simulated buildings, bridges, individual residents, or playable Warden collision geometry. Island land constraints are reported explicitly and can imply higher urban density. Representative town coverage and aggregate political identities remain approximations.

## Verification

All 183 Node tests and the offline deployment build pass. Fresh app/worker module linking also passes after review fixes. Independent review found two interaction defects (city resizing after viewport changes and stale shared-city replay after a world reroll); both were fixed and rechecked.

Automated checks cover exact population budgets, deterministic replay, unchanged parent geography and early food accounting, water-free routes and city blocks, city size/granularity, dated selection, cancellation of queued city opens, keyboard-accessible selection, zoom/pan/pinch gestures, and offline app/worker module linking. Frozen real-data benchmarks remain separate from generated history.

The city map is Canvas 2D with phone-oriented controls and a pixel-ratio cap. Actual phone hardware and the regional WebGL renderer still require a device check.
