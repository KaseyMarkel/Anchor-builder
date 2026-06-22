// Deterministic, explainable placement scoring.
//
// Every placement is graded 1–100 from a small set of *named* sub-ratings the UI
// can show, so a piece never blows for a hidden reason. The same HOLD_THRESHOLD
// applies to every kind of gear, so "does it hold?" is one consistent line.
//
// Each evaluation returns:
//   { score, hold, note, factors: [{ label, rating, weight, hint }], reason }
// where `rating` is 0–100, `weight` sums to 1 across the quality factors, and
// `reason` is the single limiting factor (what to fix). The final score is the
// weighted blend scaled by the rock-quality factor, which is shown explicitly.

export const HOLD_THRESHOLD = 50;

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// Smallest angle between a piece's spanning axis and the crack's aperture axis,
// folded into [0, π/2] (a piece is symmetric end-for-end). cos → 1 aligned, 0
// perpendicular. Auto-placed pieces are aligned, so this only bites when the
// player deliberately rotates a piece off the crack's true angle.
export function alignmentQuality(angle, apertureAngle) {
  let d = angle - apertureAngle;
  while (d > Math.PI / 2) d -= Math.PI;
  while (d < -Math.PI / 2) d += Math.PI;
  return clamp(Math.cos(d), 0, 1);
}

function blend(factors, rockFactor) {
  const wsum = factors.reduce((a, f) => a + f.weight, 0) || 1;
  const q = factors.reduce((a, f) => a + f.rating * f.weight, 0) / wsum / 100;
  return Math.round(clamp((6 + q * 94) * rockFactor, 1, 100));
}

function limiting(factors) {
  return factors.reduce((lo, f) => (f.rating < lo.rating ? f : lo), factors[0]);
}

function scoreCam(cam, sample, crack, angle, rockFactor) {
  const w = sample.w;
  if (w > cam.max + 1.5) return fail('Crack too wide — the cam is tipped out', 'Pick a bigger cam', cam, sample);
  if (w < cam.min - 1.5) return fail('Over-cammed — too tight to seat', 'Pick a smaller cam', cam, sample);

  // r: 0 = lobes nearly open (tipped), 1 = lobes nearly closed (over-cammed).
  // The sweet spot is ~40–70% retracted.
  const r = clamp((cam.max - w) / (cam.max - cam.min), 0, 1);
  const rangeRating = clamp(1 - Math.abs(r - 0.55) / 0.5, 0, 1) * 100;
  const flareRating = clamp(1 - crack.flareRate(sample.point) / 0.9, 0, 1) * 100;
  const alignRating = alignmentQuality(angle, sample.apertureAngle) * 100;

  const factors = [
    { label: 'Range', rating: Math.round(rangeRating), weight: 0.5,
      hint: r > 0.85 ? 'lobes nearly closed' : r < 0.3 ? 'lobes nearly open' : 'good lobe angle' },
    { label: 'Walls', rating: Math.round(flareRating), weight: 0.32,
      hint: flareRating < 45 ? 'flaring — could walk' : 'parallel walls' },
    { label: 'Align', rating: Math.round(alignRating), weight: 0.18,
      hint: alignRating < 80 ? 'angled off the crack' : 'square to the crack' }
  ];
  const score = blend(factors, rockFactor);
  const lim = limiting(factors);
  const note = score >= 75 ? 'Bomber cam' : lim.label === 'Walls' && flareRating < 45 ? 'Flaring walls — could walk'
    : lim.label === 'Range' && r < 0.3 ? 'Tipped-out lobes — sketchy' : 'Solid cam';
  return finish(score, factors, note, lim, cam, sample);
}

function scoreNut(nut, sample, crack, angle, rockFactor) {
  const w = sample.w;
  if (w < nut.size * 0.82) return fail('Too big for the slot', 'Pick a smaller nut', nut, sample);

  const fitRatio = w / nut.size;
  const fitRating = clamp(1 - Math.abs(fitRatio - 1.05) / 0.65, 0, 1) * 100;
  const below = crack.minWidthBelow(sample.point, 50);
  const lockRating = clamp((nut.size - below) / (nut.size * 0.4), 0, 1) * 100;
  const alignRating = alignmentQuality(angle, sample.apertureAngle) * 100;

  const factors = [
    { label: 'Lock', rating: Math.round(lockRating), weight: 0.5,
      hint: lockRating < 30 ? 'no constriction below' : 'wedged above a taper' },
    { label: 'Fit', rating: Math.round(fitRating), weight: 0.34,
      hint: fitRating < 45 ? 'loose in the slot' : 'snug' },
    { label: 'Align', rating: Math.round(alignRating), weight: 0.16, hint: '' }
  ];
  const score = blend(factors, rockFactor);
  const lim = limiting(factors);
  const note = score >= 75 ? 'Locked in a perfect taper'
    : lockRating < 30 ? 'No constriction — would pull through' : 'Seated, a touch insecure';
  return finish(score, factors, note, lim, nut, sample);
}

function scoreHex(hex, sample, crack, angle, rockFactor) {
  const w = sample.w;
  if (w > hex.max + 3) return fail('Crack too wide — the hex rattles', 'Pick a bigger piece', hex, sample);
  if (w < hex.min - 2) return fail('Too big for the slot', 'Pick a smaller hex', hex, sample);

  const r = clamp((hex.max - w) / (hex.max - hex.min), 0, 1);
  const fitRating = clamp(1 - Math.abs(r - 0.55) / 0.5, 0, 1) * 100;
  const below = crack.minWidthBelow(sample.point, 50);
  const lockRating = clamp((w - below) / (w * 0.4), 0, 1) * 100;
  const alignRating = alignmentQuality(angle, sample.apertureAngle) * 100;

  const factors = [
    { label: 'Lock', rating: Math.round(lockRating), weight: 0.46, hint: lockRating < 30 ? 'needs a constriction' : 'chocked' },
    { label: 'Fit', rating: Math.round(fitRating), weight: 0.38, hint: '' },
    { label: 'Align', rating: Math.round(alignRating), weight: 0.16, hint: '' }
  ];
  const score = blend(factors, rockFactor);
  const lim = limiting(factors);
  const note = score >= 75 ? 'Slotted hex, well chocked'
    : lockRating < 30 ? 'Needs a constriction below' : 'Placed, a bit loose';
  return finish(score, factors, note, lim, hex, sample);
}

function fail(note, reason, gear, sample) {
  return {
    score: gear.kind === 'cam' ? 4 : 5, hold: false, note, reason,
    factors: [{ label: 'Fit', rating: 0, weight: 1, hint: note }],
    kN: gear.kN, widthMm: sample.w
  };
}

function finish(score, factors, note, lim, gear, sample) {
  return {
    score, hold: score >= HOLD_THRESHOLD, note,
    reason: lim.rating < 60 ? `${lim.label}: ${lim.hint}` : 'Solid on every count',
    factors, kN: gear.kN, widthMm: sample.w
  };
}

// Public: evaluate a movable piece. `angle` is the piece's spanning-axis angle
// (radians); `rockFactor` is the pitch's rock-quality multiplier (≤1).
export function evaluatePlacement(gear, sample, crack, angle, rockFactor = 1) {
  if (gear.kind === 'cam') return scoreCam(gear, sample, crack, angle, rockFactor);
  if (gear.kind === 'hex') return scoreHex(gear, sample, crack, angle, rockFactor);
  return scoreNut(gear, sample, crack, angle, rockFactor);
}

// Public: evaluate fixed gear (pin/bolt). Reliability is driven by a visible
// `condition` (0..1) so the player can inspect a bomber bolt vs a sketchy one
// before committing. Chossy rock drags fixed gear down a little too.
export function evaluateFixed(fixed, rockFactor = 1) {
  const condRating = Math.round(fixed.condition * 100);
  const rockRating = Math.round(rockFactor * 100);
  const factors = [
    { label: 'Condition', rating: condRating, weight: 0.78,
      hint: fixed.condition > 0.7 ? 'looks bomber' : fixed.condition > 0.4 ? 'seems okay' : 'corroded/loose' },
    { label: 'Rock', rating: rockRating, weight: 0.22, hint: '' }
  ];
  const score = Math.round(clamp((condRating * 0.78 + rockRating * 0.22), 1, 100));
  const kind = fixed.fixedType === 'bolt' ? 'bolt' : 'pin';
  const note = score >= 70 ? `Bomber ${kind}` : score >= 50 ? `Solid-looking ${kind}` : `Sketchy ${kind} — suspect`;
  return {
    score, hold: score >= HOLD_THRESHOLD, note,
    reason: score < HOLD_THRESHOLD ? 'Too corroded to trust' : 'Trustworthy fixed gear',
    factors, kN: fixed.kN, widthMm: fixed.widthMm
  };
}

// Bonus structure for the whole anchor, reworked so passive and active gear are
// both viable. The old code handed out 0.3× of every passive piece's score,
// which made nut-spamming dominate. Now:
//   • clean-climbing bonus: a small flat reward per *well-placed* passive piece
//     (score ≥ 60), capped — quality, not quantity.
//   • diversity bonus: a flat reward for a mixed anchor (≥2 gear kinds), which is
//     what good trad anchors actually look like.
export function anchorBonuses(placements) {
  const goodPassive = placements.filter(
    (p) => p.type === 'gear' && (p.gear.kind === 'nut' || p.gear.kind === 'hex') && p.score >= 60
  ).length;
  const cleanBonus = Math.min(goodPassive, 2) * 14;

  const kinds = new Set(
    placements.map((p) => (p.type === 'pin' ? 'fixed' : p.gear.kind))
  );
  const diversityBonus = kinds.size >= 2 ? 24 : 0;

  return { cleanBonus, diversityBonus };
}
