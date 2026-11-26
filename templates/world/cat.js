// world/cat.js — the calico cat: the world's companion, paper-trails style.
//
// The manner is papertrails' critters: one side-view card (never front/back), walking = a two-pose
// trot — legs gathered, legs spread — swapped no faster than paper can flap, the card yawed to the
// way it walks. With generated art (assets/cat-stand.png, cat-walk-a.png, cat-walk-b.png; the
// prompt and the splitter live in the skill) the three poses print from the keyed sheet; without
// art the same cat is drawn here, its legs as four little hinged cards on the diagonal.
//
// buildCat(H, art) returns the popup node and the stride hook; followCat(H, handle, stride) makes
// it trail the hero a step behind, trotting to keep up and leaping back to his heels after a
// chart-travel. A cat keeping pace with a walking man is a trot — the two poses read it as one.

import * as P2 from 'papercraft/lib/paperkit-2d.js';
import { makeCard } from 'papercraft/lib/paperkit-3d.js';

const CAT = {
  cream: '#f3e8d2', orange: '#c9803a', ink: '#3a352f', nose: '#d98a7a', eye: '#5a7a4a',
};

// the die-cut outline: a plump side view facing +x, tail behind, ears up — one connected piece
function catOutline() {
  return [
    [-0.78, 0.12], [-0.95, 0.4], [-1.02, 0.68], [-0.8, 0.78], [-0.62, 0.5],   // the tail, curving up
    [-0.7, 0.5], [-0.62, 0.82], [-0.15, 0.95], [0.3, 0.86], [0.62, 0.55],    // the back
    [0.62, 0.35], [0.86, 0.62], [1.0, 0.5], [1.04, 0.66], [1.18, 0.52],      // the ears
    [1.14, 0.3], [0.82, 0.2], [0.55, 0.12], [-0.78, 0.12],                    // the chest and belly
  ];
}

function paintCatBody(P) {
  P.draw((g) => {
    g.fillStyle = CAT.cream;
    g.fillRect(-1.3, -0.1, 2.6, 1.25);
    // the calico's patches: orange and ink on cream
    g.fillStyle = CAT.orange;
    g.beginPath(); g.ellipse(0.12, 0.72, 0.26, 0.16, 0.2, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(-0.52, 0.5, 0.18, 0.12, 0.4, 0, Math.PI * 2); g.fill();
    g.fillStyle = CAT.ink;
    g.beginPath(); g.ellipse(-0.88, 0.68, 0.16, 0.1, -0.4, 0, Math.PI * 2); g.fill();   // the tail tip
    g.beginPath(); g.ellipse(0.92, 0.34, 0.13, 0.1, 0.3, 0, Math.PI * 2); g.fill();     // the head patch
    // the face: eye, nose, whiskers
    g.fillStyle = CAT.eye;
    g.beginPath(); g.arc(0.95, 0.44, 0.05, 0, Math.PI * 2); g.fill();
    g.fillStyle = CAT.nose;
    g.beginPath(); g.arc(1.13, 0.28, 0.04, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(58,53,47,0.6)';
    g.lineWidth = 0.018;
    g.beginPath();
    g.moveTo(1.06, 0.28); g.lineTo(1.18, 0.33);
    g.moveTo(1.06, 0.28); g.lineTo(1.18, 0.23);
    g.stroke();
    // a shadowed band under the belly
    g.fillStyle = 'rgba(58,53,47,0.14)';
    g.fillRect(-0.8, 0.1, 1.6, 0.1);
  });
}

function paintLeg(P) {
  P.draw((g) => {
    g.fillStyle = CAT.cream;
    g.fillRect(-0.09, -0.08, 0.18, 0.62);
    g.fillStyle = 'rgba(58,53,47,0.3)';
    g.fillRect(-0.09, 0.44, 0.18, 0.1);
  });
}

// the trot: each pose swings the four legs on the diagonal — gathered, then reaching
const TROT = {
  A: [0.34, -0.34, -0.34, 0.34],
  B: [-0.34, 0.34, 0.34, -0.34],
};

/**
 * buildCat(H, art = null) -> { node, stride }. art: { stand, walkA, walkB } images (all three
 * loaded) or null for the drawn cat. stride(walked, gait) picks the pose from the walked
 * distance — called by the harness for the player, or by followCat for a companion.
 */
export function buildCat(H, art = null) {
  const g = new H.THREE.Group();
  const common = { paper: H.paper, thickness: 0.05, edgeWidth: 0.04, back: 'mirror', folds: [] };
  const outline = catOutline();

  if (art) {
    const mk = (img, name) => {
      const fit = Math.min(2.0 / img.width, 1.15 / img.height);
      const iw = img.width * fit, ih = img.height * fit;
      const piece = P2Piece(img, iw, ih, name);
      const card = makeCard(piece[0], { ...common, pxPerUnit: 128, seed: 901, paint: piece[1] });
      card.visible = false;
      g.add(card);
      return card;
    };
    const stand = mk(art.stand, 'cat-stand');
    const walkA = mk(art.walkA, 'cat-walk-a');
    const walkB = mk(art.walkB, 'cat-walk-b');
    stand.visible = true;
    let last = stand;
    return {
      node: g,
      stride(walked, gait) {
        const pose = gait > 0.08 ? (Math.sin(walked * 5.2) > 0 ? walkA : walkB) : stand;
        if (pose !== last) { last.visible = false; pose.visible = true; last = pose; }
      },
    };
  }

  // the drawn cat: the body card, four hinged legs on the diagonal
  g.add(makeCard(outline, { ...common, paint: paintCatBody }));
  const legs = [];
  for (const [lx] of [[-0.52], [0.18], [-0.38], [0.32]]) {
    const leg = makeCard([[-0.09, 0], [0.09, 0], [0.09, -0.54], [-0.09, -0.54]], { ...common, thickness: 0.04, paint: paintLeg });
    leg.position.set(lx, 0.14, 0.015);
    g.add(leg);
    legs.push(leg);
  }
  return {
    node: g,
    stride(walked, gait) {
      const sw = Math.max(0, Math.min(1, gait)) * 0.4;
      const side = Math.sin(walked * 5.2) > 0 ? TROT.A : TROT.B;
      legs.forEach((leg, i) => { leg.rotation.x = side[i] * sw; });
    },
  };
}

/**
 * The companion: trail the hero a step behind, trot to keep up, leap back to his heels after a
 * chart-travel. The cat stays where the hero has walked, so it is always on the same ground.
 */
export function followCat(H, cat, { behind = 2.6, snap = 6, stride = null } = {}) {
  let walked = 0;
  const settle = () => {
    const hp = H.hero.group.position;
    const heading = H.hero.group.rotation.y;
    cat.group.position.set(hp.x - Math.sin(heading) * behind, 0.02, hp.z - Math.cos(heading) * behind);
    walked = 0;
  };
  H.onStep((time, dt) => {
    const hp = H.hero.group.position;
    const heading = H.hero.group.rotation.y;
    const tx = hp.x - Math.sin(heading) * behind;
    const tz = hp.z - Math.cos(heading) * behind;
    const p = cat.group.position;
    const dx = tx - p.x, dz = tz - p.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.02) {
      const k = Math.min(1, (d > snap ? 0.85 : 0.05 + d * 0.12) * dt * 8);
      p.x += dx * k; p.z += dz * k;
      walked += d * k;
      cat.group.rotation.y = Math.atan2(dx, dz);
    }
    stride?.(walked, d > 0.1 ? 1 : 0);
  });
  H.onRestart(settle);
  settle();
  return cat;
}

// one image printed into the pose card (y-up piece, image y-down)
function P2Piece(img, iw, ih, name) {
  return P2.drawnPiece((gg) => {
    gg.save();
    gg.imageSmoothingQuality = 'high';
    gg.translate(-iw / 2, ih);
    gg.scale(1, -1);
    gg.drawImage(img, 0, 0, iw, ih);
    gg.restore();
  }, { w: iw, h: ih, res: 128, simplify: 0.5, name });
}
