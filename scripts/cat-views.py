#!/usr/bin/env python3
"""cat-views.py — split the generated three-pose cat sheet into the game's pose images.

Usage:
  /opt/miniconda3/envs/claude-sandbox/bin/python -I scripts/cat-views.py SHEET.jpeg ASSETS_DIR

The sheet holds three side-by-side poses of one cat on a flat magenta plate, all facing RIGHT:
the LEFT panel the standing cat, the MIDDLE the walk pose with legs gathered, the RIGHT the walk
pose with legs reaching. Each panel is keyed (magenta removed), fringe-neutralised, cropped to the
cat, and written as assets/cat-stand.png, assets/cat-walk-a.png, assets/cat-walk-b.png — the three
images world/cat.js prints when art is present. Without them the drawn cat stands in.

The generation prompt is in references/hero-art.md.
"""
import argparse
import os
import sys

import numpy as np
from PIL import Image, ImageFilter


def key_panel(im, lo=55, hi=95):
    """Key the flat magenta plate (magenta excess = min(R, B) - G), like hero-views.py."""
    rgb = np.asarray(im.convert("RGB")).astype(np.int16)
    score = np.minimum(rgb[..., 0], rgb[..., 2]) - rgb[..., 1]
    alpha = np.clip((hi - score) / float(hi - lo), 0, 1)
    bg = alpha < 0.05
    band = np.asarray(Image.fromarray((bg * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(7))) > 0
    fringe = band & ~bg
    delta = np.clip(np.minimum(rgb[..., 0] - rgb[..., 1], rgb[..., 2] - rgb[..., 1]), 0, None)
    delta[~fringe] = 0
    rgb[..., 0] -= delta
    rgb[..., 2] -= delta
    a8 = Image.fromarray((alpha * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.7))
    out = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB").convert("RGBA")
    out.putalpha(a8)
    return out


def crop_figure(im, pad=4):
    a = np.asarray(im.getchannel("A"))
    ys, xs = np.nonzero(a > 8)
    if len(xs) == 0:
        sys.exit("nothing left after keying: is the plate flat magenta?")
    box = (max(0, xs.min() - pad), max(0, ys.min() - pad),
           min(im.width, xs.max() + 1 + pad), min(im.height, ys.max() + 1 + pad))
    return im.crop(box)


def main():
    ap = argparse.ArgumentParser(description="three-pose cat sheet -> pose images")
    ap.add_argument("src", help="the generated sheet (three panels on a flat magenta plate)")
    ap.add_argument("outdir", help="the world's assets/ directory")
    args = ap.parse_args()

    sheet = Image.open(args.src).convert("RGB")
    w = sheet.width
    cuts = [(0, int(w / 3)), (int(w / 3), int(w * 2 / 3)), (int(w * 2 / 3), w)]
    names = ["cat-stand.png", "cat-walk-a.png", "cat-walk-b.png"]
    os.makedirs(args.outdir, exist_ok=True)
    for (x0, x1), name in zip(cuts, names):
        keyed = crop_figure(key_panel(sheet.crop((x0, 0, x1, sheet.height))))
        out = os.path.join(args.outdir, name)
        keyed.save(out)
        a = np.asarray(keyed.getchannel("A"))
        print(f"wrote {out} ({keyed.width} x {keyed.height}, {100 * (a < 250).mean():.0f}% transparent)")


if __name__ == "__main__":
    main()
