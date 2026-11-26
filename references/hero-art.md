# Hero art — the default player and your own figure

The world always has a player. Out of the box it is the **drawn calico cat** (world/cat.js):
a side-view paper card that trots with a two-pose walk — legs gathered, legs reached — swapped no
faster than paper can flap, the way papertrails animates its critters. Two ways to replace it:

## 1. The calico cat, painted (three-pose sheet)

Generate ONE wide image, three poses side by side on a flat magenta plate, all facing RIGHT, then:

```sh
/opt/miniconda3/envs/claude-sandbox/bin/python -I scripts/cat-views.py ~/Downloads/cat-sheet.jpeg assets
```

That writes `assets/cat-stand.png`, `assets/cat-walk-a.png`, `assets/cat-walk-b.png`; the world
prints them and keeps the same trot. Prompt (copy-paste):

> Three side-view poses of the same calico cat, side by side in one wide image on a flat magenta
> plate, all facing RIGHT, one paper cut-out each. LEFT: the cat standing, tail up in a gentle
> curve. MIDDLE: the cat walking, legs gathered under the body — a trot's passing pose. RIGHT: the
> cat walking, legs spread front and back — the trot's reach pose. All three cats are the same size
> with their feet on one baseline, centered in their third of the image with a small empty margin
> all round. Each is one connected figure: ears on the head, legs attached to the body, tail
> attached — nothing floats or detaches. A plump calico cat: cream-white body with soft orange and
> charcoal-grey patches, pink nose, green eyes, a dark tail. Hand-painted gouache and ink
> illustration with subtle paper grain, soft flat shading, simple bold shapes and a clean readable
> outline; the look of a vintage storybook plate, readable at small size. Flat even lighting, no
> cast shadow, no ground, no scenery. Background: perfectly flat, uniform, solid magenta #FF00FF
> from edge to edge, like a green-screen plate — no gradient, no vignette, no texture, no shadow.
> Three poses of one cat only. No text, no watermark, no border, no frame.

Negative prompt (if the tool has a field): front view, human, more than three cats, background
scenery, cast shadow, ground, gradient background, off-white background, text, watermark, frame,
detached parts, thin stray strands, motion blur, 3D render, photorealistic

## 2. Your own figure (the three-view standee)

The classic hero: front / back / side (facing right) views, each a full-length figure on a
transparent background, one connected piece. Same pipeline as the demo repos:

```sh
/opt/miniconda3/envs/claude-sandbox/bin/python -I scripts/hero-image.py ~/Downloads/hero-front.png assets
/opt/miniconda3/envs/claude-sandbox/bin/python -I scripts/hero-views.py ~/Downloads/hero-back-side.png assets
```

Writes `assets/hero.png`, `hero-back.png`, `hero-side.png`; the standee takes over from the cat
automatically. The full generation prompts are in the demo repos' `assets/README.md`.
