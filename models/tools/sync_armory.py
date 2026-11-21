"""Regenerate same-origin Model Review Bench entries for the bundled Armory GLBs."""
import argparse
from collections import Counter
from hashlib import sha256
import json

from verify_assets import ROOT, armory_sources, canonical_armory_file, glb_meta, glb_payload


def synchronized_catalog(catalog):
    models = [model for model in catalog["models"] if model.get("sourceCollection") != "armory"]
    sources = armory_sources()
    names = Counter(source["name"].casefold() for source, pack in sources.values())
    for source_id, (source, pack) in sources.items():
        data = canonical_armory_file(source).read_bytes()
        digest = sha256(data).hexdigest()
        assert len(data) == source["bytes"] and digest == source["sha256"], source_id
        payload = glb_payload(data, allow_inline_images=True)
        name = source["name"]
        if pack["id"] == "blasters":
            name = name.replace("-", " ").title()
        if names[source["name"].casefold()] > 1:
            prefix = {"scifi": "Sci-fi", "animated": "Animated"}.get(pack["id"], pack["name"])
            name = f"{prefix} {name}"
        models.append({
            "id": f"armory-{source_id}",
            "version": "v1",
            "name": name,
            "type": "gear",
            "sourceCollection": "armory",
            "sourceId": source_id,
            "sourceName": source["name"],
            "pack": pack["name"],
            "asset": f'../armory/{source["file"]}',
            "sha256": digest,
            "bytes": len(data),
            **glb_meta(payload),
            "creator": source["creator"],
            "source": source["source"],
            "licenseEvidence": source["licenseEvidence"],
            "credits": f'{source["creator"]}. Bundled Armory asset, unchanged.',
            "license": source["license"],
        })
    return {**catalog, "models": models}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="fail if catalog differs; do not write")
    args = parser.parse_args()
    path = ROOT / "catalog.json"
    catalog = json.loads(path.read_text())
    generated = synchronized_catalog(catalog)
    if args.check:
        assert generated == catalog, "Armory references out of date; run python3 models/tools/sync_armory.py"
    else:
        path.write_text(json.dumps(generated, indent=2) + "\n")


if __name__ == "__main__":
    main()
