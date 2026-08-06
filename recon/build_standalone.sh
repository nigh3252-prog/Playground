#!/bin/bash
# Build the shippable single-file demo from the spec.
#   spec -> generated factory -> esbuild bundle -> inlined into shell.html
set -euo pipefail
cd /home/user/Playground
FORGE=/root/.claude/skills/img2threejs/forge

# The generated factory loads referencePbr maps onto MeshPhysicalMaterial. The cel path replaces
# every material with MeshToonMaterial and deliberately does NOT use those relief maps -- the
# spec's referencePbr.hardLimit says so explicitly, because they describe brush and ink texture
# on a drawing, not a physical surface. Drop the map wiring for the app build (keeping the
# extraction verdict and confidence intact) so the page makes no image requests at all.
python3 - <<'PY'
import json, pathlib
spec = json.loads(pathlib.Path("recon/object-sculpt-spec.json").read_text())
for m in spec["materials"]:
    ref = m.get("referencePbr")
    if not ref:
        continue
    ref["mapsWithheldForCelPath"] = ref.pop("maps", {})
    ref["mapsWithheldReason"] = (
        "Cel path uses MeshToonMaterial with flat sampled albedo; the extracted relief maps "
        "describe the drawing's brush and ink texture, not a physical surface (see hardLimit)."
    )
pathlib.Path("recon/object-sculpt-spec.app.json").write_text(json.dumps(spec, indent=2))
print("app spec written (referencePbr maps withheld)")
PY

python3 "$FORGE/stage3_build/generate_threejs_factory.py" \
  recon/object-sculpt-spec.app.json \
  --out recon/src/createMantaModel.ts --pass-id form-refinement --force >/dev/null

cd recon
npx esbuild app/main.ts --bundle --outfile=app/bundle.js --format=iife --target=es2020 --minify --log-level=error

python3 - <<'PY'
import pathlib
shell = pathlib.Path("app/shell.html").read_text()
bundle = pathlib.Path("app/bundle.js").read_text()
out = pathlib.Path("/home/user/Playground/manta-delta-star-freighter.html")
out.write_text(shell.replace("/*BUNDLE*/", bundle))
print(f"wrote {out} ({round(len(out.read_text())/1024)} KB, self-contained)")
PY
