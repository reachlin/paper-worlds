#!/usr/bin/env python3
"""extract_roads.py — turn an Overpass export of OSM highway ways into a location's roads.

Usage:
  /opt/miniconda3/envs/claude-sandbox/bin/python -I tools/extract_roads.py \
      data/osm/roads.json world/maps/centralpark.json world/maps/centralpark-roads.json \
      [--preview world/maps/preview-roads.png]

OSM.json   an Overpass `out geom` response for the location's bbox
LOCATION   the JSON extract_osm.py wrote (its crs and water decide what is on the page)
OUT        the JSON world/locations.js loads next to the location

The page prints the real street network: avenues and cross streets (motorway..tertiary plus the
park drives named in --main-names) as asphalt ribbons with a kerb; every smaller lane and park
footpath as a pale paved line. Tunnels, steps, plazas, indoor ways, driveways and parking aisles
are left out. A way more than half over water is a bridge or a pier — the bridge decks own those
crossings, so the roads stop at the bank. Ways are kept whole when any part falls on the page.

Widths are a presentation choice, in metres: motorway 16, trunk 14, primary 13, secondary 11,
tertiary 9, links 8-10, residential 8, pedestrian 9, service 6, footways/paths 3-3.6.

QUERY (Overpass QL; data © OpenStreetMap contributors, ODbL 1.0):
  [out:json][timeout:180];
  way["highway"](40.761,-73.986,40.804,-73.945);
  out geom;
"""
import argparse
import json
import math
from datetime import datetime, timezone

MAIN_WIDTH = {
    "motorway": 16.0, "trunk": 14.0, "primary": 13.0, "secondary": 11.0, "tertiary": 9.0,
    "motorway_link": 10.0, "trunk_link": 9.5, "primary_link": 9.0, "secondary_link": 8.0,
    "tertiary_link": 7.0,
}
SMALL_WIDTH = {
    "residential": 8.0, "unclassified": 8.0, "living_street": 8.0, "pedestrian": 9.0,
    "service": 6.0, "cycleway": 3.6, "footway": 3.4, "path": 3.2, "bridleway": 4.5, "track": 4.5,
}
# presentation width for ways the per-map spec promotes to main roads (--main-names)
PROMOTED_WIDTH = 10.0
SKIP_KINDS = {"steps", "construction", "proposed", "raceway", "bus_guideway", "escape",
              "corridor", "elevator", "platform"}
SKIP_SERVICE = {"parking_aisle", "driveway", "emergency_access"}
MIN_LEN = 6.0
EPS_MAIN = 0.6
EPS_SMALL = 0.9


def length(pts):
    return sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(pts, pts[1:]))


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
    """Even-odd point-in-water over the location's polygons (holes stay dry)."""
    polys = loc["water"]
    for pg in polys:
        xs = [p[0] for p in pg["outer"]]
        ys = [p[1] for p in pg["outer"]]
        pg["_bb"] = (min(xs), min(ys), max(xs), max(ys))

    def wet(x, y):
        for pg in polys:
            x0, y0, x1, y1 = pg["_bb"]
            if not (x0 <= x <= x1 and y0 <= y <= y1) or not in_ring(x, y, pg["outer"]):
                continue
            if any(in_ring(x, y, h) for h in pg["holes"]):
                continue
            return True
        return False
    return wet


def water_share(pts, wet, step=5.0):
    n = inside = 0
    for a, b in zip(pts, pts[1:]):
        seg = math.hypot(b[0] - a[0], b[1] - a[1])
        k = max(1, int(seg / step))
        for i in range(k + 1):
            n += 1
            inside += wet(a[0] + (b[0] - a[0]) * i / k, a[1] + (b[1] - a[1]) * i / k)
    return inside / n if n else 0.0


def rdp(pts, eps):
    """Douglas-Peucker, iterative; keeps the ends."""
    n = len(pts)
    if n < 3:
        return pts
    keep = [False] * n
    keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    while stack:
        a, b = stack.pop()
        if b <= a + 1:
            continue
        ax, ay = pts[a]
        bx, by = pts[b]
        dx, dy = bx - ax, by - ay
        L2 = dx * dx + dy * dy
        best, bi = -1.0, -1
        for i in range(a + 1, b):
            px, py = pts[i]
            if L2 == 0:
                d = math.hypot(px - ax, py - ay)
            else:
                t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / L2))
                d = math.hypot(px - ax - dx * t, py - ay - dy * t)
            if d > best:
                best, bi = d, i
        if best > eps:
            keep[bi] = True
            stack.append((a, bi))
            stack.append((bi, b))
    return [p for i, p in enumerate(pts) if keep[i]]


def main():
    ap = argparse.ArgumentParser(description="OSM highway ways -> location roads")
    ap.add_argument("osm", help="Overpass JSON (out geom)")
    ap.add_argument("loc", help="location JSON from extract_osm.py")
    ap.add_argument("out", help="road JSON to write")
    ap.add_argument("--main-names", default="",
                    help="comma-separated way names promoted to main roads regardless of class")
    ap.add_argument("--preview", help="PNG of the water + roads")
    args = ap.parse_args()

    loc = json.load(open(args.loc))
    osm = json.load(open(args.osm))
    crs = loc["crs"]
    lon0, lat0 = crs["lon0"], crs["lat0"]
    kx, ky = crs["mPerDegLon"], crs["mPerDegLat"]
    bb = loc["bbox"]
    pad = 60.0                                     # metres of geometry kept past the page edge
    px0, px1 = (bb["w"] - lon0) * kx - pad, (bb["e"] - lon0) * kx + pad
    py0, py1 = (bb["s"] - lat0) * ky - pad, (bb["n"] - lat0) * ky + pad
    promoted = {s.strip() for s in args.main_names.split(",") if s.strip()}
    wet = make_water(loc)
    skipped_water = 0

    roads = []
    for e in osm.get("elements", []):
        t = e.get("tags") or {}
        kind = t.get("highway")
        name = (t.get("name") or "").strip()
        if not kind or kind in SKIP_KINDS or t.get("indoor") == "yes":
            continue
        if t.get("area") == "yes" and not (kind == "pedestrian" and name):
            continue      # plazas: only a named pedestrian area (Literary Walk, Columbus Circle) reads as a way
        if t.get("tunnel") in ("yes", "building_passage") or t.get("covered") == "yes":
            continue
        if kind == "service" and t.get("service") in SKIP_SERVICE:
            continue
        geom = e.get("geometry") or []
        if len(geom) < 2:
            continue
        pts = [[(p["lon"] - lon0) * kx, (p["lat"] - lat0) * ky] for p in geom]
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        if max(xs) < px0 or min(xs) > px1 or max(ys) < py0 or min(ys) > py1:
            continue
        L = length(pts)
        if L < MIN_LEN:
            continue
        # a way that lies over water is a bridge or a pier: the bridge decks own those crossings
        if water_share(pts, wet) > 0.5:
            skipped_water += 1
            continue
        main = kind in MAIN_WIDTH or (bool(name) and name in promoted)
        if main:
            width = max(MAIN_WIDTH.get(kind, 0.0), PROMOTED_WIDTH if name in promoted else 0.0)
            eps = EPS_MAIN
        else:
            width = SMALL_WIDTH.get(kind)
            if width is None:
                continue
            eps = EPS_SMALL
        pts = rdp(pts, eps)
        roads.append({
            "osm": e.get("id"),
            "name": name,
            "kind": kind,
            "main": main,
            "width": width,
            "len": round(length(pts), 1),
            "path": [[round(x, 1), round(y, 1)] for x, y in pts],
        })

    # the painter strokes small ways first and the main ribbons last, so junctions read clean
    roads.sort(key=lambda r: (r["main"], -r["len"]))
    out = {
        "id": loc.get("id", "") + "-roads",
        "source": "OpenStreetMap contributors, ODbL 1.0",
        "query": 'way["highway"] over the location bbox, out geom',
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "crs": crs,
        "count": len(roads),
        "roads": roads,
    }
    with open(args.out, "w") as f:
        json.dump(out, f, separators=(",", ":"))
        f.write("\n")

    main = [r for r in roads if r["main"]]
    named = {}
    for r in main:
        if r["name"]:
            named[r["name"]] = named.get(r["name"], 0) + r["len"]
    print(f"wrote {args.out}: {len(roads)} ways, {len(main)} main "
          f"({sum(r['len'] for r in main) / 1000:.1f} km), "
          f"{len(roads) - len(main)} small "
          f"({sum(r['len'] for r in roads if not r['main']) / 1000:.1f} km), "
          f"{skipped_water} over water skipped")
    print("named main roads:", ", ".join(f"{n} {L / 1000:.1f}km" for n, L in
                                         sorted(named.items(), key=lambda kv: -kv[1])[:30]))

    if args.preview:
        from PIL import Image, ImageDraw
        W = 1100
        x0, x1, y0, y1 = px0, px1, py0, py1
        S = min(W / (x1 - x0), 1200 / (y1 - y0))
        img = Image.new("RGB", (int((x1 - x0) * S), int((y1 - y0) * S)), (239, 232, 216))
        d = ImageDraw.Draw(img)
        P = lambda p: ((p[0] - x0) * S, (y1 - p[1]) * S)
        for pg in loc["water"]:
            d.polygon([P(p) for p in pg["outer"]], fill=(127, 163, 184))
            for h in pg["holes"]:
                d.polygon([P(p) for p in h], fill=(239, 232, 216))
        for r in roads:
            pts = [P(p) for p in r["path"]]
            if r["main"]:
                d.line(pts, fill=(139, 131, 120), width=max(3, round((r["width"] + 2) * S)))
                d.line(pts, fill=(185, 179, 167), width=max(2, round(r["width"] * S)))
            else:
                d.line(pts, fill=(211, 205, 193), width=max(1, round(r["width"] * S)))
        img.save(args.preview)
        print("preview:", args.preview, img.size)


if __name__ == "__main__":
    main()
