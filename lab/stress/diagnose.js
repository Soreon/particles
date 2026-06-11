// Diagnostic spatial de l'activité résiduelle :
//   node lab/stress/diagnose.js <config> [variant=v1] [--seed N] [--warmup N] [--window M]
//
// Après warmup frames, accumule sur window frames :
//  - histogramme par LIGNE des cellules changées (l'activité doit être confinée
//    aux lignes d'interface partielles, jamais dans le coeur des couches) ;
//  - nb de "défauts" par matériau (cellules hors lignes pleines : count mod W) ;
//  - activité moyenne par frame et quantum par défaut ;
//  - composition des lignes mixtes de l'état final.

const path = require('path');
const { Sim, makeRng } = require('../automaton');
const { countsByName, changedCells } = require('../metrics');
const { NAME_OF } = require('../materials');
const { configs } = require('./configs');

const args = process.argv.slice(2);
const cfgName = args[0];
const variant = (args[1] && !args[1].startsWith('--')) ? args[1] : 'v1';
function intArg(name, dflt) {
  const i = args.indexOf(name);
  return i >= 0 ? parseInt(args[i + 1], 10) : dflt;
}
const seed = intArg('--seed', 1);
const warmup = intArg('--warmup', 1500);
const window = intArg('--window', 300);

const rule = require(path.join(__dirname, '..', 'rules', variant + '.js'));
const cfg = configs.find((c) => c.name === cfgName);
if (!cfg) { console.error('config inconnue: ' + cfgName); process.exit(1); }

const W = 64; const H = 64;
const sim = new Sim(W, H, rule, seed);
const rng = makeRng(seed * 7 + 13);
cfg.build(sim, rng);

for (let f = 0; f < warmup; f++) sim.frame();

const rowChanges = new Array(H).fill(0);
const prev = new Uint8Array(sim.grid.length);
let total = 0;
for (let f = 0; f < window; f++) {
  prev.set(sim.grid);
  sim.frame();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (prev[i] !== sim.grid[i]) { rowChanges[y]++; total++; }
    }
  }
}

// Défauts : pour chaque matériau, cellules hors lignes pleines.
const counts = countsByName(sim);
const defects = {};
let totalDefects = 0;
for (const [m, n] of Object.entries(counts)) {
  const partial = n % W;
  const d = Math.min(partial, W - partial); // bosses ou trous, le plus petit des deux
  defects[m] = { count: n, partialRow: partial, defectCells: d };
  totalDefects += d;
}

// Lignes mixtes de l'état final.
const mixedRows = [];
for (let y = 0; y < H; y++) {
  const comp = {};
  for (let x = 0; x < W; x++) {
    const nm = NAME_OF[sim.grid[y * W + x]];
    comp[nm] = (comp[nm] || 0) + 1;
  }
  if (Object.keys(comp).length > 1) mixedRows.push({ y, comp });
}

const out = {
  config: cfgName,
  variant,
  seed,
  warmup,
  window,
  meanActivityPerFrame: Math.round((total / window) * 100) / 100,
  defects,
  totalDefectCells: totalDefects,
  activityPerDefect: totalDefects > 0 ? Math.round((total / window / totalDefects) * 100) / 100 : null,
  rowChangesNonZero: rowChanges
    .map((n, y) => ({ y, changes: n }))
    .filter((e) => e.changes > 0),
  mixedRowsFinal: mixedRows,
};
console.log(JSON.stringify(out, null, 2));
