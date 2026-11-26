// world/sites.js — the landmark points of Central Park: hexagons on the chart, name tags in the air.
//
// Every site gets a small green hexagon on the chart (world/minimap.js) and an opaque paper name
// tag floating above the spot — a cream plate with a green rule and a pointer down at the ground,
// always turned to the camera. A click on a tag (or on the ground around it) opens the site's
// story panel: the name and a few short lines, on a small card at the bottom of the screen.
// Close it with the ×, Escape, or by clicking empty ground.
//
// A site whose OSM point lands in water at this scale moves to the nearest dry ground with room
// for its marker; bridge sites are the exception — their deck is walkable, so the hexagon stays
// on it and the tag floats over the bank beside the deck.

import * as THREE from 'three';

const BRIDGE_SITES = new Set(['Bow Bridge', 'Gapstow Bridge']);

// the site's story: two or three short lines each, the park in a breath
const STORIES = {
  'Bethesda Terrace': ['The park’s heart: the Angel of the Waters over the fountain, the arcade behind, the plaza full of song.'],
  'Bow Bridge': ['The cast-iron arc over the Lake (1862) — the park’s most romantic crossing.'],
  'Belvedere Castle': ['A toy castle on Vista Rock (1869), built as a weather station; the park’s best view.'],
  'Gapstow Bridge': ['The stone arch over the Pond’s neck, at the park’s southeast corner.'],
  'Strawberry Fields': ['A living memorial to John Lennon; the Imagine mosaic is its quiet centre.'],
  'Conservatory Garden': ['The formal garden behind the Vanderbilt Gate — Italian, French and English rooms.'],
  'Central Park Zoo': ['The little zoo of 1864, remade in the 1980s, still a favourite.'],
  'Sheep Meadow': ['The great lawn of the south. Sheep grazed here until 1934; crowds loll now.'],
  'The Ramble': ['38 acres of wild woodland paths — the park’s rambling heart.'],
  'Turtle Pond': ['Below the castle, a pond where turtles sun on the rocks.'],
  'Harlem Meer': ['The northern lake, ringed by the North Woods and the Dana Discovery Center.'],
  'Jacqueline Kennedy Onassis Reservoir': ['The great oval of water (1862), named for the First Lady who ran its track.'],
  'The Pond': ['The southeastern pond, glassy under the Plaza’s towers.'],
  'Conservatory Water': ['The model-boat pond — Saturdays, tiny sails cross the basin.'],
};

/** A tag needs to float clear of its landmark: a few sites carry an offset. */
const TAG_OFFSETS = { 'Belvedere Castle': [-13, -8] };

// --------------------------------------------------------------------------------------------------

/** Where the tag floats: the settled site point — for a bridge, that is the deck itself. */
function tagSpot(H, loc, s) {
  return { x: s.x, z: s.z };
}

/** One opaque tag texture: cream plate, green rule, dark name, a pointer down at the spot. */
function makeTagTexture(name) {
  const g = document.createElement('canvas').getContext('2d');
  const font = (px) => `700 ${px}px Georgia, "Times New Roman", serif`;
  let fontPx = 46;
  g.font = font(fontPx);
  let tw = g.measureText(name).width;
  const maxW = 620;
  if (tw > maxW) { fontPx *= maxW / tw; g.font = font(fontPx); tw = g.measureText(name).width; }
  const padX = 26, plateH = 74, cv = document.createElement('canvas');
  cv.width = Math.ceil(tw + padX * 2);
  cv.height = plateH + 20;
  const c = cv.getContext('2d');
  c.font = font(fontPx);
  c.fillStyle = '#f7f0e2';
  c.strokeStyle = '#4a7a46';
  c.lineWidth = 4;
  c.beginPath();
  c.roundRect(2, 2, cv.width - 4, plateH - 4, 14);
  c.fill();
  c.stroke();
  c.fillStyle = '#4a7a46';
  c.beginPath();
  c.moveTo(cv.width / 2 - 9, plateH - 4);
  c.lineTo(cv.width / 2 + 9, plateH - 4);
  c.lineTo(cv.width / 2, plateH + 16);
  c.closePath();
  c.fill();
  c.fillStyle = '#3f3a32';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(name, cv.width / 2, plateH / 2 + 2);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return { tex, aspect: cv.width / cv.height };
}

/**
 * The floating name tags: one opaque billboard per site, its pointer aimed at the ground spot.
 * Returns the click targets [{ name, sphere }] — a tap anywhere in a sphere opens the story.
 */
export function buildSiteTags(H, loc, sites) {
  const tags = [];
  for (const s of sites) {
    if (!STORIES[s.name]) continue;
    const spot = tagSpot(H, loc, s);
    const off = TAG_OFFSETS[s.name] || [0, 0];
    const x = spot.x + off[0], z = spot.z + off[1];
    const { tex, aspect } = makeTagTexture(s.name);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: true }));
    const h = 1.4;
    sprite.scale.set(h * aspect, h, 1);
    sprite.position.set(x, 4.9, z);          // the plate floats well over the hero's head
    sprite.name = 'tag-' + s.name;
    H.scene.add(sprite);
    tags.push({ name: s.name, sphere: new THREE.Sphere(new THREE.Vector3(x, 3.4, z), 8) });
  }
  return tags;
}

// --------------------------------------------------------------------------------------------------
// the story panel: a small card at the bottom of the screen, opened by a click on a tag
// --------------------------------------------------------------------------------------------------
let storyEl = null, storyStyle = null;

export function showStory(name, locName = null) {
  const story = STORIES[name];
  if (!story) return false;
  if (storyEl) {
    storyEl.querySelector('.pc-title').textContent = name;
    if (locName) storyEl.querySelector('.pc-kicker').textContent = locName;
    const body = storyEl.querySelector('.pc-body');
    body.innerHTML = '';
    for (const ln of story) {
      const p = document.createElement('p');
      p.textContent = ln;
      body.appendChild(p);
    }
    storyEl.classList.remove('gone');
    return true;
  }
  const stock = '#f7f0e2';
  const ink = '#3f3a32';
  const line = '#8b8378';
  const green = '#4a7a46';
  storyStyle = document.createElement('style');
  storyStyle.id = 'papercraft-story-style';
  storyStyle.textContent = `
    #papercraft-story{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:90;
      width:min(92vw,430px);opacity:1;transition:opacity .22s ease,transform .22s ease}
    #papercraft-story.gone{opacity:0;transform:translateX(-50%) translateY(10px);pointer-events:none}
    #papercraft-story .pc-card{position:relative;padding:18px 22px 16px;color:${ink};background:${stock};
      border-radius:3px;box-shadow:0 0 0 1px rgba(58,41,28,.34),0 18px 44px -16px rgba(24,14,5,.6),0 4px 12px rgba(30,18,8,.22);
      font-family:Georgia,'Times New Roman',serif}
    #papercraft-story .pc-x{position:absolute;top:8px;right:10px;width:26px;height:26px;border:0;background:none;
      color:${line};font-size:20px;line-height:1;cursor:pointer;border-radius:2px}
    #papercraft-story .pc-x:hover{color:${ink};background:rgba(120,96,64,.1)}
    #papercraft-story .pc-kicker{margin:0 0 4px;font-size:9px;letter-spacing:.3em;text-transform:uppercase;color:${line}}
    #papercraft-story .pc-title{margin:0 0 10px;font-size:21px;line-height:1.15;font-weight:600;
      padding-bottom:9px;border-bottom:2px solid ${green}}
    #papercraft-story .pc-body p{margin:0 0 8px;font-size:13.5px;line-height:1.55;color:${ink};opacity:.92}
    #papercraft-story .pc-body p:last-child{margin-bottom:0}
    @media (prefers-reduced-motion:reduce){#papercraft-story{transition:none}}
  `;
  document.head.appendChild(storyStyle);
  storyEl = document.createElement('div');
  storyEl.id = 'papercraft-story';
  storyEl.setAttribute('role', 'dialog');
  storyEl.setAttribute('aria-label', 'Site story');
  storyEl.innerHTML = `
    <div class="pc-card">
      <button class="pc-x" type="button" aria-label="Close">×</button>
      <p class="pc-kicker">Paper World</p>
      <h2 class="pc-title"></h2>
      <div class="pc-body"></div>
    </div>`;
  storyEl.querySelector('.pc-x').addEventListener('click', (e) => { e.stopPropagation(); closeStory(); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') closeStory(); });
  document.body.appendChild(storyEl);
  return showStory(name, locName);
}

export function closeStory() {
  storyEl?.classList.add('gone');
}

export function storyOpen() {
  return !!storyEl && !storyEl.classList.contains('gone');
}

/**
 * Stand each site on solid ground. Call after the map is built (the walk field knows water, decks
 * and buildings) and before the chart, so the hexagon marks the same ground the hero can reach.
 */
export function settleSites(H, sites) {
  const land = (x, z) => H.walk.surface(x, z) !== null;
  const room = (x, z) => {
    const yaw = Math.atan2(H.camera.position.x - x, H.camera.position.z - z);
    const ex = Math.cos(yaw), ez = -Math.sin(yaw);          // the marker's foot line on the page
    for (const d of [-1, -0.5, 0, 0.5, 1]) if (!land(x + ex * d, z + ez * d)) return false;
    for (let i = 0; i < 12; i++) {
      const a = (i * Math.PI) / 6;
      if (!land(x + Math.cos(a) * 1.8, z + Math.sin(a) * 1.8)) return false;
    }
    return true;
  };
  for (const s of sites) {
    if (BRIDGE_SITES.has(s.name)) continue;
    if (room(s.x, s.z)) continue;
    let best = null;
    for (let r = 0.5; r <= 14 && !best; r += 0.5) {
      for (let a = 0; a < 360 && !best; a += 10) {
        const x = s.x + Math.cos((a * Math.PI) / 180) * r, z = s.z + Math.sin((a * Math.PI) / 180) * r;
        if (room(x, z)) best = { x, z, r };
      }
    }
    if (best) {
      console.info(`world/sites: ${s.name} — its OSM point is on water at this scale; stood ${best.r.toFixed(1)} units away on dry land`);
      s.x = best.x; s.z = best.z;
    }
  }
  return sites;
}
