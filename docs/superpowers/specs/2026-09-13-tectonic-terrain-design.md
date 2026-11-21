# Tectonic terrain generation design

**Status:** Proposed architecture approved in chat; implementation requires final review of this written specification.

## Purpose

Replace the parent world's hand-positioned mountain-range ribbons with a deterministic, process-inspired tectonic history. Mountains, trenches, volcanic arcs, plateaus, rifts, fault valleys, and foreland basins should arise from plate type and relative motion before erosion, hydrology, climate, ecology, or human geography run.

The system is not intended to reproduce scientific plate dynamics or reconstruct Earth. Its standard is a fictional continent with a legible geological history and landforms that fall within believable real-world ranges.

## Goals

- Give every major mountain belt a causal explanation: active convergence, subduction, inherited collision, rifting, or transform deformation.
- Produce varied, segmented, asymmetric mountain systems rather than constant-width Gaussian ribbons with rounded ends.
- Make young and old ranges visibly different through uplift age and erosion history.
- Preserve deterministic seed generation and the existing parent-world-to-crop architecture.
- Preserve the existing Terrain → Water → Ecology → Human data flow and frozen benchmark separation.
- Expose enough tectonic metadata to explain and debug every generated landform.
- Keep parent-world generation practical in the browser and on mobile-class hardware.

## Non-goals

- A spherical global plate simulator or numerical geodynamics package.
- Scientifically accurate mantle convection, earthquakes, rock chemistry, or geological dating.
- Reconstructing a known real continent.
- Generating local Warden-scale terrain detail in this phase.
- Generating settlements or changing the City Lab.
- Tuning generated terrain to maximize the four existing real-region water scores.

## Approaches considered

### Full numerical plate simulation

Advecting plates and solving crustal stress through many physical time steps would offer the strongest physical story, but it would be expensive, difficult to calibrate, and too complex for the present browser simulation.

### Improved range ribbons

Adding taper, noise, branches, and foothills to the current paths would be inexpensive, but the paths would still directly prescribe where mountains appear. It would improve appearance without satisfying the causal goal.

### Process-inspired tectonic history — selected

Generate plates, crust types, velocities, and a small number of geological episodes. Classify their boundaries from relative motion, accumulate deformation fields on the existing terrain mesh, relax the crustal response, and erode the result. This captures the major causes and signatures of real tectonic settings without claiming full geophysical simulation.

## World-scale tectonic model

### Padded domain

Tectonic plates are generated on a domain larger than the 3,000–6,000 km parent world. Plate seeds and boundaries may lie outside the visible parent so mountain belts, trenches, and rifts do not start or stop at map edges.

### Plates

Each plate records:

- stable ID and seeded origin;
- continental or oceanic crust;
- crustal age, thickness, density/buoyancy, and baseline elevation tendency;
- horizontal velocity vector;
- episode in which it formed or became inactive.

Plate regions are derived from distorted Voronoi ownership rather than rectangular divisions. The distortion must remain smooth enough that boundaries form continuous arcs rather than pixel noise.

### Boundary classification

For each neighboring plate pair, compare relative velocity with the local boundary normal and tangent:

- positive normal convergence → convergent boundary;
- negative normal convergence → divergent boundary;
- dominant tangential motion → transform boundary;
- weak motion → inactive or inherited suture.

Classification is derived from kinematics. A seed may influence the plates and velocities, but it may not directly label an arbitrary line as a mountain range.

### Dominant geological story

Each parent world gets one dominant readable tectonic story, selected from its actual plate configuration, plus secondary and inherited provinces. Initial supported dominant stories are:

1. ocean–continent subduction;
2. continent–continent collision;
3. continental rifting.

Transform systems and inactive sutures may appear as secondary structures. More complicated worlds can be added after these stories are individually convincing.

## Boundary responses

Boundary response is accumulated as deformation and crustal fields; it does not directly paint a final elevation ribbon.

### Ocean–continent subduction

- Ocean-side trench and outer-rise depression.
- Accretionary/coastal deformation near the boundary.
- Inland volcanic arc offset onto the overriding continental plate.
- Broad asymmetric uplift and a lower foreland or back-arc region.
- Segmented volcanism with gaps, clusters, and variable distance from the trench.

Subduction polarity comes from crust type and density. The volcanic arc must appear on the overriding side, never arbitrarily on either side.

### Continent–continent collision

- Broad distributed shortening rather than one narrow crest.
- Multiple parallel or en-echelon ridges.
- High interior massifs or plateaus where convergence is sustained.
- Foreland basins and foothills outside the primary uplift.
- Curved sutures, variable belt width, branching, and tapered terminations where convergence weakens.

### Divergence

- Central subsidence or rift valley.
- Paired uplifted shoulders.
- Segmented volcanic activity.
- Progressive transition toward oceanic crust when a mature rift is selected in a later phase.

### Transform and inherited structures

- Narrow fault valleys, scarps, offset drainage tendencies, and local pull-apart basins.
- Little broad uplift unless compression occurs at a bend.
- Old sutures act as weak zones that can influence later rifts, rivers, or deformation.

## Geological time

Generation uses a small number of coarse episodes rather than continuous simulation:

1. **Inherited episode:** establishes old sutures, broad worn-down uplands, and weak zones.
2. **Mature episode:** accumulates the dominant collision, subduction, or rift structure.
3. **Active/recent episode:** sharpens currently active uplift, volcanism, and fault expression.

Each episode updates accumulated convergence, shear, crustal thickening/thinning, subsidence, and volcanism. Age controls later erosion. Old ranges should be lower, rounder, wider, and more dissected; active ranges may be taller, sharper, and less deeply integrated into the drainage network.

## Terrain synthesis and erosion

The per-node tectonic result includes at least:

- plate ID and crust kind;
- crustal age and thickness anomaly;
- cumulative compression, extension, and shear;
- uplift and subsidence potential;
- volcanism and fault intensity;
- dominant boundary type and episode.

Elevation is derived from continental buoyancy, crustal thickness, tectonic uplift/subsidence, isostatic-style regional relaxation, and seeded small-scale roughness. Boundary influence varies with convergence strength, obliquity, crust type, episode age, local segmentation, and inherited weaknesses. Influence must taper naturally where motion weakens; identical-width rounded capsules are prohibited.

After tectonic elevation exists, a bounded erosion pass should:

- diffuse exposed high-frequency instability without smoothing away the tectonic structure;
- encourage incision along plausible downhill routes;
- move eroded material into adjacent foreland, rift, and coastal basins;
- retain explicit glacial and volcanic histories as modifications of the tectonic foundation.

Hydrology then runs on the resulting physical surface using the existing irregular-mesh drainage system. Climate and rain shadows continue to operate only after terrain exists.

## Architecture and files

Create a focused tectonic module rather than expanding `parent-world.mjs` indefinitely:

- `assets/world-lab/tectonic-plates.mjs` — padded plate layout, crust properties, velocities, adjacency, and boundary classification.
- `assets/world-lab/tectonic-history.mjs` — episodes and accumulated deformation fields.
- `assets/world-lab/tectonic-terrain.mjs` — crustal response, elevation synthesis, and tectonic metadata.
- `assets/world-lab/terrain-erosion.mjs` — bounded regional erosion and sediment redistribution.
- `assets/world-lab/parent-world.mjs` — orchestration, continent/ocean masking, and existing public parent-world contract.
- `assets/world-lab/geology-provinces.mjs` — secondary glacial, volcanic, rift, and inherited-landform modifiers driven by tectonic context.

`generateParentTerrain()` must keep the fields consumed by hydrology, crops, rendering, benchmarks, and human geography. Existing `landHistory`, `featureAt`, `features`, and `geology` outputs remain available, with richer tectonic metadata added beneath `geology.tectonics`. Any removal of `geology.ranges` requires a consumer audit and a compatibility migration in the same change.

Real-world benchmark terrain continues to bypass fictional plate generation. This work must not leak generated plate data into frozen benchmark prediction inputs or observations.

## Debug and user interface

Add a development-facing tectonic map mode that can display:

- plate ownership and continental/oceanic crust;
- velocity arrows;
- convergent, divergent, transform, and inherited boundaries;
- subduction polarity;
- accumulated uplift, subsidence, and volcanism;
- geological episode/age.

The terrain inspector should explain the selected node's plate, nearest boundary, deformation type, age, and contribution to elevation. The normal player-facing map remains concise; detailed controls stay collapsible.

## Determinism and performance

- All topology, velocities, episode choices, deformation, and erosion are derived from the world seed.
- No live network data is required.
- Use the existing parent mesh and bounded passes over nodes, edges, boundaries, and a small fixed episode count.
- Avoid per-node iteration over every boundary where spatial binning or nearest-boundary propagation can bound the work.
- Keep typed arrays for per-node fields and serializable plain objects for explanatory metadata.
- The initial implementation should stay within roughly the current parent-world generation budget; any material regression must be reported before integration.

## Failure handling

- Invalid plate topology, unclassified boundaries, non-finite deformation, or non-finite elevations fail generation explicitly.
- Do not silently substitute the legacy mountain ribbons after a tectonic failure.
- During development, a code-only comparison flag may retain the legacy generator for A/B testing. It is not a permanent user-facing world type and is removed once the tectonic path passes acceptance.

## Verification

### Focused automated checks

- Same seed reproduces plate topology, velocities, boundary classes, deformation fields, and terrain.
- Plate boundaries continue beyond the parent edge without edge-tied uplift artifacts.
- Ocean–continent convergence places the trench oceanward and volcanic arc on the overriding continental plate.
- Continent–continent convergence produces a wider distributed belt than subduction-arc volcanism.
- Divergence produces central subsidence with paired shoulders.
- Pure transform motion does not create a continent-scale mountain wall.
- Boundary response varies and tapers; it does not have constant width or blunt capsule ends.
- Old uplift is lower and smoother than otherwise equivalent active uplift.
- Elevation is finite and hydrology remains downhill, cycle-free, and conservative.
- Frozen real-world benchmark predictions and source separation remain unchanged.

### Quantitative calibration

Compare generated worlds with real-region distributions rather than matching individual maps:

- peak and percentile elevation;
- central relief and slope distribution;
- mountain-belt width, continuity, orientation, and segmentation;
- hypsometry and coastline-adjacent elevation;
- drainage density and river orientation;
- lake area and size distribution;
- climate/rain-shadow contrast across major belts.

### Required visual review for every round

1. Make one understandable model change.
2. Run focused tectonic, terrain, hydrology, and frozen-boundary checks.
3. Generate a recorded seed and URL at true physical scale.
4. Capture at least one parent-world screenshot and one representative regional crop when the change affects both scales.
5. Identify the closest real-world analogue and explain the comparison.
6. Evaluate tectonic cause, range form, drainage, climate/ecology response, and historical transport/occupation plausibility.
7. Record artifacts and adjust underlying causes rather than visually hiding them.
8. Rotate seeds between rounds while periodically returning to an anchor seed for regression comparison.

The anchor for the first comparison is seed `431970387`, whose current parent exhibits overly smooth ribbon ranges. It is a regression reference, not a target to hand-tune.

## Delivery phases

### Phase 1: tectonic graph and debug view

Generate padded plates, crust types, velocities, boundary classifications, polarity, and episode metadata. Display them in a debug map without changing elevation. Acceptance requires readable tectonic stories and correct boundary semantics across several seeds.

### Phase 2: tectonic elevation foundation

Replace legacy range uplift with deformation-driven crustal response. Preserve existing downstream interfaces and run hydrology against the new surface. Keep secondary geology modifiers conservative.

### Phase 3: geological age, erosion, and sediment

Differentiate old and active terrain, add bounded incision/relaxation, and form supporting foothills and basins. Confirm drainage and climate respond to the new terrain rather than to visual-only fields.

### Phase 4: calibration and removal of the legacy path

Compare distributions and screenshots across multiple seeds and real analogues. Remove the code-only legacy comparison path after the tectonic generator meets the acceptance criteria.

## Acceptance criteria

- Major mountain systems can be traced to visible plate interactions or inherited tectonic history.
- The debug view and inspector explain why a mountain, trench, rift, basin, or volcanic arc exists.
- Subduction, continental collision, rifting, and transform settings have recognizably different landform signatures.
- Belts have variable width, relief, segmentation, asymmetry, branches, and natural terminations.
- Parent edges and crop edges do not prescribe plate boundaries or mountain placement.
- Generated terrain remains deterministic, finite, and compatible with hydrology, climate, ecology, human geography, and later local-level extraction.
- Focused tests, frozen-data separation checks, and browser generation pass.
- The screenshot/analogue review finds the worlds causally coherent and broadly comparable to natural regions without hand-tuning one seed.
