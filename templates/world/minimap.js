// world/minimap.js — the whole location as a paper chart in the corner, the man a red dot on it.
//
// The chart is the page's own coarse sheet (world/map.js) drawn small: the shoreline, the washes and the
// paper tint are the world's, so the chart can never disagree with the ground he is standing on. It is
// mapped +x right and +z down — the same top-down turn as the page and as the default camera (yaw 0
// looks down -z) — so walking up the screen moves the dot up the chart.
//
// Tab shows and hides it. The panel is pointer-events: none, so drags, taps and the wheel stay the game's.
// A double-click on it is a way to travel: the man is set down on the nearest dry, walkable point, even
// when you click open water. The search expands in rings from the click until it finds land.

// the closest walkable point to (x, z): the point itself if it is dry, else a ring search outward.
// H.walk.surface is null on water, on solid pieces and outside the page, so whatever it accepts is a
// place the man can stand. maxR stops the search at the page's diagonal when the click is mid-lake.
function nearestLand(H, x, z, maxR) {
  const dry = (px, pz) => (H.walk.surface(px, pz) ? { x: px, z: pz } : null);
  const here = dry(x, z);
  if (here) return here;

  let ring = 1.4, prev = 0, hit = null;
  while (ring <= maxR) {
    const n = Math.min(96, Math.max(12, Math.round(ring * 0.6)));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + ring * 0.37;   // turn each ring, so a straight shore cannot fall between samples
      const p = dry(x + Math.cos(a) * ring, z + Math.sin(a) * ring);
      if (p) { hit = p; break; }
    }
    if (hit) break;
    prev = ring;
    ring *= 1.18;
  }
  if (!hit) return null;

  // the first hit only brackets the shore: sample every angle again between the last empty ring and
  // this one, and keep the truly closest dry point.
  let best = hit, bestD = Math.hypot(hit.x - x, hit.z - z);
  const r0 = Math.max(0.5, prev * 0.8), steps = 12;
  for (let s = 0; s <= steps; s++) {
    const r = r0 + (ring - r0) * (s / steps);
    const n = Math.min(160, Math.max(16, Math.round(r * 1.2)));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      if (H.walk.surface(px, pz) == null) continue;
      const d = Math.hypot(px - x, pz - z);
      if (d < bestD) { bestD = d; best = { x: px, z: pz }; }
    }
  }
  return best;
}

export function createMinimap(H, loc, sheet, sites = []) {
  const b = loc.bounds, w = b.x1 - b.x0, d = b.z1 - b.z0;

  // backing pixels, independent of the frame: the CSS size scales the whole panel (and this with it)
  const BH = 640, BW = Math.round(BH * w / d);

  const el = document.createElement('div');
  el.id = 'papercraft-minimap';
  el.style.cssText = [
    'position:fixed', 'left:max(16px, env(safe-area-inset-left))', 'top:max(16px, env(safe-area-inset-top))',
    'padding:7px', `background:${loc.stock}`, 'border-radius:2px',
    'box-shadow:0 0 0 1px rgba(58,41,28,.34), 0 14px 28px -12px rgba(32,20,9,.6), 0 3px 8px rgba(32,20,9,.2)',
    'pointer-events:none', 'z-index:20', 'user-select:none',
  ].join(';');

  const style = document.createElement('style');
  style.textContent = '#papercraft-minimap{width:clamp(150px,24vmin,220px);transition:opacity .2s ease,transform .2s ease,visibility 0s}'
    + '#papercraft-minimap.off{opacity:0;transform:translateY(-7px) scale(.985);visibility:hidden;'
    + 'transition:opacity .16s ease,transform .16s ease,visibility 0s linear .16s}';
  document.head.appendChild(style);

  // the printed chart: the page's own sheet, its edge held by a printed keyline and a soft vignette
  const frame = document.createElement('div');
  frame.style.cssText = `position:relative;width:100%;aspect-ratio:${w} / ${d};overflow:hidden;`
    + 'box-shadow:inset 0 0 0 1px rgba(58,41,28,.38), inset 0 0 16px rgba(38,24,10,.14)';
  el.appendChild(frame);

  const layer = (cv) => {
    cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;cursor:default;touch-action:auto';
    frame.appendChild(cv);
    return cv;
  };
  const base = layer(document.createElement('canvas'));
  base.width = BW; base.height = BH;
  const g = base.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(sheet, 0, 0, BW, BH);
  const vg = g.createRadialGradient(BW / 2, BH / 2, Math.min(BW, BH) * 0.36, BW / 2, BH / 2, Math.hypot(BW, BH) / 2);
  vg.addColorStop(0, 'rgba(40,26,12,0)');
  vg.addColorStop(1, 'rgba(40,26,12,.16)');
  g.fillStyle = vg;
  g.fillRect(0, 0, BW, BH);

  // the scenes: one little green hexagon each, ringed in the page's stock like the man's dot, so a
  // landmark reads at chart size without a word. Drawn on the printed chart (they hide with it on Tab).
  const R6 = BH * 0.013;
  const hex = (x, y, r) => {
    g.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 3;
      const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
      if (i) g.lineTo(px, py); else g.moveTo(px, py);
    }
    g.closePath();
  };
  for (const s of sites) {
    const x = (s.x - b.x0) / w * BW, y = (s.z - b.z0) / d * BH;
    hex(x, y, R6 + 3);
    g.fillStyle = 'rgba(250,244,230,.97)'; g.fill();
    g.lineWidth = 1.5; g.strokeStyle = 'rgba(38,52,28,.45)'; g.stroke();
    hex(x, y, R6);
    g.fillStyle = '#4a7a46'; g.fill();
  }

  // the man: one dot, red on the chart's cream and teal alike, ringed in the page's stock
  const dot = layer(document.createElement('canvas'));
  dot.width = BW; dot.height = BH;
  const dg = dot.getContext('2d');
  const TAU = Math.PI * 2, R = BH * 0.028;
  const last = [NaN, NaN];
  const draw = (force = false) => {
    const p = H.hero && H.hero.group.position;
    if (!p) return;
    const x = (p.x - b.x0) / w * BW, y = (p.z - b.z0) / d * BH;
    if (!force && Math.abs(x - last[0]) < 0.1 && Math.abs(y - last[1]) < 0.1) return;
    last[0] = x; last[1] = y;
    dg.clearRect(0, 0, BW, BH);
    const halo = dg.createRadialGradient(x, y, R * 0.5, x, y, R * 3.4);
    halo.addColorStop(0, 'rgba(178,48,32,.34)');
    halo.addColorStop(0.55, 'rgba(178,48,32,.13)');
    halo.addColorStop(1, 'rgba(178,48,32,0)');
    dg.fillStyle = halo;
    dg.beginPath(); dg.arc(x, y, R * 3.4, 0, TAU); dg.fill();
    dg.beginPath(); dg.arc(x, y, R + 5, 0, TAU);                        // the paper ring, then a hairline round it
    dg.fillStyle = 'rgba(250,244,230,.97)'; dg.fill();
    dg.lineWidth = 1.5; dg.strokeStyle = 'rgba(58,35,18,.4)'; dg.stroke();
    dg.beginPath(); dg.arc(x, y, R, 0, TAU); dg.fillStyle = '#bb3526'; dg.fill();
    dg.beginPath(); dg.arc(x - R * 0.3, y - R * 0.34, R * 0.3, 0, TAU);
    dg.fillStyle = 'rgba(255,240,220,.55)'; dg.fill();                  // a small glint: paper, not a pin
  };

  let shown = true;
  const setShown = (v) => {
    shown = v;
    el.classList.toggle('off', !v);
    if (v) draw(true);
  };
  addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;  // plain Tab only: never steal browser chords
    e.preventDefault();
    setShown(!shown);
  });
  H.onStep(() => { if (shown) draw(); });
  H.onRestart(() => draw(true));

  // ---- the chart is also a way to travel ---------------------------------------------------------------
  // The panel is pointer-events: none, so this listens on the window in the capture phase. A click only
  // counts when its target is the game's canvas (the chart's own layers pass through) inside the chart's
  // rectangle; the opening card and every other overlay keep their clicks.
  const onDblClick = (e) => {
    if (!shown || e.button !== 0) return;
    if (!(e.target instanceof HTMLCanvasElement)) return;
    if (document.getElementById('papercraft-intro')) return;
    const r = frame.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
    e.preventDefault();
    e.stopPropagation();
    const wx = b.x0 + ((e.clientX - r.left) / r.width) * w;
    const wz = b.z0 + ((e.clientY - r.top) / r.height) * d;
    const land = nearestLand(H, wx, wz, Math.hypot(w, d));
    if (!land) return;
    const y = window.__papercraft?.place?.(land.x, land.z);   // the harness's own teleport: syncs the card, camera and walk
    if (y == null) return;
    draw(true);
  };
  addEventListener('dblclick', onDblClick, true);

  document.body.appendChild(el);
  draw(true);
  return { el, setShown };
}
