#!/usr/bin/env python3
"""Regenerate every derived reference image from recon/reference.jpg.

Produces:
  ref.png        lossless working copy the pipeline scripts read
  ref_clean.png  ref.png with the star field removed (largest connected component only).
                 The Tier 1 gate segments its own mask, and the stars wrecked it: silhouette
                 IoU read 0.283 against ref.png vs 0.472 against ref_clean.png for the same
                 render, because the scattered stars inflated the reference's bbox to nearly
                 the whole frame. Every gate number in the review history uses ref_clean.
  crops/         zoomed detail crops per assembly, used as evidenceRefs in the spec
  matcrops/      per-material crops fed to extract_pbr_evidence.py

Run from the repo root:  python3 recon/prepare_reference.py
"""
from collections import deque
import pathlib
from PIL import Image

HERE = pathlib.Path(__file__).parent
SRC = HERE / "reference.jpg"

# Detail crops. Coordinates are in the 4000x2000 source frame.
CROPS = {
    "bow":       (380, 760, 1350, 1330),
    "dorsalfin": (1420, 120, 1960, 900),
    "belly":     (1180, 880, 2480, 1470),
    "midfin":    (2400, 620, 2860, 1010),
    "stern":     (2620, 880, 3400, 1280),
    "wingtip":   (3150, 930, 3960, 1180),
}

# Per-material crops, positioned on the region each material is sampled from.
MATCROPS = {
    "hull-cream":   (2120, 860, 2480, 970),
    "hull-grey":    (1130, 1080, 1420, 1190),
    "pod-yellow":   (1400, 1040, 1680, 1260),
    "vane-yellow":  (2800, 970, 3010, 1100),
    "machine-grey": (1600, 490, 1740, 630),
    "accent-blue":  (2615, 895, 2710, 965),
    "accent-red":   (2995, 985, 3095, 1055),
    "accent-gold":  (1580, 900, 1690, 995),
    "accent-teal":  (1645, 240, 1710, 340),
    "glass-dark":   (1515, 835, 1610, 915),
}


def largest_component(gray: Image.Image, step: int = 2, thresh: int = 18) -> set[tuple[int, int]]:
    """Flood-fill the brightest connected blob at 1/step resolution."""
    w, h = gray.size
    ws, hs = w // step, h // step
    small = gray.resize((ws, hs), Image.BILINEAR).load()
    seen = bytearray(ws * hs)
    best: list[tuple[int, int]] = []
    for sy in range(hs):
        for sx in range(ws):
            if seen[sy * ws + sx] or small[sx, sy] <= thresh:
                continue
            queue = deque([(sx, sy)])
            seen[sy * ws + sx] = 1
            comp = []
            while queue:
                x, y = queue.popleft()
                comp.append((x, y))
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < ws and 0 <= ny < hs:
                        j = ny * ws + nx
                        if not seen[j] and small[nx, ny] > thresh:
                            seen[j] = 1
                            queue.append((nx, ny))
            if len(comp) > len(best):
                best = comp
    return set(best)


def main() -> None:
    if not SRC.exists():
        raise SystemExit(f"missing {SRC}")
    img = Image.open(SRC).convert("RGB")
    img.save(HERE / "ref.png")

    step = 2
    keep = largest_component(img.convert("L"), step=step)
    w, h = img.size
    clean = Image.new("RGB", (w, h), (0, 0, 0))
    src, dst = img.load(), clean.load()
    for x, y in keep:
        for dy in range(step):
            for dx in range(step):
                X, Y = x * step + dx, y * step + dy
                if X < w and Y < h:
                    dst[X, Y] = src[X, Y]
    clean.save(HERE / "ref_clean.png")

    (HERE / "crops").mkdir(exist_ok=True)
    for name, box in CROPS.items():
        crop = img.crop(box)
        cw, ch = crop.size
        scale = min(3.0, 1400 / max(cw, ch))
        crop.resize((int(cw * scale), int(ch * scale)), Image.LANCZOS).save(HERE / "crops" / f"{name}.png")

    (HERE / "matcrops").mkdir(exist_ok=True)
    for name, box in MATCROPS.items():
        crop = img.crop(box)
        cw, ch = crop.size
        scale = max(1, int(320 / max(cw, ch)) + 1)
        crop.resize((cw * scale, ch * scale), Image.NEAREST).save(HERE / "matcrops" / f"{name}.png")

    print(f"ref.png, ref_clean.png, {len(CROPS)} crops, {len(MATCROPS)} matcrops regenerated")


if __name__ == "__main__":
    main()
