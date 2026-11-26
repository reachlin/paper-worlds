#!/usr/bin/env python3
"""extract_bridges.py — turn an Overpass export of OSM bridge ways into a location's bridge decks.

Usage:
  /opt/miniconda3/envs/claude-sandbox/bin/python -I tools/extract_bridges.py \
      data/osm/bridges.json world/maps/centralpark.json world/maps/centralpark-bridges.json \
      [--preview world/maps/preview-bridges.png]

OSM.json   an Overpass `out geom` response for the location's bbox (query below)
LOCATION   the JSON extract_osm.py wrote (its crs and water decide which ways are on the lake)
OUT        the JSON world/locations.js loads next to the location

Only ways that really cross the location's water survive: `bridge=yes` (or man_made=bridge) with a
`highway` tag, length >= 3 m, and at least one sampled point inside the water polygons (even-odd;
holes dry). Each deck's ends are extended along their own direction until they touch dry land again
(<= 60 m), so the painted deck always meets the bank it serves.

Widths are a presentation choice (OSM rarely tags widths in the park): a named bridge 12 m, an
unnamed road 9 m, an unnamed footpath 6 m. Wide enough for the hero's feet at map scale 2.

QUERY (Overpass QL; data © OpenStreetMap contributors, ODbL 1.0):
  [out:json][timeout:90];
  ( way["bridge"]["highway"](40.761,-73.986,40.804,-73.945);
    way["man_made"="bridge"]["highway"](40.761,-73.986,40.804,-73.945); );
  out geom;
"""
import argparse
import json
import math
from datetime import datetime, timezone


def in_ring(x, y, ring):
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def make_water(loc):
    polys = loc["water"]
    for pg in polys:
        xs = [p[0] for p in pg["outer"]]
        ys = [p[1] for p in pg["outer"]]
        pg["_bb"] = (min(xs), min(ys), max(xs), max(ys))

    def wet(x, y):
        for pg in polys:
            x0, y0, x1, y1 = pg["_bb"]
            if not (x0 <= x <= x1 and y0 <= y <= y1):
                continue
            if not in_ring(x, y, pg["outer"]):
                continue
            if any(in_ring(x, y, h) for h in pg["holes"]):
                continue
            return True
        return False
    return wet


def length(pts):
    return sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(pts, pts[1:]))


def coverage(pts, wet, step=1.0):
    """share of points sampled every `step` m along the way that lie in water"""
    n = inside = 0
    for a, b in zip(pts, pts[1:]):
        seg = math.hypot(b[0] - a[0], b[1] - a[1])
        k = max(1, int(seg / step))
        for i in range(k + 1):
            x = a[0] + (b[0] - a[0]) * i / k
            y = a[1] + (b[1] - a[1]) * i / k
            n += 1
            inside += wet(x, y)
    return inside / n if n else 0.0


def extend_end(pts, at_start, wet, pad=2.0, cap=60.0):
    """Outward extension of one end until it is on dry land (+ pad m of overlap), so the deck meets
    the bank; an end already dry gets a small pad into it."""
    if at_start:
        end, inner = pts[0], pts[1]
    else:
        end, inner = pts[-1], pts[-2]
    dx, dy = end[0] - inner[0], end[1] - inner[1]
    L = math.hypot(dx, dy) or 1.0
    dx, dy = dx / L, dy / L
    if not wet(end[0], end[1]):
        d = pad
    else:
        d = None
        step = 1.0
        while step <= cap:
            if not wet(end[0] + dx * step, end[1] + dy * step):
                d = step + pad
                break
            step += 1.0
        if d is None:
            d = pad          # a dead end over water: leave a short stub, do not invent a landfall
    return [end[0] + dx * d, end[1] + dy * d]


def main():
    ap = argparse.ArgumentParser(description="OSM bridge ways -> location bridge decks")
    ap.add_argument("osm", help="Overpass JSON (out geom)")
    ap.add_argument("loc", help="location JSON from extract_osm.py")
    ap.add_argument("out", help="bridge JSON to write")
    ap.add_argument("--preview", help="PNG of the water + decks")
    args = ap.parse_args()

    loc = json.load(open(args.loc))
    osm = json.load(open(args.osm))
    crs = loc["crs"]
    lon0, lat0 = crs["lon0"], crs["lat0"]
    kx, ky = crs["mPerDegLon"], crs["mPerDegLat"]
    wet = make_water(loc)

    roads = {"secondary", "tertiary", "residential", "unclassified", "service"}
    bridges = []
    raw = []
    for e in osm.get("elements", []):
        t = e.get("tags") or {}
        if t.get("bridge") != "yes" and t.get("man_made") != "bridge":
            continue
        if t.get("railway") or t.get("area") == "yes":
            continue
        highway = t.get("highway") or "footway"   # man_made=bridge alone (Gapstow): a foot crossing
        geom = e.get("geometry") or []
        if len(geom) < 2:
            continue
        pts = [[(p["lon"] - lon0) * kx, (p["lat"] - lat0) * ky] for p in geom]
        if length(pts) < 3:
            continue
        raw.append({"osm": e.get("id"), "name": t.get("name") or "", "kind": highway, "pts": pts})

    # NOTE: same-name ways are NOT chained: OSM maps a bridge twice, as the centreline deck way
    # (bridge=yes) and as an area outline way (man_made=bridge, no highway: Bow Bridge's trace
    # zigzags back over itself). Chaining the two makes a tangled path; the dedupe below keeps
    # the simpler of the two.

    for w in raw:
        pts = w["pts"]
        cov = coverage(pts, wet)
        if cov <= 0:
            continue
        name = w["name"]
        width = 12.0 if name else (9.0 if w["kind"] in roads else 6.0)
        # the OSM way ends where the bridge does; the painted deck runs a little onto both banks
        pts = [extend_end(pts, True, wet)] + pts + [extend_end(pts, False, wet)]
        bridges.append({
            "osm": w["osm"],
            "name": name,
            "kind": w["kind"],
            "water": round(cov, 3),
            "width": width,
            "path": [[round(x, 1), round(y, 1)] for x, y in pts],
        })

    # one deck per crossing: same-name decks whose midpoints nearly coincide are one bridge drawn
    # twice — keep the one with the fewer points (the centreline, not the outline trace)
    seen, out = [], []
    for b in sorted(bridges, key=lambda b: len(b["path"])):
        mx = sum(p[0] for p in b["path"]) / len(b["path"])
        my = sum(p[1] for p in b["path"]) / len(b["path"])
        if any(b["name"] and s[2] == b["name"] and math.hypot(s[0] - mx, s[1] - my) < 12 for s in seen):
            continue
        if b["name"]:
            seen.append((mx, my, b["name"]))
        out.append(b)
    bridges = out

    bridges.sort(key=lambda b: (not b["name"], -length([tuple(p) for p in b["path"]])))
    out = {
        "id": loc.get("id", "") + "-bridges",
        "source": "OpenStreetMap contributors, ODbL 1.0",
        "query": 'way["bridge"]["highway"] + way["man_made"="bridge"]["highway"] over the location bbox, out geom',
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "crs": crs,
        "count": len(bridges),
        "bridges": bridges,
    }
    with open(args.out, "w") as f:
        json.dump(out, f, separators=(",", ":"))
        f.write("\n")

    names = [b["name"] for b in bridges if b["name"]]
    print(f"wrote {args.out}: {len(bridges)} bridge decks ({sum(1 for b in bridges if b['name'])} named)")
    print("named:", ", ".join(names))
    if bridges:
        print(f"lengths {min(length([tuple(p) for p in b['path']]) for b in bridges):.0f}"
              f"..{max(length([tuple(p) for p in b['path']]) for b in bridges):.0f} m")

    if args.preview:
        from PIL import Image, ImageDraw
        W = 1400
        x0, x1 = min(p[0] for b in bridges for p in b["path"]) - 80, max(p[0] for b in bridges for p in b["path"]) + 80
        y0, y1 = min(p[1] for b in bridges for p in b["path"]) - 80, max(p[1] for b in bridges for p in b["path"]) + 80
        S = min(W / (x1 - x0), 1600 / (y1 - y0))
        img = Image.new("RGB", (int((x1 - x0) * S), int((y1 - y0) * S)), (239, 232, 216))
        d = ImageDraw.Draw(img)
        P = lambda p: ((p[0] - x0) * S, (y1 - p[1]) * S)
        for pg in loc["water"]:
            d.polygon([P(p) for p in pg["outer"]], fill=(127, 163, 184))
            for h in pg["holes"]:
                d.polygon([P(p) for p in h], fill=(239, 232, 216))
        for b in bridges:
            pts = [P(p) for p in b["path"]]
            w = max(2, round(b["width"] * S / 2))
            d.line(pts, fill=(222, 216, 202), width=w)
            d.line(pts, fill=(79, 74, 68), width=max(1, w // 4))
            if b["name"]:
                mx = sum(p[0] for p in pts) / len(pts)
                my = sum(p[1] for p in pts) / len(pts)
                d.text((mx + 6, my + 3), b["name"], fill=(63, 58, 50))
        img.save(args.preview)
        print("preview:", args.preview, img.size)


if __name__ == "__main__":
    main()
