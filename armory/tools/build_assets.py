"""Rebuild the bundled, visual-only CC0 models from explicit source URLs."""
import base64
import hashlib
import json
import mimetypes
import os
from pathlib import Path
import re
import shutil
import struct
import subprocess
import tempfile
import time
from urllib.parse import quote, unquote, urljoin, urlsplit
from urllib.request import Request, urlopen
import zipfile

ROOT = Path(__file__).resolve().parents[1]
CONFIG = json.loads((ROOT / "sources.json").read_text())
LOCK = []
WORK = Path(tempfile.mkdtemp(prefix="warden-armory-"))

def download(url):
    for attempt in range(3):
        try:
            with urlopen(Request(url, headers={"User-Agent": "WardenArmory-CC0-catalog/1.0"}), timeout=90) as response:
                data = response.read(100_000_001)
            if len(data) > 100_000_000:
                raise ValueError("Source exceeds the 100 MB limit")
            LOCK.append({"url": url, "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)})
            return data
        except Exception:
            if attempt == 2:
                raise
            time.sleep(2 * (attempt + 1))

def slug(value):
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")

def unpack(url, directory):
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / unquote(urlsplit(url).path.split("/")[-1])
    path.write_bytes(download(url))
    if path.suffix.lower() == ".zip":
        with zipfile.ZipFile(path) as archive:
            if sum(x.file_size for x in archive.infolist()) > 500_000_000:
                raise ValueError("Expanded source exceeds the 500 MB limit")
            for member in archive.infolist():
                target = (directory / member.filename).resolve()
                if not target.is_relative_to(directory.resolve()):
                    raise ValueError("Unsafe archive member")
            archive.extractall(directory)
        path.unlink()
    return directory

def candidates(directory):
    for extension in (".obj", ".fbx", ".blend"):
        matches = sorted(p for p in directory.rglob("*") if p.suffix.lower() == extension and "__MACOSX" not in str(p))
        if matches:
            return matches
    raise ValueError("No supported model in " + str(directory))

def standalone_glb(data, url):
    magic, version, length = struct.unpack_from("<III", data)
    assert magic == 0x46546C67 and version == 2 and length == len(data), url
    json_length, chunk_type = struct.unpack_from("<II", data, 12)
    assert chunk_type == 0x4E4F534A
    document = json.loads(data[20:20+json_length])
    for image in document.get("images", []):
        uri = image.get("uri", "")
        if uri and not uri.startswith("data:"):
            image_url = urljoin(url, quote(unquote(uri), safe="/:"))
            image_data = download(image_url)
            image["uri"] = "data:" + (mimetypes.guess_type(uri)[0] or "image/png") + ";base64," + base64.b64encode(image_data).decode()
    for buffer in document.get("buffers", []):
        if buffer.get("uri"):
            raise ValueError("Unexpected external buffer: " + url)
    encoded = json.dumps(document, separators=(",", ":"), ensure_ascii=True).encode()
    encoded += b" " * ((-len(encoded)) % 4)
    remainder = data[20+json_length:]
    return struct.pack("<III", magic, version, 20+len(encoded)+len(remainder)) + struct.pack("<II", len(encoded), chunk_type) + encoded + remainder

def nice_name(stem):
    return re.sub(r"(?<=[a-z])(?=[A-Z])", " ", stem.replace("_", " ")).strip()

jobs, models, packs = [], [], []
for pack in CONFIG["packs"]:
    print("SOURCE", pack["id"], flush=True)
    packs.append({k: v for k, v in pack.items() if k not in ("files", "url", "mode")})
    entries = []
    if pack["mode"] == "archive":
        directory = unpack(pack["url"], WORK / pack["id"])
        for path in candidates(directory):
            if "Accessories" in path.parts or re.search(r"scope|silencer|bayonet|suppressor|grenade|bipod", path.stem, re.I):
                continue
            entries.append({"name": nice_name(path.stem), "path": path, "url": pack["url"]})
    else:
        for i, entry in enumerate(pack["files"]):
            item = dict(entry)
            if pack["mode"] == "historical":
                directory = unpack(entry["url"], WORK / (pack["id"] + str(i)))
                item["path"] = candidates(directory)[0]
            elif not urlsplit(entry["url"]).path.lower().endswith(".glb"):
                directory = unpack(entry["url"], WORK / (pack["id"] + str(i)))
                item["path"] = candidates(directory)[0]
            entries.append(item)
    for entry in entries:
        model_id = pack["id"] + "-" + slug(entry["name"])
        if any(m["id"] == model_id for m in models):
            continue
        output = ROOT / "models" / (model_id + ".glb")
        output.parent.mkdir(parents=True, exist_ok=True)
        model = {
            "id": model_id, "name": entry["name"], "pack": pack["id"],
            "creator": entry.get("creator", pack.get("creator", "")),
            "era": entry.get("era", pack.get("era", [])),
            "source": entry.get("source", pack.get("source", "")),
            "licenseEvidence": entry.get("source", pack.get("licenseEvidence", pack.get("source", ""))),
            "license": CONFIG["license"], "licenseUrl": CONFIG["licenseUrl"],
            "description": entry.get("description", pack.get("description", "")),
            "file": "models/" + output.name,
            "thumbnail": "thumbs/" + model_id + ".png",
            "downloadSource": entry["url"],
        }
        if "path" in entry:
            jobs.append({"input": str(entry["path"]), "output": str(output), "id": model_id})
            model["conversion"] = "Converted to GLB with Blender; texture dimensions limited to 2048 pixels. Source scale and authored parts retained."
        else:
            output.write_bytes(standalone_glb(download(entry["url"]), entry["url"]))
            model["conversion"] = "Original GLB geometry; any external texture embedded for portable export."
        models.append(model)

(WORK / "jobs.json").write_text(json.dumps(jobs))
subprocess.run(["blender", "--background", "--factory-startup", "--disable-autoexec", "--python-exit-code", "1", "--python", str(ROOT / "tools" / "convert_assets.py"), "--", str(WORK / "jobs.json")], check=True)

# Vendor the minimal runtime and its license so browsing and exports need no CDN.
vendor = ROOT / "vendor"
version = "r180"
vendor_files = {
    "three.module.min.js": "build/three.module.min.js",
    "three.core.min.js": "build/three.core.min.js",
    "addons/controls/OrbitControls.js": "examples/jsm/controls/OrbitControls.js",
    "addons/loaders/GLTFLoader.js": "examples/jsm/loaders/GLTFLoader.js",
    "addons/utils/BufferGeometryUtils.js": "examples/jsm/utils/BufferGeometryUtils.js",
    "THREE-LICENSE.txt": "LICENSE",
}
for target, source in vendor_files.items():
    path = vendor / target
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(download("https://raw.githubusercontent.com/mrdoob/three.js/" + version + "/" + source))

for model in models:
    path = ROOT / model["file"]
    data = path.read_bytes()
    document = json.loads(data[20:20+struct.unpack_from("<I", data, 12)[0]])
    assert document.get("meshes"), model["id"]
    model["bytes"] = len(data)
    model["sha256"] = hashlib.sha256(data).hexdigest()
    model["meshCount"] = len(document["meshes"])
    model["animations"] = [x.get("name", "Clip " + str(i+1)) for i, x in enumerate(document.get("animations", []))]
    accessors = document["accessors"]
    model["triangles"] = sum(accessors[p["indices"]]["count"] // 3 if "indices" in p else accessors[p["attributes"]["POSITION"]]["count"] // 3 for m in document["meshes"] for p in m["primitives"] if p.get("mode", 4) == 4)
    for image in document.get("images", []):
        assert not image.get("uri") or image["uri"].startswith("data:"), model["id"]
    print("MODEL", model["id"], model["bytes"], model["meshCount"], model["animations"], flush=True)

catalog = {"schema": "warden-armory-catalog", "version": 1, "verifiedAt": CONFIG["verifiedAt"], "packs": packs, "models": models}
(ROOT / "catalog.json").write_text(json.dumps(catalog, indent=2) + "\n")
(ROOT / "asset-lock.json").write_text(json.dumps({"three": version, "downloads": LOCK}, indent=2) + "\n")
credits = ["WARDEN ARMORY — ASSET CREDITS", "", "Bundled models: CC0 1.0 Universal", CONFIG["licenseUrl"], "Source license listings checked: " + CONFIG["verifiedAt"], "", "These are visual game/reference assets. Original source links and creators follow.", "Credits are retained for provenance, including where CC0 does not require attribution.", ""]
for model in models:
    credits.extend([model["name"] + " — " + model["creator"], model["source"], model["licenseEvidence"], model["conversion"], "SHA-256: " + model["sha256"], ""])
credits.extend(["Three.js " + version + " — MIT, see vendor/THREE-LICENSE.txt.", "Catalog and viewer code are distinct from the asset licenses."])
(ROOT / "CREDITS.txt").write_text("\n".join(credits) + "\n")
print("BUILT", len(models), "MODELS", len(packs), "PACKS", flush=True)
shutil.rmtree(WORK)
