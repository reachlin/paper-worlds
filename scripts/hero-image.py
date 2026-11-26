"""Turn a generated portrait into the game's hero card.

Usage:
  /opt/miniconda3/envs/claude-sandbox/bin/python tools/hero-image.py assets/hero-raw.png

Reads any image (PNG / JPEG / WebP) of the figure on a flat background (the generation prompt asks
for solid magenta #FF00FF; white or any flat colour works too), keys that background out, neutralises
the plate colour bleeding into a JPEG edge, crops to the figure, and writes assets/hero.png (RGBA) —
the file scene.js prints and die-cuts as the hero.

An input that already has a transparent background skips the keying and is only cropped.
Nothing else is needed: restart the page and the hero is the new figure.
"""
import argparse
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter


def already_transparent(im):
    a = np.asarray(im.getchannel("A"))
    return int(a.min()) < 250 and float((a < 250).mean()) > 0.02


def key_background(im, tol):
    """Flood-fill the background from the image border and return a mask (True = background)."""
    rgb = im.convert("RGB")
    w, h = rgb.size
    seeds = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1),
             (w // 2, 0), (w // 2, h - 1), (0, h // 2), (w - 1, h // 2)]
    # a colour no generated plate will contain: exact-match it afterwards
    key = (1, 254, 2)
    for xy in seeds:
        if rgb.getpixel(xy) != key:
            ImageDraw.floodfill(rgb, xy, key, thresh=tol)
    filled = np.all(np.asarray(rgb) == np.array(key, dtype=np.uint8), axis=2)
    if filled.mean() < 0.05:
        print("warning: the keyed background is only %.1f%% of the image — is the background flat?"
              % (filled.mean() * 100), file=sys.stderr)
    return filled


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("src", nargs="?", default=os.path.join(os.path.dirname(__file__), "..", "assets", "hero-raw.png"),
                    help="the generated image (default: assets/hero-raw.png)")
    ap.add_argument("-o", "--out", default=os.path.join(os.path.dirname(__file__), "..", "assets", "hero.png"),
                    help="output path (default: assets/hero.png)")
    ap.add_argument("--tol", type=int, default=48,
                    help="how far a pixel may differ from the plate colour and still count as background (default 48)")
    ap.add_argument("--pad", type=int, default=2, help="pixels of margin kept around the figure (default 2)")
    args = ap.parse_args()

    im = Image.open(args.src).convert("RGBA")
    if already_transparent(im):
        alpha_im = im.getchannel("A")
        print("input already has a transparent background: cropping only")
    else:
        bg = key_background(im, args.tol)
        print("keyed the flat background out (tolerance %d)" % args.tol)
        # a JPEG edge blends the plate ~1-3 px into the figure: neutralise that fringe (magenta excess
        # = how far red and blue both sit above green; figure colours at the edge keep their value)
        band = np.asarray(Image.fromarray((bg * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(7))) > 0
        fringe = band & ~bg
        rgb = np.asarray(im).astype(np.int16)
        delta = np.clip(np.minimum(rgb[..., 0] - rgb[..., 1], rgb[..., 2] - rgb[..., 1]), 0, None)
        delta[~fringe] = 0
        rgb[..., 0] -= delta
        rgb[..., 2] -= delta
        im = Image.fromarray(rgb.astype(np.uint8), "RGBA")
        # pull the cut 1 px inward (past the contaminated edge) so the printed rim meets clean colour
        alpha_im = Image.fromarray(np.where(bg, 0, 255).astype(np.uint8)).filter(ImageFilter.MinFilter(3))

    # soften the cut by a hair so the die-cut outline is not stair-stepped
    alpha = np.asarray(alpha_im.filter(ImageFilter.GaussianBlur(0.7)))

    ys, xs = np.nonzero(alpha > 8)
    if len(xs) == 0:
        sys.exit("nothing left after keying: is the figure the same colour as the background?")
    x0, x1 = max(0, xs.min() - args.pad), min(im.width, xs.max() + 1 + args.pad)
    y0, y1 = max(0, ys.min() - args.pad), min(im.height, ys.max() + 1 + args.pad)
    im.putalpha(Image.fromarray(alpha))
    im = im.crop((x0, y0, x1, y1))

    out = os.path.abspath(args.out)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    im.save(out)
    print("wrote %s (%d x %d, %.0f%% transparent)"
          % (out, im.width, im.height, 100 * (np.asarray(im.getchannel("A")) < 250).mean()))


if __name__ == "__main__":
    main()
