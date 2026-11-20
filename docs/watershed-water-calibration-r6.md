# Watershed r6 — water calibration state

This note records the first calibration pass against the frozen real-world benchmark packs. It is a development sanity check for believable fictional geography, not a claim of hydrologic prediction accuracy.

## What changed

The original regional mesh treated too many coarse DEM depressions as permanent lakes. The current model separates four ideas:

1. **Potential depression capacity** — the Priority-Flood spill surface still records what a closed basin could hold.
2. **Annual water balance** — rainfall/runoff, evaporation and geology-dependent leakage decide whether standing water is dry, seasonal, retained or overflowing.
3. **Regional drainage conditioning** — a several-kilometer sample can accidentally close a narrow real valley, so plausible shallow/rugged outlet corridors can be opened before the water budget.
4. **Through-drainage inference** — some remaining coarse-grid closures are treated as unresolved river valleys rather than lakes when their terrain/climate/through-flow pattern makes a permanent lake implausible.

The last item now has three generic regimes rather than one broad rule:

- **Very rugged + humid:** strong overflowing basins and very deep retained closures can become through-drainage. This is aimed at mountain terrain where a regional mesh can bridge a narrow incised valley.
- **Moderately rugged + humid:** only relatively strong flow-through closures become through-drainage, so lower-relief humid mountain belts do not get over-drained as aggressively.
- **Very low-relief + humid:** only enormous shallow flow-through basins can be treated as a missing outlet corridor.

Dry mountain basins are deliberately protected from the humid incision rule. Generated intentional glacial/rift/volcanic basins remain protected by their geology history.

## UI meaning

The Water map now labels state 6 as **Through-drainage (coarse outlet)**. Internally this means: the regional sample appears closed, but the model interprets it as an unresolved outlet/valley and routes surface flow onward. It is not a literal simulated erosion event and should not be read as a prediction that a new canyon forms.

The basin inspector exposes the state as `through-drainage`; `potentialLake` retains the pre-inference water result for diagnostics.

## Fixed benchmark comparison

Scored natural inland water bodies begin at 25 km² on the common evaluation grid. The current fixed-profile result is:

| Region | Predicted km² | Observed km² | Area bias |
| --- | ---: | ---: | ---: |
| Michigan / Great Lakes | 2,500.1 | 1,914.0 | +30.6% |
| Great Basin | 5,986.9 | 4,547.7 | +31.6% |
| Cascades | 1,247.4 | 1,004.3 | +24.2% |
| Central Appalachians | 211.1 | 358.2 | -41.1% |

For context, the original frozen baseline produced roughly 19,074 km² in Michigan against 1,914 km² observed (+897%). The gross lake-eagerness failure is therefore substantially reduced.

These numbers are **area-scale sanity checks**, not successful exact-map reconstruction. Spatial precision/recall remains weak because the regional model is coarse and because narrow outlets, lake-bottom bathymetry, groundwater and fine hydrography are unresolved.

## Calibration caveat

Michigan and Great Basin were the intended calibration pair. Cascades and Appalachians started as validation regions, but their results were explicitly inspected during this targeted terrain-regime correction. They should therefore be treated as **secondary checks, not pristine independent holdouts** from this point forward. A later independent region should be added before making any validation claim.

## Automated checks

The targeted pass completed successfully in GitHub Actions on commit `efc3bd418240f3a5ac602c59c93175cc05ad2008`:

- 34 focused water/benchmark tests passed.
- 13 parent-world and frozen-reference integration tests passed.
- Frozen benchmark manifests verified before scoring.
- Baseline scores were recomputed from the committed snapshots; no live USGS/NOAA/Census fetch was required.

## What remains

Water is now reasonable enough to support continued procedural-world development, but it is not locked. Remaining work is mainly second-order: exact lake placement, small-lake behavior below the 25 km² scored scale, groundwater/permeability realism, and independent holdout validation. Those do not need to block the next geography layer unless later changes materially alter drainage or water retention.
