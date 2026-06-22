// Logical drawing resolution. Everything is drawn in these coordinates and
// scaled to the screen, so layout math stays resolution-independent.
export const VIEW = { w: 1024, h: 720 };

// The rock face / play area.
export const PLAY = { x: 56, y: 72, w: 912, h: 350 };

// Vertical span the crack occupies inside the play area.
export const CRACK_TOP = PLAY.y + 28;
export const CRACK_BOT = PLAY.y + PLAY.h - 18;

// The rack tray at the bottom — large, with variable-height rows, so every piece
// can render at TRUE crack scale (same size in the rack as in the crack).
export const RACK = { x: 0, y: 426, w: VIEW.w, h: 294 };

// Millimetres of real crack aperture per logical pixel when drawing the gap.
export const MM2PX = 0.92;

// How long a pitch lasts on the pump clock, in seconds, at full stamina.
// (Legacy default; the live duration now comes from the chosen timer preset.)
export const PUMP_SECONDS = 26;

// Optional pump timer. OFF BY DEFAULT — the timer is never the default experience.
// `seconds` is the pump duration on pitch 1; `ramp` shrinks it on later pitches
// so difficulty starts easy and climbs gradually; `bonus` is seconds of pump
// awarded for each successfully placed (holding) piece.
export const TIMER_PRESETS = {
  off:      { id: 'off',      label: 'Off',      blurb: 'No clock. Build at your own pace.',           seconds: Infinity, ramp: 0,    bonus: 0 },
  relaxed:  { id: 'relaxed',  label: 'Relaxed',  blurb: 'A gentle clock that ramps up slowly.',        seconds: 70,       ramp: 0.05, bonus: 10 },
  standard: { id: 'standard', label: 'Standard', blurb: 'A real pump clock — keep moving.',            seconds: 46,       ramp: 0.09, bonus: 7 }
};

// Pump duration (seconds) for a preset on a given pitch — easy at first, then
// gradually shorter. Clamped so it never gets degenerate.
export function pumpSeconds(preset, pitch) {
  if (!preset || preset.seconds === Infinity) return Infinity;
  return Math.max(16, preset.seconds / (1 + preset.ramp * (pitch - 1)));
}

// Stamina cost (as a fraction of the bar) for committing a placement — you have
// to hang on while you fiddle the piece in.
export const PLACE_COST = 0.06;

// Touch placement: the piece floats above the controlling finger so the finger
// never covers it and you can watch it seat in the crack. A cam gets a long
// "neck" — your thumb sits below the stem and the lobes appear this far above it;
// you then put two fingers to the side and pull them down toward the thumb to
// retract the lobes, exactly like pulling a real trigger. Nuts/hexes just lift a
// little so the fingertip isn't on top of them. Tuned for a phone in landscape.
export const TOUCH_CAM_NECK = 130;    // logical px from thumb up to the lobes
export const TOUCH_PIECE_LIFT = 48;   // logical px lift for nuts/hexes
export const TRIGGER_TRAVEL = 120;    // logical px of trigger pull ≈ full retraction

export const COLORS = {
  rockLight: '#6b7385',
  rockMid: '#525a6b',
  rockDark: '#3c4252',
  rockEdge: '#2a2f3c',
  crack: '#0c0e15',
  crackInner: '#05060a',
  hud: '#0c1120',
  hudText: '#e7ecf6',
  good: '#46d17f',
  warn: '#e8c43a',
  bad: '#e5563f',
  accent: '#6fb1ff',
  steel: '#c9ced8',
  steelDark: '#878e9c'
};

// Rotating rock backgrounds for visual variety. Each is a granite-style palette
// (base gradient + mineral speckle colours). One is picked per pitch. The crack
// itself keeps the dark COLORS.crack tones so contrast stays readable on all.
export const ROCK_PALETTES = [
  { name: 'Sierra granite', light: '#6b7385', mid: '#525a6b', dark: '#3c4252', edge: '#2a2f3c',
    speckle: ['#dadde4', '#b7bcc7', '#2b2f39', '#9aa0a8', '#c8b4a0', '#8b93a4'] },
  { name: 'Red sandstone', light: '#a8704a', mid: '#8a5436', dark: '#5f3824', edge: '#3c2316',
    speckle: ['#e7c39a', '#c98a5c', '#5f3824', '#d6a173', '#7a4a2e', '#eccba2'] },
  { name: 'Desert varnish', light: '#9a8358', mid: '#766239', dark: '#4f4124', edge: '#332a17',
    speckle: ['#e8d6a8', '#c2a463', '#4f4124', '#a98f55', '#dcc488', '#7d6736'] },
  { name: 'Sea cliff basalt', light: '#5a6066', mid: '#42474d', dark: '#2c3034', edge: '#1c1f22',
    speckle: ['#cfd4d8', '#9aa0a6', '#23262a', '#7d848b', '#b9c0c6', '#5a6066'] },
  { name: 'Pink quartzite', light: '#9d7d86', mid: '#7c5f69', dark: '#56424b', edge: '#372a30',
    speckle: ['#e6cdd4', '#c79aa6', '#56424b', '#d8b2bc', '#8f6e78', '#ecd8de'] }
];

// Per-pitch rock quality. The face you're climbing has a quality tier that's
// shown up front (no hidden surprises) and feeds the scoring as one explicit
// factor: choss caps how good any placement can be and makes fixed gear chancier.
// `factor` multiplies a placement's final quality; `wobble` adds visual roughness.
export const ROCK_QUALITY = [
  { id: 'bomber',  label: 'Bomber rock',  blurb: 'Clean, solid stone. Gear bites.',       factor: 1.00, wobble: 0.0, color: '#46d17f' },
  { id: 'solid',   label: 'Solid rock',   blurb: 'Good stone with the odd weakness.',     factor: 0.92, wobble: 0.5, color: '#8fd24a' },
  { id: 'suspect', label: 'Suspect rock', blurb: 'Some flakes and grit — be thoughtful.', factor: 0.80, wobble: 1.0, color: '#e8c43a' },
  { id: 'choss',   label: 'Chossy rock',  blurb: 'Friable, flaky. Even good gear is iffy.', factor: 0.66, wobble: 1.6, color: '#e5563f' }
];
