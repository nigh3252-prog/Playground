# Parent-world settlement and ecological history

Research and approved design, September 14, 2026. PR #29 now implements the first parent-wide history simulation and its map timeline. The proposal below records the rationale; current controls and limits are summarized in `docs/codex-watershed-handoff.md`.

Branch point: [Playground PR #26](https://github.com/nigh3252-prog/Playground/pull/26), `codex/tectonic-terrain-design`, commit `95488ed692851807942b831565198a1c1c959066`.

## Recommendation

Add a coarse history simulation over the **whole parent world**, after the existing terrain, water, ecology, and human-potential calculations. Represent communities, their supporting countryside, and their connections. Run successive generations so settlement locations, trade routes, abandoned places, and changed vegetation acquire a shared past.

The first visible result should be a parent map with a timeline. A later window inherits this history, including connections to places outside its view. Detailed streets and buildings can then grow from those constraints.

Use a small causal simulation for growth, movement, trade, and land use, with conditional events for disruptions. Record the causes and effects before turning them into short readable history entries. The geographic rules establish opportunities; initial settlement choices and subsequent events allow several plausible histories on the same landscape.

## What other projects do

These are primary developer accounts or original research. Older descriptions are evidence of design techniques, not assertions about every detail of current releases.

| Project | Documented approach | What to borrow |
| --- | --- | --- |
| Dwarf Fortress | Bay 12 describes persistent worlds with civilizations and recorded history. In *Dwarf Fortress Talk #13*, Tarn Adams explains tracking population, professions, and building counts during world generation, then producing the detailed city map when it is needed. | Keep the parent simulation aggregate. Carry enough history forward to constrain future local maps. [Features](https://www.bay12games.com/dwarves/features.html), [developer transcript, episode 13](https://www.bay12games.com/media/df_talk_combined_transcript.html). |
| Worlds — History Simulator | The developer describes populations spreading through a cell-based world, adapting to environments, diverging through interaction, and joining into political groups. Its page lists cities and trade routes separately as planned features. | Treat inhabitants as evolving populations, with settlement and political patterns emerging over time. [Developer project page](https://drtardigrade.itch.io/worldhistorysim). |
| Azgaar's Fantasy Map Generator | The 2017 developer article ranks geographic sites, places capitals, builds roads, and reranks locations before placing towns. Rivers, confluences, and transport access influence placement. | Recalculate opportunity after infrastructure exists: a route can make a formerly ordinary place important. This article describes a placement pipeline, not a generational history simulation. [Developer explanation](https://azgaar.wordpress.com/2017/11/21/settlements/). |
| Caves of Qud | Jason Grinblat's GDC overview describes generating events and supplying explanations afterward, using replacement grammars rather than a complete historical simulation. The developers also describe historic sites and artifacts tied to generated histories. | Use compact event structures and material traces. For this geography-driven project, require map causes and consequences rather than relying on unconstrained invented explanations. [GDC talk overview](https://gdcvault.com/play/1025379/Procedurally-Generating-History-in-Caves), [developer roadmap](https://cavesofqud.com/roadmap/). |
| MayaSim | Scott Heckbert combines settlement agents, landscape cells, and a trade network. Agriculture, migration, soil degradation, climate, and forest succession affect each other. It is a proof-of-concept research model with stated calibration limits. | Couple human history to ecological changes. Borrow the feedback structure, not its Maya-specific assumptions or numerical parameters. [Original paper, 2013](https://www.jasss.org/16/4/11.html). |

## Three possible approaches

| Approach | Advantage | Limitation |
| --- | --- | --- |
| **Aggregate simulation plus conditional events — recommended** | Produces connected map changes with understandable causes; fits the existing parent graph. | Requires deliberate limits on food, migration, and transport to avoid runaway outcomes. |
| Event-led historical layers | Can quickly create eras, ruins, occupations, and narrative variety. | Spatial and economic explanations can become arbitrary unless tightly constrained. |
| Individual people and detailed economies | Could support biographies, households, and intricate politics. | Much larger development and computation cost before it improves this parent-level view. |

The recommendation is our synthesis of the sources, not a claim that one project uses this exact design.

## What PR #26 already gives us

The active browser route is `world-app-v6.mjs` → `world-worker-v6.mjs` → `generateStagesV6()` in `benchmark-pipeline.mjs`. It solves all four stages on the parent before selecting a display window. `world-pipeline.mjs` also contains an older crop-first human calculation; that is not the active v6 orchestration to extend.

The parent is 3,000–6,000 km across; the normal 4,800 km parent with 257 samples per side has nominal 18.75 km spacing. A sample represents broad countryside. A settlement marker at that resolution identifies an approximate site and its catchment, not a city boundary or exact riverbank.

| Existing data | Proposed role in history |
| --- | --- |
| `productivity`, `productiveArea`, biome, climate, water proximity | Initial livelihood opportunities and limits on supporting land. |
| Mesh adjacency, `travelFriction`, `edgeTravelCost()` | Starting information for movement and route costs. |
| `navigableRiver`, `transportAccess`, `marketAccess` | Potential connectivity, which becomes useful when communities establish transport links. |
| `strategicScore`, `strategicKind`, `strategicNodes` | Candidate crossings, mouths, confluences, passes, and ports. |
| `parentDomain` and `chooseWindow()` | A single history independent of which window is currently displayed. |

The existing human scores are relative heuristics. They do not specify people, annual harvests, or calibrated carrying capacity. The history model needs its own explicit conversion assumptions and finite resource accounting. The displayed shortlist of 36 strategic opportunities is not a settlement census or a mandatory list of towns.

The earlier handoff deferred settlement generation. Ryan's September 14 request changes the next priority to parent-level inhabitants and history. Its other geography and benchmark constraints remain useful.

## Proposed first version

Start with a chapter of preindustrial occupation, matching the current food and freight assumptions. As an adjustable starting point, show **12 generations of about 25 years**, with smaller internal updates so population and environmental changes do not jump once per generation. These are prototype settings to evaluate, not historical constants. This version begins with established founding communities; it does not claim to simulate the origins of humanity.

The same rules repeat throughout. Settlement, expansion, crisis, and recovery are possible outcomes, not compulsory global eras.

1. **Found communities.** Sample viable dry-land locations from food, water, and access signals, with spacing and finite supporting land. Use several origin clusters and seeded variation. Good land may remain unoccupied if people cannot yet reach it.
2. **Make a living.** Allocate nearby productive land, calculate food support, and update population and stores. Track countryside as well as town centers. Multiple settlements must not count the same harvest as entirely their own.
3. **Move and connect.** Households are represented as population quantities. Growth or hardship can send some to reachable existing communities or new sites. Travel follows terrain costs; established transport corridors reduce those costs. Water travel requires usable embarkation points and an explicit travel capability. The current opportunity cost function alone is too permissive to serve as migration rules.
4. **Trade and cooperate.** Connect reachable communities when benefits cover transport and upkeep. Exchange finite surplus. Successful connections can support larger centers, outlying communities, and persistent relationships. Influence can spread through these connections before any detailed kingdom model is needed.
5. **Respond to pressure.** Poor harvest periods, overlapping land demand, and contested crossings change incentives. Neighbors may share access, redirect trade, migrate, raid, or fight. Conflict needs contact, an identifiable stake, and an affordable route; adjacency alone does not require war.
6. **Leave traces.** Occupation can clear woodland, exhaust some cultivated land, or maintain transport corridors. Abandonment allows recovery where climate and biome support it. Preserve site identity, occupation periods, population peaks, route changes, and destruction or abandonment causes.

Use bounded demographic rates and explicit birth, death, and migration accounting. Resolve competing claims from a shared prior state to avoid giving earlier array entries all the resources. Recovery and maintenance must be possible so growth does not guarantee collapse.

## A history that would change the map

Illustrative sequence, not a scripted story every seed must follow:

- Several small communities occupy a fertile river valley.
- A confluence settlement links two inhabited valleys and grows as a market.
- Cultivation expands; nearby woodland recedes, while a road through a pass becomes established.
- A poor-harvest period increases demand for imported food. One group restricts a crossing; neighbors seek another route or contest access.
- Some inhabitants move to a better-connected site. The old center shrinks, but its road remains useful.
- Generations later, a smaller community reoccupies part of the abandoned site. Secondary woodland covers former farmland.

The resulting parent has both current activity and older traces. A future local window can inherit an old route, an abandoned center, a contested crossing, or land recovering from occupation. It need not invent an unrelated past when opened.

## Ecological scope

Keep the first feedback model small: cultivated fraction, woodland cover, soil condition, and time since disturbance. Initialize it from the solved environments; allow woodland recovery only where the underlying environment supports woodland. Preserve natural variation and sparsely inhabited areas.

Initial poor-harvest events can reduce food output for a bounded duration without moving the coastline or rerouting the river graph. Describe those as harvest stress. A later model that claims changing rainfall, floods, river navigability, or lake levels should update the corresponding water calculations consistently. Tectonic history and human history operate on different time scales.

## What we would see

- Parent map with community markers, inhabited countryside, major routes, and optional land-use or historical-remains overlays.
- A generation slider, play/pause, and one-generation advance. Earlier dates show saved state rather than recalculating a different world.
- Tap a place for a short history: why founded, growth or decline, connections, and what survives from earlier occupation.
- A separate **New history** control keeps geography fixed and changes the history seed. Advancing generations continues the same history; rerolling starts an alternative one.
- Thin, collapsible controls for phone review. Current window navigation remains a view of the same parent history.

## Implementation boundaries for a later build

Add separate history, movement, and land-use modules rather than expanding the terrain generator. Attach versioned results under a proposed `world.humanHistory` structure. Keep geographic arrays immutable and give sites, communities, routes, and events stable IDs. Store parent seed/configuration, history seed/configuration, and model version for replay.

Events should record their generation, participating places/groups, causes, effects, and any resulting trace. Text is a presentation of those records. No language model service is needed for the simulation or basic history descriptions.

The current UI already uses the map mode `history` for geological families and removes a URL parameter named `history`. Use distinct human-history mode and parameter names, and extend stage controls intentionally instead of silently reusing those meanings.

Run history in the existing worker architecture, yielding progress and supporting cancellation. Keep sparse transport connections, reuse path costs, and store only changing history state per generation. Avoid copying the entire physical parent for every time step or searching paths between every pair of settlements on every update.

Keep fictional history outside the frozen benchmark scoring path. Existing observed settlement/population data must not become generation inputs. Do not add deployment configuration or live data downloads for this feature.

## Evidence needed before calling the later implementation successful

- Same seeds and settings reproduce the same history; changing only the history seed preserves all terrain/water inputs.
- Opening different windows or changing visual relief does not change history. Routes and relationships continue outside the visible crop.
- Settlement and route locations respect water, reachability, and the chosen movement capabilities.
- Population changes reconcile with births, deaths, and migration; food and productive land are not duplicated across claims.
- Decline leaves inspectable traces; reoccupation preserves the former site's history; earlier snapshots remain unchanged.
- Cooperative and relatively stable histories are possible as well as crises. Check several unselected seeds for universal collapse, unchecked expansion, or one permanent winner.
- Browser review shows useful changes across generations, responsive controls, and acceptable memory/runtime at normal parent size on a phone.

These are proposed acceptance checks, not results from this documentation-only PR. The first milestone is an inspectable parent history whose changed places can be explained; detailed local city generation follows from that foundation.
