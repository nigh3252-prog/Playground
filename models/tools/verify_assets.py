"""Validate Model Review Bench manifest against original self-contained GLB bytes."""
from hashlib import sha256
import json
from pathlib import Path
import struct

ROOT = Path(__file__).resolve().parents[1]
ORIGINAL_HASHES = {
    "crocodilian": "d2c4ba627e0aab9877bb57c6225e981274984cb44da5886060c6f9410f563de6",
    "white-mech": "591ea0abb423885e7d60c1bef4f3821ec692951838b6cbeb02aeba1c383e66a8",
}
CLIPS = {
    "dot": ["Idle"],
    "crocodilian": [],
    "white-mech": ["Aim_Preview", "Articulation_Check", "Idle", "Walk_Preview"],
}


def glb_payload(blob):
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
    assert all("uri" not in resource for key in ("buffers", "images") for resource in payload.get(key, [])), "non-embedded GLB resource"
    assert all("bufferView" in image for image in payload.get("images", [])), "non-embedded image"
    return payload


def glb_meta(gltf):
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
        "rig": "skinned" if gltf.get("skins") else "articulated",
        "clips": [{"name": a["name"]} for a in gltf.get("animations", [])],
    }


def verify():
    assert (ROOT / "catalog.json").is_file(), "catalog.json missing"
    catalog = json.loads((ROOT / "catalog.json").read_text())
    assert catalog["schemaVersion"] == 1
    models = catalog["models"]
    assert len({(m["id"], m["version"]) for m in models}) == len(models), "duplicate versions"
    assert {(m["id"], m["version"]) for m in models} == {(ident, "v1") for ident in CLIPS}
    for m in models:
        ident = m["id"]
        assert m["version"] == "v1" and m["name"] and m["credits"] and m["license"]
        assert m["asset"] == f"assets/{ident}-v1.glb"
        data = (ROOT / m["asset"]).read_bytes()
        digest = sha256(data).hexdigest()
        assert m["bytes"] == len(data) and m["sha256"] == digest, ident
        assert ident not in ORIGINAL_HASHES or digest == ORIGINAL_HASHES[ident], f"{ident} original altered"
        gltf = glb_payload(data)
        for key, value in glb_meta(gltf).items():
            assert m[key] == value, (ident, key)
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
