# Area detail and roads that shape cities

Ryan approved the design discussed in this conversation: start at the full parent, pan and zoom, explicitly request detail for the visible area, add a metro overview without small streets/buildings, and make urban growth inherit a meaningful transport history and coherent surveys.

## Required behavior

- Parent → Window → Metro → Streets share parent coordinates. Detail buttons preserve the visible center and scale; they work over neighboring cities, rural land, and partial city edges. Back and home remain available. Phone controls are compact; neighborhood information stays collapsible.
- Explicit requests generate only the requested area's required detail, with a small margin and cached reuse. Panning alone must not generate roofs. Pending work has a visible progress indicator and cannot survive Back, a changed date, or a reroll. Broad requests prompt the user to zoom further instead of generating a continent of buildings.
- Window remains honest about unchanged parent terrain resolution. Metro generates urban footprints, broad districts, and principal city roads, with zero small streets or buildings. Streets refines exactly the same dated plan and cannot change its footprint, districts, or principal routes.
- Regional roads distinguish overland access from water transport. River routes must not consume a city's land-road budget. Retain earlier routes; add/upgrade land connections according to dated settlement importance. Keep dry connected components separate, preserve route geometry and founding dates, and do not alter population/geography budgets.
- Urban growth should favor inherited road access. Preserve older local paths across dated expansion, and give neighboring planned districts shared survey directions. Allow justified alignments for terrain, waterfront/industrial access, and older routes; avoid independently rotating every district. Add useful connections from through routes/approaches to city roads.
- Existing coastline, lake, and terrain generation and independent real-world benchmark inputs are unchanged. Game-model history is not a calibrated traffic or demographic forecast.
- Update PR #29 on codex/parent-settlement-history and its preview; do not merge.

## Verification

Regression tests cover river-linked cities gaining land access, dated road provenance, metro/street identity, shared survey alignment, road-led growth, visible-area selection including city edges, no eager geometry, cached overlap, and cancellation. Inspect the default High Ground area (site 26), a neighboring-city metro view, and phone-sized street views. Preserve existing accounting, water/roof clearance, and input tests.
