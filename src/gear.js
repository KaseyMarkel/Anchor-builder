// The rack. Black Diamond is the source of truth for sizes (mm) and strength
// (kN). Three families, each laid out in its own row, sorted small → large:
//   - CAMS  : Camalot Z4 (micro) + Camalot C4 — active, spring-loaded, a range
//   - NUTS  : Micro Stoppers + Stoppers — passive wedges, a single size
//   - HEXES : Hexentrics — passive cammed chocks, a two-orientation range
// Every piece carries a `nominal` aperture (mm) so the UI can draw its icon at
// the same mm→px scale as the crack — the size you see is the size it fits.

// Black Diamond's per-size colour scheme (shared by C4 and Z4 by label).
const CAM_COLOR = {
  '0': '#46d17f', '0.1': '#e5563f', '0.2': '#e8c43a', '0.3': '#3f7fd6',
  '0.4': '#9aa0a8', '0.5': '#7b4fc0', '0.75': '#46d17f',
  '1': '#e5563f', '2': '#e8c43a', '3': '#3f7fd6', '4': '#9aa0a8',
  '5': '#7b4fc0', '6': '#46d17f'
};

function cam(series, label, min, max, kN) {
  return {
    id: `${series.toLowerCase()}-${label}`, kind: 'cam', series, label,
    color: CAM_COLOR[label] || '#c9ced8',
    min, max, kN, nominal: (min + max) / 2
  };
}
function nut(series, label, size, kN, color) {
  return { id: `${series}-${label}`, kind: 'nut', series, label, color, size, kN, nominal: size };
}
function hex(label, min, max, kN) {
  return {
    id: `hex-${label}`, kind: 'hex', series: 'Hex', label,
    color: '#b08d57', min, max, kN, nominal: (min + max) / 2
  };
}

// Camalot Z4 (micro cams) + Camalot C4 — real BD aperture ranges (mm) and kN.
export const CAMS = [
  cam('Z4', '0',    7.5,  11.9, 5),
  cam('Z4', '0.1',  8.4,  13.8, 5),
  cam('Z4', '0.2',  9.9,  16.5, 6),
  cam('Z4', '0.3',  12.4, 22.6, 7),
  cam('Z4', '0.4',  15.3, 25.9, 9),
  cam('Z4', '0.5',  18.8, 33.9, 9),
  cam('Z4', '0.75', 23.1, 42.1, 9),
  cam('C4', '0.3',  13.8, 23.4, 8),
  cam('C4', '0.4',  15.5, 26.7, 9),
  cam('C4', '0.5',  19.6, 33.5, 12),
  cam('C4', '0.75', 23.9, 41.2, 12),
  cam('C4', '1',    30.2, 52.1, 14),
  cam('C4', '2',    37.2, 64.9, 14),
  cam('C4', '3',    50.7, 87.9, 14),
  cam('C4', '4',    66.0, 114.7, 14),
  cam('C4', '5',    85.4, 148.5, 14),
  cam('C4', '6',    114.1, 195.0, 14)
];

// Passive wedges. Micro Stoppers (brass, thin) then Stoppers (alloy).
const MICRO = '#caa45a', STEEL = '#c9ced8';
export const NUTS = [
  nut('Micro', 'µ1', 3.4, 2, MICRO),
  nut('Micro', 'µ2', 4.1, 2, MICRO),
  nut('Micro', 'µ3', 4.7, 2, MICRO),
  nut('Micro', 'µ4', 5.4, 5, MICRO),
  nut('Micro', 'µ5', 6.4, 5, MICRO),
  nut('Micro', 'µ6', 7.5, 5, MICRO),
  nut('Stopper', '1',  6.4, 2, STEEL),
  nut('Stopper', '2',  7.9, 2, STEEL),
  nut('Stopper', '3',  9.5, 5, STEEL),
  nut('Stopper', '4',  11.1, 6, STEEL),
  nut('Stopper', '5',  12.7, 6, STEEL),
  nut('Stopper', '6',  14.3, 6, STEEL),
  nut('Stopper', '7',  16.7, 10, STEEL),
  nut('Stopper', '8',  19.0, 10, STEEL),
  nut('Stopper', '9',  22.2, 10, STEEL),
  nut('Stopper', '10', 25.4, 10, STEEL),
  nut('Stopper', '11', 28.6, 10, STEEL),
  nut('Stopper', '12', 31.8, 10, STEEL),
  nut('Stopper', '13', 36.5, 10, STEEL)
];

// Hexentrics — placed in two orientations, so each spans a width range (mm).
export const HEXES = [
  hex('1',  13, 17, 5),
  hex('2',  16, 21, 5),
  hex('3',  19, 25, 6),
  hex('4',  22, 29, 6),
  hex('5',  26, 34, 10),
  hex('6',  30, 40, 10),
  hex('7',  36, 48, 10),
  hex('8',  43, 57, 10),
  hex('9',  52, 68, 10),
  hex('10', 62, 80, 10),
  hex('11', 75, 95, 10)
];

// Build a fresh full rack for a pitch. Each entry tracks whether it's been used.
export function makeRack() {
  return [...CAMS, ...NUTS, ...HEXES].map((g) => ({ ...g, used: false }));
}

function fitsRange(g, lo, hi) {
  if (g.kind === 'cam' || g.kind === 'hex') return g.min <= hi && g.max >= lo;
  return g.size >= lo * 0.7 && g.size <= hi * 1.15;       // nut
}
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// A limited, randomized rack for Challenge mode — you don't have your whole rack
// at the anchor. Given the pitch's aperture range (mm), pick a constrained set
// that still *covers* the crack (so the pitch is always protectable): a spread
// of cams across the range plus a couple of passive pieces. ~6–9 pieces.
export function makeChallengeRack(range) {
  const lo = range.lo, hi = range.hi;
  const pick = [];
  const add = (g) => { if (g && !pick.includes(g)) pick.push(g); };

  // Cams: a *spread* across the range — pick the cam nearest each of a few evenly
  // spaced target apertures, so coverage is guaranteed without grabbing the whole
  // rack. nCams scales gently with how wide the crack is.
  const cams = CAMS.filter((g) => fitsRange(g, lo, hi));
  const span = Math.max(1, hi - lo);
  const nCams = Math.min(cams.length, span > 40 ? 4 : span > 18 ? 3 : 2);
  for (let i = 0; i < nCams; i++) {
    const target = lo + (span * (i + 0.5)) / nCams;
    let best = null, bestD = Infinity;
    for (const c of cams) {
      if (pick.includes(c)) continue;
      const d = Math.abs(c.nominal - target);
      if (d < bestD) { bestD = d; best = c; }
    }
    add(best);
  }

  // Passive: 2–3 nuts/hexes that fit the range.
  const passive = shuffle([...NUTS, ...HEXES].filter((g) => fitsRange(g, lo, hi)));
  const nPassive = 2 + (Math.random() < 0.5 ? 1 : 0);
  for (const g of passive) {
    if (pick.filter((p) => p.kind !== 'cam').length >= nPassive) break;
    add(g);
  }

  // Fallback: if the crack is so narrow/wide that little fit, grab the nearest
  // pieces by size so the player always has *something*.
  if (pick.length < 4) {
    const all = [...CAMS, ...NUTS, ...HEXES]
      .sort((a, b) => Math.abs(a.nominal - (lo + hi) / 2) - Math.abs(b.nominal - (lo + hi) / 2));
    for (const g of all) { if (pick.length >= 6) break; if (!pick.includes(g)) pick.push(g); }
  }

  return pick
    .sort((a, b) => a.nominal - b.nominal)
    .map((g) => ({ ...g, used: false }));
}

// Human-readable spec for tooltips / breakdowns.
export function gearSpec(g) {
  if (g.kind === 'cam') return `${g.series} #${g.label} cam (${g.min.toFixed(0)}–${g.max.toFixed(0)} mm)`;
  if (g.kind === 'hex') return `Hex #${g.label} (${g.min.toFixed(0)}–${g.max.toFixed(0)} mm)`;
  return `${g.series} #${g.label} (~${g.size.toFixed(0)} mm)`;
}
