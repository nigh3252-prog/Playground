# Local Terrain Foundation Design

**Status:** Proposed implementation contract. The overall direction and scale were approved in conversation; implementation begins after review of this written specification.

**Depends on:** The parent-world tectonic terrain work on PR #26 (`codex/tectonic-terrain-design`, commit `95488ed`).

## Purpose

Build the deterministic bridge between a solved Watershed parent world and a physical terrain tile that can later host roads, settlements, buildings, and Warden gameplay.

The first deliverable is a standalone Playground generator and browser inspection lab. It does not yet add cities or modify the Warden runtime. It establishes a trustworthy local-terrain contract that those later systems can consume.

## Goals

- Generate one deterministic 1,200 m by 1,200 m terrain tile from a selected location in a solved parent world.
- Preserve geographic causality: local elevation, relief, drainage, surface water, and terrain character must be conditioned by the parent world's fields rather than by an unrelated terrain seed.
- Produce collision-ready heights and useful derived masks in meters.
- Highlight a centered 410 m by 410 m focus area for close visual inspection and eventual detailed gameplay composition.
- Make every result reproducible from URL parameters and exportable provenance.
- Provide measurements and map overlays that make visual calibration against real terrain practical.

## Non-goals

- Settlement, road, lot, or building placement.
- Direct integration into the Warden runtime in this change.
- A full hydraulic-fluid simulation or geological timescale erosion model.
- Re-solving or mutating the parent world's tectonics, hydrology, ecology, or human history.
- Selecting a final player spawn, mission route, or combat encounter.
- Adding an explicit Vercel preview configuration file.

## Architecture decision

Three implementation shapes were considered:

1. **Integrate terrain directly into Warden first.** This would reach the controller sooner, but terrain defects would be entangled with runtime scale conversion, physics, and gameplay.
2. **Reuse the existing City Lab terrain noise.** This is inexpensive, but the local terrain would not inherit the parent world's elevation, drainage, or geologic character.
3. **Create a pure local generator plus a thin Playground browser lab.** This keeps the geography deterministic and independently testable, then gives Warden a stable data contract later.

The third approach is selected. The existing City Lab can eventually consume this output, but its current independent `baseHeight` function is not the new terrain source of truth.

## Scale hierarchy

| Layer | Physical extent | Role |
| --- | ---: | --- |
| Parent world | 4,800 km | Tectonics, continental form, climate, and broad hydrology |
| Regional window | 1,200 km | Existing Watershed inspection and candidate-location context |
| Local synthesis domain | 1,800 m | Padded domain used to avoid artificial edges during local drainage and conditioning |
| Delivered terrain tile | 1,200 m | Warden-compatible finite district extent |
| Inner focus | 410 m | Highlighted detailed gameplay/composition area |

The delivered tile is a 257 by 257 vertex grid. Its sample spacing is exactly 1,200 / 256 = 4.6875 m. Local coordinates are centered on the selected site, use meters, and range from -600 m to +600 m on each horizontal axis.

Local drainage and terrain conditioning operate on a 385 by 385 padded grid at the same 4.6875 m spacing, yielding a 1,800 m domain. The central 257 by 257 samples are then cropped as the delivered tile. The 300 m padding on each side allows water and terrain operations to see beyond the output boundary without the cost of synthesizing another full gameplay tile in every direction.

The 410 m focus is metadata and an inspection overlay, not a second heightfield. It is centered by default and may be repositioned later only through an explicit design change.

## Source-site selection and provenance

The generator accepts an already generated parent world plus deterministic selection options:

- parent seed and parent-generation controls;
- regional window index;
- local site index;
- local-terrain algorithm version.

`chooseLocalSite` scans deterministic candidates within the selected regional window. Version 1 selects representative terrestrial terrain rather than optimizing for a future city. A candidate must have valid parent interpolation, place the inner focus on land, and avoid pathological local relief or an immediate ocean crossing. Candidate ranking favors usable but non-flat terrain and geographic variety. Incrementing `siteIndex` moves through the ranked candidates without changing the parent world.

The chosen anchor records:

- parent seed and generation controls;
- window and site indices;
- parent-space center coordinates in kilometers;
- local origin and rotation;
- source elevation, broad slope, downslope bearing, ruggedness, geology, climate, and water context used by synthesis;
- the generator version.

If the scan cannot find a valid candidate, generation fails with an explicit diagnostic. It must not silently substitute a flat or unrelated tile.

## Parent-to-local contract

Parent mesh values are sampled through the existing mesh index and interpolation utilities. The first implementation consumes the fields that are available and finite at the anchor and its neighborhood, including:

- absolute elevation and its broad local gradient;
- ocean and inland-water classification;
- uplift, subsidence, tectonic age, and ruggedness;
- climate and rainfall context where available;
- regional drainage direction or a gradient-derived proxy when no explicit parent river crosses the site.

The parent world remains immutable. The local generator may derive cached observations from it, but it may not edit parent arrays or re-run parent stages.

Local X/Z values are meters; source parent X/Z values remain kilometers. Elevation and water levels are meters. The local tile's low-frequency surface must agree with the parent elevation and gradient at the site within declared numeric tolerances. Warden's 10-meters-per-simulation-unit conversion belongs in a later Warden adapter, not in Playground terrain generation.

## Terrain synthesis

The local surface is assembled in four deterministic layers:

1. **Parent trend.** Interpolated parent elevation and broad slope establish absolute height, macro descent direction, and the low-frequency shape.
2. **Geology-conditioned detail.** World-space deterministic noise adds sub-parent-scale ridges and valleys. Frequency, amplitude, anisotropy, and orientation respond to parent ruggedness, uplift, tectonic age, and structural direction. Noise coordinates are derived from parent world coordinates so nearby anchors sample the same underlying field.
3. **Drainage conditioning.** A bounded erosion and flow-routing pass on the padded domain softens implausible noise, opens drainage toward valid boundary outlets, and derives flow accumulation. It preserves the parent-scale descent rather than inventing a new regional watershed.
4. **Central crop and measurements.** The 1,200 m tile is cropped from the padded result, and physical derivatives are calculated from the final meter-scale surface.

The conditioning pass may fill tiny numerical pits, but it must not flatten meaningful basins or create retaining walls at crop edges. Ocean and parent-scale surface-water context are authoritative. Version 1 may expose a drainage/flow corridor without rendering flowing water when the parent solution does not provide enough evidence for a local river.

## Output contract

`generateLocalTerrain(parentWorld, options)` returns a versioned result with:

- `version`, normalized configuration, and complete source provenance;
- `grid`: width 257, height 257, size 1,200 m, spacing 4.6875 m, and centered local bounds;
- `heightM`: final absolute elevations;
- `slope`: physically calculated grade or angle values;
- `ruggedness`: local relief measurement;
- `waterMask` and water-level metadata where applicable;
- `drainage`: flow direction, accumulation, and boundary outlet metadata;
- `surfaceClass`: coarse terrain/material classification for later consumers;
- `walkability`: terrain-only traversal suitability based on grade, water, and local roughness;
- `focus`: the centered 410 m inspection rectangle;
- summary metrics and warnings.

Typed arrays are used internally. The exporter emits a documented serializable representation without changing numeric meaning. Derived masks are advisory foundation data; later city and Warden systems may apply stricter rules without regenerating the terrain.

## Browser lab

A new `local-terrain.html` page provides a thin viewer over the pure generator. It should:

- accept deterministic URL parameters for the parent seed and controls, window index, and site index;
- open from Watershed with the current parent provenance preserved;
- render the 1.2 km tile in 3D with the 410 m focus outlined;
- offer map overlays for elevation, slope, water, drainage, and terrain walkability;
- display elevation range, relief, slope percentiles, walkable fraction, water fraction, and outlet direction;
- support generating the next deterministic site and exporting the tile;
- keep controls plain and avoid duplicating parent-generation logic in the UI.

The page must report invalid or unavailable inputs visibly. It must not replace failed generation with a decorative terrain.

## Visual calibration loop

Each substantive terrain pass includes the following review loop:

1. Generate multiple fixed parent-seed/site fixtures plus at least one fresh site.
2. Capture the 3D tile and relevant diagnostic maps.
3. Inspect whether the landform reads as a coherent piece of the parent region, including ridge shape, valley continuity, drainage direction, slope transitions, and water placement.
4. Compare the result with a named real-world terrain analogue of similar scale and geologic setting.
5. Record the mismatch and make a bounded model adjustment when needed, then repeat the same fixtures to detect regressions.

The analogue is a calibration aid, not a requirement to reproduce a particular real location. The target is plausible membership in the normal range for that landform type, avoiding conspicuous outliers such as uniformly noisy slopes, isolated conical hills, artificial edge basins, or drainage running uphill.

## Proposed file ownership

- `assets/local-terrain/local-site.mjs`: deterministic site selection and provenance.
- `assets/local-terrain/local-terrain.mjs`: pure synthesis and output contract.
- `assets/local-terrain/local-drainage.mjs`: meter-scale flow routing and conditioning.
- `assets/local-terrain/local-terrain-app.mjs`: browser adapter and inspection controls.
- `local-terrain.html`: lab shell.
- `tests/local-terrain.test.mjs`: unit and invariant tests.
- `tests/local-terrain-integration.test.mjs`: parent-to-local fixtures and export checks.
- Existing Watershed page/app: only the link and parameter handoff needed to open the local lab.
- Watershed handoff documentation: update after implementation with the actual contract and evidence.

Responsibilities may be combined into fewer modules if that makes the code clearer, but the pure generator must remain independent of browser DOM and rendering code.

## Failure handling

Generation stops with a specific error when:

- parent data or required mesh indexes are missing;
- an anchor falls outside the solved parent domain;
- required samples are non-finite;
- no candidate site satisfies the versioned site constraints;
- drainage cannot find a boundary outlet consistent with the source context;
- export validation fails.

Warnings may describe unusual but usable terrain. Errors must not trigger a silent random fallback.

## Verification

Implementation follows test-first development. Automated checks cover:

- identical parent/options producing byte-identical local outputs;
- different site indices producing different anchors and terrain;
- the local center elevation and low-frequency gradient matching the parent within explicit tolerances;
- parent arrays remaining unchanged;
- finite heights and derived fields, valid array lengths, and consistent units;
- padded routing producing valid outlets without a crop-edge wall;
- flow not increasing elevation beyond tolerance along a receiver path;
- water, slope, and walkability masks agreeing with physical thresholds;
- the 410 m focus fitting entirely inside the 1,200 m tile;
- export/import round-tripping without loss of provenance;
- several fixed seeds spanning low-relief and rugged parent settings.

Browser verification covers initial load, URL reproducibility, next-site navigation, overlays, export, and screenshots of both 3D and diagnostic views. The full repository test suite and build run before completion. Performance is measured and reported; version 1 targets responsive desktop iteration without making an unsupported mobile-performance claim.

## Delivery sequence

1. Pure source-site selection and the versioned data contract.
2. Padded local synthesis and parent-trend preservation.
3. Drainage conditioning, physical derivatives, walkability, and export.
4. Browser lab, metrics, screenshots, and real-world analogue calibration.

This change stops at a verified local-terrain foundation. Settlement suitability and regional roads are the next layer. City layout follows that, and Warden integration follows once the terrain/city contract is stable.

## Acceptance criteria

- A URL-reproducible parent seed/window/site produces a deterministic 1,200 m, 257 by 257 terrain tile.
- The tile exposes a centered 410 m focus and all dimensions use physical meters.
- Its absolute elevation, broad slope, water context, and terrain character demonstrably derive from the parent world.
- Drainage exits coherently, values are finite, and no fake flat fallback exists.
- The pure output includes heights, physical derivatives, water/drainage data, terrain walkability, provenance, and export support.
- The browser lab makes the tile and its diagnostics inspectable without duplicating generator logic.
- Fixed-seed automated tests, the repository suite/build, and at least one screenshot-based analogue review pass succeed.
- No settlement, building, Warden runtime, or explicit Vercel preview configuration is added as part of this foundation.
