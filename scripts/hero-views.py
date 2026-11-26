"""Split a generated front/back/side sheet into the game's hero view cards.

Usage:
  /opt/miniconda3/envs/claude-sandbox/bin/python tools/hero-views.py ~/Downloads/player-back-side.jpeg

The sheet holds two panels side by side on a flat magenta plate: the BACK view on the left and the
SIDE view (profile facing right) on the right. This keys the plate out of each panel, neutralises the
coloured fringe a JPEG leaves along the cut, crops to the figure, and writes:

  assets/hero-back.png   the back view
  assets/hero-side.png   the side view, facing right

scene.js prints them on the reverse of the front card and on the profile card of the standee rig.
assets/hero.png (the front view) is made by tools/hero-image.py.
"""
import argparse
import os
import sys

import numpy as np
from PIL import Image, ImageFilter


def key_panel(im, lo=55, hi=95):
    """Return RGBA with the flat magenta plate keyed out.

    Magenta excess = min(R, B) - G: ~150-210 on the plate, ~-60..+30 on the figure's inks.
    lo..hi is the soft band: below lo opaque, above hi transparent.
    """
    rgb = np.asarray(im.convert("RGB")).astype(np.int16)
    score = np.minimum(rgb[..., 0], rgb[..., 2]) - rgb[..., 1]
    alpha = np.clip((hi - score) / float(hi - lo), 0, 1)

    # JPEG fringe: a few px inside the cut still carry plate colour. Subtract the same magenta
    # excess the plate has (red and blue both above green) in a band just inside the alpha edge.
    bg = alpha < 0.05
    band = np.asarray(Image.fromarray((bg * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(7))) > 0
    fringe = band & ~bg
    delta = np.clip(np.minimum(rgb[..., 0] - rgb[..., 1], rgb[..., 2] - rgb[..., 1]), 0, None)
    delta[~fringe] = 0
    rgb[..., 0] -= delta
    rgb[..., 2] -= delta

    # soften the cut by a hair so the die-cut outline is not stair-stepped
    a8 = Image.fromarray((alpha * 255).astype(np.uint8))
    a8 = a8.filter(ImageFilter.GaussianBlur(0.7))
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
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("src", help="the two-panel generated sheet (back | side)")
    ap.add_argument("--split", type=float, default=0.5,
                    help="fraction of the width where the two panels meet (default 0.5)")
    ap.add_argument("--pad", type=int, default=4, help="pixels of margin kept around each figure (default 4)")
    ap.add_argument("-o", "--outdir", default=os.path.join(os.path.dirname(__file__), "..", "assets"),
                    help="output directory (default: assets/)")
    args = ap.parse_args()

    sheet = Image.open(args.src).convert("RGB")
    cut = int(round(sheet.width * args.split))
    panels = [("hero-back.png", sheet.crop((0, 0, cut, sheet.height))),
              ("hero-side.png", sheet.crop((cut, 0, sheet.width, sheet.height)))]

    outdir = os.path.abspath(args.outdir)
    os.makedirs(outdir, exist_ok=True)
    for name, panel in panels:
        keyed = crop_figure(key_panel(panel), args.pad)
        out = os.path.join(outdir, name)
        keyed.save(out)
        a = np.asarray(keyed.getchannel("A"))
        print("wrote %s (%d x %d, %.0f%% transparent)"
              % (out, keyed.width, keyed.height, 100 * (a < 250).mean()))


if __name__ == "__main__":
    main()
