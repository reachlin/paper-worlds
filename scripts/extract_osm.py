#!/usr/bin/env python3
"""extract_osm.py — turn the raw Overpass water + land exports into the location's map JSON.

Usage:
  /opt/miniconda3/envs/claude-sandbox/bin/python -I tools/extract_osm.py \
      data/osm/water.json data/osm/land.json world/maps/centralpark.spec.json \
      world/maps/centralpark.json --preview world/maps/preview-map.png

WATER.json  Overpass `out geom` of natural=water / waterway=riverbank in the bbox
LAND.json   Overpass `out geom` of park / grass / wood polygons in the bbox
SPEC.json   world/maps/centralpark.spec.json (bbox, crs, world bounds, provisional start)
OUT         the map JSON world/locations.js loads

Everything is projected to the spec's local metres (x east, y north). Multipolygon relations are
assembled by chaining their members' open rings end to end; each role=outer ring becomes one water
polygon, role=inner rings are its holes (assigned by containment). Rings are simplified to ~1.2 m
and tiny water bodies (fountains, basins, gutters) are dropped: at map scale they are noise.

The provisional start (Bethesda Fountain) is verified against the water polygons and settled to
the nearest dry ground if it lands in a basin.

Data © OpenStreetMap contributors, ODbL 1.0.
"""
import argparse
import json
import math
from datetime import datetime, timezone

# presentation thresholds, in local metres (real size, before mapScale)
EPS = 1.2                 # RDP simplify tolerance
MIN_WATER_AREA = 400.0    # drop fountain basins, gutters and puddles
MIN_HOLE_AREA = 300.0     # keep real islands
MIN_LAND_AREA = 600.0     # drop flower beds and traffic islands
PAD = 60.0                # metres of geometry kept past the page edge

# land kinds, best first: a polygon with several tags takes the first that matches
LAND_KINDS = [
    ("natural", "wood", "wood"), ("landuse", "forest", "wood"),
    ("natural", "scrub", "wood"), ("natural", "bare_rock", "rock"),
    ("natural", "rock", "rock"),
    ("landuse", "grass", "lawn"), ("landuse", "meadow", "lawn"),
    ("landuse", "recreation_ground", "lawn"), ("natural", "grassland", "lawn"),
    ("landuse", "village_green", "lawn"),
    ("leisure", "park", "park"), ("leisure", "garden", "park"),
    ("leisure", "nature_reserve", "park"),
]
SKIP_LAND = {"water", "reservoir", "basin", "fountain"}


def length(pts):
    return sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(pts, pts[1:]))


def ring_area(ring):
    s = 0.0
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        s += x1 * y2 - x2 * y1
    return abs(s) / 2


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


class Assembler:
    """Way/relation elements -> closed rings in local metres."""

    def __init__(self, crs):
        self.kx = crs["mPerDegLon"]
        self.ky = crs["mPerDegLat"]
        self.lon0 = crs["lon0"]
        self.lat0 = crs["lat0"]

    def to_local(self, geom):
        return [[(p["lon"] - self.lon0) * self.kx, (p["lat"] - self.lat0) * self.ky]
                for p in geom]

    def member_rings(self, members, role):
        """Chain the role's member geometries into closed rings."""
        open_rings, closed = [], []
        for m in members:
            if m.get("role") != role or not m.get("geometry"):
                continue
            pts = self.to_local(m["geometry"])
            if len(pts) < 2:
                continue
            if math.hypot(pts[0][0] - pts[-1][0], pts[0][1] - pts[-1][1]) < 1e-3:
                closed.append(pts)
            else:
                open_rings.append(pts)
        # chain open rings end to end until no two ends meet (OSM members share exact nodes)
        def meets(a, b):
            return math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-3

        changed = True
        while changed and len(open_rings) > 1:
            changed = False
            merged = None
            for i in range(len(open_rings)):
                for j in range(i + 1, len(open_rings)):
                    for r, o in ((open_rings[i], open_rings[j]),
                                 (open_rings[i], list(reversed(open_rings[j]))),
                                 (list(reversed(open_rings[i])), open_rings[j]),
                                 (list(reversed(open_rings[i])), list(reversed(open_rings[j])))):
                        if meets(r[-1], o[0]):
                            merged = (i, j, r[:-1] + o)
                            break
                    if merged:
                        break
                if merged:
                    break
            if merged:
                i, j, joined = merged
                open_rings = [r for k, r in enumerate(open_rings) if k != i and k != j]
                if meets(joined[0], joined[-1]):
                    closed.append(joined)
                else:
                    open_rings.append(joined)
                changed = True
        return closed

    def element_rings(self, e):
        """The closed rings of one element, split by role."""
        if e["type"] == "way":
            pts = self.to_local(e.get("geometry") or [])
            if len(pts) >= 4 and math.hypot(pts[0][0] - pts[-1][0], pts[0][1] - pts[-1][1]) < 1e-3:
                return [pts], []
            return [], []
        members = e.get("members", [])
        outers = self.member_rings(members, "outer")
        inners = self.member_rings(members, "inner")
        return outers, inners


def clean(ring):
    ring = rdp(ring, EPS)
    if len(ring) >= 4 and ring[0] == ring[-1]:
        ring = ring[:-1]
    return ring


def bbox(ring):
    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    return min(xs), min(ys), max(xs), max(ys)


def on_page(b, page):
    return not (b[2] < page[0] or b[0] > page[1] or b[3] < page[2] or b[1] > page[3])


def assemble_polys(osm_path, kind_fn, min_area, asm, page):
    """Water or land: one list of polygons [{outer, holes, name?, kind?}]."""
    osm = json.load(open(osm_path))
    polys, dropped = [], 0
    for e in osm.get("elements", []):
        t = e.get("tags") or {}
        kind = kind_fn(t)
        if kind is None:
            continue
        outers, inners = asm.element_rings(e)
        for outer in outers:
            outer = clean(outer)
            if len(outer) < 4 or ring_area(outer) < min_area:
                dropped += 1
                continue
            if not on_page(bbox(outer), page):
                continue
            holes = []
            for h in inners:
                h = clean(h)
                if len(h) < 4 or ring_area(h) < MIN_HOLE_AREA:
                    continue
                if in_ring(h[0][0], h[0][1], outer):
                    holes.append(h)
            poly = {"outer": [[round(x, 1), round(y, 1)] for x, y in outer],
                    "holes": [[[round(x, 1), round(y, 1)] for x, y in h] for h in holes]}
            if t.get("name"):
                poly["name"] = t["name"]
            if kind:
                poly["kind"] = kind
            polys.append(poly)
    return polys, dropped


def make_wet(polys):
    """Even-odd point-in-water (holes dry)."""
    for pg in polys:
        pg["_bb"] = bbox(pg["outer"])

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


def settle_start(x, y, wet, max_r=400.0):
    if not wet(x, y):
        return x, y, 0.0
    r = 4.0
    while r <= max_r:
        n = max(24, int(r * 0.5))
        for i in range(n):
            a = i / n * math.tau + r * 0.37
            px, py = x + math.cos(a) * r, y + math.sin(a) * r
            if not wet(px, py):
                return px, py, r
        r *= 1.25
    return None


def water_kind(t):
    if t.get("natural") == "water" or t.get("water") in ("lake", "pond", "reservoir", "river"):
        return None if t.get("water") in ("basin", "fountain", "stream", "ditch", "canal") else "water"
    if t.get("waterway") in ("riverbank",):
        return "water"
    return None


def land_kind(t):
    if t.get("natural") == "water" or t.get("water") in SKIP_LAND or t.get("waterway"):
        return None
    for k, v, kind in LAND_KINDS:
        if t.get(k) == v:
            return kind
    return None


def main():
    ap = argparse.ArgumentParser(description="Overpass water+land exports -> location map JSON")
    ap.add_argument("water", help="Overpass JSON of the water layer (out geom)")
    ap.add_argument("land", help="Overpass JSON of the land layer (out geom)")
    ap.add_argument("spec", help="the location spec (bbox, crs, world, start)")
    ap.add_argument("out", help="map JSON to write")
    ap.add_argument("--preview", help="PNG of the assembled map")
    args = ap.parse_args()

    spec = json.load(open(args.spec))
    crs = spec["crs"]
    bb = spec["bbox"]
    kx, ky = crs["mPerDegLon"], crs["mPerDegLat"]
    page = ((bb["w"] - crs["lon0"]) * kx - PAD, (bb["e"] - crs["lon0"]) * kx + PAD,
            (bb["s"] - crs["lat0"]) * ky - PAD, (bb["n"] - crs["lat0"]) * ky + PAD)
    asm = Assembler(crs)

    water, wdrop = assemble_polys(args.water, water_kind, MIN_WATER_AREA, asm, page)
    land, ldrop = assemble_polys(args.land, land_kind, MIN_LAND_AREA, asm, page)
    print(f"water: {len(water)} polygons ({wdrop} rings dropped), "
          f"land: {len(land)} polygons ({ldrop} rings dropped)")
    for pg in water:
        print(f"  water {pg.get('name') or '(unnamed)'} "
              f"{ring_area([tuple(p) for p in pg['outer']]) / 1e4:.1f} ha, {len(pg['holes'])} holes")
    kinds = {}
    for pg in land:
        kinds[pg["kind"]] = kinds.get(pg["kind"], 0) + 1
    print("  land kinds:", dict(sorted(kinds.items(), key=lambda kv: -kv[1])))

    # the provisional start: dry land or the nearest dry point
    sx = (spec["start"]["lon"] - crs["lon0"]) * kx
    sy = (spec["start"]["lat"] - crs["lat0"]) * ky
    wet = make_wet(water)
    settled = settle_start(sx, sy, wet)
    if settled is None:
        raise SystemExit("no dry land found near the start — check the water assembly")
    sx, sy, moved = settled
    if moved:
        print(f"start was water at this scale; settled {moved:.0f} m to dry land")

    out = {
        "id": spec["id"],
        "name": spec["name"],
        "source": "OpenStreetMap contributors, ODbL 1.0",
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "tool": "tools/extract_osm.py",
        "crs": crs,
        "bbox": bb,
        "world": spec["world"],
        "start": {**spec["start"], "x": round(sx, 1), "y": round(sy, 1),
                  "note": f"settled {moved:.0f} m" if moved else "dry as surveyed"},
        "water": water,
        "land": land,
    }
    with open(args.out, "w") as f:
        json.dump(out, f, separators=(",", ":"))
        f.write("\n")
    print(f"wrote {args.out}")

    if args.preview:
        from PIL import Image, ImageDraw
        W = 1100
        x0, x1, y0, y1 = page
        S = min(W / (x1 - x0), 1200 / (y1 - y0))
        img = Image.new("RGB", (int((x1 - x0) * S), int((y1 - y0) * S)), (239, 232, 216))
        d = ImageDraw.Draw(img)
        P = lambda p: ((p[0] - x0) * S, (y1 - p[1]) * S)
        col = {"park": (111, 138, 82), "wood": (85, 112, 61), "lawn": (137, 162, 103),
               "rock": (184, 179, 168)}
        for pg in land:
            d.polygon([P(p) for p in pg["outer"]], fill=col.get(pg["kind"], (150, 150, 140)))
            for h in pg["holes"]:
                d.polygon([P(p) for p in h], fill=(239, 232, 216))
        for pg in water:
            d.polygon([P(p) for p in pg["outer"]], fill=(127, 163, 184))
            for h in pg["holes"]:
                d.polygon([P(p) for p in h], fill=(239, 232, 216))
        d.ellipse([P((sx, sy))[0] - 3, P((sx, sy))[1] - 3, P((sx, sy))[0] + 3, P((sx, sy))[1] + 3], fill=(187, 53, 38))
        img.save(args.preview)
        print("preview:", args.preview, img.size)


if __name__ == "__main__":
    main()
