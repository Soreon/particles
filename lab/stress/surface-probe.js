// Sonde du scintillement de SURFACE LIBRE (règle A, liquide<->vide) :
//   node lab/stress/surface-probe.js [variant=v1] [--frames N]
//
// Deux expériences :
//  1. minimal-bump-hole : eau plate (11 lignes pleines) + 1 bosse (eau posée sur la
//     surface) + 1 trou (vide dans la ligne de surface). Masse = multiple de W :
//     l'état parfaitement plat existe et est absorbant. Si bosse et trou ne
//     s'annihilent pas, c'est que la règle A (déterministe) les fait courir
//     balistiquement sans se rencontrer.
//  2. water-level-long : le scénario water-level (704 = 11x64 cellules) sur N frames,
//     pour voir si la rugosité créée par l'effondrement initial s'annihile un jour.
//
// Sortie : activité tardive, lastChange, lignes mixtes finales, trajectoire du trou.

const path = require('path');
const { Sim, makeRng } = require('../automaton');
const { changedCells, flatness } = require('../metrics');
const { NAME_OF } = require('../materials');

const args = process.argv.slice(2);
const variant = (args[0] && !args[0].startsWith('--')) ? args[0] : 'v1';
const fArg = args.indexOf('--frames');
const FRAMES = fArg >= 0 ? parseInt(args[fArg + 1], 10) : 5000;
const rule = require(path.join(__dirname, '..', 'rules', variant + '.js'));

const W = 64; const H = 64;

function mixedRows(sim) {
  const rows = [];
  for (let y = 0; y < H; y++) {
    const comp = {};
    for (let x = 0; x < W; x++) {
      const nm = NAME_OF[sim.grid[y * W + x]];
      comp[nm] = (comp[nm] || 0) + 1;
    }
    if (Object.keys(comp).length > 1) rows.push({ y, comp });
  }
  return rows;
}

function runExp(name, build, seed) {
  const sim = new Sim(W, H, rule, seed);
  const rng = makeRng(seed * 7 + 13);
  build(sim, rng);
  const prev = new Uint8Array(sim.grid.length);
  let lastChange = -1;
  let lateSum = 0; let lateN = 0;
  for (let f = 0; f < FRAMES; f++) {
    prev.set(sim.grid);
    sim.frame();
    const ch = changedCells(prev, sim.grid);
    if (ch > 0) lastChange = f;
    if (f >= FRAMES - 300) { lateSum += ch; lateN++; }
  }
  const fl = flatness(sim, 'water');
  console.log(JSON.stringify({
    variant,
    exp: name,
    seed,
    frames: FRAMES,
    lateMeanActivity: Math.round((lateSum / lateN) * 100) / 100,
    lastChangeFrame: lastChange,
    waterFinalVariance: Math.round(fl.variance * 1000) / 1000,
    mixedRowsFinal: mixedRows(sim),
  }));
}

for (const seed of [1, 2, 3]) {
  // 1. Repro minimale : surface plate + bosse + trou (annihilation possible).
  runExp('minimal-bump-hole', (sim, rng) => {
    sim.fillRect(0, 53, W - 1, 63, 'water', rng); // 11 lignes pleines (704 = 11x64)
    sim.set(16, 53, 0);                            // trou dans la ligne de surface
    sim.set(40, 52, 110);                          // bosse : eau posée sur la surface
    // masse conservée (704) -> l'état parfaitement plat existe et est absorbant
  }, seed);

  // 2. Scénario water-level (régression) prolongé.
  runExp('water-level-long', (sim, rng) => {
    sim.fillRect(0, 20, 15, 63, 'water', rng);
  }, seed);
}
