# Constrained local terrain inside Watershed

Approved intent: add real finer-scale terrain and erosion detail inside PR26's inherited shapes, using PR28's existing Explore flow. Do not introduce a second local world, D8 routing, or per-window random seeds. Deploy the update to the existing PR28 preview; do not merge either PR.

The exact original parent triangles remain the base surface. A world-coordinate refinement evaluator adds bounded landform residuals and analytical channel/bank/floodplain cross-sections tied to the actual parent river edges. Secondary dry gullies grow uphill from these inherited reaches by continuous terrain gradients; their carved profiles descend to their parent reach. These are procedural erosion-shaped landforms, not a hydraulic simulation or a new globally solved river graph.

Every vertex retains source-node weights, base elevation, refinement delta and physical/surface elevation. Source arrays and macro drainage are immutable. The original parent centerline graph, endpoints, source IDs and upstream areas remain exact. Finer channel bends are bounded inside that inherited corridor and pin the original junctions. Widths/depths are modeled rather than measured. Existing uphill/ambiguous coarse river reaches remain inherited and are reported, not silently rerouted or made into invented lakes.

The refinement field is independent of window bounds, rendering resolution, window order and camera exaggeration. Neighboring windows sample the same field. Ocean and retained lake surfaces stay protected. Detail strength follows the full parent field at each point, not one center's statistics. Close views (12 km and below) get a bounded render mesh; overview and benchmarks remain unchanged. No street-scale ecology or settlement claims.

The existing viewer receives refined geometry and terrain-aware colors. Explore gets an on/off comparison and an actual-river navigation shortcut. Exports distinguish inherited versus synthesized quantities. Validate numerical invariants, overlap/zoom continuity, channel profiles, real parent seeds, browser appearance at desktop and portrait sizes, and the deployed module.
