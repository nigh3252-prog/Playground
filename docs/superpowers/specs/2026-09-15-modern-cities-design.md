# Modern populations and neighborhood-scale cities

Ryan asked to advance the existing parent history to modern population levels and densities, replace fantasy-style names with place/history-derived names, and open a city at neighborhood scale. Continue PR #29 from `7e34d6d`; retain the approved regional terrain.

## Experience

Generated worlds open at a contemporary endpoint. The timeline still shows early settlement history and the later transition to industrial and contemporary settlement. Users can choose the early-history endpoint in History options. Modern parent totals include both rural residents and urban residents, clearly distinguished; settlement cards report their own city/town population.

The parent map shows population concentration and city footprints at their physical scale. A visible Cities button lists the largest cities; selecting a settlement also offers Open city. The city view is a full-screen, touch-friendly map with pan, zoom, a scale bar, compact district information, and Back to region. It shows neighborhood areas, a downtown, residential districts, industrial land, parks, and major/local streets. Population, terrain, waterways, founding location and inherited transport inform the layout. District populations sum exactly to the selected settlement population. Other settlements retain their identities when returning to the regional map.

Names come from actual nearby geographic features, a founding household, or the generated community's civic identity. Store and show each place's name origin. Use varied plain-language names rather than concatenating fantasy prefixes/suffixes. Do not invent an in-world event that the model did not record.

## Model boundaries

- Keep `simulateHumanHistory()` compatible for the early agrarian simulation and its conservation tests. Add `simulateWorldHistory(world, options, progress, cancelled)` as the app/worker entry point. `options.era` is `modern` (UI default) or `agrarian`; `options.generations` remains the number of early generations, with a documented fixed later transition appended in modern mode.
- Retain the history schema (`sites`, `groups`, `routes`, `snapshots`, `generations`, `yearsPerGeneration`). Additional era, rural population, settlement density/area, naming and modern accounting fields are additive. Frame indices equal generation indices. Early frames cannot reveal future sites, names, districts or events.
- Modern population is an explicit game-world density/urbanization model informed by land habitability, access, and inherited settlement advantages; it is not a demographic forecast. Cover the whole habitable parent rather than scaling only the original settlement clusters. Allocate urban and rural population without double counting, keep all geography immutable, and never draw land transport across water. Bounded center count represents urban centers rather than every village.
- `generateCity(world, history, frame, siteId)` creates deterministic city data on demand. It uses the parent's actual triangle geometry and water classification; finer urban detail is generated content, not recovered real terrain. Keep streets/districts on buildable land and reserve water. The local city budget equals the regional settlement budget. Layouts vary with place/terrain/history and population.
- `createCityView(canvas, {onSelect})` owns city drawing and pointer gestures. Controller methods: `show(city)`, `resize()`, `zoomBy(factor)`, `reset()`, `selectDistrict(id)`, `destroy()`. The model exports district data suitable for accessible selectors/cards and a view extent in km.
- Benchmark data and independent benchmark predictions remain unchanged. No new hosted service or application dependency. No merge or production promotion.

## Reference calibration

The [GHSL definitions](https://human-settlement.emergency.copernicus.eu/degurbaDefinitions.php) distinguish cities (at least 50,000 people; dense contiguous 1 km² cells at 1,500/km²) from town/suburban clusters (at least 5,000 people; 300/km²). These are classification reference points, not a requirement to give all neighborhoods the same density. The [UN World Urbanization Prospects 2025](https://population.un.org/wup/) provides the wider modern settlement context. Our density choices remain explicit prototype assumptions, with dense cores, lower-density suburbs, rural settlement and uninhabited land.

## Verification

Meaningful tests cover deterministic names and origins; early-frame compatibility; exact urban/rural population accounting; modern density range and geographic spread; immutable parent fields; no land-route water crossing; city district population conservation; water/buildable constraints; stable city replay; and different sizes/terrain producing different footprints. Verify the whole flow in the deployed preview, including mobile-conscious layout, selecting a city, neighborhood selection, pan/zoom, return to region, earlier dates, and rerolls. Record the available browser's actual rendering/device limits.
