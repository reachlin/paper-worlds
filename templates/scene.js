// paper-worlds / templates/scene.js — the location-agnostic assembly for a new world.
// Copy this file into the new world's root next to engine/ (harness.js, papercraft/, vendor/),
// write the location spec + map JSON, and add the per-map content modules where marked CONTENT.
// The engine is kept as shipped; the world, its palette, pieces and hero are yours.
/*
PAPER SPEC --------------------------------------------------------------
BRIEF      <one paragraph: the place, the mapScale, what stands and what is painted>
SUBJECT    <the hero: what they wear; the land reads first, they read small>
HERO ART   three images, assets/hero.png (front), hero-back.png, hero-side.png (side, facing
           right), transparent backgrounds, one connected figure each (scripts/hero-image.py
           and scripts/hero-views.py key the generated sheets)
STOCK      <the paper colour under every print>
PALETTE    <the location's, in world/locations.js>
LIGHT      one warm low day key (the harness defaults), cream stock
LENS       26° fov, pitch ~42, dist ~60, sharp band across the hero
GROUND     two sheets (world/map.js): the coarse page and a 3x3 detail window following the hero;
           water blocks the walk, bridge decks carry it, buildings block at their footprints
BRIDGES    the real bridge decks (scripts/extract_bridges.py), painted pale; named ones carry a tag
SITES      the landmark set (scripts/extract_sites.py): a green hexagon on the chart, a floating
           name tag above the spot, a story on click (world/sites.js)
CHART      the whole page as a paper chart in the corner (world/minimap.js); Tab toggles it,
           double-click travels
INTRO      an opening card names the place and lists the controls (world/intro.js)
MOTION     hinge rise only; the standee yaws with his path (back walking away, profile across)
SOUND      paper flaps + soft steps (engine default); a generative score (world/music.js), M mutes
QA         0 page errors, budgets in the spec, spawn walkable, every bridge crossed, frames reviewed
--------------------------------------------------------------------------
*/
import * as P2 from 'papercraft/lib/paperkit-2d.js';
import { makeCard } from 'papercraft/lib/paperkit-3d.js';
import { createHarness } from './harness.js';
import { loadLocation, locationId, HERO } from './world/locations.js';
import { buildMap } from './world/map.js';
import { settleSites, buildSiteTags, showStory, closeStory } from './world/sites.js';
import { createMinimap } from './world/minimap.js';
import { buildCat } from './world/cat.js';
import { createMusic } from './world/music.js';
import { showIntro } from './world/intro.js';

// ---- 1. palette: the hero's inks (the land's colours are the location's) ----------------------------
const C = {
  // the drawn fallback figure, if no hero art ships (replace with the place's own person)
  cap: '#3d4659', capBrim: '#31384a', hoody: '#9a948a', hoodyD: '#857f75',
  denim: '#5d6b7a', denimD: '#4e5b68', sneaker: '#e6dfcd', sole: '#cfc8b8',
  skin: '#f0d6b4', hair: '#2a1c10', mouth: '#8a3a22', lace: '#b8b2a2',
};

// one location, from real geography: ?loc= picks the entry in world/locations.js
const loc = await loadLocation(locationId());
const spawn = loc.start;

// the world rises by itself, so a click is the game's own: a tap on a site's name tag opens its
// story, a tap on empty ground closes it
let siteHits = [];
const gameClick = (pt) => {
  const r = H.renderer.domElement.getBoundingClientRect();
  const ndc = { x: ((pt.x - r.left) / r.width) * 2 - 1, y: -((pt.y - r.top) / r.height) * 2 + 1 };
  const ray = new H.THREE.Raycaster();
  ray.setFromCamera(ndc, H.camera);
  const hit = siteHits.find((h) => ray.ray.intersectSphere(h.sphere, new H.THREE.Vector3()));
  if (hit) showStory(hit.name);
  else closeStory();
};

const H = createHarness({ ground: loc.ground, stock: loc.stock, view: { ...loc.view, target: [spawn.x, 1.5, spawn.z - 6] },
  bounds: loc.bounds, play: true, foldOnClick: false, onClick: gameClick, light: { fillIntensity: 0.95 },
  subject: [spawn.x, spawn.z], testView: { dist: 38, target: [spawn.x, 1.5, spawn.z - 4] } });
H.camera.far = 20000; H.camera.updateProjectionMatrix();

// ---- zoom: the wheel moves the lens in and out ------------------------------------------------------
const ZOOM = { min: 20, max: 100 };
addEventListener('wheel', (e) => {
  e.preventDefault();
  const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * innerHeight : e.deltaY;
  H.view.dist = Math.min(ZOOM.max, Math.max(ZOOM.min, H.view.dist * Math.exp(dy * 0.0015)));
}, { passive: false });

let RES = 1;
const popup = (pts, paint, o = {}) => H.popup(pts, paint, { res: RES, ...o });

// ---- 2. the map: the real place as the page (the water blocks the walk) ------------------------------
const map = buildMap(H, loc);

// ---- 3. the hero: your figure, or the drawn fallback ------------------------------------------------
const HERO_FILE = './assets/hero.png';
const HERO_BACK = './assets/hero-back.png';
const HERO_SIDE = './assets/hero-side.png';
const HERO_W = HERO.width, HERO_H = HERO.height;
const loadImage = (src) => new Promise((ok) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => ok(null); im.src = src; });
const [heroImage, heroBack, heroSide] = await Promise.all([loadImage(HERO_FILE), loadImage(HERO_BACK), loadImage(HERO_SIDE)]);
// the default player's frames (papertrails' cat_calico, MIT — see assets/cat-README.md);
// without them the drawn cat stands in
const [catStand, catWalkA, catWalkB] = await Promise.all([
  loadImage('./assets/cat-stand.png'), loadImage('./assets/cat-walk-a.png'), loadImage('./assets/cat-walk-b.png'),
]);
const catArt = (catStand && catWalkA && catWalkB) ? { stand: catStand, walkA: catWalkA, walkB: catWalkB } : null;

// the drawn fallback (replace with the place's own person): one flat card that flips to the lens
// the default player is the calico cat (world/cat.js); a user's own figure ships as the three
// keyed hero views and takes over automatically
const drawnMan = () => {
  const D = P2.draw2;
  const art = P2.drawnPiece((gg, ink) => {
    for (const s of [-1, 1]) {
      const cx = s * 0.22;
      gg.fillStyle = ink(C.denim); D.rect(gg, cx - 0.11, 0.18, 0.22, 0.78, 0.03);
      gg.fillStyle = ink(C.denimD); D.rect(gg, cx - 0.11, 0.18, 0.22, 0.06, 0.02);
      gg.fillStyle = ink(C.sneaker); D.rect(gg, cx - 0.135, 0, 0.27, 0.16, 0.06);
      gg.fillStyle = ink(C.sole); D.rect(gg, cx - 0.135, 0, 0.27, 0.05, 0.02);
      gg.fillStyle = ink(C.lace, 'print'); D.rect(gg, cx - 0.06, 0.1, 0.12, 0.02);
    }
    gg.fillStyle = ink(C.hoody); D.rect(gg, -0.42, 0.92, 0.84, 1.05, 0.08);
    gg.fillStyle = ink(C.hoodyD); D.rect(gg, -0.42, 0.92, 0.84, 0.09, 0.03);
    gg.fillStyle = ink(C.hoodyD); D.rect(gg, -0.24, 0.98, 0.48, 0.34, 0.1);
    gg.fillStyle = ink(P2.shade(C.hoody, -0.18), 'print');
    D.rect(gg, -0.045, 1.52, 0.03, 0.3); D.rect(gg, 0.015, 1.52, 0.03, 0.3);
    for (const s of [-1, 1]) {
      const cx = s * 0.5;
      gg.fillStyle = ink(P2.shade(C.hoody, -0.07)); D.rect(gg, cx - 0.11, 1.12, 0.22, 0.72, 0.09);
      gg.fillStyle = ink(C.hoodyD); D.rect(gg, cx - 0.11, 1.05, 0.22, 0.1, 0.03);
      gg.fillStyle = ink(C.skin); D.ell(gg, cx, 0.98, 0.075, 0.068);
      gg.fillStyle = ink(P2.shade(C.hoody, -0.3), 'print'); D.rect(gg, s * 0.39 - 0.013, 1.14, 0.026, 0.64);
    }
    gg.fillStyle = ink(C.skin); D.ell(gg, 0, 2.16, 0.33, 0.36);
    gg.fillStyle = ink(C.hair, 'print'); D.rect(gg, -0.2, 2.24, 0.11, 0.022); D.rect(gg, 0.09, 2.24, 0.11, 0.022);
    D.ell(gg, -0.135, 2.14, 0.032, 0.042); D.ell(gg, 0.135, 2.14, 0.032, 0.042);
    gg.fillStyle = ink(C.mouth, 'print'); D.rect(gg, -0.06, 1.97, 0.12, 0.024, 0.012);
    gg.fillStyle = ink(C.cap); D.rect(gg, -0.33, 2.3, 0.66, 0.46, 0.2);
    gg.fillStyle = ink(P2.shade(C.cap, -0.14)); D.rect(gg, -0.335, 2.3, 0.67, 0.12, 0.05);
    gg.fillStyle = ink(P2.shade(C.cap, 0.12), 'print');
    D.poly(gg, [[-0.33, 2.36], [-0.12, 2.66], [0.02, 2.38], [-0.12, 2.33]]);
    D.poly(gg, [[0.02, 2.38], [0.12, 2.66], [0.33, 2.36], [0.12, 2.33]]);
    gg.fillStyle = ink(C.capBrim); D.rect(gg, -0.36, 2.28, 0.72, 0.1, 0.05);
  }, { w: HERO_W, h: HERO_H, name: 'man' });
  const card = makeCard(art[0], { paint: art[1], paper: H.paper, thickness: 0.05, edgeWidth: 0.04, pxPerUnit: 64, seed: 501, back: 'mirror', folds: [] });
  card.position.y = -0.03;
  const g = new H.THREE.Group(); g.add(card); return g;
};

const viewArt = (img, { mirror = false, name = 'hero' } = {}) => {
  const fit = Math.min(HERO_W / img.width, HERO_H / img.height);
  const iw = img.width * fit, ih = img.height * fit;
  return P2.drawnPiece((gg) => {
    gg.save();
    gg.imageSmoothingQuality = 'high';
    if (mirror) { gg.translate(iw / 2, ih); gg.scale(-1, -1); }
    else { gg.translate(-iw / 2, ih); gg.scale(1, -1); }
    gg.drawImage(img, 0, 0, iw, ih);
    gg.restore();
  }, { w: HERO_W, h: HERO_H, res: 128, simplify: 0.5, name });
};
const viewCard = (art, opts = {}) => {
  const card = makeCard(art[0], { paint: art[1], paper: H.paper, thickness: 0.05, edgeWidth: 0.04, pxPerUnit: 128, seed: 501, back: 'mirror', folds: [], ...opts });
  card.position.y = -0.03;
  return card;
};
const standee = () => {
  const frontCard = viewCard(viewArt(heroImage, { name: 'hero' }), {
    back: heroBack ? viewArt(heroBack, { mirror: true, name: 'hero-back' })[1] : 'mirror',
    backRes: 1,
  });
  const g = new H.THREE.Group(); g.add(frontCard);
  let sideCard = null;
  if (heroSide) {
    const sideArt = viewArt(heroSide, { name: 'hero-side' });
    sideCard = viewCard(sideArt, { back: false });
    sideCard.rotation.y = -Math.PI / 2;
    sideCard.visible = false;
    g.add(sideCard);
  }
  return { node: g, frontCard, sideCard };
};
const placeHero = (x, z) => {
  const rig = heroImage ? standee() : null;
  const cat = rig ? null : buildCat(H, catArt);
  const hero = popup(null, null, { node: rig ? rig.node : cat.node, height: rig ? 2.9 : 1.15, x, z, sway: 0.15, scale: rig ? HERO.scale : 1, order: 0 });
  H.setHero(hero, { turn: rig ? 'yaw' : 'flip', stride: rig ? null : cat.stride });   // flip: the cat stays side-on, mirrored by direction
  if (rig && rig.sideCard) {
    H.onStep(() => {
      const vy = H.view.yaw * Math.PI / 180;
      const q = Math.atan2(Math.sin(hero.group.rotation.y - vy), Math.cos(hero.group.rotation.y - vy));
      const across = Math.abs(q) > Math.PI / 4 && Math.abs(q) < Math.PI * 3 / 4;
      rig.sideCard.visible = across;
      rig.frontCard.visible = !across;
    });
  }
};
placeHero(spawn.x, spawn.z);

// ---- 3b. the chart, the sites' markers and their stories --------------------------------------------
settleSites(H, loc.sites);
siteHits = buildSiteTags(H, loc, loc.sites);
createMinimap(H, loc, map.sheet, loc.sites);

// ---- 3c. CONTENT: the place's own landmarks, buildings and vegetation go here ------------------------
// See the example repos for the pattern: one module per content layer (a landmark assembly, the
// trees, the skyline), each placed from the location's data, never from hard-coded coordinates.

H.start();
createMusic(H);          // the score starts on the first gesture (the intro's Begin counts); M mutes it
showIntro(loc);          // the opening card: the name, what this is, the controls (?test / ?capture skip it)
