// world/map.js — the map engine: one location's water, land, streets and city fabric become the page.
//
// Two sheets, one painter:
//   * the coarse sheet (printGround): the whole location on one canvas. Everything past the detail
//     window, and the whole map at a bird's-eye look(), comes from here.
//   * the detail window: a 3x3 grid of opaque tiles around the hero, repainted when he crosses a tile
//     edge. Both sheets run the same paint functions in world space (global mottle cells, the same ring
//     paths), so the window's edge is a resolution change, never a seam.
//
// Paint order (both sheets): ground -> mottle -> land (park, wood, lawn, rock) -> plazas -> greenery
// -> water -> roads -> bridges -> building fabric -> name tags -> paper multiply.
//
// The park is a land layer, the water its lakes and ponds: the water blocks the walk, the land is
// walkable. The surrounding Manhattan blocks are printed as city fabric — tinted roofs and walls with
// a thin ink edge; the 3D skyline wall is world/buildings.js, this module only paints their plan.
// Building footprints also block the walk, so the street grid between them is where the hero goes.
//
// The streets come from the OSM highway network (tools/extract_roads.py): asphalt ribbons with kerbs,
// main roads (avenues, cross streets, the park drives) carrying a dashed centre line and their name
// in a paper tag. Bridges are the real OSM decks over the park water (tools/extract_bridges.py).

import * as THREE from 'three';
import { paperMaterial } from 'papercraft/lib/paperkit-3d.js';

const TILE = 48;          // world units per detail tile (~52 m at mapScale 2)
const PXPU = 20;          // detail pixels per unit (960 px canvases)
const PAPER_W = 512 / PXPU; // world units per paper repeat (25.6 u): the paper is 1:1 in the tiles
const COARSE_PPU = 0.35;  // sheet pixels per unit (the whole world on one canvas)
const RIM = 2.6;          // pale bank outside the water line, units (~2.8 m)
const EDGE = 0.18;        // the crisp cut along the water line, units
const CELL = 420;         // land-tone blotch cell, units (~456 m) — shared by both sheets
const GRASS = 7.3;        // grass-tuft cell, units (detail only)
const RC = 10;            // ripple cell, units (detail only)
const Y = 0.02;           // the detail window rides this far above the page

const rgba = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};
const mod = (v, m) => ((v % m) + m) % m;

// a stable 0..1 hash of a cell (the same ripple, blotch and roof tint lands in the same place on every sheet)
const hash = (i, j, k) => {
  let h = Math.imul(i, 73856093) ^ Math.imul(j, 19349663) ^ Math.imul(k + 1, 83492791);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

function bboxOf(ring) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of ring) {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  return { x0, x1, z0, z1 };
}

function inRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Even-odd point-in-water over the location's polygons (bbox-skipped; islands stay land). */
export function makeInWater(polys) {
  for (const pg of polys) {
    if (!pg.bb) pg.bb = bboxOf(pg.outer);
    for (const h of pg.holes) if (!h.bb) h.bb = bboxOf(h);
  }
  return (x, z) => {
    for (const pg of polys) {
      const b = pg.bb;
      if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1 || !inRing(x, z, pg.outer)) continue;
      let dry = false;
      for (const h of pg.holes) {
        const hb = h.bb;
        if (x < hb.x0 || x > hb.x1 || z < hb.z0 || z > hb.z1) continue;
        if (inRing(x, z, h)) { dry = true; break; }
      }
      if (!dry) return true;
    }
    return false;
  };
}

/** Point-in-land by kind (or any land): the grass and trees only grow where the park is green. */
export function makeInLand(land, kinds = null) {
  for (const pg of land) if (!pg.bb) pg.bb = bboxOf(pg.outer);
  return (x, z) => {
    for (const pg of land) {
      if (kinds && !kinds.includes(pg.kind)) continue;
      const b = pg.bb;
      if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1 || !inRing(x, z, pg.outer)) continue;
      let dry = true;
      for (const h of pg.holes) {
        const hb = h.bb;
        if (x < hb.x0 || x > hb.x1 || z < hb.z0 || z > hb.z1) continue;
        if (inRing(x, z, h)) { dry = false; break; }
      }
      if (dry) return true;
    }
    return false;
  };
}

/** Point-in-building over the footprints, on a cell index (12k footprints, one cell look-up). */
export function makeInBuildings(buildings, cell = 40) {
  const grid = new Map();
  for (const b of buildings) {
    const i0 = Math.floor(b.bb.x0 / cell), i1 = Math.floor(b.bb.x1 / cell);
    const j0 = Math.floor(b.bb.z0 / cell), j1 = Math.floor(b.bb.z1 / cell);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = i + ',' + j;
      const list = grid.get(k);
      if (list) list.push(b); else grid.set(k, [b]);
    }
  }
  return (x, z) => {
    const list = grid.get(Math.floor(x / cell) + ',' + Math.floor(z / cell));
    if (!list) return false;
    for (const b of list) if (inRing(x, z, b.outer)) return true;
    return false;
  };
}

// ---- painting (shared by the coarse sheet and the detail tiles) --------------------------------------
// P(x, z) -> [px, py] in this canvas's pixels; all widths arrive in units and scale with `ppu`.

/** Soft block-tone blotches on the global CELL grid, so the coarse sheet and the tiles agree exactly. */
function mottle(g, loc, P, ppu, x0, z0, w, h) {
  const i0 = Math.floor(x0 / CELL) - 1, i1 = Math.ceil((x0 + w) / CELL) + 1;
  const j0 = Math.floor(z0 / CELL) - 1, j1 = Math.ceil((z0 + h) / CELL) + 1;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const a = hash(i, j, 1), b = hash(i, j, 2), c = hash(i, j, 3), d = hash(i, j, 4);
    const cx = (i + 0.15 + 0.7 * a) * CELL, cz = (j + 0.15 + 0.7 * b) * CELL;
    const r = 150 + 230 * c;
    if (cx + r < x0 || cx - r > x0 + w || cz + r < z0 || cz - r > z0 + h) continue;
    const [px, py] = P(cx, cz), pr = r * ppu;
    if (pr < 0.5) continue;
    const col = loc.wash[(d * loc.wash.length) | 0];
    const gr = g.createRadialGradient(px, py, 0, px, py, pr);
    gr.addColorStop(0, rgba(col, 0.1));
    gr.addColorStop(0.72, rgba(col, 0.13));
    gr.addColorStop(1, rgba(col, 0));
    g.fillStyle = gr;
    g.fillRect(px - pr, py - pr, 2 * pr, 2 * pr);
  }
}

/**
 * The park's land polygons: a layered wash, darkest wood, then the park base, lawns lightest on top.
 * Painted before the water, so the lakes cover any that fall in them. Rock outcrops are pale grey
 * patches, the Manhattan schist breaking the green.
 */
function paintLand(g, loc, P, ppu, rect) {
  const col = loc.landCols;
  if (!col) return;
  const order = ['park', 'wood', 'lawn', 'rock'];
  const alpha = { park: 0.82, wood: 0.8, lawn: 0.78, rock: 0.85 };
  for (const kind of order) {
    for (const pg of loc.land) {
      if (pg.kind !== kind) continue;
      const b = pg.bb;
      if (rect && (b.x1 < rect.x0 || b.x0 > rect.x1 || b.z1 < rect.z0 || b.z0 > rect.z1)) continue;
      g.beginPath();
      for (const r of [pg.outer, ...pg.holes]) {
        for (let i = 0; i < r.length; i++) {
          const [px, py] = P(r[i][0], r[i][1]);
          if (i) g.lineTo(px, py); else g.moveTo(px, py);
        }
        g.closePath();
      }
      if (!col[kind]) { console.warn('paintLand: no colour for kind', JSON.stringify(kind), 'keys:', Object.keys(col || {}), 'pg keys:', Object.keys(pg)); continue; }
      g.fillStyle = rgba(col[kind], alpha[kind]);
      g.fill('evenodd');
      // a soft edge just inside the cut, so the wash reads as paper, not as an airbrush
      if (rect) {
        g.strokeStyle = rgba(col[kind], 0.5);
        g.lineWidth = Math.max(0.06 * ppu, 0.8);
        g.stroke();
      }
    }
  }
}

/** The plaza paving under a landmark (Bethesda Terrace): a pale stone wash with paving joints. */
function paintPlazas(g, loc, P, ppu, rect) {
  if (!loc.plazas) return;
  for (const pl of loc.plazas) {
    if (rect && (pl.x1 < rect.x0 || pl.x0 > rect.x1 || pl.z1 < rect.z0 || pl.z0 > rect.z1)) continue;
    const [ax, az] = P(pl.x0, pl.z0), [bx, bz] = P(pl.x1, pl.z1);
    g.fillStyle = rgba(loc.plaza || '#d9cfba', 0.85);
    g.fillRect(ax, az, bx - ax, bz - az);
    if (!rect) continue;                       // the coarse sheet keeps the plain wash
    g.strokeStyle = rgba('#8f8677', 0.4);
    g.lineWidth = Math.max(0.05 * ppu, 0.7);
    const step = 2.2 * ppu;
    const p = new Path2D();
    for (let x = ax + step; x < bx; x += step) { p.moveTo(x, az); p.lineTo(x, bz); }
    for (let z = az + step; z < bz; z += step) { p.moveTo(ax, z); p.lineTo(bx, z); }
    g.stroke(p);
    g.strokeStyle = rgba('#8f8677', 0.55);
    g.strokeRect(ax, az, bx - ax, bz - az);
  }
}

/**
 * Sparse printed grass on the park's land: a soft green stain and two to four blades. Detail tiles only —
 * at the coarse sheet's 0.35 px a unit a tuft would be a fraction of a pixel, and the page's green
 * washes already carry the tone there. Painted before the water, so the lakes cover any that fall in.
 */
function greenery(g, loc, P, ppu, rect, onGreen) {
  const cols = loc.greens;
  if (!cols || !rect || !onGreen) return;
  const i0 = Math.floor(rect.x0 / GRASS), i1 = Math.ceil(rect.x1 / GRASS);
  const j0 = Math.floor(rect.z0 / GRASS), j1 = Math.ceil(rect.z1 / GRASS);
  g.lineCap = 'round';
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const a = hash(i, j, 21), b = hash(i, j, 22), c = hash(i, j, 23), d = hash(i, j, 24), e = hash(i, j, 25);
    if (d > 0.62) continue;
    const cx = (i + 0.12 + 0.76 * a) * GRASS, cz = (j + 0.12 + 0.76 * b) * GRASS;
    if (cx < rect.x0 - 2 || cx > rect.x1 + 2 || cz < rect.z0 - 2 || cz > rect.z1 + 2) continue;
    if (!onGreen(cx, cz)) continue;
    const [px, py] = P(cx, cz);
    const col = cols[(e * cols.length) | 0];
    const pr = (1.5 + 1.7 * c) * ppu;
    const gr = g.createRadialGradient(px, py, 0, px, py, pr);
    gr.addColorStop(0, rgba(col, 0.2));
    gr.addColorStop(1, rgba(col, 0));
    g.fillStyle = gr;
    g.fillRect(px - pr, py - pr, 2 * pr, 2 * pr);
    const n = 3 + ((c * 3) | 0);                       // 3..5 blades
    const hgt = (0.8 + 0.9 * ((a + e) % 1)) * ppu;     // 0.8..1.7 units tall
    g.strokeStyle = rgba(col, 0.74 + 0.2 * b);
    g.lineWidth = Math.max(1.5, 0.11 * ppu);
    for (let k = 0; k < n; k++) {
      const t = n === 1 ? 0.5 : k / (n - 1);
      const ang = (t - 0.5) * 1.0 + (a - 0.5) * 0.5;
      const bx = px + (t - 0.5) * 0.5 * ppu;
      const tipX = bx + Math.sin(ang) * hgt * 0.65;
      const tipY = py - Math.cos(ang) * hgt;
      g.beginPath();
      g.moveTo(bx, py);
      g.quadraticCurveTo(bx + Math.sin(ang) * hgt * 0.15, py - hgt * 0.62, tipX, tipY);
      g.stroke();
    }
  }
}

/** One water body: pale bank, water, deeper middle, a few ripples (detail only), a crisp cut shoreline. */
function paintWater(g, loc, pg, P, ppu, detail, rect) {
  const rings = [pg.outer, ...pg.holes].map((r) => {
    const out = new Array(r.length);
    for (let i = 0; i < r.length; i++) out[i] = P(r[i][0], r[i][1]);
    return out;
  });
  const path = () => {
    g.beginPath();
    for (const r of rings) {
      g.moveTo(r[0][0], r[0][1]);
      for (let i = 1; i < r.length; i++) g.lineTo(r[i][0], r[i][1]);
      g.closePath();
    }
  };
  g.lineJoin = g.lineCap = 'round';
  // the pale bank, drawn under the water: half its width is left showing on the land side
  path();
  g.strokeStyle = rgba(loc.rim, 0.92);
  g.lineWidth = Math.max(2 * RIM * ppu, 1.6);
  g.stroke();
  // the water itself (even-odd keeps every island dry)
  path();
  g.fillStyle = loc.waterCols[0];
  g.fill('evenodd');
  // the deeper middle: a soft radial from the ring's centre, clipped to the water
  if (!pg.centre) {
    let cx = 0, cz = 0;
    for (const [x, z] of pg.outer) { cx += x / pg.outer.length; cz += z / pg.outer.length; }
    let R = 1;
    for (const [x, z] of pg.outer) R = Math.max(R, Math.hypot(x - cx, z - cz));
    pg.centre = [cx, cz]; pg.deepR = R;
  }
  const [pcx, pcy] = P(pg.centre[0], pg.centre[1]), pr = pg.deepR * ppu;
  g.save();
  g.clip('evenodd');                                  // the water path is still current
  const gr = g.createRadialGradient(pcx, pcy, 0, pcx, pcy, pr);
  gr.addColorStop(0, rgba(loc.waterCols[1], 0.5));
  gr.addColorStop(0.55, rgba(loc.waterCols[1], 0.36));
  gr.addColorStop(0.85, rgba(loc.waterCols[1], 0.1));
  gr.addColorStop(1, rgba(loc.waterCols[1], 0));
  g.fillStyle = gr;
  g.fillRect(pcx - pr, pcy - pr, 2 * pr, 2 * pr);
  if (detail && rect) ripples(g, P, ppu, rect);
  g.restore();
  // the cut along the water line
  path();
  g.strokeStyle = rgba(loc.shore, 0.5);
  g.lineWidth = Math.max(EDGE * ppu, 0.7);
  g.stroke();
}

/** Does (x, z) stand on a bridge deck? (the OSM way buffered by half its width, plus `pad` world units) */
export function makeOnBridge(bridges, pad = 0) {
  for (const br of bridges) {
    br.segs = [];
    for (let i = 0; i < br.path.length - 1; i++) {
      const [ax, az] = br.path[i], [bx, bz] = br.path[i + 1];
      br.segs.push([ax, az, bx - ax, bz - az, (bx - ax) ** 2 + (bz - az) ** 2]);
    }
  }
  return (x, z) => {
    for (const br of bridges) {
      const b = br.bb;
      if (x < b.x0 - pad || x > b.x1 + pad || z < b.z0 - pad || z > b.z1 + pad) continue;
      const rr = br.half + pad, r2 = rr * rr;
      for (const [ax, az, dx, dz, L2] of br.segs) {
        const t = L2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)) : 0;
        const qx = x - ax - dx * t, qz = z - az - dz * t;
        if (qx * qx + qz * qz <= r2) return true;
      }
    }
    return false;
  };
}

/** A deck from bank to bank: pale stone, a kerb a hair proud of it, a railing inside each edge. */
function paintBridges(g, loc, bridges, P, ppu, rect) {
  const col = loc.bridge || { deck: '#ded8ca', edge: '#7b7468', rail: '#4f4a42' };
  const stroke = (pts, w, style) => {
    g.strokeStyle = style;
    g.lineWidth = w;
    g.lineCap = g.lineJoin = 'round';
    g.beginPath();
    for (let i = 0; i < pts.length; i++) {
      if (i) g.lineTo(pts[i][0], pts[i][1]); else g.moveTo(pts[i][0], pts[i][1]);
    }
    g.stroke();
  };
  const offset = (br, d) => br.path.map(([x, z], i) => {
    const [ax, az] = br.path[Math.max(0, i - 1)], [bx, bz] = br.path[Math.min(br.path.length - 1, i + 1)];
    let tx = bx - ax, tz = bz - az;
    const n = Math.hypot(tx, tz) || 1;
    tx /= n; tz /= n;
    return [x - tz * d, z + tx * d];
  });
  for (const br of bridges) {
    const b = br.bb;
    if (rect && (b.x1 < rect.x0 || b.x0 > rect.x1 || b.z1 < rect.z0 || b.z0 > rect.z1)) continue;
    const pts = br.path.map(([x, z]) => P(x, z));
    const w = Math.max(br.width * ppu, 1.4);
    stroke(pts, w + Math.max(0.5 * ppu, 0.9), col.edge);          // the kerb, a hair wider than the deck
    stroke(pts, w, col.deck);                                     // the stone deck
    const inset = Math.max(0.3, br.width / 2 - Math.max(0.45, br.width * 0.1));  // railings just inside the kerb
    const railW = Math.max(br.width * 0.035 * ppu, 0.6);
    for (const sd of [-1, 1]) stroke(offset(br, sd * inset).map(([x, z]) => P(x, z)), railW, col.rail);
  }
}

/**
 * The city fabric: every footprint filled with its roof tint (a seeded mix of brick, limestone and
 * glass blocks) and, on the detail tiles, a thin ink edge so the plan reads as blocks, not stains.
 * The 3D skyline (world/buildings.js) stands on this plan.
 */
function paintBuildings(g, loc, buildings, P, ppu, rect) {
  const B = loc.building;
  if (!B || !buildings) return;
  const cols = [B.limestone, B.brick, B.glass, B.limestone, B.brick, B.roof];
  for (const b of buildings) {
    const bb = b.bb;
    if (rect && (bb.x1 < rect.x0 || bb.x0 > rect.x1 || bb.z1 < rect.z0 || bb.z0 > rect.z1)) continue;
    g.beginPath();
    for (let i = 0; i < b.outer.length; i++) {
      const [px, py] = P(b.outer[i][0], b.outer[i][1]);
      if (i) g.lineTo(px, py); else g.moveTo(px, py);
    }
    g.closePath();
    const c = cols[hash(b.n, 0, 1) * cols.length | 0];
    g.fillStyle = rgba(c, 0.9);
    g.fill();
    if (rect) {
      g.strokeStyle = B.edge;
      g.lineWidth = Math.max(0.06 * ppu, 0.6);
      g.stroke();
    }
  }
}

/**
 * The street network: a casing a hair proud of the ribbon, then its fill — asphalt everywhere. Main
 * roads also carry a dashed centre line on the detail tiles and their names in paper tags. Both
 * sheets share the function; on the coarse sheet only the main roads are drawn.
 */
function paintRoads(g, loc, roads, P, ppu, rect) {
  const col = loc.road;
  if (!col) return;
  const shown = [];
  for (const rd of roads) {
    if (!rect && !rd.main) continue;
    const b = rd.bb;
    if (rect && (b.x1 < rect.x0 || b.x0 > rect.x1 || b.z1 < rect.z0 || b.z0 > rect.z1)) continue;
    shown.push({ rd, pts: rd.path.map(([x, z]) => P(x, z)) });
  }
  if (!shown.length) return;
  const stroke = (pts, w, style) => {
    g.strokeStyle = style;
    g.lineWidth = w;
    g.lineCap = g.lineJoin = 'round';
    g.beginPath();
    for (let i = 0; i < pts.length; i++) {
      if (i) g.lineTo(pts[i][0], pts[i][1]); else g.moveTo(pts[i][0], pts[i][1]);
    }
    g.stroke();
  };
  const detail = !!rect;
  const kerb = (rd) => detail ? Math.max((rd.main ? 0.32 : 0.18) * ppu, 1.0) : 1.3;
  const width = (rd) => Math.max(rd.width * ppu, detail ? 1.6 : 1.2);
  for (const { rd, pts } of shown) stroke(pts, width(rd) + kerb(rd), rd.main ? col.mainEdge : col.smallEdge);
  for (const { rd, pts } of shown) stroke(pts, width(rd), rd.main ? col.main : col.small);
  if (detail && col.mark) {
    g.setLineDash([0.9 * ppu, 0.75 * ppu]);
    for (const { rd, pts } of shown) if (rd.main) stroke(pts, Math.max(0.14 * ppu, 0.8), col.mark);
    g.setLineDash([]);
  }
}

/** Halfway along a way, with its direction there: [x, z, tx, tz]. */
function wayMid(way) {
  const p = way.path;
  const seg = [];
  let total = 0;
  for (let i = 1; i < p.length; i++) {
    const L = Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
    seg.push(L);
    total += L;
  }
  let d = total / 2, i = 0;
  while (i < seg.length - 1 && d > seg[i]) { d -= seg[i]; i++; }
  const [ax, az] = p[i], [bx, bz] = p[i + 1];
  const L = seg[i] || 1, t = Math.min(1, d / L);
  return [ax + (bx - ax) * t, az + (bz - az) * t, (bx - ax) / L, (bz - az) / L];
}

/**
 * Named places carry a small paper tag: cream stock, grey-brown ink, turned with the way they lie so
 * it reads as a label printed on the page. Bridges take theirs at the halfway point, on whichever side
 * is water; a landmark gets one where its builder puts it (loc.labels); a main road gets one beside
 * its carriageway, on the land side. Detail tiles only. The text is never set upside down.
 */
function makeMapTags(loc, ppu, waterAt) {
  const inkU = 0.95;                            // cap height of the name, world units
  const fontPx = inkU * ppu;
  const padX = fontPx * 0.38, padY = fontPx * 0.26;
  const meter = document.createElement('canvas').getContext('2d');
  meter.font = `500 ${fontPx}px Georgia, 'Times New Roman', serif`;
  const tags = [];
  const place = (name, x, z, ang) => {
    if (ang > Math.PI / 2) ang -= Math.PI;      // keep the name the right way up
    if (ang < -Math.PI / 2) ang += Math.PI;
    const tw = meter.measureText(name).width + 2 * padX, th = fontPx + 2 * padY;
    tags.push({ name, x, z, ang, tw, th, fontPx, reach: Math.hypot(tw, th) / ppu / 2 });
  };
  for (const br of loc.bridges || []) {
    if (!br.name || br.path.length < 2) continue;
    const [mx, mz, tx, tz] = wayMid(br);
    const th = fontPx + 2 * padY;
    const off = br.half + 0.55 + th / ppu / 2;
    let nx = -tz, nz = tx;
    if (!waterAt(mx + nx * off, mz + nz * off) && waterAt(mx - nx * off, mz - nz * off)) {
      nx = -nx; nz = -nz;
    }
    const x = mx + nx * off, z = mz + nz * off;
    if (tags.some((t) => t.name === br.name && Math.hypot(t.x - x, t.z - z) < 30)) continue;
    place(br.name, x, z, Math.atan2(tz, tx));
  }
  for (const l of loc.labels || []) place(l.name, l.x, l.z, l.ang ?? 0);
  // main roads are named too, on the land side of the carriageway, longest ways first so the long
  // stretches are the ones that get named; a name repeats only every 120 units along its road
  const named = (loc.roads || []).filter((r) => r.main && r.name && r.path.length > 1)
    .sort((a, b) => (b.len || 0) - (a.len || 0));
  for (const rd of named) {
    const [mx, mz, tx, tz] = wayMid(rd);
    const th = fontPx + 2 * padY;
    const off = rd.half + 0.55 + th / ppu / 2;
    let nx = -tz, nz = tx;
    if (waterAt(mx + nx * off, mz + nz * off) && !waterAt(mx - nx * off, mz - nz * off)) {
      nx = -nx; nz = -nz;
    }
    const x = mx + nx * off, z = mz + nz * off;
    if (tags.some((t) => (t.name === rd.name && Math.hypot(t.x - x, t.z - z) < 120) ||
                         Math.hypot(t.x - x, t.z - z) < 8)) continue;
    place(rd.name, x, z, Math.atan2(tz, tx));
  }
  return tags;
}

function paintMapTags(g, loc, tags, P, rect) {
  const col = loc.label || { fill: '#f7f0e2', ink: '#3f3a32', line: '#8b8378' };
  for (const t of tags) {
    const r = t.reach;
    if (rect && (t.x + r < rect.x0 || t.x - r > rect.x1 || t.z + r < rect.z0 || t.z - r > rect.z1)) continue;
    const [px, py] = P(t.x, t.z);
    g.save();
    g.translate(px, py);
    g.rotate(t.ang);
    g.fillStyle = col.fill;
    g.strokeStyle = col.line;
    g.lineWidth = Math.max(t.fontPx * 0.07, 1);
    g.beginPath();
    g.roundRect(-t.tw / 2, -t.th / 2, t.tw, t.th, Math.min(t.th / 2, t.fontPx * 0.3));
    g.fill();
    g.stroke();
    g.fillStyle = col.ink;
    g.font = `500 ${t.fontPx}px Georgia, 'Times New Roman', serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(t.name, 0, t.fontPx * 0.04);
    g.restore();
  }
}

/** Short wind marks on a world-locked grid: neighbouring tiles draw the same marks across their edge. */
function ripples(g, P, ppu, rect) {
  g.strokeStyle = 'rgba(247,240,226,0.32)';
  g.lineWidth = Math.max(0.06 * ppu, 0.7);
  g.lineCap = 'round';
  const i0 = Math.floor(rect.x0 / RC), i1 = Math.ceil(rect.x1 / RC);
  const j0 = Math.floor(rect.z0 / RC), j1 = Math.ceil(rect.z1 / RC);
  for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) {
    if (hash(i, j, 7) > 0.74) continue;
    const x = (i + 0.1 + 0.8 * hash(i, j, 8)) * RC;
    const z = (j + 0.1 + 0.8 * hash(i, j, 9)) * RC;
    const l = (0.08 + 0.22 * hash(i, j, 10)) * RC;   // ~0.4-1.6 m: a wind streak, not a line
    const a = (hash(i, j, 11) - 0.5) * 0.7, bow = (hash(i, j, 12) - 0.5) * l * 0.4;
    const ca = Math.cos(a), sa = Math.sin(a);
    const [ax, az] = P(x - ca * l, z - sa * l);
    const [bx, bz] = P(x + ca * l, z + sa * l);
    const [mx, mz] = P(x - sa * bow, z + ca * bow);
    g.beginPath(); g.moveTo(ax, az); g.quadraticCurveTo(mx, mz, bx, bz); g.stroke();
  }
}

// ---- the builder -------------------------------------------------------------------------------------

const meanCache = new WeakMap();

/** The paper sheet's mean sRGB colour: what a multiply by the whole texture averages to. */
function paperMean(paper) {
  let m = meanCache.get(paper.sheet);
  if (m) return m;
  const s = document.createElement('canvas');
  s.width = s.height = 16;
  const sg = s.getContext('2d', { willReadFrequently: true });
  sg.drawImage(paper.sheet, 0, 0, 16, 16);
  const d = sg.getImageData(0, 0, 16, 16).data;
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
  const n = d.length / 4;
  m = [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
  meanCache.set(paper.sheet, m);
  return m;
}

// The whole world on one sheet. printGround would multiply the paper at sheet-pixel scale (512 px =
// 1.5 km here), which prints as giant stains and cannot match the tiles; the coarse sheet is too
// coarse to resolve the grain anyway, so it takes the paper's mean tint and the detail window carries
// the real paper. Same tone, only the resolution changes across the window's edge.
function buildCoarse(H, loc, inBuilding) {
  const { paper, renderer, scene } = H;
  const b = H.bounds, w = b.x1 - b.x0, d = b.z1 - b.z0, ppu = COARSE_PPU;
  const cv = document.createElement('canvas');
  cv.width = Math.round(w * ppu); cv.height = Math.round(d * ppu);
  const g = cv.getContext('2d');
  const X = (x) => (x - b.x0) * ppu, Z = (z) => (z - b.z0) * ppu;
  const P = (x, z) => [X(x), Z(z)];
  g.fillStyle = loc.ground;
  g.fillRect(0, 0, cv.width, cv.height);
  mottle(g, loc, P, ppu, b.x0, b.z0, w, d);
  paintLand(g, loc, P, ppu, null);
  paintPlazas(g, loc, P, ppu, null);
  for (const pg of loc.water) paintWater(g, loc, pg, P, ppu, false, null);
  paintRoads(g, loc, loc.roads || [], P, ppu, null);
  paintBridges(g, loc, loc.bridges || [], P, ppu, null);
  paintBuildings(g, loc, loc.buildings || [], P, ppu, null);
  const m = paperMean(paper);
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = `rgb(${m[0]},${m[1]},${m[2]})`;
  g.fillRect(0, 0, cv.width, cv.height);
  g.globalCompositeOperation = 'source-over';
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const upt = paper.unitsPerTile || 5;
  const mat = paperMaterial({ map: tex, normalMap: paper.normalMap.clone(), normalScale: 0.9 });
  mat.normalMap.repeat.set(w / upt, d / upt);
  mat.normalMap.needsUpdate = true;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set((b.x0 + b.x1) / 2, 0, (b.z0 + b.z1) / 2);
  mesh.receiveShadow = true;
  scene.add(mesh);
  return cv;             // the same sheet is the minimap's chart (world/minimap.js): one drawing of the page
}

export function buildMap(H, loc) {
  const inWater = makeInWater(loc.water);
  const inBuilding = makeInBuildings(loc.buildings || []);
  const onBridge = makeOnBridge(loc.bridges || []);
  const onGreen = makeInLand(loc.land, ['park', 'lawn', 'wood']);
  // the lakes block the walk — the water under a bridge deck is the bridge's to carry him over
  H.walk.block((x, z) => inWater(x, z) && !onBridge(x, z));
  // buildings block at their footprint: the street grid between them stays walkable — except the
  // carved walk-throughs (the arcade's central arch)
  const carve = loc.walkCarve || [];
  H.walk.block((x, z) => inBuilding(x, z) && !carve.some((c) => x > c.x0 && x < c.x1 && z > c.z0 && z < c.z1));
  // the page's edge: the hero stays `inset` units inside the printed sheet (the harness's frame never shows past it)
  const b = loc.bounds, m = loc.inset ?? 0;
  if (m) H.walk.block((x, z) => x < b.x0 + m || x > b.x1 - m || z < b.z0 + m || z > b.z1 - m);

  const sheet = buildCoarse(H, loc, inBuilding);
  buildWindow(H, loc, onGreen);
  return { inWater, inBuilding, onBridge, sheet };
}

function buildWindow(H, loc, onGreen) {
  const { paper, renderer } = H;
  const upt = paper.unitsPerTile || 5;
  const size = TILE * PXPU;
  const paperA = PXPU * PAPER_W / 512;   // 1: the tile shows the paper at its printed size
  const waterAt = makeInWater(loc.water);
  const tags = makeMapTags(loc, PXPU, waterAt);
  const tiles = [];
  for (let i = 0; i < 9; i++) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const mat = paperMaterial({ map: tex, normalMap: paper.normalMap.clone(), normalScale: 0.9 });
    mat.normalMap.repeat.set(TILE / upt, TILE / upt);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(TILE, TILE), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = Y;
    mesh.receiveShadow = true;
    H.scene.add(mesh);
    tiles.push({ mesh, tex, g: cv.getContext('2d'), ix: null, iz: null, dirty: true });
  }

  const paintTile = (t) => {
    const x0 = t.ix * TILE, z0 = t.iz * TILE, g = t.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.fillStyle = loc.ground;
    g.fillRect(0, 0, size, size);
    const P = (x, z) => [(x - x0) * PXPU, (z - z0) * PXPU];
    const rect = { x0, z0, x1: x0 + TILE, z1: z0 + TILE };
    mottle(g, loc, P, PXPU, x0, z0, TILE, TILE);
    paintLand(g, loc, P, PXPU, rect);
    paintPlazas(g, loc, P, PXPU, rect);
    greenery(g, loc, P, PXPU, rect, onGreen);
    for (const pg of loc.water) {
      const b = pg.bb;
      if (b.x1 < x0 || b.x0 > x0 + TILE || b.z1 < z0 || b.z0 > z0 + TILE) continue;
      paintWater(g, loc, pg, P, PXPU, true, rect);
    }
    paintRoads(g, loc, loc.roads || [], P, PXPU, rect);
    paintBridges(g, loc, loc.bridges || [], P, PXPU, rect);
    paintBuildings(g, loc, loc.buildings || [], P, PXPU, rect);
    paintMapTags(g, loc, tags, P, rect);
    // the paper, at its printed size and phase-locked to the world so neighbouring tiles share the grain
    const pat = g.createPattern(paper.sheet, 'repeat');
    try {
      if (pat.setTransform) pat.setTransform(new DOMMatrix([
        paperA, 0, 0, paperA,
        mod(-x0 * PXPU, 512 * paperA),
        mod(-z0 * PXPU, 512 * paperA),
      ]));
    } catch { /* older canvas: the grain drifts a little at the seams */ }
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = pat;
    g.fillRect(0, 0, size, size);
    g.globalCompositeOperation = 'source-over';
    t.tex.needsUpdate = true;
    t.dirty = false;
  };

  let cx = null, cz = null;
  const setWindow = (x, z, paintNow) => {
    const ix = Math.floor(x / TILE), iz = Math.floor(z / TILE);
    const need = [];
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) need.push([ix + i, iz + j]);
    const free = tiles.slice(), kept = new Map();
    for (const [nx, nz] of need) {
      const k = free.findIndex((t) => t.ix === nx && t.iz === nz && !t.dirty);
      if (k >= 0) kept.set(nx + ',' + nz, free.splice(k, 1)[0]);
    }
    for (const [nx, nz] of need) {
      let t = kept.get(nx + ',' + nz);
      if (!t) {
        t = free.pop();
        t.ix = nx; t.iz = nz; t.dirty = true;
        t.mesh.position.set(nx * TILE + TILE / 2, Y, nz * TILE + TILE / 2);
      }
      if (paintNow) paintTile(t);
    }
    cx = ix; cz = iz;
  };

  // repaint at most one stale tile a step: a crossing costs 5 frames of work, never one long hitch
  H.onStep(() => {
    const p = H.hero && H.hero.group.position;
    if (!p || !Number.isFinite(p.x)) return;
    const ix = Math.floor(p.x / TILE), iz = Math.floor(p.z / TILE);
    if (ix !== cx || iz !== cz) setWindow(p.x, p.z, false);
    for (const t of tiles) if (t.dirty) { paintTile(t); break; }
  });
  setWindow(loc.start.x, loc.start.z, true);
  H.onRestart(() => setWindow(loc.start.x, loc.start.z, true));
  return { tileAt: (x, z) => [Math.floor(x / TILE), Math.floor(z / TILE)] };
}
