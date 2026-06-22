import { CRACK_TOP, CRACK_BOT, PLAY, MM2PX } from './config.js';

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// A pitch holds 1–2 crack *systems*, each a branching network of strands: a
// trunk running top→bottom plus branches that fork toward the floor, merge back
// into another strand (forming Ys and islands), or cross it (Xs). Mostly one
// rich system; sometimes two.
export function pickSystemCount() {
  return Math.random() < 0.6 ? 1 : 2;
}

// Lanes are laid with a hard outer margin and an inter-system gutter, and every
// strand centre is inset from its lane edge by half the lane's max aperture, so
// ribbons can never cross a lane boundary — systems are non-overlapping by
// construction. `wobble` (0..~1.6) adds roughness for chossy rock.
export function generateSystems(count, wobble = 0) {
  const outer = 40, gutter = 74;
  const laneW = (PLAY.w - outer * 2 - gutter * (count - 1)) / count;
  const systems = [];
  for (let i = 0; i < count; i++) {
    const x0 = PLAY.x + outer + i * (laneW + gutter);
    systems.push(generateSystem(x0, x0 + laneW, count === 1 ? 3 : 2, wobble));
  }
  return systems;
}

function generateSystem(x0, x1, branchBudget, wobble) {
  const laneW = x1 - x0;
  // Cap aperture so a full-width ribbon still fits inside the lane with margin.
  const maxW = clamp((laneW - 24) / MM2PX, 34, 135);
  const inset = (maxW * MM2PX) / 2 + 6;          // keep centres this far from lane edges
  const loX = x0 + inset, hiX = x1 - inset;
  const cx = (lo) => clamp(lo, loX, hiX);

  const topX = cx(x0 + laneW * (0.3 + Math.random() * 0.4));
  const botX = cx(x0 + laneW * (0.3 + Math.random() * 0.4));
  const trunk = buildStrand(topX, CRACK_TOP, botX, CRACK_BOT, maxW, {
    wander: Math.min(laneW * 0.14, 30), M: 40, wobble
  });
  const segments = [trunk];

  // Try to add a branch; reject candidates that run alongside (overlap) an
  // existing strand so the system stays legible instead of a tangle.
  const tryAddBranch = () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const all = segments.flat();
      const starts = all.filter((p) => p.y > CRACK_TOP + 50 && p.y < CRACK_BOT - 130);
      if (!starts.length) return;
      const S = starts[Math.floor(Math.random() * starts.length)];
      const r = Math.random();
      const side = Math.random() < 0.5 ? -1 : 1;
      let ex, ey;

      if (r < 0.42) {
        ex = cx(S.x + side * (laneW * 0.22 + Math.random() * laneW * 0.22));
        ey = CRACK_BOT;
      } else if (r < 0.78) {
        const lower = all.filter((p) => p.y > S.y + 80);
        if (lower.length) {
          const Q = lower[Math.floor(Math.random() * lower.length)];
          ex = Q.x; ey = Q.y;
        } else { ex = cx(S.x + side * laneW * 0.3); ey = CRACK_BOT; }
      } else {
        const dir = S.x < (x0 + x1) / 2 ? 1 : -1;
        ex = cx(S.x + dir * laneW * 0.5);
        ey = clamp(S.y + 130 + Math.random() * 150, CRACK_TOP, CRACK_BOT);
      }

      const cand = buildStrand(S.x, S.y, ex, ey, maxW, {
        wander: Math.min(laneW * 0.1, 18), M: 28, mid: 11 + Math.random() * 15, wobble
      });
      // Reject if the middle of the branch shadows an existing strand.
      if (!overlapsExisting(cand, all)) { segments.push(cand); return; }
    }
  };

  for (let b = 0; b < branchBudget; b++) {
    if (Math.random() < (b === 0 ? 0.82 : 0.5)) tryAddBranch();
  }

  return makeSystemApi(segments);
}

// True if the inner span of `cand` runs close-and-parallel to any existing point
// (its endpoints are meant to touch other strands, so they're excluded).
function overlapsExisting(cand, existing, near = 16) {
  let hits = 0, checked = 0;
  for (let i = 3; i < cand.length - 3; i++) {
    checked++;
    const c = cand[i];
    for (const p of existing) {
      if (Math.hypot(p.x - c.x, p.y - c.y) < near) { hits++; break; }
    }
  }
  return checked > 0 && hits / checked > 0.35;
}

// Build one strand (polyline of {x,y,w}) between two endpoints. Wander is applied
// perpendicular to the line and tapered to zero at both ends so the strand meets
// its endpoints exactly (clean merges). Width undulates with a guaranteed
// constriction and usually a parallel section. `wobble` roughens chossy rock.
function buildStrand(ax, ay, bx, by, maxW, opts = {}) {
  const M = opts.M || 32;
  const dx = bx - ax, dy = by - ay;
  const len = Math.max(1, Math.hypot(dx, dy));
  const px = -dy / len, py = dx / len; // perpendicular unit
  const wAmp = opts.wander || 22;
  const wob = opts.wobble || 0;
  const wander = [
    { amp: wAmp * (0.6 + Math.random() * 0.6), freq: 0.7 + Math.random() * 1.6, phase: Math.random() * 6.28 },
    { amp: wAmp * 0.4, freq: 2 + Math.random() * 2, phase: Math.random() * 6.28 }
  ];
  const mid = opts.mid != null ? opts.mid : 18 + Math.random() * Math.min(30, maxW - 22);
  const oct = [
    { amp: 12 + Math.random() * 12, freq: 1 + Math.random() * 1.4, phase: Math.random() * 6.28 },
    { amp: 6 + Math.random() * 6, freq: 2.5 + Math.random() * 2.5, phase: Math.random() * 6.28 },
    // extra high-frequency roughness only on poor rock
    { amp: wob * (2 + Math.random() * 3), freq: 5 + Math.random() * 4, phase: Math.random() * 6.28 }
  ];

  const points = [];
  for (let i = 0; i < M; i++) {
    const t = i / (M - 1);
    let x = ax + dx * t, y = ay + dy * t;
    let off = 0;
    for (const w of wander) off += w.amp * Math.sin(t * Math.PI * 2 * w.freq + w.phase);
    const taper = Math.sin(Math.PI * t);
    x += px * off * taper;
    y += py * off * taper;
    let mm = mid;
    for (const o of oct) mm += o.amp * Math.sin(t * Math.PI * 2 * o.freq + o.phase);
    points.push({ x, y, w: mm });
  }

  carveConstriction(points, 0.28 + Math.random() * 0.4);
  if (Math.random() < 0.7) flattenSection(points, 0.4 + Math.random() * 0.3);
  for (const p of points) p.w = clamp(p.w, 7, maxW);
  return points;
}

// A V-notch: narrow the aperture around `center`, narrower below than above so a
// nut seated above the pinch can't pull through.
function carveConstriction(points, center) {
  const L = points.length;
  const ci = Math.round(center * (L - 1));
  const span = Math.max(3, Math.round(L * 0.09));
  const floor = 9 + Math.random() * 8;
  for (let d = -span; d <= span; d++) {
    const i = ci + d;
    if (i < 1 || i > L - 2) continue;
    const k = 1 - Math.abs(d) / (span + 1);
    const target = floor + Math.abs(d) * (2.2 + Math.random());
    points[i].w = points[i].w * (1 - k) + target * k;
  }
}

// Flatten the aperture across a window so cams have parallel walls to bite on.
function flattenSection(points, center) {
  const L = points.length;
  const ci = Math.round(center * (L - 1));
  const span = Math.max(3, Math.round(L * 0.1));
  const level = points[clamp(ci, 0, L - 1)].w;
  for (let d = -span; d <= span; d++) {
    const i = ci + d;
    if (i < 0 || i > L - 1) continue;
    const k = 1 - Math.abs(d) / (span + 1);
    points[i].w = points[i].w * (1 - k) + level * k;
  }
}

function makeSystemApi(segments) {
  // tag every point with its strand + index, then flatten for nearest-search
  segments.forEach((seg) => seg.forEach((p, k) => {
    p.seg = seg; p.k = k;
    // local tangent (direction the crack runs) from neighbours, plus the
    // aperture normal (the axis a piece bridges) = tangent rotated 90°.
    const a = seg[Math.max(0, k - 1)];
    const b = seg[Math.min(seg.length - 1, k + 1)];
    const tx = b.x - a.x, ty = b.y - a.y;
    const tl = Math.hypot(tx, ty) || 1;
    p.tx = tx / tl; p.ty = ty / tl;
    p.nx = -p.ty; p.ny = p.tx;                 // aperture (normal) direction
    p.apertureAngle = Math.atan2(p.ny, p.nx);  // 0 = horizontal aperture
  }));
  const points = segments.flat();

  function sampleNearest(px, py) {
    let best = points[0], bestD = Infinity;
    for (const p of points) {
      const dx = p.x - px, dy = p.y - py;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = p; }
    }
    return {
      x: best.x, y: best.y, w: best.w, dist: Math.sqrt(bestD), point: best,
      apertureAngle: best.apertureAngle
    };
  }

  // Minimum aperture along the strand within `spanPx` *downhill* of a point
  // (following the strand's own direction, so it works for diagonal cracks too)
  // — used to detect a constriction a nut/hex can lock above.
  function minWidthBelow(point, spanPx) {
    let min = point.w;
    for (const p of points) {
      // project the offset onto the point's downhill tangent
      const dx = p.x - point.x, dy = p.y - point.y;
      const along = dx * point.tx + dy * point.ty;     // >0 = downhill
      const across = Math.abs(dx * point.nx + dy * point.ny);
      if (along > 0 && along <= spanPx && across < 26) min = Math.min(min, p.w);
    }
    return min;
  }

  // Local flare rate (mm of aperture change per pixel) along the point's strand.
  function flareRate(point) {
    const seg = point.seg, k = point.k;
    const a = seg[Math.max(0, k - 1)];
    const b = seg[Math.min(seg.length - 1, k + 1)];
    const dl = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
    return Math.abs(b.w - a.w) / dl;
  }

  // Aperture range present anywhere in this system (mm) — used to build a rack
  // that can actually protect the pitch.
  function widthRange() {
    let lo = Infinity, hi = -Infinity;
    for (const p of points) { lo = Math.min(lo, p.w); hi = Math.max(hi, p.w); }
    return { lo, hi };
  }

  return { segments, points, sampleNearest, minWidthBelow, flareRate, widthRange };
}
