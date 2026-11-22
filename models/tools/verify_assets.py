"""Validate Model Review Bench manifest against original self-contained GLB bytes."""
from base64 import b64decode
from hashlib import sha256
import json
import re
from pathlib import Path
import struct

ROOT = Path(__file__).resolve().parents[1]
ARMORY = ROOT.parent / "armory"
CLIPS = {
    "dot": ["Idle"],
    "crocodilian": [],
    "white-mech": ["Aim_Preview", "Articulation_Check", "Idle", "Walk_Preview"],
}


def glb_payload(blob, *, allow_inline_images=False):
    assert len(blob) >= 20, "GLB header and JSON chunk required"
    assert struct.unpack_from("<4sII", blob) == (b"glTF", 2, len(blob)), "GLB magic, version or length mismatch"
    offset, payload, bin_count = 12, None, 0
    while offset < len(blob):
        assert offset + 8 <= len(blob), "incomplete chunk header"
        n, kind = struct.unpack_from("<I4s", blob, offset)
        start = offset + 8
        offset = start + n
        assert n % 4 == 0 and offset <= len(blob), "invalid chunk size"
        if kind == b"JSON":
            assert start == 20 and payload is None, "misplaced JSON chunk"
            payload = json.loads(blob[start:offset])
        elif kind == b"BIN\0":
            bin_count += 1
    assert offset == len(blob) and payload and bin_count == 1, "missing GLB payload"
    assert all("uri" not in buffer for buffer in payload.get("buffers", [])), "non-embedded GLB buffer"
    for image in payload.get("images", []):
        if "uri" not in image:
            assert "bufferView" in image, "non-embedded image"
            continue
        # Existing Kenney binaries carry embedded PNGs as inline data. Their exact
        # checked bytes are reused, never loaded from external or relative URIs.
        embedded = re.fullmatch(r"data:image/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})", image["uri"])
        assert allow_inline_images and embedded and "bufferView" not in image, "non-embedded image"
        signature = b"\x89PNG\r\n\x1a\n" if embedded[1] == "png" else b"\xff\xd8\xff"
        assert b64decode(embedded[2], validate=True).startswith(signature), "invalid inline image"
    return payload


def glb_meta(gltf, *, known_articulated=False):
    meshes = gltf["meshes"]
    triangles = 0
    for node in gltf["nodes"]:
        if "mesh" not in node:
            continue
        for primitive in meshes[node["mesh"]]["primitives"]:
            mode = primitive.get("mode", 4)
            accessor = primitive.get("indices", primitive["attributes"]["POSITION"])
            count = gltf["accessors"][accessor]["count"]
            if mode == 4:
                triangles += count // 3
            elif mode in (5, 6):
                triangles += max(0, count - 2)
    return {
        "triangles": triangles,
        "meshes": len(meshes),
        "textures": len(gltf.get("textures", [])),
        "rig": "skinned" if gltf.get("skins") else "articulated" if gltf.get("animations") or known_articulated else "unrigged",
        "clips": [{"name": a["name"]} for a in gltf.get("animations", [])],
    }



def armory_sources():
    catalog = json.loads((ARMORY / "catalog.json").read_text())
    assert catalog["schema"] == "warden-armory-catalog" and catalog["version"] == 1
    packs = {pack["id"]: pack for pack in catalog["packs"]}
    assert len(packs) == len(catalog["packs"])
    result = {}
    for source in catalog["models"]:
        ident = source["id"]
        assert re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", ident) and ident not in result
        assert source["file"] == f"models/{ident}.glb"
        result[ident] = (source, packs[source["pack"]])
    return result


def canonical_armory_file(source):
    path = ARMORY / source["file"]
    assert path.parent == ARMORY / "models" and path.resolve() == path and path.is_file(), "invalid Armory model path"
    return path

def split_asset(model, ident, version):
    parts = model["parts"]
    assert model["asset"] is None and isinstance(parts, list) and 3 <= len(parts) <= 6
    assert re.fullmatch(r"[A-Za-z0-9_-]+\.glb", model["originalFile"])
    verified = []
    for i, part in enumerate(parts, 1):
        expected = f"assets/{ident}-{version}.glb.part{i}"
        assert part["asset"] == expected, "invalid part path or order"
        path = ROOT / expected
        assert path.resolve() == path and path.is_file(), "invalid part file"
        assert type(part["bytes"]) is int and 0 < part["bytes"] <= 6_000_000, "invalid part size"
        data = path.read_bytes()
        assert len(data) == part["bytes"] and sha256(data).hexdigest() == part["sha256"], "part integrity mismatch"
        verified.append(data)
    return b"".join(verified)


def verify():
    assert (ROOT / "catalog.json").is_file(), "catalog.json missing"
    catalog = json.loads((ROOT / "catalog.json").read_text())
    assert catalog["schemaVersion"] == 1
    models = catalog["models"]
    assert len({(m["id"], m["version"]) for m in models}) == len(models), "duplicate versions"
    keys = {f'{m["id"]}@{m["version"]}' for m in models}
    sources = json.loads((ROOT / "source-lock.json").read_text())
    assert {f"{ident}@v1" for ident in CLIPS} <= keys
    borrowed_keys = {f'{m["id"]}@{m["version"]}' for m in models if m.get("sourceCollection") == "armory"}
    assert keys - borrowed_keys - {"dot@v1"} == sources.keys(), "original source lock must cover every locally imported revision"
    armory = armory_sources()
    assert borrowed_keys == {f"armory-{ident}@v1" for ident in armory}, "bench must list every bundled Armory model once"
    assets = [m["asset"] for m in models if m["asset"] is not None]
    assert len(set(assets)) == len(assets), "duplicate asset paths"
    for m in models:
        ident = m["id"]
        version = m["version"]
        key = f"{ident}@{version}"
        assert re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", ident) and re.fullmatch(r"v[1-9][0-9]*(?:[a-z])?", version)
        assert m["name"] and m["credits"] and m["license"]
        collection = m.get("sourceCollection")
        if collection == "armory":
            assert "parts" not in m
            source_id = m["sourceId"]
            source, pack = armory[source_id]
            assert ident == f"armory-{source_id}" and version == "v1"
            assert m["asset"] == f'../armory/{source["file"]}'
            assert m["type"] == "gear" and m["pack"] == pack["name"]
            assert m["creator"] == source["creator"] and m["source"] == source["source"]
            assert m["license"] == source["license"] and m["sha256"] == source["sha256"] and m["bytes"] == source["bytes"]
            data = canonical_armory_file(source).read_bytes()
        else:
            assert collection is None and not ident.startswith("armory-")
            if "parts" in m:
                data = split_asset(m, ident, version)
            else:
                assert m["asset"] == f"assets/{ident}-{version}.glb"
                data = (ROOT / m["asset"]).read_bytes()
        digest = sha256(data).hexdigest()
        assert m["bytes"] == len(data) and m["sha256"] == digest, ident
        assert key not in sources or digest == sources[key], f"{key} original altered"
        gltf = glb_payload(data, allow_inline_images=(collection == "armory"))
        required_extensions = gltf.get("extensionsRequired", [])
        assert ("EXT_meshopt_compression" in required_extensions) == (m.get("compression") == "meshopt"), (ident, "Meshopt flag")
        for key, value in glb_meta(gltf, known_articulated=(ident == "crocodilian")).items():
            assert m[key] == value, (ident, key)
        if ident in CLIPS and version == "v1":
            assert sorted(c["name"] for c in m["clips"]) == sorted(CLIPS[ident]), ident
        assert m["triangles"] > 0 and m["meshes"] > 0, ident
        for animation in gltf.get("animations", []):
            channels = animation["channels"]
            samplers = animation["samplers"]
            assert channels and samplers, (ident, animation["name"])
            assert all(gltf["accessors"][s["input"]]["count"] >= 2 for s in samplers), (ident, animation["name"])
            if ident == "dot":
                target_pairs = {(gltf["nodes"][c["target"]["node"]]["name"], c["target"]["path"]) for c in channels}
                assert target_pairs == {("Optic gimbal", "rotation"), ("Luminous pupil", "scale")}
        print(f'{m["name"]} {m["version"]}: {m["bytes"]:,} bytes, {m["triangles"]:,} triangles, {len(m["clips"])} clips')


if __name__ == "__main__":
    verify()
