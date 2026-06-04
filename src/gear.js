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

// Build a fresh rack for a pitch. Each entry tracks whether it's been used.
export function makeRack() {
  return [...CAMS, ...NUTS, ...HEXES].map((g) => ({ ...g, used: false }));
}

// Human-readable spec for tooltips / breakdowns.
export function gearSpec(g) {
  if (g.kind === 'cam') return `${g.series} #${g.label} cam (${g.min.toFixed(0)}–${g.max.toFixed(0)} mm)`;
  if (g.kind === 'hex') return `Hex #${g.label} (${g.min.toFixed(0)}–${g.max.toFixed(0)} mm)`;
  return `${g.series} #${g.label} (~${g.size.toFixed(0)} mm)`;
}
