# Stage 4 — Human Geography / Pre-settlement Potential

This stage is intentionally **before settlements**. It asks which parts of the generated physical world would be attractive to people living with preindustrial bulk-transport constraints. It does not place a city, town, village, road, border or state.

Stage sequence:

1. Terrain / geology
2. Hydrology
3. Environments
4. **Human potential**

The model is a game-world heuristic. Its values are relative and explanatory, not historical price estimates, demographic predictions or archaeological claims.

## 1. Food-surplus potential

Every dry mesh node receives a 0–1 productivity score from:

- land-cover class from Stage 3
- temperature and rainfall
- local slope
- elevation
- proximity to modeled water
- a modest boost for flat, large-river floodplain settings

Grassland / open woodland in a moderate climate receives the strongest default agricultural potential. Wetlands, arid scrub, steep mountains, alpine ground and snow are strongly penalized. This is deliberately crop-agnostic: it estimates potential surplus rather than wheat yield, soil chemistry, irrigation engineering or a named agricultural system.

`productiveArea = nodeArea × productivity` is used to build representative surplus sources.

## 2. Preindustrial movement cost

Each physical mesh link receives a generalized cost in **land-kilometer equivalents**. These are not hours or currency.

- flat grassland is the reference cost
- woodland / forest is progressively harder
- wetland, steep alpine ground and snow are much harder
- slope and high elevation increase land cost
- open lake / sea travel is much cheaper
- a modeled navigable-river reach is much cheaper than cart haulage
- reaching a practical shore is cheaper than continuing over rough inland land

This embodies the qualitative constraint that moving bulk staples over land is expensive while water transport can expand the economically reachable hinterland. It does **not** yet model ships, upstream towing, seasonal water levels, roads, bridges, political tolls, security, pack animals or actual historical freight rates.

## 3. Navigable-water heuristic

A river link is highlighted as potentially navigable only when it is already a Stage-2 river and also passes coarse regional thresholds for:

- contributing drainage area
- Stage-3 modeled mean runoff
- downstream link gradient
- elevation

The thresholds scale partly with region size. The result is a strategic regional network, not a guarantee that a real vessel could navigate the channel. River widths on the map remain symbolic.

## 4. Bulk-transport access

A multi-source shortest-path field measures generalized cost to the nearest practical bulk-transport source:

- navigable river reaches
- low-gradient shore access to modeled lakes or sea

The displayed 0–1 `transportAccess` is an exponential transform of that cost. A value of 1 means the node is already on the access network; it does not mean free transport.

## 5. Reachable surplus / market access

The generator selects a bounded set of representative productive regions, then performs limited shortest-path searches through the same movement-cost graph. Each source's contribution decays with generalized travel cost.

Consequences:

- fertile land separated by mountains contributes less
- surplus can propagate much farther along navigable rivers / lakes / sea than over difficult land
- a river confluence can gain access to productive country upstream without a city being explicitly placed there

This is a coarse accessibility field, not a gravity model calibrated to a real period.

## 6. Strategic transport opportunities

Outlined rings are **not settlements**. They mark physical transport opportunities that can influence the eventual settlement layer:

- major river confluence
- river mouth
- head of navigation
- low-gradient natural port / shore access
- mountain saddle / pass
- manageable non-navigable river crossing

Candidates are spatially thinned so the display does not become a solid carpet of symbols. The inspector explains the nearby opportunity.

## 7. Human-potential score

The final 0–1 heatmap combines:

- 30% local food-surplus potential
- 31% reachable surplus / market access
- 18% bulk-transport access
- 13% strategic transport-node score
- 8% ease of overland travel

Wetland locations receive an additional penalty. Water itself receives zero settlement potential because this stage is rating land sites, even though water can make nearby sites valuable.

These weights are intentionally visible in source code rather than tuned behind an opaque model. The next settlement layer should be able to change or challenge them without rewriting terrain or hydrology.

## UI

Stage 4 adds map colorings for:

- Human potential
- Food surplus
- Overland difficulty
- Bulk-transport access

The user can independently show:

- all Stage-2 rivers
- highlighted navigable reaches
- strategic transport opportunities
- physical mesh

Tapping land shows food-surplus score, human-potential score, market access, transport access, local friction and whether the selected river reach is navigable.

## Export

The r4 JSON keeps the existing v3 physical-world export and adds `humanGeography` fields including productivity, productive area, movement friction, cost to transport, navigable reaches, market access, final human potential and strategic opportunities.

The export explicitly notes that no settlements have been placed.

## Validation

`tests/regional-human-geography.test.mjs` checks deterministic output, stage preservation, agricultural response to slope/climate/biome, movement-friction ordering, water-vs-cart edge costs, bounded water/land scores, navigable-reach constraints, transport-distance decay, graph influence on market access, strategic-node types/spacing, absence of settlements, hotspot relationships, climate sensitivity and several seeds / region sizes.

The physical-world tests remain separate in `tests/regional-world.test.mjs`.

Preview retry note: this commit intentionally retriggers the branch preview after fixing the JavaScript exponentiation parse error in the Stage-4 module.
