// templates/world/cat.js — the default player: a calico cat, paper-trails style.
//
// Most users have no hero art, so the world ships with a cat. The manner is papertrails'
// critters: one side-view card, always side-on to the lens (never edge-on), walking = a two-pose
// trot — legs gathered, legs spread — swapped no faster than paper can flap, and a left/right walk
// mirrors the card like a paper flip (the harness's `turn: 'flip'` does it for the player;
// followCat does it for a companion).
//
// The pose frames ship in templates/assets/cat-*.png — papertrails' cat_calico (sit, walk_a,
// walk_b), (c) 2026 Shikhar, MIT. Without them the same cat is drawn here as a layered paper
// construction of simple cards. A user's own figure (assets/hero*.png) takes over automatically.
//
// buildCat(H, art) returns the popup node and the stride hook. As the player:
//   H.setHero(hero, { turn: 'flip', stride: cat.stride })   // flip = always side-on, mirrored
// As a companion, followCat(H, handle, { stride }) makes it trail the hero a step behind.

import * as P2 from 'papercraft/lib/paperkit-2d.js';
import { makeCard } from 'papercraft/lib/paperkit-3d.js';

const CAT = {
  cream: '#f3e8d2', orange: '#c9803a', ink: '#3a352f', nose: '#d98a7a', eye: '#5a7a4a',
};

// the trot: contact (legs wide), passing (gathered), opposite contact, passing again
const TROT = {
  A: [0.42, -0.42, -0.42, 0.42],
  B: [-0.14, 0.14, 0.14, -0.14],
  C: [-0.42, 0.42, 0.42, -0.42],
};
const STRIDE_HZ = 0.9;             // pose swaps per second at the harness's walk speed (a trot)

function poseAt(walked, gait) {
  if (gait <= 0.08) return 'stand';
  const p = ((walked * STRIDE_HZ * 2) % 4 + 4) % 4;      // 0..4 through the cycle
  return p < 1 ? 'A' : p < 2 ? 'B' : p < 3 ? 'C' : 'B';
}

/**
 * buildCat(H, art = null) -> { node, stride }. art: { stand, walkA, walkB } images (all three
 * loaded) or null for the drawn cat. stride(walked, gait) picks the pose from the walked
 * distance — called by the harness for the player, or by followCat for a companion.
 */
export function buildCat(H, art = null) {
  const g = new H.THREE.Group();
  const common = { paper: H.paper, thickness: 0.05, edgeWidth: 0.04, back: 'mirror', folds: [] };

  if (art) {
    // the shipped frames: one die-cut card per pose, swapped on the trot
    const mk = (img, name) => {
      const fit = Math.min(2.0 / img.width, 1.15 / img.height);
      const iw = img.width * fit, ih = img.height * fit;
      const piece = P2.drawnPiece((gg) => {
        gg.save();
        gg.imageSmoothingQuality = 'high';
        gg.translate(-iw / 2, ih);
        gg.scale(1, -1);
        gg.drawImage(img, 0, 0, iw, ih);
        gg.restore();
      }, { w: iw, h: ih, res: 128, simplify: 0.5, name });
      const card = makeCard(piece[0], { ...common, pxPerUnit: 128, seed: 901, paint: piece[1] });
      card.visible = false;
      g.add(card);
      return card;
    };
    const stand = mk(art.stand, 'cat-stand');
    const A = mk(art.walkA, 'cat-walk-a');
    const B = mk(art.walkB, 'cat-walk-b');
    stand.visible = true;
    let last = stand;
    return {
      node: g,
      stride(walked, gait) {
        const pose = gait > 0.08 ? (Math.sin(walked * STRIDE_HZ) > 0 ? A : B) : stand;
        if (pose !== last) { last.visible = false; pose.visible = true; last = pose; }
      },
    };
  }

  // ---- the drawn cat: a layered paper construction, each card one safe simple shape ----------------
  const circle = (cx, cy, r, n = 20) => {
    const pts = [];
    for (let k = 0; k < n; k++) {
      const a = Math.PI * 2 * k / n;
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    return pts;
  };
  const ellipse = (cx, cy, rx, ry, n = 22) => {
    const pts = [];
    for (let k = 0; k < n; k++) {
      const a = Math.PI * 2 * k / n;
      pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
    }
    return pts;
  };
  const paintHead = (P) => P.draw((gg) => {
    gg.fillStyle = CAT.cream;
    gg.fillRect(-0.5, 0.05, 1.0, 0.95);
    gg.fillStyle = CAT.ink;
    gg.beginPath(); gg.ellipse(0.06, 0.78, 0.16, 0.1, 0.2, 0, Math.PI * 2); gg.fill();
    gg.fillStyle = CAT.eye;
    gg.beginPath(); gg.arc(0.18, 0.5, 0.07, 0, Math.PI * 2); gg.fill();
    gg.fillStyle = '#2c3a26';
    gg.beginPath(); gg.arc(0.18, 0.5, 0.03, 0, Math.PI * 2); gg.fill();
    gg.fillStyle = CAT.nose;
    gg.beginPath(); gg.arc(0.36, 0.38, 0.035, 0, Math.PI * 2); gg.fill();
    gg.strokeStyle = 'rgba(58,53,47,0.55)';
    gg.lineWidth = 0.015;
    gg.beginPath();
    gg.moveTo(0.34, 0.4); gg.lineTo(0.34, 0.33);
    gg.moveTo(0.31, 0.36); gg.quadraticCurveTo(0.2, 0.3, 0.12, 0.3);
    gg.moveTo(0.22, 0.34); gg.lineTo(0.44, 0.36);
    gg.moveTo(0.22, 0.28); gg.lineTo(0.44, 0.27);
    gg.stroke();
  });
  const paintEar = (P) => P.draw((gg) => {
    gg.fillStyle = CAT.cream;
    gg.fillRect(-0.3, -0.05, 0.6, 0.5);
    gg.fillStyle = 'rgba(217,138,122,0.75)';
    gg.beginPath();
    gg.moveTo(0.02, 0.1); gg.lineTo(-0.08, 0.3); gg.lineTo(0.12, 0.22);
    gg.closePath(); gg.fill();
  });
  const paintBody = (P) => P.draw((gg) => {
    gg.fillStyle = CAT.cream;
    gg.fillRect(-0.6, -0.45, 1.2, 0.9);
    gg.fillStyle = CAT.orange;
    gg.beginPath(); gg.ellipse(-0.1, 0.12, 0.2, 0.11, 0.3, 0, Math.PI * 2); gg.fill();
    gg.fillStyle = CAT.ink;
    gg.beginPath(); gg.ellipse(-0.34, 0.02, 0.12, 0.08, -0.4, 0, Math.PI * 2); gg.fill();
  });
  const paintTail = (P) => P.draw((gg) => {
    gg.fillStyle = CAT.cream;
    gg.fillRect(-0.1, -0.05, 0.2, 0.6);
    gg.fillStyle = CAT.ink;
    gg.fillRect(-0.1, 0.42, 0.2, 0.13);
  });
  const paintLeg = (P) => P.draw((gg) => {
    gg.fillStyle = CAT.cream;
    gg.fillRect(-0.09, -0.08, 0.18, 0.62);
    gg.fillStyle = 'rgba(58,53,47,0.3)';
    gg.fillRect(-0.09, 0.44, 0.18, 0.1);
  });

  const headCard = makeCard(circle(0.42, 0.52, 0.4), { ...common, paint: paintHead });
  headCard.position.z = 0.03;
  g.add(headCard);
  for (const [lx, rz] of [[0.2, 0.14], [0.56, -0.14]]) {
    const ear = makeCard([[-0.16, 0], [0.04, 0.34], [0.18, 0]], { ...common, thickness: 0.04, paint: paintEar });
    ear.position.set(lx, 0.84, 0.02);
    ear.rotation.z = rz;
    g.add(ear);
  }
  const bodyCard = makeCard(ellipse(-0.22, 0.26, 0.46, 0.3), { ...common, paint: paintBody });
  bodyCard.position.z = -0.03;
  g.add(bodyCard);
  const tailCard = makeCard([[-0.06, 0], [0.06, 0], [0.05, 0.52], [-0.05, 0.52]], { ...common, thickness: 0.04, paint: paintTail });
  tailCard.position.set(-0.62, 0.2, -0.04);
  tailCard.rotation.z = -0.5;
  g.add(tailCard);
  const legs = [];
  for (const [lx] of [[-0.3], [0.28], [-0.14], [0.42]]) {
    const leg = makeCard([[-0.09, 0], [0.09, 0], [0.09, -0.52], [-0.09, -0.52]], { ...common, thickness: 0.04, paint: paintLeg });
    leg.position.set(lx, 0.12, 0.01);
    g.add(leg);
    legs.push(leg);
  }
  return {
    node: g,
    stride(walked, gait) {
      const sw = Math.max(0, Math.min(1, gait)) * 0.4;
      const side = poseAt(walked, gait) === 'A' ? TROT.A : poseAt(walked, gait) === 'B' ? TROT.B : TROT.C;
      legs.forEach((leg, i) => { leg.rotation.x = side[i] * sw; });
    },
  };
}

/**
 * The companion mode: trail the hero a step behind, trot to keep up, leap back to his heels after
 * a chart-travel. The cat stays side-on to the lens: a left/right walk mirrors the card like a
 * paper flip, it never yaws edge-on.
 */
export function followCat(H, cat, { behind = 2.6, snap = 6, stride = null } = {}) {
  let walked = 0;
  let facing = 1;
  const settle = () => {
    const hp = H.hero.group.position;
    const heading = H.hero.group.rotation.y;
    cat.group.position.set(hp.x - Math.sin(heading) * behind, 0.02, hp.z - Math.cos(heading) * behind);
    cat.pivot.scale.x = 1;
    facing = 1;
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
      if (Math.abs(dx) > Math.abs(dz) * 0.4 && Math.sign(dx) !== facing && Math.abs(dx) > 0.04) {
        facing = Math.sign(dx);
        cat.pivot.scale.x = facing;
      }
    }
    stride?.(walked, d > 0.1 ? 1 : 0);
  });
  H.onRestart(settle);
  settle();
  return cat;
}
