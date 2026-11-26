---
name: paper-worlds
description: >-
  Build a walkable paper diorama of any real place — a "paper world" printed on a fold-up page,
  from real map data (OpenStreetMap, city open-data portals). Use when the user asks to build a
  paper world, paper map or papercraft diorama of a real place ("paper Central Park", "build a
  paper West Lake", "turn my hometown into a paper world", "a walkable paper map of X"), or wants
  a new location added to an existing paper world project. Covers the full pipeline: data
  download, extraction to the map contract, the location spec, world assembly, content, headless
  QA and deploy.
---

# paper-worlds — a walkable paper diorama of any real place

The engine is [xikhar/papercraft](https://github.com/xikhar/papercraft) (MIT) — the paper look,
hinges, light and lens. This skill adds the layer that makes it about *real geography*: a data
pipeline that turns OSM + open-data downloads into a walkable map, a location-agnostic world, and
a repeatable QA/deploy flow. Two worlds prove the pattern, one in each register:

- **Paper West Lake** (classical garden): `~/dev/private/paper-worlds-demo/westlake` — the reference implementation
- **Paper Central Park** (modern city): `~/dev/private/paper-worlds-demo/nyc` — the second proof, with buildings,
  a skyline wall, floating name tags and story panels

When the target resembles one of them, copy its content modules as the starting pattern; when it
does not, follow the contracts in `references/FRAMEWORK.md` and write fresh content. **Never fork
a demo's world modules wholesale** — a building, a species or a sound must be authored for the new
place, not renamed from another.

## The pipeline, in order

Work top to bottom; each phase has a gate — do not start a phase before the previous gate passes.

### Phase 1 — the brief (the map spec)

Write `world/maps/<id>.spec.json` first (see `references/FRAMEWORK.md` §2.3 and the demo repos for
the shape): WGS84 bbox (~4–6 km across works well), `crs` origin at the bbox centre
(`mPerDegLon = 111320 * cos(lat0)`, `mPerDegLat = 110540`), the `world` bounds in local metres, the
provisional `start` (verify dry later), `mapScale` chosen from walk time
(`walk minutes ≈ real length / mapScale / 3.7 m/s / 60`; 2 for a big park, 4 for a large lake),
`inset` (~300), the layer lists, the palette, and the budgets (`buildMs` 3000, `prints` 120,
`printMs` 1200, `pageErrors` 0). Pick the landmark set now (the spec's `sites` list feeds the
extractor).

Gate: the spec answers — what stands, what is painted, where the hero starts, what the chart shows.

### Phase 2 — download (untrusted input)

Raw downloads live in `data/` and are **never imported by the page** — only passed as file paths to
the scripts. Overpass first (`scripts/fetch_osm.py --bbox=W,S,E,N --out data/osm --layers ...`);
retry with backoff, then fall back to Geofabrik + osmium and record it. Buildings are **optional** —
most worlds paint no building cards (see Phase 5), so skip the layer unless the brief commits to
authored city fabric. When used: NYC takes the Open Data footprints
(`scripts/extract_buildings.py`, Socrata `5zhs-2jue`, height_roof); anywhere else use Overpass
`building=*` (the fetch tool has the layer). Write a `SOURCE.md` per `data/` subdirectory: source
URL, download date, licence. Palette reference images go in `docs/` notes, never in the published
site.

Gate: every layer has raw JSON + source note + timestamp.

### Phase 2b — coastal sites (islands, bays, sea edges)

The sea is usually NOT mapped as water polygons: it is tidal flats (`natural=wetland`) and
coastline lines. The pipeline handles both: wetlands join the water layer, closed coastline rings
join the land layer (`kind: coast`), and when a site has coastlines but no water polygons,
extract_osm.py makes the sea itself — the whole page with the top-level land rings as holes, so
the island walks and everything else blocks. The mainland behind an open coastline line stays sea
in v1; acceptable at the page edge.

### Phase 3 — extract (raw → map JSON)

Run the extractors in order; each writes a preview PNG and stats:

```
scripts/extract_osm.py     water.json land.json spec.json <id>.json        # polygons, ring assembly, spawn settle
scripts/extract_roads.py   roads.json <id>.json <id>-roads.json            # --main-names for scenic ways
scripts/extract_bridges.py bridges.json <id>.json <id>-bridges.json        # only decks crossing water
scripts/extract_sites.py   sites.json <id>.json <id>-sites.json            # spec "sites" or --names
scripts/extract_buildings.py <id>.json <id>-buildings.json                 # NYC Open Data (see above)
```

Check the previews numerically if you cannot view them: ring counts, water body areas, the page
water fraction by zone sampling, roads/bridges named and counted, and that the spawn is dry.

Gate: previews look like the place; counts/areas sane; spawn walkable; one `crs` everywhere.

### Phase 4 — the world

Copy the engine into the new world's folder (the world is self-contained): `engine/harness.js`,
`engine/papercraft/`, `engine/vendor/`. Then copy `templates/index.html`, `templates/scene.js` and
`templates/world/*`. Register the location in `world/locations.js` (`?loc=<id>` must load with no
other edits) and set the palette there — it is pre-compensated for the cream paper multiply. Walk
rules come from `world/map.js` automatically: water blocks, bridge decks carry, the page edge
walls. The templates ship without a buildings layer; adding one also adds its blocking footprints.

Gate: `?loc=<id>` serves; the spawn view renders; the hero walks.

### Phase 5 — content (the place's own)

One module per layer, all placed from the location's data — never hard-coded world coordinates:

- **Landmarks** — mini assemblies of printed cards (base, walls, a roof, a name tag). The demo
  repos show the pattern: an arcade wall with arches, a castle C-fold, a terrace with a fountain.
- **Vegetation** — one die-cut silhouette per species, prints shared across the planting
  (`H.printed`), placed along real ways (an allée on a named road) and inside land polygons.
- **No generic building cards** — the default is none. Extruding raw `building=*` footprints reads
  as crude boxes or floating triangles; the Mont Saint-Michel test learned this the hard way and
  dropped its whole buildings layer. Famous buildings and sites get the floating tag + story
  instead. Building cards are only for authored city fabric — long block fronts with stepped
  rooflines facing the lens (the NYC pattern) — never one card per footprint.
- **Sites** — the floating name tags + story panels already ship in `world/sites.js`: fill
  `STORIES` with the place's own lines, and the chart hexagons follow.
- **The player** — out of the box the world is walked by a calico cat (world/cat.js): one
  side-view card, always side-on to the lens, trotting on a two-pose walk and mirroring like a
  paper flip when the direction changes. The pose frames ship in `templates/assets/cat-*.png`
  (papertrails' cat_calico, (c) Shikhar, MIT); without them the drawn cat stands in, and a user's
  own figure from the three keyed hero views (`scripts/hero-image.py`, `hero-views.py`) takes
  over automatically. `followCat` makes the same cat trail a hero as a companion.
- **Copy and music** — `world/intro.js` (English UI unless asked otherwise) and `world/music.js`
  (a generative score; `scripts/music-sample.py` renders a WAV for the user to hear before
  committing — always play the sample first when changing the score).

Gate: close-ups read as the place; print budget intact (`__papercraft.printStats()`).

### Phase 6 — QA (headless)

Serve the repo root locally (a ThreadingHTTPServer with HTTP/1.1 — plain `python3 -m http.server`
resets Chromium's parallel module loads), then drive `?loc=<id>&capture` headless:

```js
__papercraft.ready / .buildMs / .pieces
__papercraft.walk.surface(x, z)        // spawn dry, water blocked, every bridge deck walkable
__papercraft.walkPath([[x, z], ...])   // route tests: spawn → each landmark → across each bridge
__papercraft.printStats(10)            // budgets
__papercraft.step(3) / .look(x, z, d)  // then screenshots for the human to review
```

Gate: 0 page errors, 0 console errors, 0 HTTP ≥ 400, budgets met, routes reached, screenshots
reviewed by the human.

### Phase 7 — publish

Stage a runtime-only `dist/`: entry page, code, `world/` (map JSONs, no spec), `papercraft/`,
`vendor/`, runtime assets. No `data/`, `tools/`, `frames/`, source art. Vendor three.js — no CDN.
Smoke-test `dist/` locally, then publish. For aweshell static hosting (the demo pattern):

```bash
aweshell-cli context wizard --format json   # task_goal=share_file, sensitivity: judge the content
cp -R dist paper-<city>                     # the upload folder names the archive
aweshell-cli file-hosting ./paper-<city> --entry-file index.html --format json --context ...
```

Name every publish after its city (`paper-westlake.zip`, `paper-nyc.zip`): a directory upload's
archive takes the folder's name, so a bare `dist/` upload becomes `dist.zip`, indistinguishable
across worlds. Keep the staged copy out of git (`paper-*/` in `.gitignore`).

**No in-place update** — every publish is a new resource + URL; a bound custom domain must be
rebound in the HSK console (takes 5–10 min). Smoke-test the public URL headlessly. Keep the OSM
attribution on the page and check every other dataset's licence (NYC Open Data: verified, no
restrictions; record it in `SOURCE.md`).

## The contracts (never break these)

See `references/FRAMEWORK.md` for the full text. The short form:

- One bbox, one `crs` per map; geometry in local metres, x east, y north; the world turns east to
  −x and north to +z (camera faces south by default)
- The hero is 2 m = `HERO.height × HERO.scale` world units; `mapScale` compresses geography, never
  the hero
- The map JSON is data with provenance (`osm` ids); < 5 MB per map
- Coarse sheet + hero-centred detail window share one deterministic painter — same colours or the
  seam shows
- No network at runtime; no `Math.random()` without a seeded RNG
- QA with `step()`, never wall-clock sleeps

## The engine

`engine/harness.js` and `engine/papercraft/` come from [xikhar/papercraft](https://github.com/xikhar/papercraft)
(MIT) — keep them as shipped; the world writes against the harness API. `engine/vendor/` is
three.js (MIT). Attribution: the page credits OSM (ODbL) and any other data source.

## Examples

| repo | register | what to copy from it |
|---|---|---|
| `~/dev/private/paper-worlds-demo/westlake` | classical garden, water-centred, 1:4 scale | garden vegetation, a raised landmark assembly, the stele/sign pattern |
| `~/dev/private/paper-worlds-demo/nyc` | modern city, grid + buildings, 1:2 scale | city fabric + skyline cards, story tags, the NYC extraction notes |
| `~/dev/private/paper-worlds-demo/MtStMichel` | coastal island, causeway, 1:1 | the coastal pipeline (tidal flats, synthetic sea), tags-only famous sites — no building cards |
