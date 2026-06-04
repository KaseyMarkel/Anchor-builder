import { CRACK_TOP, CRACK_BOT, PLAY, MM2PX } from './config.js';

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// A pitch holds 1–2 crack *systems*, each a branching network of strands: a
// trunk running top→bottom plus branches that fork toward the floor, merge back
// into another strand (forming Ys and islands), or cross it (Xs). Mostly one
// rich system; sometimes two.
export function pickSystemCount() {
  return Math.random() < 0.6 ? 1 : 2;
}

export function generateSystems(count) {
  const margin = 56;
  const laneW = (PLAY.w - margin * 2) / count;
  const systems = [];
  for (let i = 0; i < count; i++) {
    const x0 = PLAY.x + margin + i * laneW;
    // a lone system gets a bigger branch budget than two side-by-side ones
    systems.push(generateSystem(x0, x0 + laneW, count === 1 ? 3 : 2));
  }
  return systems;
}

function generateSystem(x0, x1, branchBudget) {
  const laneW = x1 - x0;
  const maxW = clamp((laneW - 22) / MM2PX, 34, 135);

  const topX = x0 + laneW * (0.3 + Math.random() * 0.4);
  const botX = x0 + laneW * (0.3 + Math.random() * 0.4);
  const trunk = buildStrand(topX, CRACK_TOP, botX, CRACK_BOT, maxW, {
    wander: Math.min(laneW * 0.14, 30), M: 40
  });
  const segments = [trunk];

  const addBranch = () => {
    const all = segments.flat();
    const starts = all.filter((p) => p.y > CRACK_TOP + 50 && p.y < CRACK_BOT - 130);
    if (!starts.length) return;
    const S = starts[Math.floor(Math.random() * starts.length)];
    const r = Math.random();
    let ex, ey;
    const side = Math.random() < 0.5 ? -1 : 1;

    if (r < 0.42) {
      // fork down to the floor
      ex = clamp(S.x + side * (laneW * 0.22 + Math.random() * laneW * 0.22), x0 + 18, x1 - 18);
      ey = CRACK_BOT;
    } else if (r < 0.78) {
      // merge into a lower point on an existing strand → Y / island
      const lower = all.filter((p) => p.y > S.y + 80);
      if (lower.length) {
        const Q = lower[Math.floor(Math.random() * lower.length)];
        ex = Q.x; ey = Q.y;
      } else {
        ex = clamp(S.x + side * laneW * 0.3, x0 + 18, x1 - 18);
        ey = CRACK_BOT;
      }
    } else {
      // cross the trunk to the far side → X
      const dir = S.x < (x0 + x1) / 2 ? 1 : -1;
      ex = clamp(S.x + dir * laneW * 0.5, x0 + 18, x1 - 18);
      ey = clamp(S.y + 130 + Math.random() * 150, CRACK_TOP, CRACK_BOT);
    }

    segments.push(buildStrand(S.x, S.y, ex, ey, maxW, {
      wander: Math.min(laneW * 0.1, 18), M: 28, mid: 11 + Math.random() * 15
    }));
  };

  for (let b = 0; b < branchBudget; b++) {
    if (Math.random() < (b === 0 ? 0.82 : 0.5)) addBranch();
  }

  return makeSystemApi(segments);
}

// Build one strand (polyline of {x,y,w}) between two endpoints. Wander is applied
// perpendicular to the line and tapered to zero at both ends so the strand meets
// its endpoints exactly (clean merges). Width undulates with a guaranteed
// constriction and usually a parallel section.
function buildStrand(ax, ay, bx, by, maxW, opts = {}) {
  const M = opts.M || 32;
  const dx = bx - ax, dy = by - ay;
  const len = Math.max(1, Math.hypot(dx, dy));
  const px = -dy / len, py = dx / len; // perpendicular unit
  const wAmp = opts.wander || 22;
  const wander = [
    { amp: wAmp * (0.6 + Math.random() * 0.6), freq: 0.7 + Math.random() * 1.6, phase: Math.random() * 6.28 },
    { amp: wAmp * 0.4, freq: 2 + Math.random() * 2, phase: Math.random() * 6.28 }
  ];
  const mid = opts.mid != null ? opts.mid : 18 + Math.random() * Math.min(30, maxW - 22);
  const oct = [
    { amp: 12 + Math.random() * 12, freq: 1 + Math.random() * 1.4, phase: Math.random() * 6.28 },
    { amp: 6 + Math.random() * 6, freq: 2.5 + Math.random() * 2.5, phase: Math.random() * 6.28 }
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
  segments.forEach((seg) => seg.forEach((p, k) => { p.seg = seg; p.k = k; }));
  const points = segments.flat();

  function sampleNearest(px, py) {
    let best = points[0], bestD = Infinity;
    for (const p of points) {
      const dx = p.x - px, dy = p.y - py;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = p; }
    }
    return { x: best.x, y: best.y, w: best.w, dist: Math.sqrt(bestD), point: best };
  }

  // Minimum aperture in the crackwork directly below a point (any strand within
  // a narrow x-window) — used to detect a constriction beneath a nut.
  function minWidthBelow(point, spanPx) {
    let min = point.w;
    for (const p of points) {
      const dy = p.y - point.y;
      if (dy > 0 && dy <= spanPx && Math.abs(p.x - point.x) < 26) min = Math.min(min, p.w);
    }
    return min;
  }

  // Local flare rate (mm of aperture change per pixel) along the point's strand.
  function flareRate(point) {
    const seg = point.seg, k = point.k;
    const a = seg[Math.max(0, k - 1)];
    const b = seg[Math.min(seg.length - 1, k + 1)];
    const dy = Math.max(1, Math.abs(b.y - a.y));
    return Math.abs(b.w - a.w) / dy;
  }

  return { segments, points, sampleNearest, minWidthBelow, flareRate };
}
