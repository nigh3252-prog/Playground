#!/bin/bash
# Sweep forward-wing half-span x plane height, scoring each against the reference silhouette.
cd /home/user/Playground
for span in "$@"; do
  for wy in 0.09 0.20; do
    MANTA_SPAN=$span MANTA_WINGY=$wy python3 recon/build_spec.py >/dev/null 2>&1
    python3 /root/.claude/skills/img2threejs/forge/stage3_build/generate_threejs_factory.py \
      recon/object-sculpt-spec.json --out recon/src/createMantaModel.ts --force >/dev/null 2>&1
    (cd recon && npx esbuild harness/main.ts --bundle --outfile=harness/bundle.js --format=iife --target=es2020 --log-level=error 2>/dev/null)
    (cd recon && node shoot.mjs sweep2 reference-match stripped >/dev/null 2>&1)
    cp recon/renders/sweep2/reference-match-stripped.png "recon/renders/sweep/s${span}_w${wy}.png"
    echo -n "span=$span wingY=$wy  "
    python3 -c "
from PIL import Image
ref=Image.open('recon/ref_clean.png').convert('L').resize((800,400),Image.BILINEAR).load()
ren=Image.open('recon/renders/sweep/s${span}_w${wy}.png').convert('L').resize((800,400),Image.BILINEAR).load()
i=u=0
for y in range(400):
  for x in range(800):
    a=ref[x,y]>18; b=ren[x,y]>18
    if a and b: i+=1
    if a or b: u+=1
print('IoU', round(i/u,4))"
  done
done
