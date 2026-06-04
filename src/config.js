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
export const PUMP_SECONDS = 26;

// Stamina cost (as a fraction of the bar) for committing a placement — you have
// to hang on while you fiddle the piece in.
export const PLACE_COST = 0.06;

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
