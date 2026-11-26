#!/usr/bin/env python3
"""extract_sites.py — the landmark sites of Central Park, from OpenStreetMap.

Usage:
  /opt/miniconda3/envs/claude-sandbox/bin/python -I tools/extract_sites.py \
      data/osm/sites.json world/maps/centralpark.json world/maps/centralpark-sites.json

OSM.json   an Overpass `out tags center` response for the park bbox
LOCATION   the JSON extract_osm.py wrote (its crs turns lon/lat into local metres)
OUT        the JSON world/locations.js loads next to the location

One element per landmark. Preference: a memorial node (the exact spot), then tourism=attraction,
then historic/building, then any named element. Duplicate names (Strawberry Fields appears seven
times) resolve to the best-ranked element; its centre is stored in the location's local metres.

QUERY (Overpass QL; data (c) OpenStreetMap contributors, ODbL 1.0):
  [out:json][timeout:60];
  nwr["name"](40.761,-73.986,40.804,-73.945);
  out tags center;
"""
import argparse
import json
from datetime import datetime, timezone

# the landmark set: taken from the spec's "sites" list, or --names at the command line

# how well an element marks the landmark
RANK = [("historic", "memorial"), ("tourism", "viewpoint"), ("tourism", "attraction"),
        ("historic", "castle"), ("tourism", "zoo"), ("leisure", "garden"),
        ("building", "yes"), ("leisure", "park"), ("natural", "water")]


def rank(tags):
    for i, (k, v) in enumerate(RANK):
        if tags.get(k) == v:
            return len(RANK) - i
    return 0


def kind(tags):
    for k, v in RANK:
        if tags.get(k) == v:
            return v
    return tags.get("tourism") or tags.get("historic") or tags.get("leisure") or ""


def centre(e):
    if e["type"] == "node":
        return e["lon"], e["lat"]
    c = e.get("center")
    if c and c.get("lon") is not None:
        return c["lon"], c["lat"]
    return None


def main():
    ap = argparse.ArgumentParser(description="OSM elements -> Central Park site markers")
    ap.add_argument("osm", help="Overpass JSON (out tags center)")
    ap.add_argument("loc", help="location JSON from extract_osm.py")
    ap.add_argument("out", help="site JSON to write")
    ap.add_argument("--names", default=None,
                    help="comma-separated landmark names (else the spec's \"sites\" list)")
    args = ap.parse_args()

    loc = json.load(open(args.loc))
    osm = json.load(open(args.osm))
    crs = loc["crs"]
    lon0, lat0 = crs["lon0"], crs["lat0"]
    kx, ky = crs["mPerDegLon"], crs["mPerDegLat"]

    SITES = [n.strip() for n in (args.names or "").split(",") if n.strip()] \
        or [s.get("name") for s in loc.get("sites") or []] \
        or [s.get("name") for s in loc.get("labels") or []]
    if not SITES:
        raise SystemExit("no site names: pass --names or put a \"sites\" list in the spec")

    best = {}
    for e in osm.get("elements", []):
        t = e.get("tags") or {}
        name = t.get("name")
        if name not in SITES:
            continue
        c = centre(e)
        if c is None:
            continue
        r = rank(t)
        if name not in best or r > best[name]["rank"]:
            best[name] = {"rank": r, "kind": kind(t), "type": e["type"], "osm": e["id"],
                          "lon": c[0], "lat": c[1]}

    missing = [n for n in SITES if n not in best]
    if missing:
        print("no OSM element for:", ", ".join(missing))

    sites = []
    for name in SITES:
        if name not in best:
            continue
        s = best[name]
        x = (s["lon"] - lon0) * kx
        y = (s["lat"] - lat0) * ky
        sites.append({
            "name": name,
            "kind": s["kind"],
            "osm": {"type": s["type"], "id": s["osm"]},
            "lon": round(s["lon"], 6), "lat": round(s["lat"], 6),
            "x": round(x, 1), "y": round(y, 1),
        })

    out = {
        "id": loc.get("id", "") + "-sites",
        "title": "Central Park landmarks",
        "source": "OpenStreetMap contributors, ODbL 1.0",
        "query": 'nwr["name"] over the park bbox, out tags center',
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "crs": crs,
        "count": len(sites),
        "sites": sites,
    }
    with open(args.out, "w") as f:
        json.dump(out, f, indent=1)
        f.write("\n")
    for s in sites:
        print(f"{s['name']:<36} {s['kind']:<12} {s['osm']['type']} {s['osm']['id']:<10} "
              f"local ({s['x']:8.1f}, {s['y']:8.1f})")
    print(f"wrote {args.out}: {len(sites)} sites")


if __name__ == "__main__":
    main()
