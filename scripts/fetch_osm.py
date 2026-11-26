#!/usr/bin/env python3
"""fetch_osm.py — download the raw OSM layers for one map bbox.

Usage:
  /opt/miniconda3/envs/claude-sandbox/bin/python -I tools/fetch_osm.py \
      --bbox -73.986,40.761,-73.945,40.804 \
      --out data/osm --layers water,land,roads,bridges,pois

  # one layer
  ... --layers water

The output is the raw Overpass JSON (`out geom`), one file per layer, plus `meta.json`.
Nothing is projected, clipped or simplified here: that is the extractor's job, so the raw download
stays auditable.

OSM data © OpenStreetMap contributors, ODbL 1.0. Keep the attribution on the published page.

Overpass is a shared public service. This tool makes one request at a time, retries with exponential
backoff on 429/502/503/504, and does not fan out across mirrors. If the endpoint stays at capacity,
use a Geofabrik state extract + `osmium extract -b` instead and record that in meta.json.
"""
import argparse
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

DEFAULT_ENDPOINT = "https://overpass-api.de/api/interpreter"
USER_AGENT = "paper-nyc-map-pipeline/0.1 (one-map-at-a-time; OSM ODbL)"

# The first slice's named POIs. Override with --poi-regex for another map.
CENTRAL_PARK_POIS = [
    "Bethesda Terrace", "Bethesda Fountain", "Bow Bridge", "Belvedere Castle",
    "Strawberry Fields", "The Mall", "Jacqueline Kennedy Onassis Reservoir",
    "Harlem Meer", "Conservatory Garden", "Gapstow Bridge", "Central Park Zoo",
    "The Lake", "The Pond", "Turtle Pond", "Conservatory Water", "The Ramble",
    "Sheep Meadow", "Great Lawn",
]


def overpass_query(bbox, layer, poi_regex=None):
    b = bbox
    if layer == "water":
        body = f"""
  way["natural"="water"]({b});
  relation["natural"="water"]({b});
  way["waterway"="riverbank"]({b});
  relation["waterway"="riverbank"]({b});"""
        return f"[out:json][timeout:180];({body}\n);out geom;"
    if layer == "land":
        body = f"""
  way["leisure"="park"]({b});
  relation["leisure"="park"]({b});
  way["landuse"~"grass|forest|meadow|recreation_ground"]({b});
  relation["landuse"~"grass|forest|meadow|recreation_ground"]({b});
  way["natural"~"wood|scrub|grassland|sand|beach"]({b});
  relation["natural"~"wood|scrub|grassland|sand|beach"]({b});
  way["natural"="coastline"]({b});"""
        return f"[out:json][timeout:180];({body}\n);out geom;"
    if layer == "roads":
        return f'[out:json][timeout:180];way["highway"]({b});out geom;'
    if layer == "bridges":
        # man_made=bridge without a highway tag (Gapstow Bridge, Bow Bridge's attraction way) are
        # still crossings: the extractor treats them as footways and chains them to their deck way.
        body = f"""
  way["bridge"]["highway"]({b});
  way["man_made"="bridge"]({b});"""
        return f"[out:json][timeout:120];({body}\n);out geom;"
    if layer == "sites":
        names = poi_regex or "|".join(CENTRAL_PARK_POIS)
        return (f'[out:json][timeout:120];'
                f'nwr["name"~"({names})"]({b});out tags center;')
    if layer == "buildings":
        # Prefer NYC Open Data for Manhattan footprints. This OSM query is a fallback and can be big.
        body = f"""
  way["building"]({b});
  relation["building"]({b});"""
        return f"[out:json][timeout:240];({body}\n);out geom;"
    raise ValueError(f"unknown layer: {layer}")


def post(endpoint, query, attempts=5):
    data = urllib.parse.urlencode({"data": query}).encode()
    wait = 5
    for i in range(1, attempts + 1):
        req = urllib.request.Request(endpoint, data=data, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                body = r.read()
            try:
                return json.loads(body)
            except json.JSONDecodeError:
                head = body[:300].decode("utf-8", "replace")
                raise RuntimeError(f"endpoint did not return JSON: {head!r}")
        except urllib.error.HTTPError as e:
            if e.code not in (429, 502, 503, 504) or i == attempts:
                raise
            print(f"  HTTP {e.code}; retry {i}/{attempts - 1} in {wait}s", file=sys.stderr)
        except urllib.error.URLError as e:
            if i == attempts:
                raise
            print(f"  network error ({e.reason}); retry in {wait}s", file=sys.stderr)
        time.sleep(wait)
        wait *= 2
    raise RuntimeError("unreachable")


def main():
    ap = argparse.ArgumentParser(description="Download raw Overpass JSON for a map bbox.")
    ap.add_argument("--bbox", required=True, help="W,S,E,N in WGS84, e.g. -73.986,40.761,-73.945,40.804")
    ap.add_argument("--out", required=True, help="output directory, e.g. data/osm")
    ap.add_argument("--layers", default="water,land,roads,bridges,sites",
                    help="comma list: water,land,roads,bridges,sites,buildings,all")
    ap.add_argument("--endpoint", default=DEFAULT_ENDPOINT)
    ap.add_argument("--poi-regex", default=None, help="override the site-name regex")
    ap.add_argument("--dry-run", action="store_true", help="print queries, download nothing")
    args = ap.parse_args()

    parts = [p.strip() for p in args.bbox.split(",")]
    if len(parts) != 4:
        ap.error("--bbox needs four comma-separated numbers: W,S,E,N")
    w, s, e, n = (float(p) for p in parts)
    # Overpass QL order is (south,west,north,east); the CLI takes the friendlier W,S,E,N.
    bbox = f"{s:g},{w:g},{n:g},{e:g}"
    layers = ["water", "land", "roads", "bridges", "sites", "buildings"] if args.layers == "all" \
        else [l.strip() for l in args.layers.split(",") if l.strip()]

    import os
    os.makedirs(args.out, exist_ok=True)
    meta = {
        "bbox_wgs84": {"w": w, "s": s, "e": e, "n": n},
        "overpass_bbox": bbox,
        "endpoint": args.endpoint,
        "layers": layers,
        "fetched_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "attribution": "© OpenStreetMap contributors, ODbL 1.0",
    }

    for layer in layers:
        query = overpass_query(bbox, layer, args.poi_regex)
        if args.dry_run:
            print(f"--- {layer}\n{query}\n")
            continue
        print(f"{layer}: querying {args.endpoint}", flush=True)
        doc = post(args.endpoint, query)
        path = os.path.join(args.out, f"{layer}.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(doc, f, ensure_ascii=False)
        n = len(doc.get("elements", []))
        print(f"{layer}: {n} elements -> {path}", flush=True)
        time.sleep(1)

    if not args.dry_run:
        path = os.path.join(args.out, "meta.json")
        if os.path.exists(path):
            with open(path, encoding="utf-8") as f:
                old = json.load(f)
            meta["layers"] = sorted(set(old.get("layers", [])) | set(layers))
            meta["layer_fetched_at"] = old.get("layer_fetched_at", {})
        for layer in layers:
            meta.setdefault("layer_fetched_at", {})[layer] = meta["fetched_at"]
        with open(path, "w", encoding="utf-8") as f:
            json.dump(meta, f, ensure_ascii=False, indent=2)
        print(f"meta -> {path}")


if __name__ == "__main__":
    main()
