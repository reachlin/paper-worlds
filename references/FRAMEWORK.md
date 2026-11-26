# The framework

This is the part of `paper-worlds-demo/westlake` worth carrying to another city. It is a set of **contracts**, not
a code dump: any map that honours them can use the same world assembly, QA harness and deploy step,
while its art, data and palette stay entirely its own.

---

## 1. The shape of a map

A map is five layers stacked in one direction:

```
  SOURCE          OSM / NYC Open Data / a vendor vector pack / survey data
     │  fetch, keep raw in data/ (untrusted)
     ▼
  NORMALIZE       clip to bbox → project to local metres → simplify → validate → map JSON
     │
     ▼
  LOCATION SPEC   bbox + spawn + mapScale + palette + layer files + labels
     │
     ▼
  WORLD           coarse printed sheet + hero-centred detail window + walk model
     │            + pop-up cards + name tags
     ▼
  CONTENT         landmarks, buildings, vegetation, props, copy, music
     │
     ▼
  QA → DIST → PUBLISH
```

The world and the QA harness are **location-agnostic**. The source, the location spec and the content
are per-map. The boundary matters: if a change needs a city name or a coordinate in the world code,
it belongs in the spec or the content layer instead.

---

## 2. Contracts

### 2.1 Coordinates and scale

- Input is WGS84 (`lon`, `lat`). A map has one **bbox** and one **origin**: the bbox centre.
- Local metres use an equirectangular projection at the origin latitude:

  ```text
  x_m = (lon - lon0) * 111320 * cos(lat0)     // east
  y_m = (lat - lat0) * 110540                 // north
  ```

  This is accurate to a few metres over a city-scale bbox and needs no projection library. Store the
  four constants (`lon0`, `lat0`, `mPerDegLon`, `mPerDegLat`) in every map JSON as `crs` so downstream
  tools never re-derive them differently.

- The hero is **2 m tall**. The engine's `UNITS_PER_METER` is derived from the hero art, not hard-coded:

  ```text
  UNITS_PER_METER = HERO.height * HERO.scale / HERO.meters     // ≈ 1.84375
  ```

- `mapScale` is the explicit geography cheat: the real metres are divided by it, so at `mapScale: 4`
  the city reads at quarter size against the hero and a walk takes a quarter as long. Choose it from
  the intended walk time, not from the data: `walk minutes ≈ real length / mapScale / 3.7 m/s / 60`.

- The engine turns the page 180° so the default camera faces south: **east = −x, north = +z**. Keep
  this convention or change it in exactly one loader function; never let two layers disagree.

- The page edge is a wall: `inset` units are kept between the walkable area and the printed sheet, so
  the camera never sees past the paper.

### 2.2 Map JSON — the data contract

One JSON per map (or one per layer if a layer gets large). All geometry is in **local metres**, x east,
y north.

```jsonc
{
  "id": "centralpark",
  "name": "Central Park",
  "source": "OpenStreetMap 2026-11-25; NYC Open Data footprints",
  "generated": "2026-11-25T15:00:00Z",
  "crs": { "lon0": -73.9655, "lat0": 40.7825, "mPerDegLon": 84250.0, "mPerDegLat": 110540.0 },
  "bbox": { "w": -73.986, "s": 40.761, "e": -73.945, "n": 40.804 },
  "world": { "x0": -1750.0, "x1": 1750.0, "y0": -2400.0, "y1": 2400.0 },
  "start": { "lon": -73.9709, "lat": 40.7740 },

  "water":    [{ "outer": [[x, y], ...], "holes": [[[x, y], ...]] }],
  "land":     [{ "outer": [[x, y], ...], "holes": [], "kind": "park|lawn|wood|plaza" }],
  "roads":    [{ "path": [[x, y], ...], "width": 7.0, "kind": "residential",
                 "main": false, "name": "W 72nd St", "osm": 123, "len": 240.0 }],
  "bridges":  [{ "path": [[x, y], ...], "width": 8.0, "name": "Bow Bridge",
                 "kind": "footway", "osm": 456 }],
  "buildings":[{ "outer": [[x, y], ...], "height": 18.0, "kind": "residential", "osm": 789 }],
  "sites":    [{ "name": "Bethesda Terrace", "kind": "attraction", "x": 12.0, "y": 34.0, "osm": 101 }]
}
```

Rules:

| rule | why |
|---|---|
| Rings are closed, non-self-intersecting, simplified to ~1–1.5 m | keeps canvas paths and extrusions cheap |
| Holes are separate rings, resolved even-odd | lakes with islands, building courtyards |
| Every feature carries `osm`/`source` provenance | a map you can audit and refresh |
| Widths are **presentation** values, not surveyed | OSM rarely has road widths; make them generous enough for the hero's feet |
| `land` is paint-only; `water` is walk-blocking; `buildings` block (or not) per world design | not every layer has the same physics |
| One feature never spans two layers (a road is not also a land polygon) | avoids z-fighting and double painting |
| Target < 5 MB of geometry per map; split by layer beyond that | first load and canvas build time |

**Extraction gates** (run before the world ever sees the file): bbox matches the spec; each layer's
feature count and total length/area are sane against the source; a preview PNG shows the rings on the
same bbox; the spawn is on dry, walkable ground; water bodies that should be one are one.

### 2.3 Location spec — the only per-map registry entry

```js
{
  id: 'centralpark',
  name: 'Central Park',
  data: 'world/maps/centralpark.json',
  bridges: 'world/maps/centralpark-bridges.json',
  roads: 'world/maps/centralpark-roads.json',
  sites: 'world/maps/centralpark-sites.json',
  ground: '#e8e2d2',                  // paper base
  waterCols: ['#8fb0c4', '#5d7f96'],  // shallow, deep
  rim: '#f4ecdc',                     // printed bank
  shore: '#3d5666',
  greens: ['#5f7d46', '#4d6b38'],     // park wash / tufts
  road: { main: '#d9d4c8', mainEdge: '#8b8378', small: '#e4ddcf', smallEdge: '#a89f90' },
  bridge: { deck: '#ded8ca', edge: '#7b7468', rail: '#4f4a42' },
  view: { pitch: 42, dist: 60 },
  mapScale: 2,
  inset: 300,
  start: { x: ..., z: ... },          // derived from map JSON if omitted
  labels: [{ name, x, z, ang }]
}
```

The spec is data. The world must be able to load a second location without code changes; `?loc=<id>`
is the switch. If a new map needs a new *kind* of layer (NYC's `buildings`), extend the contract and
the loader once, not the per-map code.

### 2.4 World assembly

Three renderers share one deterministic paint function:

1. **Coarse sheet** — the whole bbox on one canvas at low resolution (`ppu ≈ 0.35`). It is what the
   player sees from the map view and under the haze; it is also the minimap's chart. Paint order:
   ground → land → water → roads → bridges → labels → paper multiply.
2. **Detail window** — a grid of tiles around the hero at play resolution (e.g. 5×5 tiles of 64 world
   units at 10 px/unit). Repaint only the tiles exposed by a cell crossing, one per frame. Because
   the paint function is deterministic and every shape is drawn in full then clipped to the tile, the
   seams are pixel-identical.
3. **Walk model** — block water (except where a bridge deck carries the hero), block the page edge,
   optionally block building footprints. Expose `walk.surface(x, z)` for QA. A bridge is walkable
   *and* the water under it is not: the deck overrides the water test along its width.

Invariants:

- No network at runtime; all data is local JSON.
- Painting is deterministic from `(data, palette, ppu, rect)`; no `Math.random()` without a seeded RNG.
- The coarse sheet and the detail window use the same colours, or the transition shows.
- Pop-up cards are placed from world coordinates; their `order` is global on the page, so a card on a
  huge map needs a sensible order or it rises seconds late.
- Ground labels are printed before the sheet is built; ink height and orientation are fixed by the
  world, not by each label.
- The renderer has a **sharpness budget**: the camera subject gets a sharp print, everything else a
  cheap print with effects off. Judge distant content by silhouette.

### 2.5 Content

Content is a set of pure functions from a form object + palette to print operations:

- **Print API** (2D): `fill`, `layer(shape, colour, {depth, shadow, lip, shade, felt, rim})`, `draw`,
  seeded `rng`, colour `mix`. The paper multiply is applied once at the end of a sheet.
- **Cards** (3D): `makeCard(points, opts)` extrudes a die-cut; useful options are `thickness`,
  `edgeWidth`/`edgeColor` (the visible paper core), `back: 'mirror'` (standee), `contact` (ground
  shadow), `folds`. A thick cream edge makes a piece read as a sticker; keep it thin and tint it
  toward the rim.
- **Landmarks** are mini assemblies, not single sprites: a base, tiers/storeys, an edge material, a
  name tag. Build them where the data says, never at hard-coded world coordinates.
- **Vegetation** is one die-cut silhouette per species with different painting, not a new mesh per
  tree. Reuse a form across a species; vary seed, scale, palette and leaf placement.
- **Copy, palette and music** are content too. Keep them out of the world and out of the tools.

### 2.6 QA contract

Drive the page headless; never wait on wall-clock time (dt is clamped and headless fps is tiny):

```js
__papercraft.ready
__papercraft.step(seconds)      // advance the fixed clock and render
__papercraft.look(x, z, dist, height)
__papercraft.heroPos
__papercraft.walk.surface(x, z)
__papercraft.pieces
__papercraft.printStats(n)
__papercraft.post.o            // zero haze/blur/vignette for review shots
```

Gates for every map:

- 0 page errors, 0 console errors, 0 HTTP ≥ 400.
- Build time and print time within the map's budget (record the numbers in the repo).
- The spawn is walkable; water is blocked; every bridge deck is walkable end to end.
- A frame from the spawn, a wide frame, and three close-ups of the map's signature content.
- Labels legible at gameplay distance; no card floating above the paper; no card clipping through the
  ground sheet.
- `printStats` shows the expected print count; the garden/greenery/landmark pass is the usual hotspot.

### 2.7 Deploy contract

- The site is static: no build step, ES modules, one import map. Vendor every runtime dependency
  (three.js `three.module.js` **and** `three.core.js`); a CDN is a single point of failure.
- Stage a runtime-only `dist/`: entry page, code, vendored deps, runtime assets. Exclude raw data,
  tools, QA frames and source art. Publish that folder, not the repo.
- Keep OSM attribution on the page; check the licence of every other dataset.
- `aweshell-cli file-hosting` has **no in-place update**. Every publish is a new resource and a new
  URL. A custom domain is bound per resource in the HSK console; the CLI cannot rebind it.
- Smoke-test the public URL headlessly after publishing (page ready, 0 errors, 0 404s), not just the
  local server.

---

## 3. What NYC reuses, what it rebuilds

| layer | reuse | NYC work |
|---|---|---|
| coordinate model, local metres, `mapScale` | **yes, unchanged** | choose `mapScale` from walk time |
| map JSON contract | **yes** | add `land.kind` and `buildings` |
| coarse sheet + detail window + walk model | **yes, as a pattern** | implement on the chosen engine; add building block/paint rules |
| print/card engine | **as a library, not a fork** | modern materials: paper white, asphalt, glass, steel, brick |
| location registry + `?loc=` switch | **yes** | one `centralpark` entry |
| OSM roads/bridges extraction | **as a pattern** | fresh extractor; the West Lake scripts are not copied |
| water extraction | **no** | OSM `natural=water` polygons, not the Asia vendor pack |
| garden/trees/pagoda/waves/music | **no** | new species, landmarks, skyline, sound; no Chinese-garden vocabulary |
| QA harness | **yes, as a pattern** | new spawn/wide/close-up frames and budgets |
| deploy | **yes** | vendored deps, new dist, new resource, attribution |

**The line:** the framework is portable; the West Lake *world* is not. A building, a species or a
sound must be authored for Manhattan, not renamed from Hangzhou.

---

## 4. Lessons that cost time on West Lake

1. **A vendor pack is not a map engine.** The Asia PMTiles format needed a reverse-engineered reader;
   it does not generalise. Normalize source data into the map JSON early, then never let the world
   know where it came from.
2. **Generalised shorelines and OSM roads disagree.** Clip roads at paint time; keep a road whole if
   any part falls on the page; extend bridge decks to the bank.
3. **Bridges painted on the ground read as flat.** Raise every named bridge as a card (arched deck,
   kerb, railing posts) while keeping the printed deck as the walkable base.
4. **One water blob hides causeways and islands.** Either subtract land polygons or model the
   crossings; do not rely on the source's coastline alone.
5. **The coarse sheet is for the map view, the detail window for play.** Haze hides the hand-off;
   without it the transition is visible.
6. **Sharpness budget:** only the camera subject is printed sharp. A far tree is a silhouette; do
   not spend print time on texture that can never be seen.
7. **One card vs. two crossed cards** is an engine decision. Papertrails' two planes avoid an
   edge-on tree but show a seam on a thick die-cut card. Test on the map's most important silhouette
   before committing.
8. **Ground labels** are the cheapest way to make species/landmarks legible; put them in the spec.
9. **Popup order is global.** On a huge page, a card without a sensible order rises late.
10. **Headless time is not wall time.** Use `step()` and `look()`; screenshots after a real-time
    `sleep` are non-deterministic.
