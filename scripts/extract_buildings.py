#!/usr/bin/env python3
"""extract_buildings.py — building footprints -> the location's buildings layer.

Usage (OSM, anywhere):
  /opt/miniconda3/envs/claude-sandbox/bin/python -I scripts/extract_buildings.py \
      world/maps/<id>.json world/maps/<id>-buildings.json --osm data/osm/buildings.json

Usage (NYC, Open Data):
  /opt/miniconda3/envs/claude-sandbox/bin/python -I scripts/extract_buildings.py \
      world/maps/<id>.json world/maps/<id>-buildings.json [--raw data/nyc-buildings/raw.geojson]

LOCATION   the JSON extract_osm.py wrote (bbox, crs)
OUT        the JSON world/locations.js loads next to the location

--osm reads an Overpass `building=*` export (out geom): each closed way becomes a footprint;
heights come from the `height` tag, else `building:levels` x 3 m, else a deterministic fallback
from footprint area + a seeded RNG, so the skyline is stable across reloads.

Without --osm, the NYC Open Data Building Footprints (Socrata id 5zhs-2jue) are downloaded for the
location bbox, projected, simplified, and kept with their height_roof (feet -> metres).
Source: https://data.cityofnewyork.us/Housing-Development/Building-Footprints/5zhs-2jue
Licence: City of New York open data terms — verify before publication; record the download date.
"""
import argparse
import json
import math
import os
import urllib.request
from datetime import datetime, timezone

DATASET = "https://data.cityofnewyork.us/resource/5zhs-2jue.geojson"
LIMIT = 50000
EPS = 0.8              # simplify tolerance, metres
MIN_AREA = 12.0        # drop sheds and vents
MAX_H = 120.0          # the tallest towers read as the skyline, not a fence


def ring_area(pts):
    s = 0.0
    for (x1, y1), (x2, y2) in zip(pts, pts[1:] + pts[:1]):
        s += x1 * y2 - x2 * y1
    return abs(s) / 2


def rdp(pts, eps):
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


def fallback_height(pts):
    """Deterministic height from footprint area + a seeded RNG (stable across reloads)."""
    cx = sum(p[0] for p in pts) / len(pts)
    cy = sum(p[1] for p in pts) / len(pts)
    seed = abs(hash((round(cx), round(cy)))) % 1000 / 1000
    return min(MAX_H, 4.0 + math.sqrt(ring_area(pts)) * 0.2 + seed * 5.0)


def osm_buildings(osm_path, crs):
    """Overpass building=* export (out geom) -> footprints in local metres."""
    osm = json.load(open(osm_path))
    kx, ky = crs["mPerDegLon"], crs["mPerDegLat"]
    lon0, lat0 = crs["lon0"], crs["lat0"]
    buildings = []
    for e in osm.get("elements", []):
        t = e.get("tags") or {}
        if not t.get("building"):
            continue
        geom = e.get("geometry") or []
        if len(geom) < 4:
            continue
        pts = [[(p["lon"] - lon0) * kx, (p["lat"] - lat0) * ky] for p in geom]
        if math.hypot(pts[0][0] - pts[-1][0], pts[0][1] - pts[-1][1]) > 1e-3:
            continue
        if ring_area(pts) < MIN_AREA:
            continue
        pts = rdp(pts, EPS)
        if len(pts) < 4:
            continue
        h = None
        try:
            h = float(t.get("height") or 0) or None
        except ValueError:
            h = None
        if not h:
            try:
                h = float(t.get("building:levels") or 0) * 3.0 or None
            except ValueError:
                h = None
        if not h:
            h = fallback_height(pts)
        buildings.append({
            "osm": e.get("id"),
            "name": t.get("name"),
            "height": round(min(MAX_H, h), 1),
            "area": round(ring_area(pts), 1),
            "outer": [[round(x, 1), round(y, 1)] for x, y in pts],
        })
    return buildings


def nyc_buildings(raw_path, bb, crs):
    """NYC Open Data footprints for the bbox -> local metres."""
    if os.path.exists(raw_path):
        print(f"using cached {raw_path}")
        doc = json.load(open(raw_path))
    else:
        where = f"within_box(the_geom,{bb['s']},{bb['w']},{bb['n']},{bb['e']})"
        feats, offset = [], 0
        while True:
            url = f"{DATASET}?$where={where}&$limit={LIMIT}&$offset={offset}"
            print(f"fetching offset {offset} ...", flush=True)
            with urllib.request.urlopen(url, timeout=120) as r:
                doc = json.loads(r.read())
            got = doc.get("features", [])
            feats.extend(got)
            if len(got) < LIMIT:
                break
            offset += LIMIT
        print(f"fetched {len(feats)} footprints")
        os.makedirs(os.path.dirname(raw_path), exist_ok=True)
        json.dump({"type": "FeatureCollection", "features": feats}, open(raw_path, "w"))
        doc = {"features": feats}
    kx, ky = crs["mPerDegLon"], crs["mPerDegLat"]
    lon0, lat0 = crs["lon0"], crs["lat0"]
    buildings, dropped, h_from, h_miss = [], 0, 0, 0
    for f in doc.get("features", []):
        geom = f.get("geometry") or {}
        if geom.get("type") != "MultiPolygon":
            continue
        props = f.get("properties") or {}
        for poly in geom.get("coordinates") or []:
            ring = poly[0]
            if len(ring) < 4:
                dropped += 1
                continue
            pts = [[(p[0] - lon0) * kx, (p[1] - lat0) * ky] for p in ring]
            if ring_area(pts) < MIN_AREA:
                dropped += 1
                continue
            pts = rdp(pts, EPS)
            if len(pts) < 4:
                dropped += 1
                continue
            hft = props.get("height_roof", props.get("heightroof"))
            try:
                hft = float(hft)
            except (TypeError, ValueError):
                hft = None
            if hft and hft > 0:
                h = min(MAX_H, hft * 0.3048)
                h_from += 1
            else:
                h = fallback_height(pts)
                h_miss += 1
            buildings.append({
                "osm": None,
                "height": round(h, 1),
                "area": round(ring_area(pts), 1),
                "outer": [[round(x, 1), round(y, 1)] for x, y in pts],
            })
    return buildings, dropped, h_from, h_miss


def main():
    ap = argparse.ArgumentParser(description="building footprints -> location buildings")
    ap.add_argument("loc", help="location JSON from extract_osm.py")
    ap.add_argument("out", help="buildings JSON to write")
    ap.add_argument("--raw", default="data/nyc-buildings/raw.geojson",
                    help="cache path for the raw NYC download")
    ap.add_argument("--osm", default=None,
                    help="an Overpass building=* export (out geom): use it instead of NYC Open Data")
    ap.add_argument("--preview", help="PNG of the footprints")
    args = ap.parse_args()

    loc = json.load(open(args.loc))
    crs = loc["crs"]

    if args.osm:
        buildings = osm_buildings(args.osm, crs)
        dropped, h_from, h_miss = 0, 0, len(buildings)
        source = "OpenStreetMap building=* (out geom)"
        licence = "OpenStreetMap contributors, ODbL 1.0"
    else:
        buildings, dropped, h_from, h_miss = nyc_buildings(args.raw, loc["bbox"], crs)
        source = "NYC Open Data Building Footprints (5zhs-2jue)"
        licence = "City of New York open data terms — verify before publication"

    out = {
        "id": loc.get("id", "") + "-buildings",
        "source": source,
        "licence": licence,
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "crs": crs,
        "count": len(buildings),
        "heights": {"from_data": h_from, "derived": h_miss, "max_m": MAX_H},
        "buildings": buildings,
    }
    with open(args.out, "w") as f:
        json.dump(out, f, separators=(",", ":"))
        f.write("\n")
    print(f"wrote {args.out}: {len(buildings)} buildings "
          f"({h_from} with data heights, {h_miss} derived, {dropped} rings dropped)")

    if args.preview and buildings:
        from PIL import Image, ImageDraw
        W = 1200
        x0, x1 = min(min(p[0] for p in b["outer"]) for b in buildings), max(max(p[0] for p in b["outer"]) for b in buildings)
        y0, y1 = min(min(p[1] for p in b["outer"]) for b in buildings), max(max(p[1] for p in b["outer"]) for b in buildings)
        S = min(W / (x1 - x0), 1400 / (y1 - y0))
        img = Image.new("RGB", (int((x1 - x0) * S), int((y1 - y0) * S)), (239, 232, 216))
        d = ImageDraw.Draw(img)
        P = lambda p: ((p[0] - x0) * S, (y1 - p[1]) * S)
        for b in buildings:
            c = int(min(255, 120 + b["height"] * 1.2))
            d.polygon([P(p) for p in b["outer"]], fill=(c, c - 20, c - 30))
        img.save(args.preview)
        print("preview:", args.preview, img.size)


if __name__ == "__main__":
    main()
