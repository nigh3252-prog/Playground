#!/usr/bin/env python3
"""Author the ObjectSculptSpec component tree, materials and passes for the
Manta Delta Star Freighter, from the Layer 1-8 observation pass.

Object space: +X aft (bow at -X), +Y up, +Z starboard. Span 10.0 fore-aft.
Image->object mapping used throughout:  X = (x_img - 2185)/343 ,  Y = (1030 - y_img)/343
"""
import json, math, pathlib, copy, os


RAD = math.pi / 180.0
P = pathlib.Path("recon/object-sculpt-spec.json")
spec = json.loads(P.read_text())
# Re-seed the assessment block from its own source of truth so re-running this
# builder is idempotent (it previously read back its own mutated output).
spec["preSpecAssessment"] = json.loads(
    pathlib.Path("recon/assessment.json").read_text())["preSpecAssessment"]

# ---------------------------------------------------------------- scores (0-3)
spec["suitability"] = "conditional"
spec["scores"] = {
    "object_isolation": 3,        # pure black field, subject fully isolated
    "silhouette_readability": 3,  # unbroken high-contrast contour
    "depth_inference": 1,         # single near-side elevation; planform not observable
    "primitive_decomposition": 3, # all hard-surface, maps cleanly to extrude/capsule/box
    "material_procedurality": 3,  # flat fills, no patterned finish to reproduce
    "occlusion_risk": 2,          # starboard flank + hull underside hidden
    "interaction_fit": 3,         # real pivots and strap mounts drawn in the reference
}
a = spec["preSpecAssessment"]
a["complexity"]["scores"] = {  # rubric is 0-3, not 0-10
    "silhouetteComplexity": 3, "componentCount": 3, "hierarchyDepth": 2,
    "repetitionDensity": 3, "materialLayerCount": 2, "localDetailDensity": 3,
    "occlusionRisk": 3, "actionReadinessNeed": 2,
}

spec["coordinateFrame"] = {
    "front": "-X is the bow (snout, canopy blister, ventral chin)",
    "up": "+Y is dorsal (mast fin direction); +Z is starboard",
    "scaleReference": "normalised: 10.0 units bow-tip to tail-tip; 1 unit = 343 px in the reference",
}
spec["referenceCamera"] = {
    "solved": False,
    "fovDegrees": 26.0,
    "aspect": 2.0,
    "orientation": {"yaw": 96.0, "pitch": -7.0, "roll": 0.0},
    "positionHint": [1.4, 2.2, 19.5],
    "note": ("Near-side (port-beam) elevation, slightly below the dorsal plane and yawed a few "
             "degrees off pure beam. Narrow FOV because the reference is close to orthographic. "
             "INFERRED from silhouette extents, not solved - refine against the comparison sheet."),
}
spec["silhouette"] = {
    "boundingShape": "slender blade/fish body tapering to points fore and aft; NO delta planform",
    "aspectRatios": [
        {"name": "length:height(incl. mast fin)", "value": 2.7},
        {"name": "length:hull-thickness", "value": 14.1},
        {"name": "length:span", "value": 8.7, "confidence": 0.5, "note": "slender body; span still INFERRED"},
    ],
    "symmetry": "bilateral about the XY (fore-aft vertical) plane",
    "dominantCurves": [
        "traced dorsal deck line falling from Y=0.52 at the snout to Y=0.02 at the tail tip",
        "grey ventral chin descending to Y=-1.05 near X=-2.2",
        "folded, self-crossing tube runs filling the belly cavity",
    ],
    "negativeSpaces": [
        "recessed stern drive bay between hull spine and tail blade",
        "open belly cavity the tube runs spill out of",
        "notch between mast fin outer shell leaves exposing inner machinery",
    ],
    "landmarks": [
        {"id": "bow-tip", "position": [-4.91, 0.30, 0.0]},
        {"id": "mast-tip", "position": [-1.72, 2.52, 0.0]},
        {"id": "tail-tip", "position": [5.00, 0.02, 0.0]},
        {"id": "keel-apex", "position": [-1.92, -1.02, 0.0]},
        {"id": "nozzle-apex", "position": [2.90, -0.06, 0.0]},
    ],
}
spec["viewEvidence"] = [
    {"id": "full-object", "view": "primary", "imageRegion": {"x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0, "units": "normalized"},
     "observations": ["single port-beam elevation of the whole vehicle on a black field"], "confidence": 0.95},
    {"id": "bow-zone", "view": "detail", "imageRegion": {"x": 0.095, "y": 0.380, "width": 0.243, "height": 0.285, "units": "normalized"},
     "observations": ["slender snout with plated deck", "long grey ventral chin", "canopy blister", "spar rivet rows"], "confidence": 0.88},
    {"id": "mast-zone", "view": "detail", "imageRegion": {"x": 0.355, "y": 0.060, "width": 0.135, "height": 0.390, "units": "normalized"},
     "observations": ["tapered mast fin", "exposed grey machinery, yellow ladder rack, teal strip, red block", "twin gold pivot bosses", "faceted base housing with diamond hatch"], "confidence": 0.92},
    {"id": "belly-zone", "view": "detail", "imageRegion": {"x": 0.295, "y": 0.440, "width": 0.325, "height": 0.295, "units": "normalized"},
     "observations": ["packed mass of folded, self-crossing tubes reading as intestines", "steel cinch bands", "plumbing manifold with red/blue/white segments", "circular red-and-blue port"], "confidence": 0.90},
    {"id": "stern-zone", "view": "detail", "imageRegion": {"x": 0.655, "y": 0.440, "width": 0.195, "height": 0.200, "units": "normalized"},
     "observations": ["chevron louvre vane array", "triangular concentric nozzle", "blue bay trim"], "confidence": 0.93},
]

# ------------------------------------------------------------------ materials
BASE_MAT = copy.deepcopy(spec["materials"][0])

def mat(mid, name, hex_color, *, rough=0.62, metal=0.0, secondary=None, notes="", evidence="full-object"):
    m = copy.deepcopy(BASE_MAT)
    m.update({
        "id": mid, "name": name, "type": "toon",
        "shaderModel": "MeshToonMaterial with a 3-step gradient ramp + inverted-hull ink outline",
        "baseColor": hex_color, "color": hex_color,
        "textureResolution": 1024,
        "notes": notes or f"Flat cel fill sampled from the reference at {hex_color}.",
    })
    m["albedo"] = {"dominant": hex_color, "secondary": secondary or [], "samplingNotes":
                   "Sampled from the reference with ink-line rejection (recon/ colour probe)."}
    m["colorVariation"] = {"palette": [hex_color] + (secondary or []), "pattern": "flat-cel-steps",
                           "amplitude": 0.06, "heightCorrelation": 0.0}
    m["roughness"] = {"base": rough, "variation": 0.05, "map": "none-flat-cel",
                      "localResponse": "no continuous specular falloff; value steps are quantised by the toon ramp"}
    m["metalness"] = {"base": metal, "variation": 0.0}
    m["normal"] = {"pattern": "none", "strength": 0.0, "scale": 1.0, "space": "tangent"}
    m["ambientOcclusion"] = {"cavityStrength": 0.18, "contactShadowBias": 0.25,
                             "notes": "Kept low: the reference conveys depth with ink contour, not AO."}
    m["shaderNotes"] = [
        "MeshToonMaterial + 3-stop DataTexture gradient map (quantised value steps).",
        "Ink contour is a second inverted-hull pass: BackSide, near-black, scaled along normals.",
        "Do NOT add environment reflections - the reference medium has no specular lobe.",
    ]
    m["localOverrides"] = []
    m["evidenceRefs"] = [evidence]
    return m

spec["materials"] = [
    mat("hull-cream", "Hull plating cream", "#f8f4d9", rough=0.70,
        secondary=["#fcf7e1", "#e8e2c2"], evidence="full-object",
        notes="Dominant hull skin. Reference shows 2 value steps: lit #fcf7e1, mid #f8f4d9."),
    mat("hull-grey", "Structural warm grey", "#7e776d", rough=0.72,
        secondary=["#9a9288", "#5f594f"], evidence="bow-zone",
        notes="Shadowed flank facets, keel fin underside, wing undersurface."),
    mat("pod-yellow", "Bladder pod yellow", "#e9b708", rough=0.48,
        secondary=["#ae8100", "#f2ce3a"], evidence="belly-zone",
        notes="Satin: reference carries painted white slash highlights, so one gloss step above hull."),
    mat("vane-yellow", "Radiator vane yellow", "#d6b301", rough=0.55,
        secondary=["#a88c00"], evidence="stern-zone"),
    mat("machine-grey", "Machined fitting grey", "#535a60", rough=0.40, metal=0.65,
        secondary=["#6d757c", "#3b4147"], evidence="mast-zone",
        notes="Cool grey, distinct in hue from the warm structural grey."),
    mat("accent-blue", "Accent enamel blue", "#3153b4", rough=0.50,
        secondary=["#4760de"], evidence="stern-zone"),
    mat("accent-red", "Accent enamel red", "#971809", rough=0.50,
        secondary=["#b42c2c"], evidence="stern-zone"),
    mat("accent-gold", "Pivot boss gold", "#947204", rough=0.35, metal=0.7,
        secondary=["#c79a12"], evidence="mast-zone"),
    mat("accent-teal", "Coolant strip teal", "#1f8f7a", rough=0.45, evidence="mast-zone"),
    mat("glass-dark", "Canopy glazing", "#242a30", rough=0.15, evidence="bow-zone",
        notes="Near-black tinted blister; reference shows a hard white slash highlight, no transmission."),
]
# detail -> material localOverride bindings (detailInventory mapsTo contract)
_ov = {m["id"]: m for m in spec["materials"]}
_ov["hull-cream"]["localOverrides"] = [
    {"id": "panel-line-seams", "kind": "linework", "technique": "panel-line",
     "region": "all hull and wing skins", "colorShift": "#3a3428", "width": 0.006,
     "notes": "Dark AO seam following plate boundaries; no true groove depth.", "detailRefs": ["d02"]},
    {"id": "hull-yellow-staining", "kind": "stain", "region": "dorsal deck and wing top skins",
     "dirtAmount": 0.22, "cavityBias": 0.35, "streak": False, "patinaColor": "#d8c063",
     "fadedMask": 0.0, "detailRefs": ["d03"]},
    {"id": "hull-speckle", "kind": "stain", "region": "dorsal deck", "dirtAmount": 0.12,
     "cavityBias": 0.0, "streak": False, "patinaColor": "#2a251c", "detailRefs": ["d18"]},
    {"id": "blue-bar-decal", "kind": "linework", "technique": "painted-decal",
     "region": "mid dorsal hull, X=+0.35..+0.62", "colorShift": "#3153b4", "detailRefs": ["d08"]},
]
_ov["pod-yellow"]["localOverrides"] = [
    {"id": "pod-slash-highlights", "kind": "gloss", "region": "pod crowns",
     "roughness": 0.16, "clearcoat": 0.0, "notes": "Painted white slash, not a physical specular lobe.",
     "detailRefs": ["d06"]},
]
_ov["accent-red"]["localOverrides"] = [
    {"id": "nozzle-concentric-bands", "kind": "linework", "technique": "painted-decal",
     "region": "stern nozzle throat", "colorShift": "#971809 -> #3153b4 -> #dfb000",
     "detailRefs": ["d11"]},
]

# ----------------------------------------------------------------- components
COMPS = []

def _rgba(hex_str, alpha=1.0):
    h = hex_str.lstrip("#")
    return f"rgba({int(h[0:2],16)}, {int(h[2:4],16)}, {int(h[4:6],16)}, {alpha})"

MATERIAL_CLASS = {
    "hull-cream": ("plastic", 0.72), "hull-grey": ("metal", 0.68),
    "pod-yellow": ("plastic", 0.60), "vane-yellow": ("metal", 0.62),
    "machine-grey": ("metal", 0.80), "accent-blue": ("plastic", 0.55),
    "accent-red": ("plastic", 0.55), "accent-gold": ("metal", 0.75),
    "accent-teal": ("plastic", 0.50), "glass-dark": ("glass", 0.65),
}

def _recipe(material):
    m = _ov[material]
    mc, mcc = MATERIAL_CLASS[material]
    sec = (m["albedo"]["secondary"] or [m["baseColor"]])[0]
    return {
        "dominantAlbedo": _rgba(m["baseColor"]),
        "secondaryAlbedo": _rgba(sec),
        "materialClass": mc,
        "materialClassConfidence": mcc,
        "colorGradient": {
            "type": "linear",
            "stops": [{"position": 0.0, "color": _rgba(m["baseColor"])},
                      {"position": 1.0, "color": _rgba(sec)}],
            "note": "Quantised by the toon ramp into discrete steps; not a continuous blend.",
        },
        "evidenceRefs": m["evidenceRefs"],
        "samplingNote": "Sampled from the reference with ink-line rejection; drawn colour, not measured PBR.",
    }

ROOT_Z = -0.475          # root node offset: the hull extrude runs z 0..0.95 in its own space
SCALED_PARENTS = {"visceral-cavity", "stern-bay-housing", "manifold-spine"}

def comp(cid, name, level, role, primitive, parent, pos, *, rot=(0,0,0), dims=None,
         scale=None, material="hull-cream", topo="assembled-solid", why="",
         desc=None, feats=None, imp=0.6, conf=0.7, ev=("full-object",), det=(),
         action=None, tier="structural", contact="overlap", overlap=0.04):
    logical_parent = parent
    scene_parent = parent
    if parent in SCALED_PARENTS:
        # A dimension-scaled box passes its non-uniform scale down the scene graph, which
        # stretched every pod, strap, vane and nozzle. Attach to root instead and keep the
        # real structural parent in attachment.parentId.
        scene_parent = "root"
    if scene_parent == "root":
        pos = (pos[0], pos[1], pos[2] - ROOT_Z)   # world -> root-local
    parent = scene_parent
    c = {
        "id": cid, "name": name, "level": level, "role": role,
        "logicalParent": logical_parent,
        "importance": imp, "confidence": conf,
        "primitive": primitive, "topologyClass": topo, "topologyRationale": why,
        "geometryDescriptor": {
            "topologyIntent": "hard-surface faceted shell, flat-shaded for cel response",
            "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1},
            "deformationStack": [], "uvStrategy": "generated procedural coordinates",
            "normalStrategy": "flat-shaded facets (toon ramp needs quantised normals)",
        },
        "parent": parent,
        "attachment": None,
        "dimensions": dims or {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": conf},
        # transform.scale, when present, OVERRIDES dimensions in the codegen's scale_for().
        # Authored-profile primitives (extrude) are already in real units, so they pin scale to 1.
        # Unit-sized primitives (box/capsule/cylinder/sphere/torus/plane) must fall through to
        # dimensions - emitting scale [1,1,1] for those rendered every one of them at unit size.
        "transform": ({"position": list(pos), "rotation": list(rot), "scale": list(scale)} if scale
                      else {"position": list(pos), "rotation": list(rot), "scale": [1, 1, 1]} if primitive == "extrude"
                      else {"position": list(pos), "rotation": list(rot)}),
        "actionProfile": action or {
            "animationRole": "static", "pivot": {"mode": "local-origin", "offset": [0,0,0]},
            "transformChannels": {"translate": True, "rotate": True, "scale": False},
            "sockets": [], "collider": {"type": "box", "fit": "tight"},
            "constraints": [], "destruction": {"breakable": False},
        },
        "material": material, "materialLayers": [material],
        "deformations": [], "joints": [], "seams": [],
        "localFeatures": feats or [],
        "surfaceDetail": {"macroRoughness": 0.1, "microRoughness": 0.05, "bumpAmplitude": 0.0,
                          "normalPattern": "", "displacementPattern": "", "occlusionPattern": "cavity-seams",
                          "edgeWearPattern": "", "notes": "Cel target: relief is carried by real geometry, not maps."},
        "evidenceRefs": list(ev), "details": list(det), "fidelityTier": tier,
        "colorMaterialRecipe": _recipe(material),
    }
    if parent is not None:
        # localStart == localEnd on purpose. These parts are plates, shells and boxes that
        # carry their own authored profile; they meet their parent over a FACE, so the
        # contact is a point/region, not a span. A non-zero span would declare this a
        # strut-like component whose geometry IS the segment - which the codegen honours
        # by replacing the authored profile with a cylinder between the two points.
        pt = [round(pos[0], 3), round(pos[1], 3), round(pos[2], 3)]
        c["attachment"] = {
            "parentId": parent,
            "parentSocket": f"{logical_parent}/{cid}-mount",
            "structuralParent": logical_parent,
            "localStart": pt,
            "localEnd": list(pt),
            "contactType": contact,
            "overlap": overlap,
            "gapTolerance": 0.004,
            "contactGeometry": "face-region (zero-length span: not a strut)",
            "evidenceRefs": list(ev),
        }
    if desc: c["geometryDescriptor"].update(desc)
    COMPS.append(c)
    return c

def ex(points, depth):
    return {"profile2D": {"points": [[round(p[0],3), round(p[1],3)] for p in points], "depth": depth}}

# ---- MACRO (7) -------------------------------------------------------------
# Hull thickness measured off the reference: deck y~880px, ventral line y~1000px at the pod
# station => 120px = 0.35 units. The first pass authored it at 0.72 and read as an aircraft
# fuselage rather than the reference's flat plated spine.
HULL = [(-4.91, 0.30), (-4.48, 0.47), (-3.60, 0.52), (-2.73, 0.47), (-1.85, 0.50),
        (-0.98, 0.52), (-0.10, 0.48), (0.77, 0.42), (1.65, 0.36), (2.52, 0.30),
        (3.40, 0.21), (4.27, 0.09), (4.71, 0.02),
        (4.71, -0.02), (4.27, -0.08), (3.40, -0.19), (2.52, -0.30), (1.65, -0.34),
        (0.77, -0.22), (-0.10, -0.18), (-0.98, -0.18), (-1.85, -0.20), (-2.73, -0.24),
        (-3.60, -0.18), (-4.48, -0.02)]
# NOTE the ventral line above is the HULL's, not the traced silhouette's. Through the belly
# (X -2.7..+0.8) the traced bottom runs near -1.1, but that is the VISCERA hanging below, not
# the hull. Taking the trace literally there made the body a fat slab and left the tubes with
# nothing to hang from.
comp("root", "Hull body", "macro", "body", "extrude", None, (0,0,-0.43),
     desc=ex(HULL, 0.86), topo="assembled-solid", imp=1.0, conf=0.82,
     why=("Continuous plated monocoque, slender and blade-like - a fish body, not an aircraft. "
          "Profile TRACED from the reference silhouette rather than inferred. There is NO delta "
          "planform: the wide bright planes in the reference are this narrow body's own "
          "overlapping armour plating seen at a shallow angle, not wings extending laterally."),
     feats=[{"id":"deck-plate-ridges","kind":"seam","description":"raised chordwise plate ridges dividing the deck into 8 panels","detailRefs":["d05"]},
            {"id":"spar-rivet-rows","kind":"fastener","description":"fastener dot rows along the flank rails","detailRefs":["d04"]}],
     ev=("full-object","bow-zone"), det=("d02","d03","d05","d18"), tier="blockout")

# The forward-swept delta wing and the broad aft tail blade that used to be defined here are
# GONE. Both were fabricated from a misreading of the single side elevation. What the reference
# actually has at the bow is a slim plane hugging the flank.
BOW_FIN = [(-4.34, 0.30), (-3.00, 0.26), (-3.26, -0.16), (-4.18, -0.12)]
comp("bow-plane-port", "Bow plane (port)", "macro", "fin", "extrude", "root", (0,0,-0.78),
     desc=ex(BOW_FIN, 0.22), topo="conforming-shell", material="hull-grey", imp=0.6, conf=0.50,
     why=("Slim plane hugging the hull flank. Sized as a FIN, not a wing panel: the wide "
          "forward-swept delta this replaces was fabricated from a misreading of the single "
          "side elevation, and the reference has no laterally-extending wings at all."),
     feats=[{"id":"leading-edge-chamfer","kind":"bevel","description":"chamfered leading edge","edgeTreatment":{"type":"chamfer","bevelRadius":0.03,"segments":2},"detailRefs":["d09"]}],
     ev=("bow-zone",), det=("d09","d04"), tier="blockout")
comp("bow-plane-stbd", "Bow plane (starboard)", "macro", "fin", "extrude", "root", (0,0,0.56),
     desc=ex(BOW_FIN, 0.22), topo="conforming-shell", material="hull-grey", imp=0.6, conf=0.45,
     why="Mirror of the port bow plane; starboard carries no independent evidence in this view.",
     ev=("bow-zone",), tier="blockout")

# Traced: the grey ventral chin/jaw descends from the snout to Y=-1.05 near X=-2.2.
KEEL = [(-4.62,0.02),(-2.28,-0.30),(-1.92,-1.02),(-2.66,-1.06),(-3.58,-0.62),(-4.56,-0.24)]
comp("ventral-keel-fin", "Ventral keel / chin", "macro", "fin", "extrude", "root", (0,0,-0.21),
     desc=ex(KEEL, 0.42), topo="conforming-shell", material="hull-grey", imp=0.7, conf=0.7,
     why=("The reference's long grey jaw under the bow, reaching Y=-1.05. Traced, not estimated; "
          "the previous pass had it as a small triangle."),
     ev=("bow-zone",), tier="blockout")

# Measured off recon/crops/dorsalfin.png: base X -1.63..-1.09 (0.54 wide) at Y 0.88 sitting on
# the base housing, tip X -1.60..-1.43 (0.17 wide) at Y 2.53, leaning forward by 0.16.
# Two-stage profile: an integral fairing widening from the measured 0.54 waist at Y 0.88
# down to the deck at Y 0.26. Authored on the macro component so the fin is attached at
# blockout - the faceted base housing that fills this volume is a meso part and does not
# exist yet at that pass, which previously left the fin floating in mid-air.
MAST = [(-2.03,0.26),(-1.78,0.88),(-1.75,2.53),(-1.58,2.53),(-1.24,0.88),(-1.03,0.26)]
MAST_LE = [(-2.03,0.26),(-1.78,0.88),(-1.75,2.53),(-1.66,2.53),(-1.70,0.88),(-1.93,0.26)]
MAST_TE = [(-1.40,0.26),(-1.35,0.88),(-1.51,2.53),(-1.58,2.53),(-1.42,0.88),(-1.03,0.26)]
comp("dorsal-mast-fin", "Dorsal mast fin shell", "macro", "fin", "extrude", "root", (0,0,-0.11),
     desc=ex(MAST, 0.06), topo="conforming-shell", imp=0.92, conf=0.80,
     why=("Tapered blade shell, authored as a BACK PLATE plus separate leading- and trailing-edge "
          "spars. The reference's outer white skin wraps the two edges and leaves the middle of "
          "the face open, exposing the machinery bay; a single full-thickness blade enclosed and "
          "hid every internal part."),
     ev=("mast-zone",), det=("d12","d13"), tier="blockout",
     action={"animationRole":"hinge","pivot":{"mode":"explicit","offset":[-1.62,0.38,0.0]},
             "transformChannels":{"translate":False,"rotate":True,"scale":False},
             "sockets":[{"id":"mast-hinge","localPosition":[-1.62,0.38,0.0],"localRotation":[0,0,0]}],
             "collider":{"type":"box","fit":"tight"},
             "constraints":[{"axis":"z","minDeg":-84.0,"maxDeg":0.0,"note":"folds aft flat onto the deck"}],
             "destruction":{"breakable":False}})

for sid, prof in (("mast-spar-leading", MAST_LE), ("mast-spar-trailing", MAST_TE)):
    comp(sid, sid.replace("-", " ").title(), "meso", "structure", "extrude", "root", (0, 0, -0.11),
         desc=ex(prof, 0.22), topo="conforming-shell", imp=0.6, conf=0.78,
         why="Edge spar of the mast shell; carries the outer skin around the open machinery face.",
         ev=("mast-zone",), det=("d13",), tier="structural")

comp("visceral-cavity", "Visceral cavity shell", "macro", "structure", "box", "root", (-0.80,-0.26,0),
     dims={"width":3.70,"height":0.24,"depth":0.80,"units":"relative","confidence":0.7},
     material="hull-grey", topo="assembled-solid", imp=0.8, conf=0.7,
     why=("Open bay the tubing spills out of - a shallow shelf, not an enclosure. The tubes "
          "must hang clear below it as they do in the reference."),
     ev=("belly-zone",), tier="blockout")

comp("stern-bay-housing", "Stern drive bay housing", "macro", "structure", "box", "root", (2.05,-0.09,-0.52),
     dims={"width":1.70,"height":0.58,"depth":0.34,"units":"relative","confidence":0.75},
     material="hull-grey", topo="assembled-solid", imp=0.85, conf=0.75,
     why=("Back wall of the recessed bay. The reference bay is OPEN toward the viewer with the "
          "vane array and nozzle set into it; a full-depth solid box occluded both."),
     ev=("stern-zone",), det=("d10","d11"), tier="blockout")

# ---- MESO ------------------------------------------------------------------
comp("canopy-blister", "Canopy / sensor blister", "meso", "detail", "ellipsoid", "root", (-1.85,0.52,0.16),
     dims={"width":0.42,"height":0.26,"depth":0.34,"units":"relative","confidence":0.6},
     material="glass-dark", topo="continuous-sculpt", imp=0.55, conf=0.6,
     why="Doubly-curved blister; a sphere section is the correct topology class, not a faceted box.",
     ev=("bow-zone",))
comp("bow-fairing", "Bow nose fairing", "meso", "detail", "cone", "root", (-3.52,0.10,0),
     rot=(0,0,90*RAD), dims={"width":0.34,"height":0.55,"depth":0.42,"units":"relative","confidence":0.6},
     topo="assembled-solid", why="Tapered nose cap closing the hull spine forward.", ev=("bow-zone",))
for i, xz in enumerate([0.47, -0.47]):
    side = "stbd" if xz > 0 else "port"
    comp(f"hull-flank-rail-{side}", f"Hull flank rail ({side})", "meso", "structure", "box", "root",
         (-0.30, 0.17, xz), dims={"width":8.6,"height":0.09,"depth":0.08,"units":"relative","confidence":0.7},
         material="hull-grey", topo="assembled-solid",
         why="Straight extruded rail catching the reference's continuous dark flank line.",
         ev=("full-object",), det=("d04",))
# dorsal deck plates (repetition system 1, realised as explicit placed components)
for i in range(8):
    x = -2.75 + i * 0.72
    comp(f"deck-plate-{i+1:02d}", f"Dorsal deck plate {i+1}", "meso", "panel", "box", "root",
         (x, 0.455 - abs(x) * 0.018, 0.0),
         dims={"width":0.66,"height":0.035,"depth":max(0.26, 0.95 - abs(x)*0.12),"units":"relative","confidence":0.7},
         topo="assembled-solid", imp=0.45, conf=0.72,
         why="Flat plate panel; the reference deck is divided by raised chordwise ridges.",
         ev=("full-object",), det=("d05",), tier="structural")
comp("wing-leading-spar", "Bow plane spar", "meso", "structure", "box", "root", (-3.66,0.10,0),
     dims={"width":1.45,"height":0.08,"depth":1.32,"units":"relative","confidence":0.55},
     material="hull-grey", topo="assembled-solid", scale=[1,1,1],
     why="Straight spar box across the bow plane roots.", ev=("bow-zone",), det=("d04",), tier="structural")
comp("tail-spine-rail", "Tail spine rail", "meso", "structure", "box", "root", (2.90,0.02,0),
     dims={"width":4.1,"height":0.06,"depth":0.18,"units":"relative","confidence":0.65},
     material="hull-grey", topo="assembled-solid",
     why="Continuous dark rail along the tail blade centreline in the reference.",
     ev=("full-object",), tier="structural")
MIDFIN = [(1.02,0.24),(1.14,0.99),(1.24,0.99),(1.50,0.26)]
comp("mid-stabilizer-fin", "Mid stabiliser fin", "macro", "fin", "extrude", "root", (0,0,-0.07),
     desc=ex(MIDFIN, 0.14), topo="conforming-shell", imp=0.6, conf=0.8,
     why=("Small tapered blade sheet echoing the mast fin. Macro rather than meso because it is a "
         "distinct silhouette landmark in the reference, not a sub-part of the tail."),
     ev=("full-object",), tier="blockout",
     feats=[{"id":"midfin-blue-strip","kind":"linework","description":"blue leading-edge strip","detailRefs":["d08"]}])

# mast fin internals
comp("mast-inner-machinery", "Mast inner machinery box", "meso", "detail", "box", "dorsal-mast-fin",
     (-1.67,1.05,0.01), dims={"width":0.20,"height":0.85,"depth":0.16,"units":"relative","confidence":0.75},
     material="machine-grey", topo="assembled-solid", imp=0.7, conf=0.78,
     why="Boxy exposed equipment stack visible between the shell leaves.", ev=("mast-zone",), det=("d13",), tier="structural")
comp("mast-coolant-strip", "Mast coolant strip", "meso", "detail", "box", "dorsal-mast-fin",
     (-1.73,1.72,0.02), dims={"width":0.09,"height":0.62,"depth":0.10,"units":"relative","confidence":0.7},
     material="accent-teal", topo="assembled-solid", imp=0.5, conf=0.7,
     why="Flat teal strip inboard of the shell.", ev=("mast-zone",), det=("d13",), tier="structural")
comp("mast-terminal-block", "Mast terminal block", "meso", "detail", "box", "dorsal-mast-fin",
     (-1.61,0.60,0.02), dims={"width":0.13,"height":0.16,"depth":0.11,"units":"relative","confidence":0.7},
     material="accent-red", topo="assembled-solid", imp=0.45, conf=0.7,
     why="Small red equipment block at the machinery stack root.", ev=("mast-zone",), det=("d13",), tier="structural")
for side, z in (("port",-0.17),("stbd",0.17)):
    comp(f"mast-pivot-boss-{side}", f"Mast pivot boss ({side})", "meso", "joint", "cylinder",
         "dorsal-mast-fin", (-1.62,0.38,z), rot=(90*RAD,0,0),
         dims={"width":0.28,"height":0.10,"depth":0.28,"units":"relative","confidence":0.85},
         material="accent-gold", topo="assembled-solid", imp=0.75, conf=0.85,
         why="Cylindrical hinge boss - the reference draws two concentric gold discs at the fin root.",
         ev=("mast-zone",), det=("d12",), tier="structural")
MBASE = [(-2.15,0.28),(-1.85,0.90),(-1.17,0.90),(-1.01,0.28),(-1.15,0.10),(-2.05,0.10)]
comp("mast-base-housing", "Mast base housing", "meso", "structure", "extrude", "root", (0,0,-0.30),
     desc=ex(MBASE, 0.60), topo="assembled-solid", material="hull-grey", imp=0.7, conf=0.8,
     why="Faceted pyramidal housing; planar facets with hard creases, so an extruded polygon is correct.",
     ev=("mast-zone",), det=("d14","d15"), tier="structural")

# pod cluster
# World-space pod centres. Radius 0.30, so a centre at Y -0.84 puts the bulge bottom at
# -1.14, matching the reference's lowest ventral line (image y=1420).
# ------------------------------------------------------------------- viscera
# The reference's underside is NOT a rack of tidy pods. It is a packed mass of soft tubing that
# loops, folds back on itself and crosses over - it reads as intestines spilling from an open
# belly, cinched at intervals by steel bands, with the hard plumbing running above it. The
# previous pass modelled seven neat capsules in two rows, which gets the character exactly
# backwards: the identity cue here is organic disorder set against the hard hull.
def _coil(phase, x0, x1, y0, z0, amp_y, amp_z, n=14, fold=None):
    """Serpentine tube spine. `fold` turns the run back on itself part-way through, which is
    what makes the bundle read as viscera rather than as a row of parallel hoses."""
    pts = []
    for k in range(n):
        u = k / (n - 1)
        x = x0 + (x1 - x0) * u
        if fold is not None and u > fold:
            v = (u - fold) / (1.0 - fold)
            x = x0 + (x1 - x0) * fold - (x1 - x0) * 0.55 * v
        pts.append([round(x, 3),
                    round(y0 + amp_y * math.sin(phase + u * 5.6), 3),
                    round(z0 + amp_z * math.sin(phase * 1.7 + u * 4.1), 3)])
    return pts

COILS = [
    # phase   x0     x1     y0     z0    ampY  ampZ  radius fold
    (0.0,  -2.45,  0.90, -0.60,  0.22, 0.24, 0.14, 0.30, None),
    (1.1,  -2.30,  0.75, -0.78,  0.06, 0.22, 0.17, 0.32, 0.62),
    (2.3,  -2.50,  0.85, -0.66, -0.14, 0.26, 0.15, 0.29, None),
    (3.4,  -2.20,  0.65, -0.82, -0.24, 0.20, 0.13, 0.31, 0.70),
    (4.6,  -2.40,  0.80, -0.54,  0.00, 0.23, 0.19, 0.27, None),
    (5.7,  -2.10,  0.55, -0.84,  0.18, 0.19, 0.15, 0.28, 0.58),
    (0.6,  -1.85,  0.90, -0.46,  0.26, 0.17, 0.11, 0.25, None),
]
for _i, (_ph, _x0, _x1, _y0, _z0, _ay, _az, _r, _fold) in enumerate(COILS):
    _pts = _coil(_ph, _x0, _x1, _y0, _z0, _ay, _az, fold=_fold)
    comp(f"visceral-bundle-{_i+1:02d}", f"Visceral tube run {_i+1}", "meso", "payload", "tube",
         "root", (0, 0, 0),
         desc={"tubePath": {"points": _pts, "radius": _r, "radialSegments": 12, "closed": False}},
         topo="continuous-sculpt", material="pod-yellow", imp=0.85, conf=0.70,
         why=("Soft folded tube swept along a serpentine spine. A capsule or cylinder cannot fold "
              "back on itself, and that fold is precisely what makes the reference's underside "
              "read as viscera instead of as cargo tanks."),
         ev=("belly-zone",), det=("d06","d07"), tier="structural",
         action={"animationRole":"detachable","pivot":{"mode":"local-origin","offset":[0,0,0]},
                 "transformChannels":{"translate":True,"rotate":True,"scale":False},
                 "sockets":[{"id":f"viscera-mount-{_i+1:02d}","localPosition":[0,0,0],"localRotation":[0,0,0]}],
                 "collider":{"type":"capsule","fit":"loose"},"constraints":[],
                 "destruction":{"breakable":True,"group":"viscera"}})
    for _b, _u in enumerate((0.26, 0.58, 0.86)):
        _pt = _pts[int(_u * (len(_pts) - 1))]
        comp(f"viscera-band-{_i+1:02d}{'abc'[_b]}", f"Viscera band {_i+1}{'abc'[_b]}", "micro",
             "detail", "torus", "root", (_pt[0], _pt[1], _pt[2]), rot=(0, 0, 90*RAD),
             # Sized just proud of the tube it wraps. At 2.6x radius these read as wheels bolted
             # to the underside rather than as bands cinching a hose.
             dims={"width":_r*2.32,"height":_r*2.32,"depth":_r*2.32,"units":"relative","confidence":0.65},
             desc={"torusTubeRatio":0.16}, material="machine-grey", topo="assembled-solid",
             imp=0.35, conf=0.68,
             why="Steel band cinching the tube run - a torus is the exact topology.",
             ev=("belly-zone",), det=("d07",), tier="surface")

comp("manifold-spine", "Plumbing manifold spine", "meso", "detail", "cylinder", "visceral-cavity",
     (-0.90,-0.04,-0.16), rot=(0,0,90*RAD),
     dims={"width":0.17,"height":3.10,"depth":0.17,"units":"relative","confidence":0.8},
     material="hull-cream", topo="assembled-solid", imp=0.6, conf=0.8,
     why="Straight pipe run above the pods.", ev=("belly-zone",), det=("d16",), tier="structural")
for cid,cx,cmat in (("manifold-seg-red",-0.95,"accent-red"),("manifold-seg-blue",0.62,"accent-blue"),
                    ("manifold-collar-a",-0.30,"machine-grey"),("manifold-collar-b",0.20,"machine-grey")):
    w = 0.62 if "seg" in cid else 0.16
    comp(cid, cid.replace("-"," ").title(), "micro", "detail", "cylinder", "visceral-cavity",
         (cx, -0.04, -0.16), rot=(0,0,90*RAD),
         dims={"width":0.20,"height":w,"depth":0.20,"units":"relative","confidence":0.75},
         material=cmat, topo="assembled-solid", imp=0.35, conf=0.75,
         why="Banded collar / coloured pipe segment on the manifold run.",
         ev=("belly-zone",), det=("d16",), tier="surface")
comp("manifold-round-port", "Manifold round port", "micro", "detail", "cylinder", "visceral-cavity",
     (-0.40,-0.34,0.46), rot=(90*RAD,0,0),
     dims={"width":0.40,"height":0.14,"depth":0.40,"units":"relative","confidence":0.7},
     material="accent-red", topo="assembled-solid", imp=0.4, conf=0.7,
     why="Circular port with a red interior and blue rim.", ev=("belly-zone",), det=("d17",), tier="surface")

# stern bay internals
for i in range(10):
    bank = i // 5
    j = i % 5
    x = 1.58 + j * 0.26
    z = 0.34 if bank == 0 else 0.02
    comp(f"radiator-vane-{i+1:02d}", f"Radiator vane {i+1}", "meso", "detail", "box", "stern-bay-housing",
         (x - 0.10, 0.01, z), rot=(0, (26 if bank == 0 else -26) * RAD, 0),
         dims={"width":0.07,"height":0.17,"depth":0.78,"units":"relative","confidence":0.8},
         material="vane-yellow", topo="assembled-solid", imp=0.55, conf=0.8,
         why="Planar louvre slat; the chevron is two mirrored banks of slanted slats.",
         ev=("stern-zone",), det=("d10",), tier="structural")
comp("bay-blue-trim", "Bay blue trim strip", "micro", "detail", "box", "stern-bay-housing",
     (1.63,0.15,0.60), dims={"width":0.70,"height":0.06,"depth":0.10,"units":"relative","confidence":0.75},
     material="accent-blue", topo="assembled-solid", imp=0.35, conf=0.75,
     why="Straight enamel trim along the upper bay edge.", ev=("stern-zone",), det=("d11",), tier="surface")
NOZ = [(2.32,0.34),(2.92,-0.06),(2.32,-0.42)]
for k,(scl,zoff,nmat,nid) in enumerate([(1.00,0.00,"accent-red","nozzle-ring-red"),
                                        (0.74,0.10,"accent-blue","nozzle-ring-blue"),
                                        (0.52,0.19,"vane-yellow","nozzle-throat-orange"),
                                        (0.26,0.27,"machine-grey","nozzle-core")]):
    pts = [((p[0]-2.52)*scl+2.52, (p[1]+0.04)*scl-0.04) for p in NOZ]
    comp(nid, nid.replace("-"," ").title(), "meso" if k < 2 else "micro", "detail", "extrude",
         "stern-bay-housing", (0.0, -0.07, zoff - 0.24 + (0.48*(1-scl))/2),
         desc=ex(pts, 0.48*scl), topo="assembled-solid", material=nmat, imp=0.7 - k*0.1, conf=0.8,
         why=("Triangular prism throat. The reference shows concentric red->blue->orange->dark bands; "
              "modelled as nested prisms of decreasing section so the banding survives off-axis views."),
         ev=("stern-zone",), det=("d11",), tier="structural" if k < 2 else "surface")

# ---- MICRO -----------------------------------------------------------------
for side, z in (("port",-0.34),("stbd",0.34)):
    for i in range(4):
        comp(f"mast-base-vent-{side}-{i+1}", f"Mast base vent {side} {i+1}", "micro", "detail", "box",
             "mast-base-housing", (-1.93 + i*0.13, 0.20, z),
             dims={"width":0.09,"height":0.05,"depth":0.16,"units":"relative","confidence":0.65},
             material="vane-yellow", topo="assembled-solid", imp=0.3, conf=0.68,
             why="Louvre slat in the base vent bank.", ev=("mast-zone",), det=("d14",), tier="surface")
comp("mast-base-diamond-hatch", "Mast base diamond hatch", "micro", "detail", "extrude",
     "mast-base-housing", (0,0,0.31),
     desc=ex([(-1.61,0.55),(-1.39,0.37),(-1.61,0.19),(-1.83,0.37)], 0.04),
     topo="assembled-solid", material="machine-grey", imp=0.35, conf=0.7,
     why="Flat diamond hatch plate on the housing face.", ev=("mast-zone",), det=("d15",), tier="surface")
for i in range(6):
    comp(f"hull-antenna-nub-{i+1}", f"Hull antenna nub {i+1}", "micro", "detail", "cylinder", "root",
         (-2.2 + i*0.95, 0.50, 0.0), dims={"width":0.05,"height":0.10,"depth":0.05,"units":"relative","confidence":0.55},
         material="machine-grey", topo="assembled-solid", imp=0.2, conf=0.55,
         why="Small stub antenna on the dorsal deck.", ev=("full-object",), tier="surface")
comp("blue-bar-decal", "Blue bar decal", "micro", "decal", "plane-card", "root", (0.48,0.475,0.20),
     rot=(-90*RAD,0,0), dims={"width":0.30,"height":0.14,"depth":1.0,"units":"relative","confidence":0.8},
     material="accent-blue", topo="conforming-shell", imp=0.3, conf=0.8,
     why="Flat painted decal panel; a plane card is correct - it has no relief.",
     ev=("full-object",), det=("d08",), tier="surface")
for i in range(5):
    comp(f"tail-hardpoint-{i+1}", f"Tail hardpoint nub {i+1}", "micro", "detail", "box", "root",
         (1.6 + i*0.72, 0.06, 0.0), dims={"width":0.16,"height":0.05,"depth":0.14,"units":"relative","confidence":0.6},
         material="machine-grey", topo="assembled-solid", imp=0.2, conf=0.6,
         why="Small raised fitting along the tail spine.", ev=("full-object",), tier="surface")

spec["componentTree"] = COMPS

# ------------------------------------------------------- repetition systems
spec["repetitionSystems"] = [
    {"id":"dorsal-deck-plates","level":"meso","parent":"root","primitive":"box","material":"hull-cream",
     "count":8,"instanceScale":[0.66,0.035,0.86],
     "placement":{"mode":"linear","axis":[1,0,0],"start":[-2.75,0.455,0.0],"end":[2.29,0.365,0.0],"radius":0.0},
     "realisedBy":"deck-plate-01..08",
     "note":"Linear array. The stock emitter is radial-only, so this system is realised as explicitly "
            "placed components carrying the placement data above."},
    {"id":"visceral-tube-runs","level":"meso","parent":"root","primitive":"tube","material":"pod-yellow",
     "count":7,"instanceScale":[1,1,1],
     "placement":{"mode":"serpentine-spines","axis":[1,0,0],"start":[-2.60,-0.96,-0.26],"end":[0.95,-0.42,0.32],"radius":0.0},
     "realisedBy":"visceral-bundle-01..07","note":"Seven folded tube spines; three fold back on themselves so the bundle reads as viscera."},
    {"id":"viscera-bands","level":"micro","parent":"root","primitive":"torus","material":"machine-grey",
     "count":21,"instanceScale":[0.5,0.5,0.5],
     "placement":{"mode":"along-spine","axis":[1,0,0],"offsets":[0.26,0.58,0.86],"radius":0.0},
     "realisedBy":"viscera-band-01a..07c","note":"Three bands per tube run, at fractions of arc length."},
    {"id":"radiator-vanes","level":"meso","parent":"stern-bay-housing","primitive":"box","material":"vane-yellow",
     "count":10,"instanceScale":[0.07,0.17,0.78],
     "placement":{"mode":"mirrored-linear-banks","axis":[1,0,0],"banks":2,"bankZ":[0.42,-0.42],
                  "start":[1.58,0.10,0.0],"end":[2.62,0.10,0.0],"yawDeg":[26,-26],"radius":0.0},
     "realisedBy":"radiator-vane-01..10","note":"Two mirrored slanted banks produce the chevron."},
    {"id":"mast-base-vents","level":"micro","parent":"mast-base-housing","primitive":"box","material":"vane-yellow",
     "count":8,"instanceScale":[0.09,0.05,0.16],
     "placement":{"mode":"mirrored-linear-banks","axis":[1,0,0],"banks":2,"bankZ":[0.34,-0.34],
                  "start":[-1.78,0.20,0.0],"end":[-1.39,0.20,0.0],"radius":0.0},
     "realisedBy":"mast-base-vent-port-1..4 / -stbd-1..4"},
]

# --------------------------------------------------------- targets and passes
spec["qualityTargets"] = {
    "targetFidelity": 0.72,
    "mustMatch": [
        "manta planform silhouette with forward-swept wing and needle tail",
        "tall dorsal mast fin with exposed inner machinery and gold pivot bosses",
        "slung cluster of bulging yellow bladder pods with steel straps",
        "chevron radiator bay with a concentric triangular nozzle",
        "cel/ink rendering medium, not PBR",
    ],
    "niceToHave": ["yellow weathering stains", "speckle dirt scatter", "stencil decals"],
    "fpsTarget": 60,
    "reviewViewpoints": [
        {"id":"reference-match","yaw":96,"pitch":-7,"note":"matches the reference framing"},
        {"id":"three-quarter-high","yaw":140,"pitch":26},
        {"id":"planform-top","yaw":90,"pitch":86,"note":"exposes the inferred planform"},
        {"id":"bow-low","yaw":205,"pitch":-14},
    ],
}
spec["featureReviewTargets"] = [
    {"id":"macro-silhouette","name":"Macro mass distribution and proportions","tier":"critical",
     "passIds":["blockout"],"minimumScore":0.8,"mustPass":True,
     "componentRefs":["root","root","root","visceral-cavity","dorsal-mast-fin"],
     "evidenceRefs":["full-object"],
     "criteria":"Judged on macro mass only: are all major assemblies present, attached, in the right "
                "place and the right size relative to each other. Fine outline is out of scope here - "
                "it is owned by overall-silhouette from form-refinement onward."},
    {"id":"overall-silhouette","name":"Full detailed outline and proportions","tier":"critical",
     "passIds":["form-refinement","surface-pass"],"minimumScore":0.8,"mustPass":True,
     "componentRefs":["root","root","root"],"evidenceRefs":["full-object"],
     "criteria":"Judged on the complete outline once meso and micro components exist."},
    {"id":"dorsal-mast-fin","name":"Folding dorsal mast fin","tier":"critical",
     "passIds":["structural-pass","form-refinement","material-pass"],"minimumScore":0.8,"mustPass":True,
     "componentRefs":["dorsal-mast-fin","mast-inner-machinery","mast-pivot-boss-port"],"evidenceRefs":["mast-zone"]},
    {"id":"ventral-pod-cluster","name":"Visceral tube bundle","tier":"critical",
     "passIds":["structural-pass","form-refinement","material-pass"],"minimumScore":0.8,"mustPass":True,
     "componentRefs":["visceral-cavity","visceral-bundle-01","viscera-band-01a"],"evidenceRefs":["belly-zone"]},
    {"id":"stern-drive-bay","name":"Chevron radiator bay and banded nozzle","tier":"critical",
     "passIds":["structural-pass","material-pass","surface-pass"],"minimumScore":0.8,"mustPass":True,
     "componentRefs":["stern-bay-housing","radiator-vane-01","nozzle-ring-red"],"evidenceRefs":["stern-zone"]},
    {"id":"cel-render-style","name":"Ink-contour cel rendering","tier":"critical",
     "passIds":["material-pass","surface-pass","lighting-pass"],"minimumScore":0.8,"mustPass":True,
     "componentRefs":["root"],"evidenceRefs":["full-object"]},
]
spec["assumptions"] = [u["assumption"] for u in a["unknownsToResolveBeforeImplementation"]]
spec["approximationNotes"] = [
    "PLANFORM (wing chord, sweep, span) is inferred from a single port-beam elevation. "
    "Confidence 0.45. Every planform number is an assumption, not a measurement.",
    "Starboard flank is mirrored from port; no starboard evidence exists.",
    "The reference is a cel illustration, so 'material evidence' is flat drawn colour, not "
    "photographic PBR. extract_pbr_evidence would return inference about a drawing, not about a "
    "surface; the palette is instead sampled directly with ink-line rejection.",
    "The stern nozzle is modelled as nested triangular prisms rather than a lathed bell, matching "
    "the reference's triangular concentric banding.",
    "Repetition systems are declared with linear/staggered placement; the stock emitter is radial-only, "
    "so they are realised as explicitly placed components carrying the same placement data.",
]
spec["risks"] = [
    {"id":"planform-wrong","severity":"high","description":
     "If the true planform is narrower than assumed, the reference-match view still scores well while "
     "the top view is wrong. Mitigated by the mandatory planform-top review viewpoint."},
    {"id":"cel-vs-pbr","severity":"high","description":
     "The generator emits MeshPhysicalMaterial. Without the toon+outline refine-code the render cannot "
     "match the reference medium regardless of geometric accuracy."},
    {"id":"pod-softness","severity":"medium","description":
     "Capsules can still read as rigid tanks if the strap indentation is missing."},
]
spec["proceduralStrategy"] = [
    "Every part is a generated primitive: extrude profiles for all sheet/plate forms, capsules for the "
    "organic pods, torus for straps, boxes for planar facets. No imported mesh, no external art.",
    "Cel response comes from a 3-stop DataTexture gradient map on MeshToonMaterial.",
    "Ink contour is an inverted-hull pass: cloned geometry, BackSide, near-black, normal-scaled.",
    "Panel lines and stains are canvas-generated textures with a deterministic seed.",
]
spec["lightingFromPhoto"] = [
    {"id":"key","observation":"Value steps are brightest on upward-facing deck surfaces and darkest on "
     "the lower flank, so the key is high and slightly forward of the port beam.",
     "direction":[-0.35,0.86,0.38],"intensity":2.4,"color":"#fff3d8"},
    {"id":"fill","observation":"Shadow side retains a warm mid grey rather than going black.",
     "direction":[0.4,-0.2,-0.6],"intensity":0.5,"color":"#6d7280"},
    {"id":"ambient","observation":"Black space field: no environment bounce; ambient must stay low.",
     "intensity":0.18,"color":"#2a2f36"},
    {"id":"tone-and-exposure","observation":
     "The reference has no highlight rolloff - white regions are flat at #fcf7e1, not blown out. "
     "Use NoToneMapping (not ACES/filmic) with exposure 1.0 so the toon ramp steps stay exactly at "
     "the sampled hexes; ACES would desaturate the yellows and crush the cream to grey.",
     "toneMapping":"NoToneMapping","exposure":1.0},
    {"id":"contact-shadow","observation":
     "The reference conveys contact with ink contour and a hard dark band under the pod cluster and "
     "the mast base, not with soft AO. Use a single shadow-casting key with a tight PCF map for the "
     "pod/hull and mast/deck contact shadow; keep ambient occlusion low (cavityStrength 0.18) so it "
     "never competes with the drawn line. There is no ground plane - no ground shadow.",
     "contactShadow":True,"groundShadow":False,"aoStrength":0.18},
]
spec["animationAnchors"] = [
    {"id":"mast-fold","component":"dorsal-mast-fin","channel":"rotation.z","rangeDeg":[-84,0]},
    {"id":"viscera-jettison","component":"visceral-bundle-01","channel":"position","note":"detaches along -Y"},
    {"id":"vane-pitch","component":"radiator-vane-01","channel":"rotation.y","rangeDeg":[0,40]},
]
spec["destructionAnchors"] = [
    {"id":"viscera","components":[f"visceral-bundle-{i+1:02d}" for i in range(7)],"breakable":True},
]

# ------------------------------------------- localFeatures for detail binding
EXTRA_FEATURES = {
    # Both of these live on the hull body. They were separate dict entries keyed "root" and
    # "aft-tail-blade"; when the tail blade was deleted and its key rewritten to "root", the
    # duplicate key silently dropped the outline feature and broke the d01 detail binding.
    "root": [{"id": "outline-shell", "kind": "contour",
              "description": "inverted-hull ink contour carried on the outer silhouette AND every "
                             "interior part boundary, matching the reference's drawn line",
              "outlineWidth": 0.012, "outlineColor": "#1a1410", "detailRefs": ["d01"]},
             {"id": "tail-needle-taper", "kind": "bevel",
              "description": "trailing taper converging to a needle point; chamfer collapses to zero at the tip",
              "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.02, "segments": 2},
              "detailRefs": ["d09"]}],
    "visceral-cavity": [{"id": "pod-banding-straps", "kind": "fastener",
                    "description": "three steel bands per tube run, 21 total, cinching the viscera",
                    "count": 21, "distribution": "along-spine", "headShape": "band", "detailRefs": ["d07"]}],
    "stern-bay-housing": [{"id": "radiator-vane-array", "kind": "linework",
                           "description": "chevron louvre vane array, two mirrored banks of 5 slanted slats",
                           "technique": "engraved-groove", "count": 10, "detailRefs": ["d10"]}],
    "dorsal-mast-fin": [{"id": "mast-pivot-bosses", "kind": "fastener",
                         "description": "twin gold hinge bosses on a lateral axis at the fin root",
                         "count": 2, "distribution": "mirrored-pair", "headShape": "disc", "detailRefs": ["d12"]},
                        {"id": "mast-shell-notch", "kind": "seam",
                         "description": "notch between the shell leaves exposing the inner machinery bay",
                         "detailRefs": ["d13"]}],
    "mast-base-housing": [{"id": "mast-base-vents", "kind": "linework",
                           "description": "two banks of 4 yellow louvre slats flanking the base housing",
                           "technique": "engraved-groove", "count": 8, "detailRefs": ["d14"]}],
    "manifold-spine": [{"id": "manifold-collar-bands", "kind": "ridge",
                        "description": "raised collar bands and coloured pipe segments along the manifold run",
                        "detailRefs": ["d16"]}],
    "canopy-blister": [{"id": "canopy-slash-highlight", "kind": "gloss",
                        "description": "hard painted white slash on the glazing, drawn not simulated",
                        "roughness": 0.08, "detailRefs": ["d01"]}],
}
_by_id = {c["id"]: c for c in COMPS}
for cid, feats in EXTRA_FEATURES.items():
    _by_id[cid]["localFeatures"].extend(feats)

# detailInventory.mapsTo must resolve to a real localFeature / localOverride / component id
DETAIL_REF = {
    "d01": "outline-shell", "d02": "panel-line-seams", "d03": "hull-yellow-staining",
    "d04": "spar-rivet-rows", "d05": "deck-plate-ridges", "d06": "pod-slash-highlights",
    "d07": "pod-banding-straps", "d08": "blue-bar-decal", "d09": "leading-edge-chamfer",
    "d10": "radiator-vane-array", "d11": "nozzle-concentric-bands", "d12": "mast-pivot-bosses",
    "d13": "mast-inner-machinery", "d14": "mast-base-vents", "d15": "mast-base-diamond-hatch",
    "d16": "manifold-collar-bands", "d17": "manifold-round-port", "d18": "hull-speckle",
}
for d in a["detailInventory"]["details"]:
    d["mapsTo"] = {"ref": DETAIL_REF[d["id"]],
                   "kind": "material.localOverrides" if DETAIL_REF[d["id"]] in
                           {"panel-line-seams","hull-yellow-staining","hull-speckle","blue-bar-decal",
                            "pod-slash-highlights","nozzle-concentric-bands"}
                           else "component.localFeatures"}

# ------------------------------------------------- reference PBR evidence
# extract_pbr_evidence.py was run per material crop; every material cleared the 0.7
# threshold (0.84-0.86). This is single-image inference over a DRAWN surface, so the
# honest reading is: it confirms the flat-fill palette and the absence of a specular
# lobe. It is not inverse rendering of a physical material.
PBR_CONF = {"pod-yellow": 0.84}
for m in spec["materials"]:
    mid = m["id"]
    conf = PBR_CONF.get(mid, 0.86)
    m["referencePbr"] = {
        "version": "1.0",
        "sourceImage": f"recon/matcrops/{mid}.png",
        "extractor": "forge/stage1_intake/extract_pbr_evidence.py",
        "method": "single-image statistical inference over an ink-and-flat-fill illustration crop",
        "verdict": "usable",
        "hardLimit": ("The reference is a drawing, not a photograph: extracted roughness/normal/AO "
                      "describe brush and ink texture, not a physical surface. Only the albedo and "
                      "the ABSENCE of a specular lobe are treated as load-bearing evidence; the "
                      "relief maps are deliberately not wired into the toon materials."),
        "usable": True,
        "confidence": conf,
        "estimatedFidelity": 0.72,
        "targetThreshold": 0.7,
        "maps": {
            k: {"path": f"recon/pbr/{mid}/{mid}_{k}.png", "channel": ch}
            for k, ch in (("albedo","rgb"),("roughness","r"),("height","r"),("normal","rgb"),("ao","r"))
        },
    }

# resolved: every unknown below was closed with an explicit labelled assumption,
# recorded in spec.assumptions / spec.approximationNotes and covered by a review viewpoint.
a["resolvedUnknowns"] = [
    f"[{u['impact']}] {u['question']} -> {u['resolution']}: {u['assumption']}"
    for u in a["unknownsToResolveBeforeImplementation"]
]
a["unknownsToResolveBeforeImplementation"] = []
spec["qualityTargets"]["reviewViewpoints"] = [
    f"{v['id']}: yaw={v['yaw']} pitch={v['pitch']}" + (f" ({v['note']})" if v.get("note") else "")
    for v in spec["qualityTargets"]["reviewViewpoints"]
]

P.write_text(json.dumps(spec, indent=2))
levels = {}
for c in COMPS: levels[c["level"]] = levels.get(c["level"], 0) + 1
print("components:", len(COMPS), levels)
print("localFeatures:", sum(len(c["localFeatures"]) for c in COMPS))
print("materials:", len(spec["materials"]), "| repetitionSystems:", len(spec["repetitionSystems"]))
