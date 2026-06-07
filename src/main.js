// Anchor Builder — trad climbing anchor sim / training tool.
// Each pitch generates 1–2 branching crack systems on a rock face. You grab a
// piece from the rack (it follows your cursor), move it over the crack, and —
// for cams — hold SPACE to pull the trigger and retract the lobes so they fit,
// then click to place. A cam only seats if you've retracted it narrower than the
// crack, exactly like the real thing. Each placement is scored 1–100 on real
// trad logic; a fall test then decides whether the anchor holds. Some pitches
// also have old fixed pins you can clip into the anchor.

import './style.css';
import {
  VIEW, PLAY, RACK, MM2PX, PUMP_SECONDS, PLACE_COST, COLORS,
  CRACK_TOP, CRACK_BOT
} from './config.js';
import { makeRack, gearSpec } from './gear.js';
import { generateSystems, pickSystemCount } from './crack.js';

const canvas = document.getElementById('game');
canvas.width = VIEW.w;
canvas.height = VIEW.h;
const ctx = canvas.getContext('2d');

const MAX_PIECES = 3;

// Rack layout — three rows (cams / nuts / hexes).
const RACK_LABEL_W = 52;
const RACK_PACK_X = RACK_LABEL_W + 8;
const RACK_AVAIL = VIEW.w - RACK_PACK_X - 12;
const RACK_GAP = 8;
const RACK_MIN_SLOT = 20;

// Rack icons render at TRUE crack scale, so a piece is the same size in the rack
// as it is in the crack. The rack is tall with variable row heights — cams (the
// largest family) get the most vertical room; only the few giant cams/hexes are
// height-capped to their row.
const RACK_SCALE = MM2PX;
const ROW_DEFS = [
  { kind: 'cam', label: 'CAMS', frac: 0.48 },
  { kind: 'nut', label: 'NUTS', frac: 0.20 },
  { kind: 'hex', label: 'HEXES', frac: 0.32 }
];

// ----------------------------------------------------------------------------
// Game state
// ----------------------------------------------------------------------------
const state = {
  phase: 'play',
  pitch: 1,
  score: 0,
  pitchPoints: 0,
  stamina: 1,
  systems: [],
  rack: [],
  placements: [],     // normalized: { type, score, note, hold, x, y, kN, gear?, sample?, pin? }
  pins: [],
  drag: null,         // { gear, idx, x, y, retraction }
  spaceHeld: false,
  rackRects: [],
  fall: null,
  result: null,
  hint: true
};

function newPitch() {
  state.phase = 'play';
  state.stamina = 1;
  state.systems = generateSystems(pickSystemCount());
  state.rack = makeRack();
  state.placements = [];
  state.pins = generatePins(state.systems);
  state.drag = null;
  state.fall = null;
  state.result = null;
}

// 30% of pitches carry 1–2 old fixed pins, each with a random condition.
function generatePins(systems) {
  if (Math.random() >= 0.30) return [];
  const n = Math.random() < 0.6 ? 1 : 2;
  const pins = [];
  for (let i = 0; i < n; i++) {
    const sys = systems[Math.floor(Math.random() * systems.length)];
    const cand = sys.points.filter((p) => p.y > CRACK_TOP + 50 && p.y < CRACK_BOT - 40);
    const p = cand[Math.floor(Math.random() * cand.length)] || sys.points[0];
    if (pins.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 70)) continue;
    const condition = Math.random();
    const score = Math.round(35 + condition * 60);
    pins.push({
      x: p.x, y: p.y, condition, widthMm: p.w,
      kN: Math.round(4 + condition * 10),
      score,
      note: condition > 0.7 ? 'Bomber fixed pin'
        : condition > 0.4 ? 'Old pin, seems solid' : 'Rusty pin — suspect',
      hold: score >= 45,
      used: false
    });
  }
  return pins;
}
newPitch();

// ----------------------------------------------------------------------------
// Scoring
// ----------------------------------------------------------------------------
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function scoreCam(cam, sample, crack) {
  const w = sample.w;
  if (w > cam.max + 1.5) return { score: 3, note: 'Tipped out — crack too wide', hold: false };
  if (w < cam.min - 1.5) return { score: 5, note: 'Over-cammed — crack too tight', hold: false };
  const r = clamp((cam.max - w) / (cam.max - cam.min), 0, 1);
  const rangeQ = clamp(1 - Math.abs(r - 0.6) / 0.5, 0, 1);
  const flareQ = clamp(1 - crack.flareRate(sample.point) / 0.9, 0, 1);
  const q = 0.62 * rangeQ + 0.38 * flareQ;
  const score = Math.round(clamp(10 + q * 90, 1, 100));
  let note;
  if (r > 0.85) note = 'Bit tight, but solid';
  else if (r < 0.32) note = 'Tipped-out lobes — sketchy';
  else if (flareQ < 0.4) note = 'Flaring walls — could walk';
  else note = score >= 75 ? 'Bomber cam placement' : 'Decent cam';
  return { score, note, hold: score >= 45 };
}

function scoreNut(nut, sample, crack) {
  const w = sample.w;
  const below = crack.minWidthBelow(sample.point, 50);
  const fitRatio = w / nut.size;
  const fitQ = fitRatio < 0.82 ? 0 : clamp(1 - Math.abs(fitRatio - 1.05) / 0.65, 0, 1);
  const lockQ = clamp((nut.size - below) / (nut.size * 0.4), 0, 1);
  const q = 0.42 * fitQ + 0.58 * lockQ;
  const score = Math.round(clamp(4 + q * 96, 1, 100));
  let note;
  if (fitQ === 0) note = 'Too big for the slot';
  else if (lockQ < 0.25) note = 'No constriction — would pull through';
  else if (score >= 75) note = 'Locked in a perfect taper';
  else note = 'Seated, a touch insecure';
  return { score, note, hold: score >= 40 && fitQ > 0 };
}

function scoreHex(hex, sample, crack) {
  const w = sample.w;
  if (w > hex.max + 3) return { score: 5, note: 'Crack too wide — hex rattles', hold: false };
  if (w < hex.min - 2) return { score: 5, note: 'Too big for the slot', hold: false };
  const r = clamp((hex.max - w) / (hex.max - hex.min), 0, 1);
  const fitQ = clamp(1 - Math.abs(r - 0.55) / 0.5, 0, 1);
  const below = crack.minWidthBelow(sample.point, 50);
  const lockQ = clamp((w - below) / (w * 0.4), 0, 1);
  const q = 0.5 * fitQ + 0.5 * lockQ;
  const score = Math.round(clamp(8 + q * 92, 1, 100));
  const note = score >= 75 ? 'Slotted hex, well chocked'
    : lockQ < 0.25 ? 'Needs a constriction below' : 'Placed, a bit loose';
  return { score, note, hold: score >= 42 };
}

function scorePlacement(gear, sample, crack) {
  if (gear.kind === 'cam') return scoreCam(gear, sample, crack);
  if (gear.kind === 'hex') return scoreHex(gear, sample, crack);
  return scoreNut(gear, sample, crack);
}

// ----------------------------------------------------------------------------
// Input — click to grab, cursor-follow, click to place. SPACE retracts a cam.
// ----------------------------------------------------------------------------
function toLogical(e) {
  const r = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) / r.width * VIEW.w,
    y: (e.clientY - r.top) / r.height * VIEW.h
  };
}

function nearestSample(px, py) {
  let best = null;
  state.systems.forEach((sys, ci) => {
    const s = sys.sampleNearest(px, py);
    if (!best || s.dist < best.s.dist) best = { ci, s, sys };
  });
  return best;
}

// Desktop (mouse): click to grab, cursor-follow, click to place, SPACE retracts.
// Touch: tap/drag to grab + position, two-finger pinch retracts a cam, lift to
// place. Both share these handlers, branching on pointer type.
const isTouch = window.matchMedia('(pointer: coarse)').matches;
const pointers = new Map();        // pointerId -> {id,x,y,sx,sy,type}
let pinch = null;                  // {baseDist, baseRetraction}
const PINCH_RANGE = 260;           // logical px of pinch travel ≈ full retraction

function dist2(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function touchPoints() {
  const a = [];
  for (const v of pointers.values()) if (v.type !== 'mouse') a.push(v);
  return a;
}
function activeTouchCount() { return touchPoints().length; }

function clipPin(pin) {
  pin.used = true;
  state.placements.push({
    type: 'pin', pin, x: pin.x, y: pin.y, kN: pin.kN, widthMm: pin.widthMm,
    score: pin.score, note: pin.note, hold: pin.hold
  });
  state.stamina = clamp(state.stamina - 0.02, 0, 1);
  state.hint = false;
  if (state.placements.length >= MAX_PIECES) startFallTest();
}

canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
  const p = toLogical(e);
  pointers.set(e.pointerId, { id: e.pointerId, x: p.x, y: p.y, sx: p.x, sy: p.y, type: e.pointerType });
  const touch = e.pointerType !== 'mouse';

  if (state.phase === 'result') { bankAndAdvance(); return; }
  if (state.phase !== 'play') return;

  // second finger on a held cam → begin pinch-to-retract (squish the lobes in)
  if (touch && state.drag && state.drag.gear.kind === 'cam' && activeTouchCount() === 2) {
    const [a, b] = touchPoints();
    pinch = { baseDist: dist2(a, b), baseRetraction: state.drag.retraction };
    state.drag.x = (a.x + b.x) / 2; state.drag.y = (a.y + b.y) / 2;
    return;
  }

  // rack: grab (or switch) a piece
  for (const rr of state.rackRects) {
    if (p.x >= rr.x && p.x <= rr.x + rr.w && p.y >= rr.y && p.y <= rr.y + rr.h) {
      if (!rr.gear.used) {
        state.drag = { gear: rr.gear, idx: rr.index, x: p.x, y: p.y, retraction: 0, touch, posId: e.pointerId };
      }
      return;
    }
  }

  // holding a piece
  if (state.drag) {
    if (touch) { state.drag.posId = e.pointerId; state.drag.x = p.x; state.drag.y = p.y; }
    else tryPlace();                 // desktop: a click places
    return;
  }

  // desktop clips a pin on click; touch clips on a tap (handled in pointerup)
  if (!touch) {
    for (const pin of state.pins) {
      if (!pin.used && Math.hypot(p.x - pin.x, p.y - pin.y) < 18) { clipPin(pin); return; }
    }
  }
});

canvas.addEventListener('pointermove', (e) => {
  const rec = pointers.get(e.pointerId);
  const p = toLogical(e);
  if (rec) { rec.x = p.x; rec.y = p.y; }
  if (!state.drag) return;

  if (pinch && state.drag.gear.kind === 'cam' && activeTouchCount() >= 2) {
    const [a, b] = touchPoints();
    state.drag.retraction = clamp(pinch.baseRetraction + (pinch.baseDist - dist2(a, b)) / PINCH_RANGE, 0, 1);
    state.drag.x = (a.x + b.x) / 2; state.drag.y = (a.y + b.y) / 2;
    return;
  }
  if (e.pointerType === 'mouse' || e.pointerId === state.drag.posId) {
    state.drag.x = p.x; state.drag.y = p.y;
  }
});

canvas.addEventListener('pointerup', (e) => {
  const rec = pointers.get(e.pointerId);
  const moved = rec ? Math.hypot(rec.x - rec.sx, rec.y - rec.sy) : 0;
  const type = rec ? rec.type : e.pointerType;
  pointers.delete(e.pointerId);
  try { canvas.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
  if (type === 'mouse' || state.phase !== 'play') return;

  // dropped below two fingers → end the pinch, hand positioning to the survivor
  if (pinch && activeTouchCount() < 2) {
    pinch = null;
    const rem = touchPoints()[0];
    if (rem && state.drag) state.drag.posId = rem.id;
  }

  if (state.drag) {
    if (activeTouchCount() === 0) {       // all fingers up → place if over a crack
      const near = nearestSample(state.drag.x, state.drag.y);
      if (near && near.s.dist <= 64) tryPlace();
    }
    return;
  }

  // a tap (not a drag) on an old pin clips it
  if (rec && moved < 14) {
    const pin = state.pins.find((q) => !q.used && Math.hypot(rec.x - q.x, rec.y - q.y) < 24);
    if (pin) clipPin(pin);
  }
});

canvas.addEventListener('pointercancel', (e) => {
  pointers.delete(e.pointerId);
  if (activeTouchCount() < 2) pinch = null;
});

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); state.spaceHeld = true; }
  else if (e.code === 'Escape') { state.drag = null; }
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') state.spaceHeld = false;
});

function camCurrentWidth(gear, retraction) {
  return gear.max - retraction * (gear.max - gear.min); // mm
}

function tryPlace() {
  const d = state.drag;
  const near = nearestSample(d.x, d.y);
  if (!near || near.s.dist > 64) { flash('Move it over a crack to place'); return; }
  const gear = d.gear;
  const crackW = near.s.w;

  if (gear.kind === 'cam') {
    const curW = camCurrentWidth(gear, d.retraction);
    if (curW > crackW + 1) {
      if (gear.min > crackW + 1) flash('Too big — over-cammed, it won’t fit here');
      else flash(isTouch ? 'Pinch two fingers to retract the cam more' : 'Hold SPACE to retract the lobes — pull the trigger');
      return;
    }
  }

  const res = scorePlacement(gear, near.s, near.sys);
  gear.used = true;
  state.placements.push({
    type: 'gear', gear, sample: near.s, x: near.s.x, y: near.s.y,
    kN: gear.kN, widthMm: near.s.w, ...res
  });
  state.stamina = clamp(state.stamina - PLACE_COST, 0, 1);
  state.drag = null;
  state.hint = false;
  if (state.placements.length >= MAX_PIECES) startFallTest();
}

let flashMsg = '', flashUntil = 0;
function flash(msg) { flashMsg = msg; flashUntil = now() + 1600; }
function now() { return performance.now(); }

// ----------------------------------------------------------------------------
// Fall test
// ----------------------------------------------------------------------------
function startFallTest() {
  state.phase = 'falling';
  state.drag = null;
  const holders = state.placements.filter((p) => p.hold);
  const effKN = state.placements.reduce((a, p) => a + p.kN * (p.score / 100), 0);
  const anchorHolds = holders.length >= 2 || (holders.length >= 1 && effKN >= 16);
  const catchY = anchorHolds ? Math.min(...holders.map((p) => p.y)) : CRACK_BOT + 220;
  state.fall = { y: CRACK_TOP - 30, v: 0, catchY, anchorHolds, settle: 0 };
  state.result = { anchorHolds, holds: holders.length, effKN };
}

function stepFall(dt) {
  const f = state.fall;
  f.v += 1400 * dt;
  f.y += f.v * dt;
  if (f.anchorHolds && f.y >= f.catchY) {
    f.y = f.catchY; f.v = 0; f.settle += dt;
    if (f.settle > 0.7) showResult();
  } else if (!f.anchorHolds && f.y > VIEW.h + 80) {
    showResult();
  }
}

function showResult() {
  const base = state.placements.reduce((a, p) => a + p.score, 0);
  // Reward passive protection (nuts & hexes) over active cams — it's lower-impact,
  // old-school gear and harder to place well.
  const passiveBonus = state.placements
    .filter((p) => p.type === 'gear' && (p.gear.kind === 'nut' || p.gear.kind === 'hex'))
    .reduce((a, p) => a + Math.round(p.score * 0.3), 0);

  let pts;
  if (state.result.anchorHolds) {
    const holdBonus = 100 + Math.round(state.stamina * 120);
    pts = base + holdBonus + passiveBonus;
    state.result.holdBonus = holdBonus;
  } else {
    pts = Math.round(base * 0.4) + Math.round(passiveBonus * 0.4);
    state.result.holdBonus = 0;
  }
  state.result.base = base;
  state.result.passiveBonus = passiveBonus;
  state.pitchPoints = pts;
  state.phase = 'result';
}

function bankAndAdvance() {
  state.score += state.pitchPoints;
  state.pitch += 1;
  newPitch();
}

// ----------------------------------------------------------------------------
// Render
// ----------------------------------------------------------------------------
let last = 0;
function frame(t) {
  const dt = Math.min(0.05, (t - last) / 1000) || 0;
  last = t;

  if (state.phase === 'play') {
    state.stamina = clamp(state.stamina - dt / PUMP_SECONDS, 0, 1);
    // desktop: SPACE animates the trigger. touch: retraction is driven by pinch.
    if (state.drag && state.drag.gear.kind === 'cam' && !state.drag.touch) {
      const target = state.spaceHeld ? 1 : 0;
      state.drag.retraction += (target - state.drag.retraction) * Math.min(1, dt * 12);
    }
    if (state.stamina <= 0 && state.placements.length < MAX_PIECES) {
      flash('Pumped out!');
      startFallTest();
    }
  } else if (state.phase === 'falling') {
    stepFall(dt);
  }

  draw();
  requestAnimationFrame(frame);
}

function draw() {
  ctx.clearRect(0, 0, VIEW.w, VIEW.h);
  drawBackground();
  drawHUD();
  drawRock();
  for (const sys of state.systems) drawSystem(sys);
  drawPins();
  drawPlacements();
  if (state.drag && state.phase === 'play') drawDragPreview();
  if (state.phase === 'falling' || state.fall) drawClimber();
  drawRack();
  drawMessages();
  if (state.phase === 'result') drawResult();
}

function drawBackground() {
  ctx.fillStyle = COLORS.hud;
  ctx.fillRect(0, 0, VIEW.w, VIEW.h);
}

// Procedural granite, baked once to an offscreen canvas: a mottled base plus
// thousands of mineral speckles (feldspar / quartz / mica / biotite).
let graniteTex = null;
function granite() {
  if (graniteTex) return graniteTex;
  const c = document.createElement('canvas');
  c.width = PLAY.w; c.height = PLAY.h;
  const g = c.getContext('2d');
  const base = g.createLinearGradient(0, 0, c.width, c.height);
  base.addColorStop(0, COLORS.rockLight);
  base.addColorStop(0.5, COLORS.rockMid);
  base.addColorStop(1, COLORS.rockDark);
  g.fillStyle = base; g.fillRect(0, 0, c.width, c.height);

  // soft mineral mottling
  for (let i = 0; i < 170; i++) {
    const x = Math.random() * c.width, y = Math.random() * c.height, r = 22 + Math.random() * 80;
    g.globalAlpha = 0.05 + Math.random() * 0.06;
    g.fillStyle = Math.random() < 0.5 ? COLORS.rockDark : COLORS.rockLight;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  // crystalline speckle
  const cols = ['#dadde4', '#b7bcc7', '#2b2f39', '#9aa0a8', '#c8b4a0', '#8b93a4'];
  for (let i = 0; i < 6000; i++) {
    const x = Math.random() * c.width, y = Math.random() * c.height, r = 0.4 + Math.random() * 1.9;
    g.globalAlpha = 0.22 + Math.random() * 0.5;
    g.fillStyle = cols[(Math.random() * cols.length) | 0];
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  g.globalAlpha = 1;
  graniteTex = c;
  return c;
}

function drawRock() {
  const { x, y, w, h } = PLAY;
  ctx.save();
  ctx.beginPath(); roundRect(x, y, w, h, 12); ctx.clip();
  ctx.drawImage(granite(), x, y, w, h);

  // ambient top-light → shadowed base, for relief
  const lg = ctx.createLinearGradient(0, y, 0, y + h);
  lg.addColorStop(0, 'rgba(255,255,255,0.10)');
  lg.addColorStop(0.42, 'rgba(255,255,255,0)');
  lg.addColorStop(1, 'rgba(0,0,0,0.30)');
  ctx.fillStyle = lg; ctx.fillRect(x, y, w, h);

  // vignette
  const rg = ctx.createRadialGradient(x + w / 2, y + h / 2, h * 0.2, x + w / 2, y + h / 2, w * 0.72);
  rg.addColorStop(0, 'rgba(0,0,0,0)');
  rg.addColorStop(1, 'rgba(0,0,0,0.36)');
  ctx.fillStyle = rg; ctx.fillRect(x, y, w, h);
  ctx.restore();

  ctx.lineWidth = 2; ctx.strokeStyle = COLORS.rockEdge;
  roundRect(x, y, w, h, 12); ctx.stroke();
}

function ribbonPath(seg, grow) {
  ctx.beginPath();
  for (let i = 0; i < seg.length; i++) {
    const half = (seg[i].w * MM2PX) / 2 + grow;
    if (i === 0) ctx.moveTo(seg[i].x - half, seg[i].y);
    else ctx.lineTo(seg[i].x - half, seg[i].y);
  }
  for (let i = seg.length - 1; i >= 0; i--) {
    const half = (seg[i].w * MM2PX) / 2 + grow;
    ctx.lineTo(seg[i].x + half, seg[i].y);
  }
  ctx.closePath();
}

function drawSystem(sys) {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const seg of sys.segments) {
    // recessed crack: a soft dark halo (ambient occlusion) makes it look carved
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 2;
    ribbonPath(seg, 3); ctx.fillStyle = COLORS.crack; ctx.fill();
    ctx.restore();
    // darker depth core
    ribbonPath(seg, 0); ctx.fillStyle = COLORS.crackInner; ctx.fill();
    // lit rim on the left wall (where the top-light catches the edge)
    ctx.strokeStyle = 'rgba(205,214,228,0.13)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < seg.length; i++) {
      const half = (seg[i].w * MM2PX) / 2;
      if (i === 0) ctx.moveTo(seg[i].x - half - 1, seg[i].y);
      else ctx.lineTo(seg[i].x - half - 1, seg[i].y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function drawPlacements() {
  for (const pl of state.placements) {
    if (pl.type === 'gear') drawPiece(pl.gear, pl.sample);
  }
}

// Honest fit: an active piece that fits expands to touch both walls; a misfit is
// drawn at its true size, so an over-cammed piece overflows and an undersized
// one shows gaps. Scores stay hidden until the end-of-pitch reveal.
function drawPiece(gear, s) {
  const crackW = s.w * MM2PX;
  const trueW = gear.nominal * MM2PX;
  let drawW = trueW;
  if (gear.kind === 'cam' || gear.kind === 'hex') {
    if (s.w >= gear.min && s.w <= gear.max) drawW = crackW;
  }
  ctx.save();
  drawGearShape(gear, s.x, s.y, drawW);
  ctx.restore();
}


// A cam with lobes that rotate on the axle. `spanPx` is the current contact width
// (distance between the rock-touching lobe edges). The axle, stem and lobe size
// stay fixed for a given cam — pulling the trigger rotates the lobes inward, so a
// retracted cam looks narrow because its lobes have pivoted, not shrunk.
function drawCam(gear, cx, cy, spanPx, maxHalf = Infinity) {
  const fullHalf = (gear.max * MM2PX) / 2;     // geometry sized to the cam's open width
  let lr = Math.max(2.2, fullHalf * 0.34);     // lobe radius
  let pivGap = Math.max(1.5, fullHalf * 0.16); // half the axle width
  const AMAX = 1.05;                            // splay (~60°) at full expansion
  let arm = Math.max(3, (fullHalf - pivGap - lr) / Math.sin(AMAX));

  // scale the whole mechanism down only if it would overflow a rack row
  const naturalHalf = arm * 0.7 + lr + 3;
  const gscale = naturalHalf > maxHalf ? maxHalf / naturalHalf : 1;
  lr *= gscale; pivGap *= gscale; arm *= gscale;

  const targetHalf = (spanPx / 2) * gscale;
  const a = Math.asin(clamp((targetHalf - pivGap - lr) / arm, -0.85, 0.98));
  const pivY = cy - arm * 0.45 * Math.cos(a);
  const lobeBottom = pivY + arm * Math.cos(a) + lr;
  const stem = clamp(fullHalf * 0.5, 8, 46) * gscale;
  const lw = Math.max(1, fullHalf * 0.09 * gscale);

  // stem + thumb loop + axle
  ctx.strokeStyle = COLORS.steel;
  ctx.lineWidth = Math.max(1.5, lw);
  ctx.beginPath(); ctx.moveTo(cx, pivY); ctx.lineTo(cx, lobeBottom + stem); ctx.stroke();
  ctx.lineWidth = Math.max(1.2, lw * 0.7);
  ctx.beginPath();
  ctx.ellipse(cx, lobeBottom + stem, Math.max(2, 3 * gscale), Math.max(3, 5 * gscale), 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx - pivGap, pivY); ctx.lineTo(cx + pivGap, pivY); ctx.stroke();

  // two rotating lobes
  for (const dir of [-1, 1]) {
    const px = cx + dir * pivGap, py = pivY;
    const ex = px + dir * arm * Math.sin(a);
    const ey = py + arm * Math.cos(a);
    const ang = Math.atan2(ey - py, ex - px);
    ctx.save();
    ctx.translate((px + ex) / 2, (py + ey) / 2);
    ctx.rotate(ang);
    ctx.fillStyle = gear.color;
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.ellipse(0, 0, arm / 2 + lr, lr, 0, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    ctx.restore();
    // axle pin
    ctx.fillStyle = COLORS.steelDark;
    ctx.beginPath(); ctx.arc(px, py, Math.max(1.2, lr * 0.26), 0, Math.PI * 2); ctx.fill();
  }
}

// Draw a piece centred at (cx,cy) spanning `wpx` wide, with height proportional
// to width (so larger gear is larger in both dimensions, not just fatter).
// `maxHalf` caps the vertical half-extent (used for the few giant rack icons).
function drawGearShape(gear, cx, cy, wpx, maxHalf = Infinity) {
  ctx.save();
  if (gear.kind === 'cam') {
    drawCam(gear, cx, cy, wpx, maxHalf);
  } else if (gear.kind === 'hex') {
    const hw = wpx / 2;
    const hh = Math.min(Math.max(5, wpx * 0.55), maxHalf);
    ctx.fillStyle = gear.color;
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(cx - hw, cy);
    ctx.lineTo(cx - hw * 0.5, cy - hh);
    ctx.lineTo(cx + hw * 0.5, cy - hh);
    ctx.lineTo(cx + hw, cy);
    ctx.lineTo(cx + hw * 0.5, cy + hh);
    ctx.lineTo(cx - hw * 0.5, cy + hh);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.strokeStyle = COLORS.steelDark; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx, cy + hh); ctx.lineTo(cx, cy + hh + 8); ctx.stroke();
  } else {
    const top = wpx / 2;
    const bot = wpx / 2.6;
    const h = Math.min(Math.max(7, wpx), maxHalf * 2);
    ctx.fillStyle = gear.color;
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(cx - top, cy - h / 2);
    ctx.lineTo(cx + top, cy - h / 2);
    ctx.lineTo(cx + bot, cy + h / 2);
    ctx.lineTo(cx - bot, cy + h / 2);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.strokeStyle = COLORS.steelDark; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.moveTo(cx, cy + h / 2); ctx.lineTo(cx, cy + h / 2 + 8); ctx.stroke();
  }
  ctx.restore();
}

function drawDragPreview() {
  const d = state.drag;
  const g = d.gear;
  const near = nearestSample(d.x, d.y);
  const onCrack = near && near.s.dist <= 64;
  const x = onCrack ? near.s.x : d.x;
  const y = onCrack ? near.s.y : d.y;

  ctx.save();
  ctx.globalAlpha = 0.92;
  if (g.kind === 'cam') {
    const curMm = camCurrentWidth(g, d.retraction);
    drawGearShape(g, x, y, curMm * MM2PX);
    if (onCrack) {
      const seats = curMm <= near.s.w + 1;
      const crackHalf = (near.s.w * MM2PX) / 2;
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = seats ? COLORS.good : COLORS.bad;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x - crackHalf, y - 22); ctx.lineTo(x - crackHalf, y + 22);
      ctx.moveTo(x + crackHalf, y - 22); ctx.lineTo(x + crackHalf, y + 22);
      ctx.stroke();
    }
  } else {
    drawGearShape(g, x, y, g.nominal * MM2PX);
  }
  ctx.restore();
}

function drawPins() {
  for (const pin of state.pins) {
    ctx.save();
    // blade hammered into the rock
    ctx.strokeStyle = '#6b6f78'; ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(pin.x - 10, pin.y - 6); ctx.lineTo(pin.x + 8, pin.y + 4); ctx.stroke();
    // eye
    ctx.fillStyle = '#9aa0a8';
    ctx.beginPath(); ctx.arc(pin.x - 12, pin.y - 8, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = COLORS.hud;
    ctx.beginPath(); ctx.arc(pin.x - 12, pin.y - 8, 2.2, 0, Math.PI * 2); ctx.fill();

    if (!pin.used) {
      ctx.strokeStyle = 'rgba(111,177,255,0.6)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(pin.x - 12, pin.y - 8, 9, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#cdd6e6'; ctx.font = '10px ui-sans-serif, system-ui';
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText('old pin', pin.x, pin.y + 8);
    } else {
      ctx.strokeStyle = COLORS.accent; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(pin.x - 12, pin.y + 5, 4, 7, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(pin.x - 12, pin.y + 12); ctx.lineTo(pin.x - 12, pin.y + 24); ctx.stroke();
    }
    ctx.restore();
  }
}

function drawClimber() {
  const f = state.fall;
  if (!f) return;
  ctx.strokeStyle = '#d8d04a'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(VIEW.w * 0.5, CRACK_TOP - 30); ctx.lineTo(VIEW.w * 0.5, f.y); ctx.stroke();
  ctx.fillStyle = f.anchorHolds && f.settle > 0 ? COLORS.good : COLORS.accent;
  ctx.beginPath(); ctx.arc(VIEW.w * 0.5, f.y, 12, 0, Math.PI * 2); ctx.fill();
}

function drawHUD() {
  ctx.fillStyle = COLORS.hudText;
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.font = 'bold 22px ui-sans-serif, system-ui';
  ctx.fillText('ANCHOR BUILDER', 22, 30);
  ctx.font = '14px ui-sans-serif, system-ui';
  ctx.fillStyle = COLORS.accent;
  ctx.fillText(`Pitch ${state.pitch}`, 22, 54);

  ctx.textAlign = 'right'; ctx.fillStyle = COLORS.hudText;
  ctx.font = 'bold 22px ui-sans-serif, system-ui';
  ctx.fillText(String(state.score), VIEW.w - 22, 30);
  ctx.font = '13px ui-sans-serif, system-ui'; ctx.fillStyle = '#9aa6bf';
  ctx.fillText('SCORE', VIEW.w - 22, 52);

  const bx = 220, by = 22, bw = VIEW.w - 440, bh = 18;
  ctx.fillStyle = '#1b2336'; roundRect(bx, by, bw, bh, 9); ctx.fill();
  const s = state.stamina;
  ctx.fillStyle = s > 0.5 ? COLORS.good : s > 0.22 ? COLORS.warn : COLORS.bad;
  roundRect(bx, by, Math.max(0, bw * s), bh, 9); ctx.fill();
  ctx.fillStyle = COLORS.hudText; ctx.font = 'bold 11px ui-sans-serif, system-ui';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('PUMP', bx + bw / 2, by + bh / 2 + 1);

  ctx.fillStyle = '#9aa6bf'; ctx.font = '13px ui-sans-serif, system-ui';
  ctx.fillText(`${state.placements.length} / ${MAX_PIECES} placed`, VIEW.w / 2, 58);
}

function drawRack() {
  state.rackRects = [];
  ctx.fillStyle = '#0a0f1c';
  ctx.fillRect(0, RACK.y, RACK.w, RACK.h);
  ctx.strokeStyle = '#1c2640'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, RACK.y + 0.5); ctx.lineTo(VIEW.w, RACK.y + 0.5); ctx.stroke();

  let rowTop = RACK.y + 2;
  for (const row of ROW_DEFS) {
    const rowH = Math.floor((RACK.h - 6) * row.frac);
    const items = state.rack.filter((g) => g.kind === row.kind);
    const yc = rowTop + Math.floor(rowH * 0.46);
    const budgetHalf = (rowH - 18) / 2;

    const slots = items.map((g) => Math.max(RACK_MIN_SLOT, g.nominal * RACK_SCALE));
    const totalW = slots.reduce((a, b) => a + b, 0) + RACK_GAP * (items.length - 1);
    const scale = Math.min(1, RACK_AVAIL / totalW);

    ctx.fillStyle = '#5f6c86'; ctx.font = 'bold 11px ui-sans-serif, system-ui';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(row.label, 8, yc);

    let x = RACK_PACK_X;
    items.forEach((gear, c) => {
      const idx = state.rack.indexOf(gear);
      const slotW = slots[c] * scale;
      const iconW = gear.nominal * RACK_SCALE * scale;
      const held = state.drag && state.drag.idx === idx;

      state.rackRects.push({ x, y: rowTop, w: slotW, h: rowH, index: idx, gear });

      if (held) {
        ctx.fillStyle = '#1d2c4a'; roundRect(x, rowTop, slotW, rowH, 6); ctx.fill();
        ctx.strokeStyle = COLORS.accent; ctx.lineWidth = 2;
        roundRect(x, rowTop, slotW, rowH, 6); ctx.stroke();
      }

      ctx.save();
      ctx.globalAlpha = gear.used ? 0.22 : 1;
      drawGearShape(gear, x + slotW / 2, yc, Math.max(6, iconW), budgetHalf * scale);
      ctx.fillStyle = '#aab6cf'; ctx.font = '9px ui-sans-serif, system-ui';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(gear.label, x + slotW / 2, rowTop + rowH - 9);
      ctx.restore();

      x += slotW + RACK_GAP * scale;
    });

    rowTop += rowH;
  }
}

function drawMessages() {
  if (state.drag && state.phase === 'play') {
    const g = state.drag.gear;
    const t = state.drag.touch;
    const tip = g.kind === 'cam'
      ? (t ? `${gearSpec(g)}  —  pinch two fingers to retract, lift to place`
           : `${gearSpec(g)}  —  hold SPACE to retract, click to place`)
      : (t ? `${gearSpec(g)}  —  drag onto a crack, lift to place`
           : `${gearSpec(g)}  —  click a crack to place`);
    ctx.font = '14px ui-sans-serif, system-ui';
    const w = ctx.measureText(tip).width + 36;
    ctx.fillStyle = 'rgba(8,14,28,0.82)';
    roundRect(VIEW.w / 2 - w / 2, PLAY.y + 8, w, 30, 8); ctx.fill();
    ctx.fillStyle = COLORS.accent;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(tip, VIEW.w / 2, PLAY.y + 23);
  } else if (state.hint && state.phase === 'play') {
    ctx.fillStyle = 'rgba(8,14,28,0.78)';
    roundRect(PLAY.x + PLAY.w / 2 - 280, PLAY.y + 14, 560, 54, 10); ctx.fill();
    ctx.fillStyle = COLORS.hudText; ctx.font = '15px ui-sans-serif, system-ui';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(isTouch
      ? 'Tap gear to pick it up, drag onto a crack, lift to place — 3 per pitch.'
      : 'Click gear to pick it up, move it over a crack, click to place — 3 per pitch.',
      PLAY.x + PLAY.w / 2, PLAY.y + 32);
    ctx.fillStyle = '#9fb0d0'; ctx.font = '13px ui-sans-serif, system-ui';
    ctx.fillText(isTouch
      ? 'Cams: pinch two fingers to pull the trigger · Nuts/hexes lock above constrictions · Tap pins'
      : 'Cams: hold SPACE to pull the trigger · Nuts/hexes lock above constrictions · Clip old pins',
      PLAY.x + PLAY.w / 2, PLAY.y + 52);
  }
  if (now() < flashUntil) {
    ctx.font = 'bold 15px ui-sans-serif, system-ui';
    const w = ctx.measureText(flashMsg).width + 40;
    ctx.fillStyle = 'rgba(8,14,28,0.85)';
    roundRect(VIEW.w / 2 - w / 2, PLAY.y + PLAY.h - 56, w, 36, 8); ctx.fill();
    ctx.fillStyle = COLORS.warn;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(flashMsg, VIEW.w / 2, PLAY.y + PLAY.h - 38);
  }
}

function placementName(p) {
  return p.type === 'pin' ? 'Old fixed pin' : gearSpec(p.gear);
}

function drawResult() {
  const r = state.result;
  ctx.fillStyle = 'rgba(6,10,20,0.82)';
  ctx.fillRect(0, 0, VIEW.w, VIEW.h);
  const cx = VIEW.w / 2;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = r.anchorHolds ? COLORS.good : COLORS.bad;
  ctx.font = 'bold 46px ui-sans-serif, system-ui';
  ctx.fillText(r.anchorHolds ? 'ANCHOR HELD' : 'ANCHOR FAILED', cx, 150);

  let y = 220;
  state.placements.forEach((p) => {
    const col = p.score >= 70 ? COLORS.good : p.score >= 40 ? COLORS.warn : COLORS.bad;
    ctx.textAlign = 'right'; ctx.fillStyle = col;
    ctx.font = 'bold 18px ui-sans-serif, system-ui';
    ctx.fillText(String(p.score), cx - 150, y);
    ctx.textAlign = 'left'; ctx.fillStyle = COLORS.hudText;
    ctx.font = '16px ui-sans-serif, system-ui';
    const dia = p.widthMm != null ? ` [${Math.round(p.widthMm)} mm]` : '';
    ctx.fillText(`${placementName(p)} · ${p.kN}kN${dia} — ${p.note}`, cx - 130, y);
    // per-piece verdict: would this single piece hold the fall?
    ctx.textAlign = 'right';
    ctx.fillStyle = p.hold ? COLORS.good : COLORS.bad;
    ctx.font = 'bold 15px ui-sans-serif, system-ui';
    ctx.fillText(p.hold ? '✓ holds' : '✗ blows', cx + 300, y);
    y += 32;
  });

  y += 14;
  ctx.textAlign = 'center'; ctx.fillStyle = '#9fb0d0';
  ctx.font = '15px ui-sans-serif, system-ui';
  let line = `Placements ${r.base}` + (r.holdBonus ? `   +   Hold bonus ${r.holdBonus}` : '   ×0.4 (failed)');
  if (r.passiveBonus) line += `   +   Passive-gear bonus ${r.passiveBonus}`;
  ctx.fillText(line, cx, y);
  y += 40;
  ctx.fillStyle = COLORS.hudText; ctx.font = 'bold 30px ui-sans-serif, system-ui';
  ctx.fillText(`+${state.pitchPoints} points`, cx, y);

  ctx.fillStyle = COLORS.accent; ctx.font = 'bold 18px ui-sans-serif, system-ui';
  ctx.fillText('Click to climb the next pitch →', cx, VIEW.h - 80);
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

requestAnimationFrame((t) => { last = t; requestAnimationFrame(frame); });
