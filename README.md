# Anchor Builder

A browser-playable **trad climbing anchor-building simulator** and training tool, built with vanilla JavaScript + HTML canvas (Vite).

Each pitch generates one or two branching crack systems on a granite face. Against a draining pump clock, you pick gear off the rack, position it over the crack, and place three pieces to build an anchor — then a fall test decides whether it holds.

## Mechanics

- **Branching crack systems** — procedurally generated trunks with forks, merges (Ys), and crossings (Xs), each with constrictions and parallel sections.
- **A real Black Diamond rack** — Camalot Z4 + C4 cams, Micro Stoppers + Stoppers, and Hexentrics, all at true Black Diamond sizes (mm) and strength ratings (kN). Icons render at the same scale as the crack.
- **Cams placed like the real thing** — grab a cam, hold **SPACE** to pull the trigger (the lobes rotate inward on the axle), and seat it. A cam too big for the crack physically won't go in.
- **Authentic placement scoring (1–100)** — cams want the aperture centered in their range with parallel walls; nuts and hexes need a constriction to lock above; passive pro earns a bonus.
- **Old fixed pins** appear on some pitches — clip them into your anchor.
- Scores stay hidden until the end-of-pitch debrief, which reports each piece's grade, strength, the crack diameter it went into, and whether it would hold.

## Run locally

```bash
npm install
npm run dev      # dev server
npm run build    # production build → dist/
```

## Play

Live at **[kaseymarkel.com/anchor-builder](https://kaseymarkel.com/anchor-builder/)**.
