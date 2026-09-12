# Watershed frozen benchmark architecture

Real geography is a **development benchmark**, not a live runtime dependency.

## Frozen snapshot

`assets/world-lab/benchmarks/` contains the processed reference inputs and held-out observations for Michigan / Great Lakes, Great Basin, Cascades, and Central Appalachians. `manifest.json` records the capture timestamp, protocol, data counts, and source digests. Normal browser and Vercel builds read only these committed files.

The fixed protocol deliberately separates model inputs from score-only truth:

- model input: raw regional elevation plus frozen NOAA climate normals;
- held-out observations: USGS NHD inland water, Natural Earth major-river geometry, Census 2020 tract population, and the available 1850 urban-place sample;
- calibration regions: Michigan and Great Basin;
- validation regions: Cascades and Central Appalachians.

Known observed inland water, river lines, and population do not enter the prediction path. They are applied only after Water → Ecology → Human has been generated.

## Refreshing source data

`.github/workflows/freeze-watershed-benchmarks.yml` is the intentional refresh path. It downloads the public sources, creates compact snapshots, validates them against the model, recomputes baseline reports, and commits the frozen files. This workflow is not part of Vercel deployment.

A benchmark refresh is appropriate when the benchmark protocol/source set is intentionally changed. It is not required for UI changes, gameplay work, or ordinary preview deployments.

## Deployments

`scripts/build-watershed.mjs` is offline with respect to benchmark sources. It validates module syntax/linking, verifies the committed snapshot schemas, runs the model against the frozen packs, recomputes reports from those packs, and copies static output. A preview therefore cannot fail because USGS, Census, NOAA, or another public source is temporarily unavailable.

## Current calibration result

The first frozen, unfitted baseline is intentionally diagnostic rather than a success criterion. In particular, Michigan currently exposes a large false-positive lake problem: the ≥25 km² scored model water is about 19,074 km² versus about 1,914 km² observed, roughly +897% area bias. That is evidence to tune the water-retention / depression model next, not a reason to alter the frozen benchmark target.

Visual relief exaggeration never enters these metrics. Physical elevation, drainage, lake masks, population correlation, and benchmark scoring use unexaggerated values.
