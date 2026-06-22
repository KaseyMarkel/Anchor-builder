// Anchor Builder v2 — trad climbing anchor sim / training tool.
//
// Two modes (Practice / Challenge), an optional ramping pump timer (off by
// default), cams that open into the crack by themselves, gear you can move and
// rotate after placing, a deterministic & explainable scoring system, and
// rotating rocky backgrounds with a per-pitch rock-quality tier.
//
// Menus/settings/tutorial live in the DOM (ui.js); the pitch itself is canvas.

import './style.css';
import {
  VIEW, PLAY, RACK, MM2PX, PLACE_COST, COLORS,
  CRACK_TOP, CRACK_BOT, TOUCH_CAM_NECK, TOUCH_PIECE_LIFT, TRIGGER_TRAVEL,
  TIMER_PRESETS, pumpSeconds, ROCK_PALETTES, ROCK_QUALITY
} from './config.js';
import { makeRack, makeChallengeRack, gearSpec } from './gear.js';
import { generateSystems, pickSystemCount } from './crack.js';
import { evaluatePlacement, evaluateFixed, anchorBonuses, HOLD_THRESHOLD } from './scoring.js';
import * as ui from './ui.js';

const canvas = document.getElementById('game');
canvas.width = VIEW.w;
canvas.height = VIEW.h;
const ctx = canvas.getContext('2d');

const MAX_PIECES = 3;
const ROT_STEP = Math.PI / 18;        // 10° per rotate tap
const ROT_LIMIT = 0.7;                // ±40° of manual rotation

// Rack layout — three rows (cams / nuts / hexes).
const RACK_LABEL_W = 52;
const RACK_PACK_X = RACK_LABEL_W + 8;
const RACK_AVAIL = VIEW.w - RACK_PACK_X - 12;
const RACK_GAP = 8;
const RACK_MIN_SLOT = 20;
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
  phase: 'start',          // start | play | falling | result
  mode: 'practice',
  settings: ui.loadSettings(),
  preset: TIMER_PRESETS.off,
  timerOn: false,
  pitch: 1,
  score: 0,
  pitchPoints: 0,
  stamina: 1,
  pumpMax: Infinity,
  systems: [],
  rock: null,              // { tier, palette }
  rack: [],
  placements: [],
  fixed: [],               // pins + bolts
  drag: null,
  selected: null,          // index into placements being edited
  selDragId: null,         // pointerId dragging the selected piece
  spaceHeld: false,
  rackRects: [],
  inspect: null,           // fixed piece currently inspected (touch)
  fall: null,
  result: null,
  hint: true
};

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function now() { return performance.now(); }

// ----------------------------------------------------------------------------
// Session / pitch lifecycle
// ----------------------------------------------------------------------------
function startGame(settings) {
  state.settings = settings;
  state.mode = settings.mode;
  state.preset = TIMER_PRESETS[settings.timer] || TIMER_PRESETS.off;
  state.timerOn = state.mode === 'challenge' && state.preset.id !== 'off';
  state.score = 0;
  state.pitch = 1;
  newPitch();
  state.phase = 'play';
  ui.showHelpButton(true);
  refreshActions();
  if (!ui.tutorialSeen()) {
    state.phase = 'play';
    ui.showTutorial({ mode: state.mode, isTouch }, () => { state.phase = 'play'; });
  }
}

function pickRock() {
  const palette = ROCK_PALETTES[Math.floor(Math.random() * ROCK_PALETTES.length)];
  // Weight toward decent rock; choss is rarer.
  const r = Math.random();
  const tier = r < 0.4 ? ROCK_QUALITY[0] : r < 0.72 ? ROCK_QUALITY[1] : r < 0.9 ? ROCK_QUALITY[2] : ROCK_QUALITY[3];
  return { palette, tier };
}

function newPitch() {
  state.rock = pickRock();
  state.systems = generateSystems(pickSystemCount(), state.rock.tier.wobble);
  state.rack = state.mode === 'challenge'
    ? makeChallengeRack(combinedWidthRange())
    : makeRack();
  state.placements = [];
  state.fixed = generateFixed(state.systems);
  state.stamina = 1;
  state.pumpMax = pumpSeconds(state.preset, state.pitch);
  state.drag = null;
  state.selected = null;
  state.selDragId = null;
  state.fall = null;
  state.result = null;
  ui.hideInspect(); ui.hideTools();
  state.inspect = null;
  refreshActions();
}

// Regenerate just this pitch's crack (and fixed gear) WITHOUT ending the run:
// keep total score, pitch number, mode and rack. Any in-progress placements are
// cleared (they belonged to the old crack) and that gear returns to the rack.
function regenCrack() {
  state.systems = generateSystems(pickSystemCount(), state.rock.tier.wobble);
  state.placements.forEach((p) => { if (p.type === 'gear') p.gear.used = false; });
  state.placements = [];
  state.fixed = generateFixed(state.systems);
  state.drag = null;
  state.selected = null;
  ui.hideTools();
  if (state.mode === 'challenge') state.rack = makeChallengeRack(combinedWidthRange());
  refreshActions();
  flash('Fresh crack — your score and pitch are kept');
}

function combinedWidthRange() {
  let lo = Infinity, hi = -Infinity;
  for (const sys of state.systems) {
    const r = sys.widthRange();
    lo = Math.min(lo, r.lo); hi = Math.max(hi, r.hi);
  }
  return { lo, hi };
}

// Fixed gear: ~30% of pitches carry 1–2 old pins or bolts with a visible
// condition you can inspect before clipping.
function generateFixed(systems) {
  if (Math.random() >= 0.30) return [];
  const n = Math.random() < 0.6 ? 1 : 2;
  const out = [];
  for (let i = 0; i < n; i++) {
    const sys = systems[Math.floor(Math.random() * systems.length)];
    const cand = sys.points.filter((p) => p.y > CRACK_TOP + 50 && p.y < CRACK_BOT - 40);
    const p = cand[Math.floor(Math.random() * cand.length)] || sys.points[0];
    if (out.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 70)) continue;
    const fixedType = Math.random() < 0.5 ? 'bolt' : 'pin';
    // bolts tend to be in better shape than old pins
    const condition = clamp((fixedType === 'bolt' ? 0.45 : 0.25) + Math.random() * 0.55, 0.05, 0.99);
    out.push({
      fixedType, x: p.x, y: p.y, widthMm: p.w,
      kN: fixedType === 'bolt' ? Math.round(10 + condition * 15) : Math.round(4 + condition * 10),
      condition, used: false
    });
  }
  return out;
}

// ----------------------------------------------------------------------------
// Geometry helpers
// ----------------------------------------------------------------------------
function toLogical(e) {
  const r = canvas.getBoundingClientRect();
  return { x: (e.clientX - r.left) / r.width * VIEW.w, y: (e.clientY - r.top) / r.height * VIEW.h };
}
function logicalToClient(x, y) {
  const r = canvas.getBoundingClientRect();
  return { x: r.left + x / VIEW.w * r.width, y: r.top + y / VIEW.h * r.height };
}

function nearestSample(px, py) {
  let best = null;
  state.systems.forEach((sys, ci) => {
    const s = sys.sampleNearest(px, py);
    if (!best || s.dist < best.s.dist) best = { ci, s, sys };
  });
  return best;
}

// The angle of a piece's spanning axis when aligned to the crack at `point`,
// plus an optional manual rotation delta. delta=0 ⇒ auto-aligned to the crack
// (so the old "rejects a piece that should fit" bug is gone).
function spanAxisAngle(point, delta) {
  return Math.atan2(point.ty, point.tx) - Math.PI / 2 + (delta || 0);
}

function placedPieceAt(px, py) {
  for (let i = state.placements.length - 1; i >= 0; i--) {
    const p = state.placements[i];
    if (p.type !== 'gear') continue;
    if (Math.hypot(px - p.x, py - p.y) < 26) return i;
  }
  return -1;
}
function fixedAt(px, py) {
  return state.fixed.find((q) => !q.used && Math.hypot(px - q.x, py - q.y) < 22) || null;
}

function rackHitAt(px, py, unusedOnly) {
  for (const rr of state.rackRects) {
    if (px >= rr.x && px <= rr.x + rr.w && py >= rr.y && py <= rr.y + rr.h) {
      if (unusedOnly && rr.gear.used) return null;
      return { gear: rr.gear, idx: rr.index };
    }
  }
  return null;
}

// ----------------------------------------------------------------------------
// Touch infrastructure (used mainly for the manual cam trigger)
// ----------------------------------------------------------------------------
const isTouch = window.matchMedia('(pointer: coarse)').matches;
const pointers = new Map();

function touchPoints() {
  const a = [];
  for (const v of pointers.values()) if (v.type !== 'mouse') a.push(v);
  return a;
}
function activeTouchCount() { return touchPoints().length; }
function triggerPoints() {
  return touchPoints().filter((p) => !state.drag || p.id !== state.drag.posId);
}
function manualCams() { return !!state.settings.manualCam; }

function setHeadFromThumb() {
  const d = state.drag;
  if (!d || d.posId == null) return;
  const t = pointers.get(d.posId);
  if (!t) return;
  const neck = d.gear.kind === 'cam' ? TOUCH_CAM_NECK : TOUCH_PIECE_LIFT;
  d.x = t.x; d.y = t.y - neck;
}

function updateTriggerRetraction() {
  const d = state.drag;
  if (!d || d.gear.kind !== 'cam' || !manualCams()) return;
  const trig = triggerPoints();
  const thumb = pointers.get(d.posId);
  if (!trig.length || !thumb) { d.trig = null; return; }
  const avgY = trig.reduce((a, p) => a + p.y, 0) / trig.length;
  const gap = thumb.y - avgY;
  if (!d.trig) d.trig = { startGap: gap, base: d.retraction };
  d.retraction = clamp(d.trig.base + (d.trig.startGap - gap) / TRIGGER_TRAVEL, 0, 1);
  d.everPositioned = true;
}

function grab(rg, touch, p, pointerId) {
  deselect();
  state.drag = {
    gear: rg.gear, idx: rg.idx, x: p.x, y: p.y, retraction: 0, touch,
    posId: touch ? pointerId : null, trig: null, switchCand: null, everPositioned: false
  };
  if (touch) setHeadFromThumb();
  state.hint = false;
}

// ----------------------------------------------------------------------------
// Cam width helpers
// ----------------------------------------------------------------------------
function camCurrentWidth(gear, retraction) {
  return gear.max - retraction * (gear.max - gear.min);
}
// Width (mm) to draw a cam at, given auto vs manual mode and whether it's over a
// crack of aperture `aperture`. Auto cams sit closed in hand and spring to the
// aperture when placed.
function camDrawWidth(gear, d, aperture, onCrack) {
  if (manualCams()) return camCurrentWidth(gear, d.retraction);
  if (!onCrack) return gear.min;
  if (aperture > gear.max) return gear.max;
  if (aperture < gear.min) return gear.min;
  return aperture;
}

// ----------------------------------------------------------------------------
// Placement
// ----------------------------------------------------------------------------
function fitError(gear, crackW) {
  if (gear.kind === 'nut') {
    if (crackW < gear.size * 0.82) return 'Too big — this nut won’t fit the slot';
  } else if (gear.kind === 'hex') {
    if (crackW < gear.min - 2) return 'Too big — the hex won’t fit here';
    if (crackW > gear.max + 3) return 'Crack too wide — the hex would rattle out';
  }
  return null;
}

function anchorFull() { return state.placements.length >= MAX_PIECES; }

function tryPlace() {
  const d = state.drag;
  if (anchorFull()) { flash('Anchor full — test it, or remove a piece'); return; }
  const near = nearestSample(d.x, d.y);
  if (!near || near.s.dist > 64) { flash('Move it over a crack to place'); return; }
  const gear = d.gear;
  const aperture = near.s.w;

  if (gear.kind === 'cam') {
    if (manualCams()) {
      const curW = camCurrentWidth(gear, d.retraction);
      if (aperture < gear.min - 1.5) { flash('Too tight — over-cammed, it won’t fit'); return; }
      if (curW > aperture + 1) {
        flash(d.touch ? 'Pull two fingers down to retract the lobes more' : 'Hold SPACE to retract the lobes');
        return;
      }
    } else {
      if (aperture > gear.max + 1.5) { flash('Too wide — the cam tips out here'); return; }
      if (aperture < gear.min - 1.5) { flash('Too tight — over-cammed, it won’t fit'); return; }
    }
  } else {
    const err = fitError(gear, aperture);
    if (err) { flash(err); return; }
  }

  const angle = spanAxisAngle(near.s.point, 0);
  const res = evaluatePlacement(gear, near.s, near.sys, angle, state.rock.tier.factor);
  gear.used = true;
  const retraction = gear.kind === 'cam'
    ? clamp((gear.max - aperture) / (gear.max - gear.min), 0, 1) : 0;
  state.placements.push({
    type: 'gear', gear, sys: near.sys, sample: near.s, point: near.s.point,
    x: near.s.x, y: near.s.y, angleDelta: 0, retraction,
    kN: gear.kN, widthMm: near.s.w, score: res.score, hold: res.hold,
    note: res.note, factors: res.factors, reason: res.reason
  });
  awardPlacement(res);
  state.drag = null;
  state.hint = false;
  refreshActions();
}

function clipFixed(fx) {
  if (anchorFull()) { flash('Anchor full — test it, or remove a piece'); return; }
  const res = evaluateFixed(fx, state.rock.tier.factor);
  fx.used = true;
  state.placements.push({
    type: 'pin', pin: fx, x: fx.x, y: fx.y, kN: fx.kN, widthMm: fx.widthMm,
    score: res.score, hold: res.hold, note: res.note, factors: res.factors, reason: res.reason
  });
  awardPlacement(res);
  ui.hideInspect();
  state.inspect = null;
  state.hint = false;
  refreshActions();
}

// Stamina cost + (timer) bonus time for a placement.
function awardPlacement(res) {
  if (!state.timerOn) return;
  state.stamina = clamp(state.stamina - PLACE_COST, 0, 1);
  if (res.hold) state.stamina = clamp(state.stamina + state.preset.bonus / state.pumpMax, 0, 1);
}

// ----------------------------------------------------------------------------
// Post-placement editing
// ----------------------------------------------------------------------------
function selectPlacement(i) {
  state.selected = i;
  state.drag = null;
  positionTools();
}
function deselect() {
  if (state.selected != null) { state.selected = null; ui.hideTools(); }
}
function positionTools() {
  if (state.selected == null) return;
  const p = state.placements[state.selected];
  const c = logicalToClient(p.x, p.y);
  ui.showTools(c.x, c.y);
}
function reEvaluate(pl, resample) {
  if (resample) {
    const near = nearestSample(pl.x, pl.y);
    if (near && near.s.dist <= 80) { pl.sys = near.sys; pl.sample = near.s; pl.point = near.s.point; pl.x = near.s.x; pl.y = near.s.y; }
  }
  const angle = spanAxisAngle(pl.point, pl.angleDelta);
  const res = pl.type === 'pin'
    ? evaluateFixed(pl.pin, state.rock.tier.factor)
    : evaluatePlacement(pl.gear, pl.sample, pl.sys, angle, state.rock.tier.factor);
  pl.widthMm = pl.sample ? pl.sample.w : pl.widthMm;
  pl.score = res.score; pl.hold = res.hold; pl.note = res.note;
  pl.factors = res.factors; pl.reason = res.reason;
}
function rotateSelected(dir) {
  const p = state.placements[state.selected];
  if (!p || p.type !== 'gear') return;
  p.angleDelta = clamp(p.angleDelta + dir * ROT_STEP, -ROT_LIMIT, ROT_LIMIT);
  reEvaluate(p, false);
}
function removeSelected() {
  const p = state.placements[state.selected];
  if (!p) return;
  if (p.type === 'gear') p.gear.used = false;
  else if (p.type === 'pin') p.pin.used = false;
  state.placements.splice(state.selected, 1);
  deselect();
  refreshActions();
}

ui.mountTools({
  rotateL: () => { rotateSelected(-1); },
  rotateR: () => { rotateSelected(1); },
  remove: () => removeSelected(),
  done: () => deselect()
});
ui.mountActions({ test: () => startFallTest(), regen: () => regenCrack() });

function refreshActions() {
  const playing = state.phase === 'play';
  ui.showActions(playing, state.placements.length >= 2);
}

// ----------------------------------------------------------------------------
// Input
// ----------------------------------------------------------------------------
canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
  const p = toLogical(e);
  pointers.set(e.pointerId, { id: e.pointerId, x: p.x, y: p.y, sx: p.x, sy: p.y, type: e.pointerType });
  const touch = e.pointerType !== 'mouse';

  if (state.phase === 'result') { advanceFromResult(); return; }
  if (state.phase !== 'play') return;

  // Editing a selected piece: grab it to drag, or interact elsewhere to switch.
  if (state.selected != null) {
    const sp = state.placements[state.selected];
    if (sp && sp.type === 'gear' && Math.hypot(p.x - sp.x, p.y - sp.y) < 28) {
      state.selDragId = e.pointerId; return;
    }
    const other = placedPieceAt(p.x, p.y);
    if (other >= 0) { selectPlacement(other); return; }
    deselect();
    // fall through to normal handling (rack grab etc.)
  }

  // Touch while holding a piece: thumb positions / trigger fingers retract.
  if (touch && state.drag) {
    const d = state.drag;
    const thumb = pointers.get(d.posId);
    if (thumb && thumb.id !== e.pointerId) {
      updateTriggerRetraction();
    } else {
      d.posId = e.pointerId;
      const rg = rackHitAt(p.x, p.y, true);
      d.switchCand = rg ? rg.gear : null;
      if (p.y < RACK.y) d.everPositioned = true;
      setHeadFromThumb();
    }
    return;
  }

  // Grab from the rack.
  const rg = rackHitAt(p.x, p.y, false);
  if (rg) { if (!rg.gear.used) grab(rg, touch, p, e.pointerId); return; }

  // Select an already-placed piece to edit it.
  const hit = placedPieceAt(p.x, p.y);
  if (hit >= 0 && !state.drag) { selectPlacement(hit); return; }

  // Fixed gear: inspect, then clip.
  const fx = fixedAt(p.x, p.y);
  if (fx) {
    if (touch) {
      if (state.inspect === fx) clipFixed(fx);
      else { state.inspect = fx; const c = logicalToClient(fx.x, fx.y); ui.showInspect(c.x, c.y, fx); }
    } else {
      clipFixed(fx);
    }
    return;
  }
  if (!touch && state.inspect) { state.inspect = null; ui.hideInspect(); }

  // Desktop: a click while holding places.
  if (!touch && state.drag) { tryPlace(); return; }
});

canvas.addEventListener('pointermove', (e) => {
  const rec = pointers.get(e.pointerId);
  const p = toLogical(e);
  if (rec) { rec.x = p.x; rec.y = p.y; }

  // Dragging a selected (already placed) piece.
  if (state.selDragId === e.pointerId && state.selected != null) {
    const pl = state.placements[state.selected];
    pl.x = p.x; pl.y = p.y;
    reEvaluate(pl, true);
    positionTools();
    return;
  }

  const d = state.drag;

  // Desktop hover: inspect fixed gear under the cursor.
  if (e.pointerType === 'mouse' && !d && state.phase === 'play') {
    const fx = fixedAt(p.x, p.y);
    if (fx) { const c = logicalToClient(fx.x, fx.y); ui.showInspect(c.x, c.y, fx); }
    else ui.hideInspect();
  }

  if (!d) return;
  if (e.pointerType === 'mouse') { d.x = p.x; d.y = p.y; return; }

  if (e.pointerId === d.posId) {
    if (rec && Math.hypot(rec.x - rec.sx, rec.y - rec.sy) > 12) { d.switchCand = null; d.everPositioned = true; }
    setHeadFromThumb();
  }
  updateTriggerRetraction();
});

canvas.addEventListener('pointerup', (e) => {
  const rec = pointers.get(e.pointerId);
  const moved = rec ? Math.hypot(rec.x - rec.sx, rec.y - rec.sy) : 0;
  const type = rec ? rec.type : e.pointerType;
  const d = state.drag;
  const wasThumb = d && e.pointerId === d.posId;
  pointers.delete(e.pointerId);
  try { canvas.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }

  if (state.selDragId === e.pointerId) { state.selDragId = null; positionTools(); return; }
  if (type === 'mouse' || state.phase !== 'play') return;

  if (d) {
    if (wasThumb && d.switchCand && moved < 14 && triggerPoints().length === 0) {
      grab({ gear: d.switchCand, idx: state.rack.indexOf(d.switchCand) }, true, { x: d.x, y: d.y }, null);
      return;
    }
    if (wasThumb) d.posId = null;
    d.trig = null;
    if (activeTouchCount() === 0) {
      if (d.everPositioned) {
        const near = nearestSample(d.x, d.y);
        if (near && near.s.dist <= 64) tryPlace();
        else flash('Move the piece over a crack to place');
      }
    } else {
      updateTriggerRetraction();
    }
  }
});

canvas.addEventListener('pointercancel', (e) => {
  pointers.delete(e.pointerId);
  if (state.selDragId === e.pointerId) state.selDragId = null;
  if (state.drag) updateTriggerRetraction();
});

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); state.spaceHeld = true; }
  else if (e.code === 'Escape') { state.drag = null; deselect(); }
  else if (state.selected != null && (e.code === 'BracketLeft' || e.code === 'KeyQ')) rotateSelected(-1);
  else if (state.selected != null && (e.code === 'BracketRight' || e.code === 'KeyE')) rotateSelected(1);
  else if (state.selected != null && (e.code === 'Delete' || e.code === 'Backspace')) removeSelected();
});
window.addEventListener('keyup', (e) => { if (e.code === 'Space') state.spaceHeld = false; });
window.addEventListener('resize', () => { positionTools(); });

let flashMsg = '', flashUntil = 0;
function flash(msg) { flashMsg = msg; flashUntil = now() + 1700; }

// ----------------------------------------------------------------------------
// Fall test
// ----------------------------------------------------------------------------
function startFallTest() {
  if (state.placements.length < 2) { flash('Place at least two pieces first'); return; }
  state.phase = 'falling';
  state.drag = null;
  deselect();
  ui.showActions(false);
  ui.hideInspect();
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
  const { cleanBonus, diversityBonus } = anchorBonuses(state.placements);
  let pts;
  if (state.result.anchorHolds) {
    const holdBonus = 100 + (state.timerOn ? Math.round(state.stamina * 120) : 60);
    pts = base + holdBonus + cleanBonus + diversityBonus;
    state.result.holdBonus = holdBonus;
  } else {
    pts = Math.round(base * 0.4) + Math.round((cleanBonus + diversityBonus) * 0.4);
    state.result.holdBonus = 0;
  }
  state.result.base = base;
  state.result.cleanBonus = cleanBonus;
  state.result.diversityBonus = diversityBonus;
  state.result.fell = state.mode === 'challenge' && !state.result.anchorHolds;
  state.pitchPoints = pts;
  state.score += pts;
  state.phase = 'result';
}

function advanceFromResult() {
  if (state.result && state.result.fell) {
    // Challenge run over — back to the menu.
    state.phase = 'start';
    ui.showHelpButton(false);
    ui.showActions(false);
    ui.showStart(state.settings, startGame);
    return;
  }
  state.pitch += 1;
  newPitch();
  state.phase = 'play';
  refreshActions();
}

// ----------------------------------------------------------------------------
// Render loop
// ----------------------------------------------------------------------------
let last = 0;
function frame(t) {
  const dt = Math.min(0.05, (t - last) / 1000) || 0;
  last = t;

  if (state.phase === 'play') {
    if (state.timerOn) {
      state.stamina = clamp(state.stamina - dt / state.pumpMax, 0, 1);
      if (state.stamina <= 0 && state.placements.length < MAX_PIECES) {
        flash('Pumped out!');
        if (state.placements.length >= 2) startFallTest();
        else { // no anchor — you fall
          state.result = { anchorHolds: false, holds: 0, effKN: 0 };
          state.fall = { y: CRACK_TOP - 30, v: 0, catchY: CRACK_BOT + 220, anchorHolds: false, settle: 0 };
          state.phase = 'falling';
          ui.showActions(false);
        }
      }
    }
    if (state.drag && state.drag.gear.kind === 'cam' && manualCams() && !state.drag.touch) {
      const target = state.spaceHeld ? 1 : 0;
      state.drag.retraction += (target - state.drag.retraction) * Math.min(1, dt * 12);
    }
  } else if (state.phase === 'falling') {
    stepFall(dt);
  }

  draw();
  requestAnimationFrame(frame);
}

function draw() {
  ctx.clearRect(0, 0, VIEW.w, VIEW.h);
  drawBackdrop();
  if (state.phase === 'start' || !state.rock) return;
  drawHUD();
  drawRock();
  for (const sys of state.systems) drawSystem(sys);
  drawFixed();
  drawPlacements();
  if (state.selected != null) drawSelection();
  if (state.drag && state.phase === 'play') drawDragPreview();
  if (state.phase === 'falling' || state.fall) drawClimber();
  drawRack();
  drawMessages();
  if (state.phase === 'result') drawResult();
}

// ----------------------------------------------------------------------------
// Drawing
// ----------------------------------------------------------------------------
function drawBackdrop() {
  ctx.fillStyle = COLORS.hud;
  ctx.fillRect(0, 0, VIEW.w, VIEW.h);
}

// Procedural rock baked once per palette to an offscreen canvas.
const graniteCache = new Map();
function granite(palette) {
  if (graniteCache.has(palette.name)) return graniteCache.get(palette.name);
  const c = document.createElement('canvas');
  c.width = PLAY.w; c.height = PLAY.h;
  const g = c.getContext('2d');
  const base = g.createLinearGradient(0, 0, c.width, c.height);
  base.addColorStop(0, palette.light);
  base.addColorStop(0.5, palette.mid);
  base.addColorStop(1, palette.dark);
  g.fillStyle = base; g.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < 170; i++) {
    const x = Math.random() * c.width, y = Math.random() * c.height, r = 22 + Math.random() * 80;
    g.globalAlpha = 0.05 + Math.random() * 0.06;
    g.fillStyle = Math.random() < 0.5 ? palette.dark : palette.light;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  for (let i = 0; i < 6000; i++) {
    const x = Math.random() * c.width, y = Math.random() * c.height, r = 0.4 + Math.random() * 1.9;
    g.globalAlpha = 0.22 + Math.random() * 0.5;
    g.fillStyle = palette.speckle[(Math.random() * palette.speckle.length) | 0];
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  g.globalAlpha = 1;
  graniteCache.set(palette.name, c);
  return c;
}

function drawRock() {
  const { x, y, w, h } = PLAY;
  ctx.save();
  ctx.beginPath(); roundRect(x, y, w, h, 12); ctx.clip();
  ctx.drawImage(granite(state.rock.palette), x, y, w, h);
  const lg = ctx.createLinearGradient(0, y, 0, y + h);
  lg.addColorStop(0, 'rgba(255,255,255,0.10)');
  lg.addColorStop(0.42, 'rgba(255,255,255,0)');
  lg.addColorStop(1, 'rgba(0,0,0,0.30)');
  ctx.fillStyle = lg; ctx.fillRect(x, y, w, h);
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
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  for (const seg of sys.segments) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 2;
    ribbonPath(seg, 3); ctx.fillStyle = COLORS.crack; ctx.fill();
    ctx.restore();
    ribbonPath(seg, 0); ctx.fillStyle = COLORS.crackInner; ctx.fill();
    ctx.strokeStyle = 'rgba(205,214,228,0.13)'; ctx.lineWidth = 1.5;
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
    if (pl.type !== 'gear') continue;
    drawPlacedPiece(pl);
  }
}

function drawPlacedPiece(pl) {
  const gear = pl.gear, s = pl.sample;
  const crackW = s.w * MM2PX;
  const trueW = gear.nominal * MM2PX;
  let drawW = trueW;
  if (gear.kind === 'cam' || gear.kind === 'hex') {
    if (s.w >= gear.min && s.w <= gear.max) drawW = crackW;
  }
  const rot = spanAxisAngle(pl.point, pl.angleDelta);
  drawRotated(gear, pl.x, pl.y, drawW, rot);
}

// Draw a gear icon at (x,y), rotated so its spanning axis matches `rot`.
function drawRotated(gear, x, y, wpx, rot, maxHalf) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  drawGearShape(gear, 0, 0, wpx, maxHalf == null ? Infinity : maxHalf);
  ctx.restore();
}

function drawCam(gear, cx, cy, spanPx, maxHalf = Infinity) {
  const fullHalf = (gear.max * MM2PX) / 2;
  let lr = Math.max(2.2, fullHalf * 0.34);
  let pivGap = Math.max(1.5, fullHalf * 0.16);
  const AMAX = 1.05;
  let arm = Math.max(3, (fullHalf - pivGap - lr) / Math.sin(AMAX));
  const naturalHalf = arm * 0.7 + lr + 3;
  const gscale = naturalHalf > maxHalf ? maxHalf / naturalHalf : 1;
  lr *= gscale; pivGap *= gscale; arm *= gscale;
  const targetHalf = (spanPx / 2) * gscale;
  const a = Math.asin(clamp((targetHalf - pivGap - lr) / arm, -0.85, 0.98));
  const pivY = cy - arm * 0.45 * Math.cos(a);
  const lobeBottom = pivY + arm * Math.cos(a) + lr;
  const stem = clamp(fullHalf * 0.5, 8, 46) * gscale;
  const lw = Math.max(1, fullHalf * 0.09 * gscale);
  ctx.strokeStyle = COLORS.steel; ctx.lineWidth = Math.max(1.5, lw);
  ctx.beginPath(); ctx.moveTo(cx, pivY); ctx.lineTo(cx, lobeBottom + stem); ctx.stroke();
  ctx.lineWidth = Math.max(1.2, lw * 0.7);
  ctx.beginPath();
  ctx.ellipse(cx, lobeBottom + stem, Math.max(2, 3 * gscale), Math.max(3, 5 * gscale), 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx - pivGap, pivY); ctx.lineTo(cx + pivGap, pivY); ctx.stroke();
  for (const dir of [-1, 1]) {
    const px = cx + dir * pivGap, py = pivY;
    const ex = px + dir * arm * Math.sin(a);
    const ey = py + arm * Math.cos(a);
    const ang = Math.atan2(ey - py, ex - px);
    ctx.save();
    ctx.translate((px + ex) / 2, (py + ey) / 2);
    ctx.rotate(ang);
    ctx.fillStyle = gear.color; ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.ellipse(0, 0, arm / 2 + lr, lr, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.restore();
    ctx.fillStyle = COLORS.steelDark;
    ctx.beginPath(); ctx.arc(px, py, Math.max(1.2, lr * 0.26), 0, Math.PI * 2); ctx.fill();
  }
}

function drawGearShape(gear, cx, cy, wpx, maxHalf = Infinity) {
  ctx.save();
  if (gear.kind === 'cam') {
    drawCam(gear, cx, cy, wpx, maxHalf);
  } else if (gear.kind === 'hex') {
    const hw = wpx / 2;
    const hh = Math.min(Math.max(5, wpx * 0.55), maxHalf);
    ctx.fillStyle = gear.color; ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(cx - hw, cy); ctx.lineTo(cx - hw * 0.5, cy - hh); ctx.lineTo(cx + hw * 0.5, cy - hh);
    ctx.lineTo(cx + hw, cy); ctx.lineTo(cx + hw * 0.5, cy + hh); ctx.lineTo(cx - hw * 0.5, cy + hh);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = COLORS.steelDark; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx, cy + hh); ctx.lineTo(cx, cy + hh + 8); ctx.stroke();
  } else {
    const top = wpx / 2, bot = wpx / 2.6;
    const h = Math.min(Math.max(7, wpx), maxHalf * 2);
    ctx.fillStyle = gear.color; ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(cx - top, cy - h / 2); ctx.lineTo(cx + top, cy - h / 2);
    ctx.lineTo(cx + bot, cy + h / 2); ctx.lineTo(cx - bot, cy + h / 2);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = COLORS.steelDark; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.moveTo(cx, cy + h / 2); ctx.lineTo(cx, cy + h / 2 + 8); ctx.stroke();
  }
  ctx.restore();
}

function drawSelection() {
  const p = state.placements[state.selected];
  if (!p) return;
  ctx.save();
  ctx.strokeStyle = COLORS.accent; ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
  ctx.beginPath(); ctx.arc(p.x, p.y, 30, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
  // live score for the selected piece in Practice
  if (state.mode === 'practice' && p.score != null) {
    drawScoreBadge(p.x, p.y - 40, p.score);
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
  const rot = onCrack ? spanAxisAngle(near.s.point, 0) : 0;

  ctx.save();
  ctx.globalAlpha = 0.92;

  if (d.touch && d.posId != null) {
    const t = pointers.get(d.posId);
    if (t) {
      ctx.save();
      ctx.globalAlpha = 0.55; ctx.strokeStyle = COLORS.steel; ctx.lineWidth = 2; ctx.setLineDash([5, 5]);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(t.x, t.y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(111,177,255,0.45)';
      ctx.beginPath(); ctx.arc(t.x, t.y, 11, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  let seats = true;
  if (g.kind === 'cam') {
    const aperture = onCrack ? near.s.w : 0;
    const wmm = camDrawWidth(g, d, aperture, onCrack);
    drawRotated(g, x, y, wmm * MM2PX, rot);
    if (onCrack) seats = manualCams() ? wmm <= aperture + 1 && aperture >= g.min - 1.5
      : aperture >= g.min - 1.5 && aperture <= g.max + 1.5;
  } else {
    drawRotated(g, x, y, g.nominal * MM2PX, rot);
    if (onCrack) seats = fitError(g, near.s.w) === null;
  }

  if (onCrack) {
    // green/red walls (drawn along the aperture, rotated to the crack)
    const crackHalf = (near.s.w * MM2PX) / 2;
    ctx.save();
    ctx.translate(x, y); ctx.rotate(rot);
    ctx.globalAlpha = 0.9; ctx.strokeStyle = seats ? COLORS.good : COLORS.bad; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-crackHalf, -22); ctx.lineTo(-crackHalf, 22);
    ctx.moveTo(crackHalf, -22); ctx.lineTo(crackHalf, 22);
    ctx.stroke();
    ctx.restore();

    // live per-piece score in Practice
    if (state.mode === 'practice' && seats) {
      const res = evaluatePlacement(g, near.s, near.sys, rot, state.rock.tier.factor);
      drawScoreBadge(x, y - 40, res.score, res.factors);
    }
  }
  ctx.restore();
}

function drawScoreBadge(x, y, score, factors) {
  ctx.save();
  const col = score >= 70 ? COLORS.good : score >= HOLD_THRESHOLD ? COLORS.warn : COLORS.bad;
  let label = String(score);
  let sub = '';
  if (factors) sub = factors.filter((f) => f.label !== 'Align' || f.rating < 90).map((f) => `${f.label} ${f.rating}`).join(' · ');
  ctx.font = 'bold 18px ui-sans-serif, system-ui';
  const w = Math.max(ctx.measureText(label).width + 22, sub ? ctx.measureText(sub).width + 18 : 0);
  ctx.fillStyle = 'rgba(8,12,22,0.86)';
  roundRect(x - w / 2, y - 16, w, sub ? 38 : 26, 7); ctx.fill();
  ctx.fillStyle = col; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(label, x, y - 3);
  if (sub) {
    ctx.font = '10px ui-sans-serif, system-ui'; ctx.fillStyle = '#aab6cf';
    ctx.fillText(sub, x, y + 13);
  }
  ctx.restore();
}

function drawFixed() {
  for (const fx of state.fixed) {
    ctx.save();
    if (fx.fixedType === 'bolt') {
      // bolt hanger
      ctx.fillStyle = '#9aa0a8';
      ctx.beginPath(); ctx.arc(fx.x, fx.y, 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = COLORS.hud;
      ctx.beginPath(); ctx.arc(fx.x, fx.y, 3, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#6b6f78'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(fx.x, fx.y + 6); ctx.lineTo(fx.x, fx.y + 14); ctx.stroke();
    } else {
      ctx.strokeStyle = '#6b6f78'; ctx.lineWidth = 5; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(fx.x - 10, fx.y - 6); ctx.lineTo(fx.x + 8, fx.y + 4); ctx.stroke();
      ctx.fillStyle = '#9aa0a8';
      ctx.beginPath(); ctx.arc(fx.x - 12, fx.y - 8, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = COLORS.hud;
      ctx.beginPath(); ctx.arc(fx.x - 12, fx.y - 8, 2.2, 0, Math.PI * 2); ctx.fill();
    }
    if (!fx.used) {
      // a small condition pip so reliability is hinted on the wall, not hidden
      const col = fx.condition > 0.7 ? COLORS.good : fx.condition > 0.4 ? COLORS.warn : COLORS.bad;
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(fx.x + 12, fx.y - 10, 3.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#cdd6e6'; ctx.font = '10px ui-sans-serif, system-ui';
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(isTouch ? `tap to inspect` : `${fx.fixedType}`, fx.x, fx.y + 14);
    } else {
      ctx.strokeStyle = COLORS.accent; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(fx.x - 2, fx.y + 8, 4, 7, 0, 0, Math.PI * 2); ctx.stroke();
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
  ctx.fillStyle = COLORS.hudText; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.font = 'bold 22px ui-sans-serif, system-ui';
  ctx.fillText('ANCHOR BUILDER', 22, 30);
  ctx.font = '14px ui-sans-serif, system-ui'; ctx.fillStyle = COLORS.accent;
  ctx.fillText(`${state.mode === 'challenge' ? 'Challenge' : 'Practice'} · Pitch ${state.pitch}`, 22, 54);

  ctx.textAlign = 'right'; ctx.fillStyle = COLORS.hudText;
  ctx.font = 'bold 22px ui-sans-serif, system-ui';
  ctx.fillText(String(state.score), VIEW.w - 22, 30);
  ctx.font = '13px ui-sans-serif, system-ui'; ctx.fillStyle = '#9aa6bf';
  ctx.fillText('SCORE', VIEW.w - 22, 52);

  const bx = 220, by = 22, bw = VIEW.w - 440, bh = 18;
  if (state.timerOn) {
    ctx.fillStyle = '#1b2336'; roundRect(bx, by, bw, bh, 9); ctx.fill();
    const s = state.stamina;
    ctx.fillStyle = s > 0.5 ? COLORS.good : s > 0.22 ? COLORS.warn : COLORS.bad;
    roundRect(bx, by, Math.max(0, bw * s), bh, 9); ctx.fill();
    ctx.fillStyle = COLORS.hudText; ctx.font = 'bold 11px ui-sans-serif, system-ui';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('PUMP', bx + bw / 2, by + bh / 2 + 1);
  } else {
    ctx.fillStyle = '#8b97b3'; ctx.font = '12px ui-sans-serif, system-ui';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('No clock — take your time', bx + bw / 2, by + bh / 2);
  }

  // rock-quality chip
  const rq = state.rock.tier;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = 'bold 12px ui-sans-serif, system-ui';
  const chip = rq.label;
  const cw = ctx.measureText(chip).width + 26;
  const ccx = VIEW.w / 2;
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  roundRect(ccx - cw / 2, 44, cw, 22, 11); ctx.fill();
  ctx.fillStyle = rq.color;
  ctx.beginPath(); ctx.arc(ccx - cw / 2 + 12, 55, 4, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#cdd6e6';
  ctx.fillText(chip, ccx + 6, 56);

  ctx.fillStyle = '#9aa6bf'; ctx.font = '13px ui-sans-serif, system-ui';
  ctx.textAlign = 'right';
  ctx.fillText(`${state.placements.length} / ${MAX_PIECES} placed`, VIEW.w - 22, 74);
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
    const scale = items.length ? Math.min(1, RACK_AVAIL / totalW) : 1;

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
    const g = state.drag.gear, t = state.drag.touch;
    let tip;
    if (g.kind === 'cam' && manualCams()) {
      tip = t ? `${gearSpec(g)} — thumb sets it, pull two fingers down to retract, lift to place`
              : `${gearSpec(g)} — hold SPACE to retract, click to place`;
    } else if (g.kind === 'cam') {
      tip = t ? `${gearSpec(g)} — float it into the crack and lift; it opens itself`
              : `${gearSpec(g)} — click a crack; the cam opens to fit`;
    } else {
      tip = t ? `${gearSpec(g)} — thumb moves it over a crack, lift to place`
              : `${gearSpec(g)} — click a crack to place`;
    }
    drawTip(tip);
  } else if (state.selected != null && state.phase === 'play') {
    drawTip('Drag to nudge · ◄ ► to rotate · ✕ to remove · ✓ when done');
  } else if (state.hint && state.phase === 'play') {
    ctx.fillStyle = 'rgba(8,14,28,0.78)';
    roundRect(PLAY.x + PLAY.w / 2 - 290, PLAY.y + 14, 580, 54, 10); ctx.fill();
    ctx.fillStyle = COLORS.hudText; ctx.font = '15px ui-sans-serif, system-ui';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(isTouch
      ? 'Tap gear, float it over a crack, lift to place. Tap a placed piece to adjust it.'
      : 'Click gear, move it over a crack, click to place. Click a placed piece to adjust it.',
      PLAY.x + PLAY.w / 2, PLAY.y + 32);
    ctx.fillStyle = '#9fb0d0'; ctx.font = '13px ui-sans-serif, system-ui';
    ctx.fillText(state.mode === 'challenge'
      ? 'Limited rack · build 2–3 pieces, then ⚡ test the anchor'
      : 'Cams open themselves · nuts/hexes lock above constrictions · scores shown live',
      PLAY.x + PLAY.w / 2, PLAY.y + 52);
  }
  if (now() < flashUntil) {
    ctx.font = 'bold 15px ui-sans-serif, system-ui';
    const w = ctx.measureText(flashMsg).width + 40;
    ctx.fillStyle = 'rgba(8,14,28,0.85)';
    roundRect(VIEW.w / 2 - w / 2, PLAY.y + PLAY.h - 56, w, 36, 8); ctx.fill();
    ctx.fillStyle = COLORS.warn; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(flashMsg, VIEW.w / 2, PLAY.y + PLAY.h - 38);
  }
}

function drawTip(tip) {
  ctx.font = '14px ui-sans-serif, system-ui';
  const w = ctx.measureText(tip).width + 36;
  ctx.fillStyle = 'rgba(8,14,28,0.82)';
  roundRect(VIEW.w / 2 - w / 2, PLAY.y + 8, w, 30, 8); ctx.fill();
  ctx.fillStyle = COLORS.accent; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(tip, VIEW.w / 2, PLAY.y + 23);
}

function placementName(p) {
  return p.type === 'pin' ? (p.pin.fixedType === 'bolt' ? 'Fixed bolt' : 'Old piton') : gearSpec(p.gear);
}

function drawResult() {
  const r = state.result;
  ctx.fillStyle = 'rgba(6,10,20,0.85)';
  ctx.fillRect(0, 0, VIEW.w, VIEW.h);
  const cx = VIEW.w / 2;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = r.anchorHolds ? COLORS.good : COLORS.bad;
  ctx.font = 'bold 44px ui-sans-serif, system-ui';
  ctx.fillText(r.anchorHolds ? 'ANCHOR HELD' : (r.fell ? 'YOU FELL' : 'ANCHOR FAILED'), cx, 120);

  ctx.font = '12px ui-sans-serif, system-ui'; ctx.fillStyle = '#7e8aa3';
  ctx.fillText('✓ holds · ✗ blows   —   each piece scored on named factors', cx, 154);

  let y = 188;
  state.placements.forEach((p) => {
    const col = p.score >= 70 ? COLORS.good : p.score >= HOLD_THRESHOLD ? COLORS.warn : COLORS.bad;
    ctx.textAlign = 'right'; ctx.fillStyle = p.hold ? COLORS.good : COLORS.bad;
    ctx.font = 'bold 17px ui-sans-serif, system-ui';
    ctx.fillText(p.hold ? '✓' : '✗', cx - 250, y);
    ctx.fillStyle = col; ctx.font = 'bold 18px ui-sans-serif, system-ui';
    ctx.fillText(String(p.score), cx - 216, y);
    ctx.textAlign = 'left'; ctx.fillStyle = COLORS.hudText; ctx.font = '15px ui-sans-serif, system-ui';
    const dia = p.widthMm != null ? ` [${Math.round(p.widthMm)}mm]` : '';
    ctx.fillText(`${placementName(p)} · ${p.kN}kN${dia} — ${p.note}`, cx - 196, y - 7);
    // explainable factor breakdown
    ctx.fillStyle = '#8b97b3'; ctx.font = '11px ui-sans-serif, system-ui';
    const fstr = (p.factors || []).map((f) => `${f.label} ${f.rating}`).join('  ·  ');
    ctx.fillText(fstr, cx - 196, y + 9);
    y += 36;
  });

  y += 10;
  ctx.textAlign = 'center'; ctx.fillStyle = '#9fb0d0'; ctx.font = '14px ui-sans-serif, system-ui';
  let line = `Placements ${r.base}` + (r.holdBonus ? `   +   Hold ${r.holdBonus}` : '   ×0.4 (failed)');
  if (r.cleanBonus) line += `   +   Clean-climbing ${r.cleanBonus}`;
  if (r.diversityBonus) line += `   +   Mixed anchor ${r.diversityBonus}`;
  line += `   ·   Rock ×${state.rock.tier.factor.toFixed(2)}`;
  ctx.fillText(line, cx, y);
  y += 36;
  ctx.fillStyle = COLORS.hudText; ctx.font = 'bold 28px ui-sans-serif, system-ui';
  ctx.fillText(`+${state.pitchPoints} points`, cx, y);

  ctx.fillStyle = COLORS.accent; ctx.font = 'bold 18px ui-sans-serif, system-ui';
  ctx.fillText(r.fell ? 'Click for the menu →' : 'Click to climb the next pitch →', cx, VIEW.h - 70);
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

// ----------------------------------------------------------------------------
// Boot
// ----------------------------------------------------------------------------
ui.mountHelpButton(() => ui.showTutorial({ mode: state.mode, isTouch }, () => {}));
ui.showHelpButton(false);
ui.showStart(state.settings, startGame);

// Dev-only inspection hook for automated smoke tests (stripped from prod builds).
if (import.meta.env && import.meta.env.DEV) {
  window.__ab = { state, nearestSample, startFallTest, tryPlace };
}
requestAnimationFrame((t) => { last = t; requestAnimationFrame(frame); });
