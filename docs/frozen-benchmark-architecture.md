# Watershed frozen benchmark architecture

Real geography is a **development benchmark**, not a live runtime dependency.

## Frozen snapshot

`assets/world-lab/benchmarks/` contains the processed reference inputs and held-out observations for Michigan / Great Lakes, Great Basin, Cascades, and Central Appalachians. `manifest.json` records the capture timestamp, protocol, data counts, and source digests. Normal browser and Vercel builds read only these committed files.

The fixed protocol deliberately separates model inputs from score-only truth:

- model input: raw regional elevation plus frozen NOAA climate normals;
- held-out observations: USGS NHD inland water, Natural Earth major-river geometry, Census 2020 tract population, and the available 1850 urban-place sample;
- calibration regions: Michigan and Great Basin;
- secondary check regions: Cascades and Central Appalachians. Both have been inspected during tuning, so they are not pristine holdouts.

Known observed inland water, river lines, and population do not enter the prediction path. They are applied only after Water → Ecology → Human has been generated.

## Refreshing source data

`.github/workflows/freeze-watershed-benchmarks.yml` is the intentional refresh path. It downloads the public sources, creates compact snapshots, validates them against the model, recomputes baseline reports, and commits the frozen files. This workflow is not part of Vercel deployment.

A benchmark refresh is appropriate when the benchmark protocol/source set is intentionally changed. It is not required for UI changes, gameplay work, or ordinary preview deployments.

## Deployments

`scripts/build-watershed.mjs` is offline with respect to benchmark sources. It validates module syntax/linking, verifies the committed snapshot schemas, runs the model against the frozen packs, recomputes reports from those packs, and copies static output. A preview therefore cannot fail because USGS, Census, NOAA, or another public source is temporarily unavailable.

## Current calibration result

The current frozen, unfitted baseline is intentionally diagnostic rather than a success criterion. Predicted versus observed inland water is about 2,500 versus 1,914 km² in Michigan (+30.6%), 5,987 versus 4,548 km² in the Great Basin (+31.6%), 1,247 versus 1,004 km² in the Cascades (+24.2%), and 211 versus 358 km² in Central Appalachia (-41.1%). These are useful coarse plausibility checks, not independent validation claims.

Visual relief exaggeration never enters these metrics. Physical elevation, drainage, lake masks, population correlation, and benchmark scoring use unexaggerated values.
