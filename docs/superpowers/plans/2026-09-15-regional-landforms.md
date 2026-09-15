# Regional landforms implementation plan

The user approved the geography changes after comparing 1,200 km generated and real-world maps. Continue PR #29, based on PR #26.

**Goal:** Replace repeated straight water cuts with varied parent-scale geography: finite, curved tectonic belts; segmented basins; branching inlets; and drowned bedrock that can form peninsulas and islands.

**Constraints:** Generate physical elevation before solving water, ecology, and history. Keep the parent independent of the selected window. Preserve deterministic seeds, benchmark inputs and their pipeline, existing resolution controls, and the ability to inspect geology. This remains an exploratory game terrain model. Do not imply detailed erosion, glaciation, or sea-level simulation.

## Implementation

1. Capture the current parent and identical 1,200 km windows for seeds 431970387, 1, 42, and 0. Add a failing finite-boundary deformation regression and a curved-boundary regression.
2. Correct tectonic distance and polarity so deformation follows local margin geometry and decays beyond the endpoints.
3. Add regional relief on coastal shelves before erosion, using spatially distinct coastal provinces. Bedrock highs and connected branching depressions should change actual land/water connectivity. Break rift corridors into basins and intervening sills following their source polyline. Test these effects against controlled terrain, including submerged terrain.
4. Compare the same seeds, scales, and windows. Verify finite elevations, determinism, crop independence, water routing and budgets, history, and the complete Node suite/build. Record the visual assessment and known resolution limits.
5. Review the diff, publish to the existing PR branch, update its description, and verify the deployed preview. No merge.

**Primary files:** `tectonic-history.mjs`, `tectonic-terrain.mjs`, `geology-provinces.mjs`, `parent-world.mjs`, focused terrain tests, and the handoff. Add a regional landform module only if it makes the elevation ownership clearer. Keep the UI unchanged unless a concrete integration issue requires a correction.

## Review evidence

Record the baseline commit, fixed seeds, render method, verification commands and results in the handoff. Compare geometry at the same mesh spacing; increasing sample count alone is not the proposed fix.
