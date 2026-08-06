#!/usr/bin/env python3
"""Populate recon/assessment.json from the Layer 1-8 observation pass."""
import json, pathlib

P = pathlib.Path("recon/assessment.json")
d = json.loads(P.read_text())
a = d["preSpecAssessment"]

a["objectClass"].update({
    "primaryType": "spacecraft (wide delta/manta-planform starship, side elevation)",
    "primaryDomain": "object",
    "formLanguage": [
        "hard-surface geometric, chiselled planar facets",
        "flattened swept-delta planform with a long tapering tail blade",
        "one organic exception: bulging ventral bladder pods",
    ],
    "structureKind": [
        "plated monocoque hull spine",
        "thin lofted wing blades (fore) and tail blade (aft)",
        "slung ventral payload cluster on pylons",
        "pivoting dorsal mast fin",
        "recessed stern drive bay",
    ],
    "motionPotential": [
        "dorsal mast fin folds aft about a lateral axis (twin gold pivot bosses observed)",
        "ventral pod cluster is strap-mounted and reads as jettisonable/detachable",
        "stern louvre vanes read as a rotatable radiator array",
    ],
    "materialFamilies": [
        "matte painted composite hull (cream)",
        "satin painted bladder pods (saturated yellow)",
        "bare cool-grey machined metal fittings",
        "flat accent enamels (blue / red / gold)",
    ],
    "notes": (
        "OBSERVED: the reference is a digital ink-and-flat-fill illustration (cel/toon), not a "
        "photograph. Hard near-black contour lines bound both the outer silhouette and interior "
        "part boundaries; colour regions are flat with 2-3 discrete value steps and no continuous "
        "specular falloff. INFERENCE: matching this reference therefore means matching a stylised "
        "rendering mode (toon ramp + inverted-hull outline), not PBR realism. A physically-lit PBR "
        "render would score poorly against this reference no matter how correct the geometry is."
    ),
})

a["complexity"]["tier"] = "complex"
a["complexity"]["scores"].update({
    "silhouetteComplexity": 7,
    "componentCount": 7,
    "hierarchyDepth": 3,
    "repetitionDensity": 7,
    "materialLayerCount": 6,
    "localDetailDensity": 7,
    "occlusionRisk": 8,
    "actionReadinessNeed": 6,
})
a["complexity"]["estimatedCounts"].update({
    "macroComponents": 7,
    "mesoComponents": 26,
    "microFeatureGroups": 9,
    "materialLayers": 6,
    "repetitionSystems": 5,
})
a["complexity"]["reasoning"] = [
    "7 macro assemblies: forward wing, ventral keel fin, hull spine, dorsal mast fin, "
    "ventral pod cluster, stern drive bay, aft tail blade.",
    "5 real repetition systems: dorsal deck plates (~8), stern louvre vanes (~10 in chevron), "
    "bladder pods (6-8), pod banding straps (~2 per pod), mast-base louvre vents (2 banks).",
    "occlusionRisk 8 is the dominant risk: this is a single near-side elevation. Planform "
    "(top-down wing chord and sweep) is NOT observable and must be inferred.",
    "actionReadinessNeed 6: the mast pivot bosses and pod straps are drawn as real mechanisms, "
    "so the hierarchy must expose those pivots rather than welding everything into one mesh.",
]

a["specDepthDecision"].update({
    "requiredDepth": "complex",
    "minimumComponentLevels": ["macro", "meso", "micro"],
    "needsRepetitionSystems": True,
    "needsMaterialLocalOverrides": True,
    "needsMultipleReviewViews": True,
    "needsActionReadyHierarchy": True,
    "rationale": (
        "Complex, not ultra-complex: component count and repetition density are high, but the "
        "form is planar-dominant and the palette is a limited 6-colour flat scheme with no "
        "patterned finish requiring projection. Three levels are required because the mast fin "
        "and pod cluster each have real sub-assemblies (machinery box, ladder rack, pivot bosses; "
        "pods, straps, manifold) that a two-level tree would collapse into slabs."
    ),
})

a["unknownsToResolveBeforeImplementation"] = [
    {"id": "planform-unknown", "question":
        "Top-down planform is not observable from this single side elevation. Wing chord, sweep "
        "angle and hull width are inferred, not measured.",
     "impact": "high", "resolution": "assume-and-label",
     "assumption": "Wing chord ~28% of span; leading edge swept forward ~18deg on the forward "
                   "wing, aft blade swept back ~12deg; hull spine width ~9% of span."},
    {"id": "starboard-hidden", "question": "Only the port flank is visible.",
     "impact": "medium", "resolution": "mirror",
     "assumption": "Bilateral symmetry about the fore-aft vertical plane."},
    {"id": "pod-count", "question": "6 bladder pods are clearly legible; 1-2 more may be occluded.",
     "impact": "medium", "resolution": "assume-and-label", "assumption": "7 pods per side bank."},
    {"id": "bow-dome-function", "question":
        "The small dark dome at the bow is either a crewed canopy or a sensor blister.",
     "impact": "low", "resolution": "assume-and-label",
     "assumption": "Model as a tinted sensor/canopy blister; geometry is identical either way."},
    {"id": "nozzle-multiplicity", "question":
        "One triangular nozzle is visible at the stern bay apex; a mirrored starboard nozzle is "
        "plausible but not observable.",
     "impact": "low", "resolution": "mirror", "assumption": "One nozzle per side."},
    {"id": "absolute-scale", "question": "No human or known object in frame.",
     "impact": "low", "resolution": "assume-and-label",
     "assumption": "Model in normalised units, span = 10.0."},
    {"id": "hull-underside", "question":
        "The hull underside between the pods is occluded by the pod cluster.",
     "impact": "low", "resolution": "assume-and-label",
     "assumption": "Flat plated ventral deck continuing the flank facet."},
]

DETAILS = [
    ("d01", "contour", "ink contour outline on outer silhouette and interior part boundaries",
     [0.05, 0.05, 0.95, 0.95], "global", "macro", "recon/crops/bow.png", 0.97,
     "component.localFeatures:outline-shell"),
    ("d02", "linework", "engraved dark panel-line network across dorsal deck and wing skins",
     [0.10, 0.40, 0.95, 0.60], "hull-skin", "meso", "recon/crops/wingtip.png", 0.93,
     "material.localOverrides:panel-line-seams"),
    ("d03", "stain", "irregular yellow weathering/discolour patches on cream hull plating",
     [0.15, 0.42, 0.75, 0.58], "hull-skin", "meso", "recon/crops/midfin.png", 0.88,
     "material.localOverrides:hull-yellow-staining"),
    ("d04", "fastener", "rivet/fastener dot rows along wing spar and hull flank rails",
     [0.12, 0.46, 0.55, 0.56], "wing-spar", "micro", "recon/crops/bow.png", 0.82,
     "component.localFeatures:spar-rivet-rows"),
    ("d05", "seam", "raised chordwise plate ridges dividing the dorsal deck into ~8 panels",
     [0.30, 0.40, 0.85, 0.52], "dorsal-deck", "meso", "recon/crops/stern.png", 0.91,
     "component.localFeatures:deck-plate-ridges"),
    ("d06", "gloss", "painted white slash highlights on the bladder pod crowns",
     [0.34, 0.55, 0.58, 0.68], "pod-bladders", "micro", "recon/crops/belly.png", 0.86,
     "material.localOverrides:pod-slash-highlights"),
    ("d07", "fastener", "steel banding straps wrapping each bladder pod (~2 per pod)",
     [0.32, 0.54, 0.60, 0.70], "pod-bladders", "meso", "recon/crops/belly.png", 0.94,
     "component.localFeatures:pod-banding-straps"),
    ("d08", "linework", "blue rectangular decal with yellow bar stencil on mid dorsal hull",
     [0.64, 0.44, 0.69, 0.48], "hull-skin", "micro", "recon/crops/midfin.png", 0.90,
     "material.localOverrides:blue-bar-decal"),
    ("d09", "bevel", "chamfered leading edges on both wing blades and the mast fin",
     [0.10, 0.05, 0.98, 0.60], "wing-blades", "meso", "recon/crops/wingtip.png", 0.85,
     "component.localFeatures:leading-edge-chamfer"),
    ("d10", "linework", "chevron louvre vane array in the stern drive bay (~10 vanes)",
     [0.70, 0.48, 0.80, 0.58], "stern-bay", "meso", "recon/crops/stern.png", 0.95,
     "component.localFeatures:radiator-vane-array"),
    ("d11", "linework", "concentric red/blue/orange banding on the triangular stern nozzle",
     [0.755, 0.495, 0.80, 0.545], "stern-nozzle", "meso", "recon/crops/stern.png", 0.96,
     "material.localOverrides:nozzle-concentric-bands"),
    ("d12", "fastener", "twin gold pivot bosses at the dorsal mast fin root",
     [0.40, 0.33, 0.44, 0.37], "mast-fin", "meso", "recon/crops/dorsalfin.png", 0.95,
     "component.localFeatures:mast-pivot-bosses"),
    ("d13", "linework", "exposed inner machinery: grey box, yellow ladder-rung rack, teal coolant "
     "strip and red terminal block inside the mast fin shell",
     [0.405, 0.13, 0.435, 0.34], "mast-fin", "meso", "recon/crops/dorsalfin.png", 0.92,
     "component.localFeatures:mast-inner-machinery"),
    ("d14", "linework", "yellow louvre vent banks flanking the mast base housing",
     [0.38, 0.36, 0.46, 0.40], "mast-base", "micro", "recon/crops/dorsalfin.png", 0.88,
     "component.localFeatures:mast-base-vents"),
    ("d15", "seam", "diamond-shaped hatch panel on the faceted mast base housing",
     [0.395, 0.355, 0.43, 0.395], "mast-base", "micro", "recon/crops/dorsalfin.png", 0.87,
     "component.localFeatures:mast-base-diamond-hatch"),
    ("d16", "linework", "plumbing manifold above the pods: red segment, blue collars, white segment",
     [0.44, 0.47, 0.56, 0.53], "pod-manifold", "meso", "recon/crops/belly.png", 0.90,
     "component.localFeatures:manifold-collar-bands"),
    ("d17", "gloss", "circular port with red interior and blue rim set among the pods",
     [0.455, 0.53, 0.49, 0.60], "pod-manifold", "micro", "recon/crops/belly.png", 0.89,
     "component.localFeatures:manifold-round-port"),
    ("d18", "stain", "speckle/dirt dot scatter across the cream dorsal plating",
     [0.20, 0.42, 0.80, 0.56], "hull-skin", "micro", "recon/crops/midfin.png", 0.80,
     "material.localOverrides:hull-speckle"),
]
a["detailInventory"].update({
    "scanMethod": "component-zones",
    "targetMinDetails": 10,
    "details": [
        {"id": i, "kind": k, "description": desc, "region": reg, "affects": aff,
         "scale": sc, "evidenceRef": ev, "confidence": cf, "mapsTo": mt}
        for (i, k, desc, reg, aff, sc, ev, cf, mt) in DETAILS
    ],
})

d["qualityContract"]["definitionOfDone"] = [
    "Silhouette from the reference camera reads as the same vehicle: wide forward wing, thick "
    "mid spine, long tapering tail blade, tall dorsal mast fin, slung ventral pod cluster.",
    "Rendering mode is cel/toon with an ink contour outline - matching the reference's medium, "
    "not a PBR interpretation of it.",
    "All 5 repetition systems present as real instanced/array geometry, not painted texture.",
    "Mast fin pivots about its bosses and the pod cluster detaches - action-ready hierarchy.",
    "Every model part is individually clickable and the model explodes along part axes.",
    "Per-region confidence reported for the planform, which the single view cannot show.",
]
d["qualityContract"]["minimumSpecDepth"].update({
    "macroComponents": 7, "mesoComponents": 20, "microFeatureGroups": 8,
    "materialLayers": 6, "repetitionSystems": 5, "reviewViewpoints": 4,
})

FG = [
    ("overall-silhouette", "Manta planform and proportions", [
        "Span:height ratio holds at ~5.5:1 in the reference view.",
        "Forward wing sweeps forward; aft tail blade sweeps back and tapers to a point.",
        "Hull spine is thickest at the pod-cluster station, not at mid-span.",
    ], ["recon/ref.png"], [
        "Symmetric lens shape with equal fore/aft extents - the reference is asymmetric fore-aft.",
        "Tail blade too thick, losing the stingray taper.",
    ]),
    ("dorsal-mast-fin", "Folding dorsal mast fin", [
        "Tall tapered blade, height ~= 0.9x hull-spine local chord.",
        "Outer white shell leaves part to expose grey machinery, yellow ladder rack, teal strip.",
        "Twin gold pivot bosses present at the root, on a lateral axis.",
    ], ["recon/crops/dorsalfin.png"], [
        "Solid white fin with no exposed interior - loses the identity feature.",
        "Fin modelled as a flat plane with no thickness.",
    ]),
    ("ventral-pod-cluster", "Slung yellow bladder pod cluster", [
        "6-8 bulging capsule pods, visibly soft/inflated against the hard hull.",
        "Steel banding straps wrap each pod.",
        "Plumbing manifold with red/blue/white segments runs above the pods.",
    ], ["recon/crops/belly.png"], [
        "Pods modelled as rigid cylinders - the bulge is the identity feature.",
        "Pods flush with the hull instead of slung below on pylons.",
    ]),
    ("stern-drive-bay", "Chevron radiator bay and banded nozzle", [
        "~10 yellow louvre vanes in a chevron/herringbone array inside a recessed bay.",
        "Triangular nozzle with concentric red -> blue -> orange -> dark-core bands.",
        "Blue trim strip along the upper bay edge.",
    ], ["recon/crops/stern.png"], [
        "Round nozzle instead of triangular.",
        "Vanes painted on a flat surface instead of real recessed geometry.",
    ]),
    ("cel-render-style", "Ink-contour cel-shaded rendering", [
        "Near-black contour on the outer silhouette and interior part boundaries.",
        "Flat colour fills with 2-3 discrete value steps, no continuous specular falloff.",
        "Limited palette: cream #f8f4d9, yellow #e9b708, warm grey #7e776d, blue #3153b4, "
        "red #971809, gold #947204.",
    ], ["recon/crops/bow.png", "recon/crops/stern.png"], [
        "Smooth PBR shading with environment reflections - wrong medium.",
        "Outline missing on interior boundaries, present only on the silhouette.",
    ]),
]
d["qualityContract"]["featureGroups"] = [
    {"id": i, "name": n, "required": True, "qualityCriteria": qc,
     "evidenceRefs": er, "failureModes": fm} for (i, n, qc, er, fm) in FG
]
d["qualityContract"]["visualDeltaChecks"] = [
    "Overlay render silhouette on the reference at the solved camera; wing tips and tail tip "
    "must land within 5% of span.",
    "Palette check: sampled render colours must match the 6 reference hexes within dE00 < 12.",
    "Count check: deck plates >= 7, vanes >= 9, pods >= 6, straps >= 10 in the render.",
    "Outline presence: contour visible on interior part boundaries, not only the silhouette.",
]

P.write_text(json.dumps(d, indent=2))
print("assessment filled:",
      len(a["detailInventory"]["details"]), "details,",
      len(d["qualityContract"]["featureGroups"]), "feature groups,",
      len(a["unknownsToResolveBeforeImplementation"]), "unknowns")
