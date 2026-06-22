// DOM overlay layer: start screen, settings, tutorial, the fixed-gear inspect
// tooltip, and the selected-piece toolbar. The game itself stays on the canvas;
// these are plain HTML/CSS over it so menus, toggles and forms are easy and
// accessible (and behave well on touch).

import { TIMER_PRESETS } from './config.js';

const LS_KEY = 'anchor-builder.settings.v2';
const LS_SEEN = 'anchor-builder.tutorialSeen.v2';

const DEFAULTS = { mode: 'practice', timer: 'off', manualCam: false };

export function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(LS_KEY) || '{}') }; }
  catch { return { ...DEFAULTS }; }
}
export function saveSettings(s) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}
export function tutorialSeen() {
  try { return localStorage.getItem(LS_SEEN) === '1'; } catch { return false; }
}
export function markTutorialSeen() {
  try { localStorage.setItem(LS_SEEN, '1'); } catch { /* ignore */ }
}

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}

let overlay = null;
export function hideOverlay() { if (overlay) { overlay.remove(); overlay = null; } }

// Start screen: pick a mode, tweak settings, hit Play. `onPlay(settings)` runs
// with the chosen, persisted settings.
export function showStart(settings, onPlay) {
  hideOverlay();
  const s = { ...settings };
  overlay = el('div', 'ab-overlay');
  const card = el('div', 'ab-card');
  overlay.appendChild(card);

  card.appendChild(el('h1', null, 'ANCHOR BUILDER'));
  card.appendChild(el('p', 'ab-sub', 'Build a trad anchor: place gear in the crack, score each piece, hold the whipper.'));

  // ---- mode cards ----
  card.appendChild(el('h2', null, 'Choose a mode'));
  const modes = el('div', 'ab-modes');
  const modeDefs = [
    { id: 'practice', title: 'Practice', desc: 'No clock · live placement scores · cams seat themselves · your whole rack. Learn the ropes.' },
    { id: 'challenge', title: 'Challenge', desc: 'A limited, randomized rack and an optional pump clock. Blow the anchor and you fall.' }
  ];
  const modeBtns = {};
  modeDefs.forEach((m) => {
    const b = el('button', 'ab-mode' + (s.mode === m.id ? ' sel' : ''));
    b.appendChild(el('div', 'ab-mode-title', m.title));
    b.appendChild(el('div', 'ab-mode-desc', m.desc));
    b.onclick = () => { s.mode = m.id; Object.values(modeBtns).forEach((x) => x.classList.remove('sel')); b.classList.add('sel'); syncTimerEnabled(); };
    modeBtns[m.id] = b;
    modes.appendChild(b);
  });
  card.appendChild(modes);

  // ---- timer ----
  card.appendChild(el('h2', null, 'Pump timer'));
  const timerRow = el('div', 'ab-row');
  const timerSeg = el('div', 'ab-seg');
  const timerBtns = {};
  Object.values(TIMER_PRESETS).forEach((t) => {
    const b = el('button', s.timer === t.id ? 'sel' : '', t.label);
    b.onclick = () => { s.timer = t.id; Object.values(timerBtns).forEach((x) => x.classList.remove('sel')); b.classList.add('sel'); updateTimerHelp(); };
    timerBtns[t.id] = b;
    timerSeg.appendChild(b);
  });
  const timerText = el('div');
  timerText.appendChild(el('div', 'ab-label', 'Clock'));
  const timerHelp = el('div', 'ab-help');
  timerText.appendChild(timerHelp);
  timerRow.appendChild(timerText);
  timerRow.appendChild(timerSeg);
  card.appendChild(timerRow);
  function updateTimerHelp() { timerHelp.textContent = TIMER_PRESETS[s.timer].blurb + (s.timer !== 'off' ? ' Starts easy, ramps up; bonus time per piece.' : ''); }
  function syncTimerEnabled() {
    const off = s.mode === 'practice';
    timerSeg.style.opacity = off ? 0.4 : 1;
    timerSeg.style.pointerEvents = off ? 'none' : 'auto';
    timerHelp.textContent = off ? 'Practice mode has no clock.' : (TIMER_PRESETS[s.timer].blurb + ' Starts easy, ramps up; bonus time per piece.');
  }
  updateTimerHelp();

  // ---- manual cams toggle ----
  card.appendChild(el('h2', null, 'Options'));
  const camRow = el('div', 'ab-row');
  const camText = el('div');
  camText.appendChild(el('div', 'ab-label', 'Manual cam trigger'));
  camText.appendChild(el('div', 'ab-help', 'Off: cams open into the crack automatically. On: hold to retract the lobes yourself (desktop SPACE / two-finger pull).'));
  const camTog = el('button', 'ab-toggle' + (s.manualCam ? ' on' : ''));
  camTog.onclick = () => { s.manualCam = !s.manualCam; camTog.classList.toggle('on', s.manualCam); };
  camRow.appendChild(camText);
  camRow.appendChild(camTog);
  card.appendChild(camRow);

  // ---- play ----
  const play = el('button', 'ab-btn', 'Start climbing →');
  play.onclick = () => { saveSettings(s); hideOverlay(); onPlay(s); };
  card.appendChild(play);

  syncTimerEnabled();
  document.body.appendChild(overlay);
}

// First-play tutorial / controls hint.
export function showTutorial(opts, onClose) {
  hideOverlay();
  const { mode, isTouch } = opts;
  overlay = el('div', 'ab-overlay');
  const card = el('div', 'ab-card');
  overlay.appendChild(card);
  card.appendChild(el('h1', null, 'How to climb'));
  card.appendChild(el('p', 'ab-sub', mode === 'challenge'
    ? 'Challenge: a limited rack, and (if the clock is on) keep moving.'
    : 'Practice: take your time — every placement is scored live.'));

  const place = isTouch
    ? 'your <b>thumb</b> floats it over a crack — lift to place'
    : 'move it over a crack and <b>click</b> to place';
  const steps = [
    `<b>Pick gear</b> from the rack at the bottom, then ${place}.`,
    'Cams <b>open into the crack by themselves</b> — just put them where they fit. (You can switch to a manual trigger in settings.)',
    'Nuts &amp; hexes need a <b>constriction below</b> them to lock — slot them above a pinch.',
    'After placing, <b>tap a piece to select it</b>, then drag to nudge it or use the ◄ ► buttons to rotate.',
    'Tap <b>fixed pins/bolts</b> to inspect their condition before you clip them.',
    'Build <b>3 pieces</b>, then a fall test decides if the anchor holds.'
  ];
  const ol = el('ol', 'ab-steps');
  steps.forEach((t) => ol.appendChild(el('li', null, t)));
  card.appendChild(ol);

  const btn = el('button', 'ab-btn', 'Got it — let’s climb');
  btn.onclick = () => { markTutorialSeen(); hideOverlay(); onClose && onClose(); };
  card.appendChild(btn);
  document.body.appendChild(overlay);
}

// ---- persistent help button (re-opens the tutorial) ----
let helpBtn = null;
export function mountHelpButton(onClick) {
  if (helpBtn) return;
  helpBtn = el('button', 'ab-btn ab-help-btn', '?');
  helpBtn.style.width = '38px';
  helpBtn.style.padding = '7px 0';
  helpBtn.style.margin = '0';
  helpBtn.onclick = onClick;
  document.body.appendChild(helpBtn);
}
export function showHelpButton(show) { if (helpBtn) helpBtn.style.display = show ? 'block' : 'none'; }

// ---- bottom action buttons (Test anchor / New crack) ----
let actionWrap = null, testBtn = null, regenBtn = null;
export function mountActions(handlers) {
  if (actionWrap) return;
  actionWrap = el('div');
  actionWrap.style.cssText = 'position:fixed;left:50%;bottom:10px;transform:translateX(-50%);z-index:13;display:none;gap:8px;';
  testBtn = el('button', 'ab-btn', '⚡ Test the anchor');
  testBtn.style.cssText = 'margin:0;width:auto;padding:11px 20px;font-size:0.95rem;';
  testBtn.onclick = () => handlers.test && handlers.test();
  regenBtn = el('button', 'ab-btn ab-ghost', '↻ New crack');
  regenBtn.style.cssText = 'margin:0;width:auto;padding:11px 16px;font-size:0.9rem;';
  regenBtn.onclick = () => handlers.regen && handlers.regen();
  actionWrap.appendChild(regenBtn);
  actionWrap.appendChild(testBtn);
  document.body.appendChild(actionWrap);
}
export function showActions(show, canTest) {
  if (!actionWrap) return;
  actionWrap.style.display = show ? 'flex' : 'none';
  if (testBtn) { testBtn.style.display = canTest ? 'block' : 'none'; }
}

// ---- fixed-gear inspect tooltip ----
let inspectEl = null;
function ensureInspect() {
  if (!inspectEl) { inspectEl = el('div', 'ab-inspect'); document.body.appendChild(inspectEl); }
  return inspectEl;
}
export function showInspect(clientX, clientY, fixed) {
  const e = ensureInspect();
  const pct = Math.round(fixed.condition * 100);
  const col = fixed.condition > 0.7 ? '#46d17f' : fixed.condition > 0.4 ? '#e8c43a' : '#e5563f';
  const kind = fixed.fixedType === 'bolt' ? 'Bolt' : 'Piton';
  e.innerHTML =
    `<div class="ab-ins-title">${kind} · ${fixed.kN} kN</div>` +
    `<div>Condition: <b style="color:${col}">${pct}%</b> — ${fixed.condition > 0.7 ? 'bomber' : fixed.condition > 0.4 ? 'okay' : 'corroded'}</div>` +
    `<div class="ab-bar"><i style="width:${pct}%;background:${col}"></i></div>` +
    `<div style="color:#9fb0d0;margin-top:4px">Tap again to clip it</div>`;
  e.style.display = 'block';
  const r = e.getBoundingClientRect();
  e.style.left = Math.min(clientX + 12, window.innerWidth - r.width - 8) + 'px';
  e.style.top = Math.max(8, clientY - r.height - 12) + 'px';
}
export function hideInspect() { if (inspectEl) inspectEl.style.display = 'none'; }

// ---- selected-piece toolbar ----
let toolsEl = null, toolHandlers = {};
export function mountTools(handlers) {
  toolHandlers = handlers;
  if (toolsEl) return;
  toolsEl = el('div', 'ab-tools');
  const mk = (label, cls, fn) => { const b = el('button', cls, label); b.onclick = (ev) => { ev.stopPropagation(); fn(); }; return b; };
  toolsEl.appendChild(mk('◄', '', () => toolHandlers.rotateL && toolHandlers.rotateL()));
  toolsEl.appendChild(mk('►', '', () => toolHandlers.rotateR && toolHandlers.rotateR()));
  toolsEl.appendChild(mk('✕', 'ab-del', () => toolHandlers.remove && toolHandlers.remove()));
  toolsEl.appendChild(mk('✓', 'ab-done', () => toolHandlers.done && toolHandlers.done()));
  document.body.appendChild(toolsEl);
}
// Position the toolbar near a client-space point (above it).
export function showTools(clientX, clientY) {
  if (!toolsEl) return;
  toolsEl.style.display = 'flex';
  const r = toolsEl.getBoundingClientRect();
  toolsEl.style.left = Math.min(Math.max(8, clientX - r.width / 2), window.innerWidth - r.width - 8) + 'px';
  toolsEl.style.top = Math.max(8, clientY - r.height - 16) + 'px';
}
export function hideTools() { if (toolsEl) toolsEl.style.display = 'none'; }
