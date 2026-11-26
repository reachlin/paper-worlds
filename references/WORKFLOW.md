# The workflow

The repeatable path from "a place on the map" to "a link on aweshell". Every phase has an artefact and
a gate; do not start the next phase until the gate passes.

```
0 brief ─ 1 acquire ─ 2 extract ─ 3 register ─ 4 assemble ─ 5 dress ─ 6 QA ─ 7 publish
             raw data    map JSON    spec        sheet/walk    art       frames   URL
```

---

## 0. Brief — decide before downloading

Write these down in `docs/<map>.md` and `world/maps/<id>.spec.json`:

- **bbox** (WGS84, with a margin of one block/neighbourhood around the subject)
- **spawn** (a real point on dry, walkable ground; verify against the data, not from memory)
- **mapScale** (walk time = real length / mapScale / 3.7 m/s / 60)
- **layer list** (water, land, roads, paths, bridges, buildings, sites)
- **art direction** (materials, palette, era, what this map is *not*)
- **signature content** (the 3–5 things a player should remember)

Gate: someone can read the brief and say what the first frame looks like.

---

## 1. Acquire — download raw data

Keep every download in its own subdirectory of `data/`, with a `SOURCE.md` beside it recording URL,
licence, timestamp and the exact query. Raw data is **untrusted input**: tools live outside `data/`,
read paths as arguments, and Python that parses it runs with `-I`.

### OpenStreetMap (water, land, roads, bridges, POIs)

Overpass QL, `out tags geom` (ways and relations). Bbox order is `south,west,north,east`.

```overpassql
// water polygons
[out:json][timeout:180];
(
  way["natural"="water"](S,W,N,E);
  relation["natural"="water"](S,W,N,E);
  way["waterway"="riverbank"](S,W,N,E);
  relation["waterway"="riverbank"](S,W,N,E);
);
out geom;
```

```overpassql
// park / lawn / wood / meadow polygons
[out:json][timeout:180];
(
  way["leisure"="park"](S,W,N,E);
  relation["leisure"="park"](S,W,N,E);
  way["landuse"~"grass|forest|meadow|recreation_ground"](S,W,N,E);
  relation["landuse"~"grass|forest|meadow|recreation_ground"](S,W,N,E);
  way["natural"~"wood|scrub|grassland"](S,W,N,E);
  relation["natural"~"wood|scrub|grassland"](S,W,N,E);
);
out geom;
```

```overpassql
// the street and path network
[out:json][timeout:180];
way["highway"](S,W,N,E);
out geom;
```

```overpassql
// real bridge decks (walkable lines only)
[out:json][timeout:120];
(
  way["bridge"]["highway"](S,W,N,E);
  way["man_made"="bridge"]["highway"](S,W,N,E);
);
out geom;
```

```overpassql
// named landmarks for tags/steles
[out:json][timeout:120];
nwr["name"~"^(Bethesda Terrace|Bow Bridge|Belvedere Castle|...)$"](S,W,N,E);
out tags center;
```

Practical notes:

- Use `out geom;`, **not** `out tags geom;`. The latter returns way geometry but silently drops
  relation members (`members: []`), so lakes stored as multipolygon relations come back as names with
  no shape. This cost one download cycle on Central Park: The Lake, Turtle Pond, Harlem Meer and the
  Reservoir were empty until the query was changed.
- The public endpoint (`overpass-api.de`) is sometimes at capacity and returns HTTP 502. Retry with
  exponential backoff (5 s, 10 s, 20 s, 40 s), one query at a time. Do not fan out across mirrors.
- If Overpass stays unavailable, fall back to a Geofabrik state extract + `osmium extract -b`, or the
  OSM API `/api/0.6/map?bbox=` for small tiles (50k-node limit). Record which source was used.
- OSM data © OpenStreetMap contributors, ODbL 1.0. The published page must carry the attribution.

### NYC Open Data (building footprints)

The city's footprint dataset is the right source for Manhattan blocks: more complete than OSM, with
heights in some releases. Use the Socrata API, paginate, and filter by bbox server-side:

```sh
curl -sS -G 'https://data.cityofnewyork.us/resource/5zhs-2jue.geojson' \
  --data-urlencode '$where=within_box(the_geom, 40.761, -73.986, 40.804, -73.945)' \
  --data-urlencode '$limit=50000' -o data/nyc-buildings/buildings-01.geojson
```

Check the dataset's current id, columns and licence on the NYC Open Data page before relying on it;
footprint datasets get revised. Record the dataset id and download date.

### Reference imagery

Satellite/street imagery is for **palette and massing study only**. Do not ship it. Write down the
colour swatches you actually use in the spec, not a screenshot.

Gate: every layer has a file, a source note and a timestamp; the bbox in every query matches the spec.

---

## 2. Extract — normalize to the map contract

Write one extractor per source family, all emitting the same local-metre JSON described in
`FRAMEWORK.md` §2.2.

**OSM polygons** (`tools/extract_osm.py`):

1. Collect ways and relation members; assemble closed outer/inner rings from member geometries.
2. Clip to the bbox; drop rings smaller than the area threshold (e.g. 100 m² for ponds, 500 m² for
   land patches).
3. Project every vertex with the spec's `crs`.
4. Rasterize the even-odd union at 1–1.5 m, contour-trace, simplify with Douglas–Peucker to 1–1.5 m.
   This resolves overlapping ways and holes without a geometry library.
5. Emit `water`, `land` with `kind`, and per-feature provenance.
6. Write a preview PNG on the bbox; print feature count, total area and bbox.

**OSM lines** (`tools/extract_roads.py`, `tools/extract_bridges.py`):

- Project the way, keep the whole way if any part falls in the bbox (the painter clips).
- Drop tunnels, steps, indoor ways, parking aisles and sub-6 m stubs.
- Assign presentation widths (main road, small street, path) and a `main` flag.
- For bridges: keep only ways that actually cross water; extend the deck along its own direction
  until it reaches dry land (≤ 60 m).
- Record `name`, `kind`, `osm`.

**Buildings** (`tools/extract_buildings.py`):

- Read the GeoJSON, project rings, drop courtyards below the area floor, simplify to ~0.5–1 m.
- Attach a height: use the dataset's height where present; otherwise a deterministic storey count
  from footprint area and a seeded RNG. Store `kind` from `landuse`/`building` tags when present.
- Merge adjacent footprints below a size threshold to keep the draw count sane.

Gate: preview PNG looks like the place; counts/areas are within a sane factor of the source; the spawn
is on dry walkable ground; every layer shares one `crs`.

---

## 3. Register — one spec entry

Add `world/maps/<id>.spec.json` and the loader entry:

- `data`, `bridges`, `roads`, `sites`, `buildings` paths
- palette: ground, water shallow/deep, rim, shore, land greens, road deck/edge, bridge deck/edge
- `mapScale`, `inset`, `view`, `start`, `labels`
- any per-map `sharpAt` / detail-window hints

Gate: `?loc=<id>` loads the new map with no code edits outside the registry.

---

## 4. Assemble — the world

Order of work (each step is independently visible):

1. **Coarse sheet** — whole bbox at low ppu; ground → land → water → roads → bridges. Look at it from
   a high camera; does the place read?
2. **Detail window** — tiles around the hero; verify no seams while walking a full block.
3. **Walk model** — block water, page edge, buildings (decision per map); bridge decks override water.
4. **Spawn** — place the hero at the spec's start; walk forward 20 m; the first frame must sell the map.
5. **Labels** — names on the sheet before the map is built; check legibility at gameplay distance.

Gate: you can walk the signature route without falling through, seeing a seam, or leaving the page.

---

## 5. Dress — content pass

Build in this order, because each layer changes the performance budget:

1. **Landmarks** — the 3–5 signature assemblies (bridge, terrace, castle, skyline block).
2. **Buildings** — block fabric from footprints; LOD by distance; paper materials, no texture atlas
   unless it earns its download.
3. **Vegetation** — one silhouette per species, seeded variation; park masses before individual trees.
4. **Street furniture** — lamps, benches, railings, signs; printed on the sheet if the hero never
   gets close, cards if he does.
5. **UI/copy/music** — title, intro, controls, chart, sound; modern and local, not inherited.

Gate: each close-up frame reads as the intended material at gameplay distance, and the print budget
has not blown.

---

## 6. QA — headless gates

Script pattern:

```python
page.goto("http://127.0.0.1:PORT/?loc=<id>&capture", wait_until="networkidle")
page.wait_for_function("window.__papercraft && window.__papercraft.ready", timeout=240000)
page.evaluate("__papercraft.post.o.maxBlur = 0; __papercraft.post.o.hazeAmount = 0")
page.evaluate("__papercraft.step(6.0)")
page.screenshot(path="frames/spawn.png")
```

Checks:

- 0 page errors, 0 console errors, 0 HTTP ≥ 400, 0 external hosts.
- `buildMs`, `printStats`, `pieces` recorded and compared with the previous run.
- `walk.surface` at spawn, at every landmark foot, at both ends of every bridge.
- Frames: spawn, wide, three close-ups; inspect them, do not just save them.
- A "walk the route" run: 200 steps along the signature path, sampling `walk.surface` and the hero
  position; the hero must not enter water or leave the page.

Gate: all green, frames reviewed, numbers written into the repo's notes.

---

## 7. Publish — aweshell

```sh
# 1. stage runtime only (no data/, tools/, frames/, source art)
rsync -a index.html scene.js harness.js papercraft/ vendor/ world/ assets/ dist/

# 2. verify the staged folder on a local server (do not skip)
python3 -m http.server 8768 --bind 127.0.0.1 --directory dist

# 3. publish (foreground; auto-claim with the configured api-key) — the folder name names the archive
cp -R dist paper-<city>
AI_AGENT=claude aweshell-cli file-hosting ./paper-<city> --entry-file index.html --format json
rm -rf paper-<city>

# 4. smoke-test the public URL headlessly
# 5. bind the custom domain in the HSK console (CLI cannot)
```

Remember: file hosting has **no in-place update** — every publish is a new resource and a new URL.
Record the resource id, the URL and the data timestamp. If a custom domain is required, rebind it in
the console; do not promise a CLI rebind.

Gate: the public URL boots with 0 errors and 0 404s, and the page shows the OSM attribution.

---

## Directory layout for a new map

```
paper-<city>/
  README.md
  docs/
    FRAMEWORK.md          # this framework, copied once per project
    WORKFLOW.md           # this workflow
    <city>.md             # the brief
  data/                   # raw downloads (untrusted, never deployed)
    osm/  nyc-buildings/  ...
  tools/
    fetch_osm.py          # download raw Overpass JSON
    extract_osm.py        # water/land polygons -> map JSON
    extract_roads.py
    extract_bridges.py
    extract_buildings.py
  world/
    maps/<id>.json        # generated
    maps/<id>-roads.json
    maps/<id>-buildings.json
    maps/<id>.spec.json
  frames/                 # QA stills (never deployed)
  dist/                   # staged runtime (never committed)
```

## Definition of done

- A local URL opens on the new map, no errors, and the first frame reads as the intended place.
- The signature route is walkable; water/buildings behave; bridges carry the hero.
- QA numbers and frames are recorded with the data date.
- A public URL exists, attribution is visible, and the custom domain is bound (if required).
- The data can be refreshed by re-running the recorded queries, not by hand-editing JSON.
