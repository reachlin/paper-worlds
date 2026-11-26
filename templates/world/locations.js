// world/locations.js — the location registry: one entry turns one extracted map JSON into a world.
//
// Adding a place:
//   1. write world/maps/<id>.spec.json (bbox, crs, world bounds, start, palette)
//   2. run tools/extract_osm.py, extract_roads.py, extract_bridges.py, extract_sites.py,
//      extract_buildings.py into world/maps/<id>*.json
//   3. add an entry below; open the game with ?loc=<id>
//
// Units: the hero's printed card is HERO.height x HERO.scale tall and stands for HERO.meters metres,
// so 1 world unit = HERO.meters / (HERO.height * HERO.scale) m (2 m / 3.6875 units = 0.542 m).
// A location's mapScale compresses its ground against that hero: the real metres are divided by it,
// so at mapScale 2 the park reads at half its real size against him and a walk takes half as long.
// The map JSON is in local metres (x east, y north); loadLocation turns it into world units with a
// 180 deg turn about y (east = -x, north = +z) so the harness's default camera (yaw 0, looking -z)
// faces SOUTH.

export const HERO = { width: 1.4, height: 2.95, scale: 1.25, meters: 2.0 };
export const UNITS_PER_METER = HERO.height * HERO.scale / HERO.meters;
export const METERS_PER_UNIT = 1 / UNITS_PER_METER;

export const LOCATIONS = {
  centralpark: {
    id: 'centralpark', name: 'Central Park',
    data: 'world/maps/centralpark.json',
    bridges: 'world/maps/centralpark-bridges.json',   // real OSM bridge decks over the park water (tools/extract_bridges.py)
    sites: 'world/maps/centralpark-sites.json',       // the landmark set: Bethesda, Bow Bridge, Belvedere, ... (tools/extract_sites.py)
    roads: 'world/maps/centralpark-roads.json',       // the OSM street network (tools/extract_roads.py)
    ground: '#efe8d8', stock: '#f7f0e2',
    // the palette is pre-compensated: the cream sheet multiplies into every detail tile, which pulls
    // a muted blue toward sage — so the water carries more blue than it prints
    waterCols: ['#7fa3b8', '#4f7389'], rim: '#d9e3e6', shore: '#3d5666',
    wash: ['#e4dcc9', '#dcd3bf', '#e9e2d2', '#cfc7b4'],            // pale city-block washes
    landCols: { park: '#6f8a52', lawn: '#89a267', wood: '#55703d', rock: '#b8b3a8' },
    greens: ['#6b8a4a', '#5d7a3c', '#7fa25c'],                     // the printed grass tufts (park land only)
    bridge: { deck: '#ded8ca', edge: '#7b7468', rail: '#4f4a42' }, // the stone-arch park bridges
    // the streets: asphalt ribbons with kerbs; main roads carry a dashed centre line
    road: { main: '#b9b3a7', mainEdge: '#8b8378', small: '#d3cdc1', smallEdge: '#a89f90',
            mark: 'rgba(247,240,226,0.55)' },
    plaza: '#d9cfba',                                               // the terrace paving wash
    label: { fill: '#f7f0e2', ink: '#3f3a32', line: '#8b8378' },    // the name tags: cream paper, grey-brown ink
    view: { pitch: 42, dist: 60 },
    mapScale: 2,       // the park at 1:2 against the 2 m man: ~2.4 km effective, ~11 min north to south
    inset: 300,        // units kept between the walk and the sheet's edge at 1:1 (the page shrank 2x: 150 units)
    dressing: null,    // later: per-location props
  },
};

export const DEFAULT_LOCATION = 'centralpark';

export function locationId() {
  return new URLSearchParams(location.search).get('loc') || DEFAULT_LOCATION;
}

export async function loadLocation(id = locationId()) {
  const meta = LOCATIONS[id] || LOCATIONS[DEFAULT_LOCATION];
  const raw = await (await fetch(meta.data)).json();
  const deck = meta.bridges ? await (await fetch(meta.bridges)).json() : { bridges: [] };
  const siteDoc = meta.sites ? await (await fetch(meta.sites)).json() : { sites: [] };
  const roadDoc = meta.roads ? await (await fetch(meta.roads)).json() : { roads: [] };
  const f = meta.mapScale || 1;     // the geography's compression against the hero
  const U = UNITS_PER_METER / f;
  const X = (x) => -x * U;          // east -> -x
  const Z = (y) => y * U;           // north -> +z
  const ring = (pts) => pts.map(([x, y]) => [X(x), Z(y)]);
  const bb = (pts) => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of pts) {
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
    return { x0, x1, z0, z1 };
  };
  const w = raw.world;
  return {
    ...meta, raw,
    bounds: { x0: X(w.x1), x1: X(w.x0), z0: Z(w.y0), z1: Z(w.y1) },
    inset: (meta.inset ?? 0) / f,   // the page shrank with the geography; keep the edge margin in proportion
    water: raw.water.map((pg) => ({ outer: ring(pg.outer), holes: pg.holes.map(ring) })),
    land: (raw.land || []).map((pg) => ({ kind: pg.kind, outer: ring(pg.outer), holes: pg.holes.map(ring), bb: null })),
    start: { x: X(raw.start.x), z: Z(raw.start.y) },
    // bridge decks: the OSM way in world units, its width in world units, a bbox widened by half the
    // width (map.js culls and tests strips with it — the walk may step anywhere on the deck)
    bridges: (deck.bridges || []).map((br) => {
      const path = ring(br.path), half = br.width * U / 2;
      return { name: br.name || '', kind: br.kind || '', osm: br.osm, path, width: br.width * U, half,
               bb: { ...bb(path), x0: bb(path).x0 - half, x1: bb(path).x1 + half, z0: bb(path).z0 - half, z1: bb(path).z1 + half } };
    }),
    // the landmarks: local metres -> the page (x east -> -x, y north -> +z), keeping the OSM provenance
    sites: (siteDoc.sites || []).map((s) => ({ name: s.name, kind: s.kind, osm: s.osm, x: X(s.x), z: Z(s.y) })),
    // the street network: the OSM way in world units, its ribbon width, and a bbox widened by half the
    // width (map.js culls and paints by it; the name tags sort by the real length)
    roads: (roadDoc.roads || []).map((rd) => {
      const path = ring(rd.path), width = rd.width * U, half = width / 2;
      const b = bb(path);
      return { name: rd.name || '', kind: rd.kind || '', main: !!rd.main, osm: rd.osm,
               path, width, half, len: rd.len || 0,
               bb: { x0: b.x0 - half, x1: b.x1 + half, z0: b.z0 - half, z1: b.z1 + half } };
    }),
  };
}
