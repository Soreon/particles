// Stress test grande grille : oil-in-water et alcool-in-water sur 128x128.
// Piscine d'eau pleine largeur (plus large que la version 64x64), disque r=14,
// 1500 frames. Critères : flatness variance <= 2 + conservation de masse à
// chaque frame. Usage : node lab/stress/big-grid.js <variant> [--seed N] [--dump]
//
// Ne modifie aucun fichier du labo : consomme automaton/metrics/scenarios tels quels.

const path = require('path');
const { Sim, makeRng } = require('../automaton');
const { countsByName, flatness, meanY, changedCells, ascii } = require('../metrics');

const W = 128;
const H = 128;
const FRAMES = 1500;
const FLAT_LIMIT = 2;

const args = process.argv.slice(2);
const variant = args[0] || 'v1';
const seedArg = args.indexOf('--seed');
const seed = seedArg >= 0 ? parseInt(args[seedArg + 1], 10) : 1;
const dump = args.includes('--dump');

const flowRule = require(path.join(__dirname, '..', 'rules', variant + '.js'));

// Mise à l'échelle des scénarios 64x64 d'origine (x2) :
// - oil-in-water    : piscine y=28..63 -> y=56..127 ; disque (32,40,r=9) -> (64,80,r=14)
// - alcool-in-water : piscine y=28..63 -> y=56..127 ; disque (32,48,r=9) -> (64,96,r=14)
const scenarios = [
  {
    name: 'oil-in-water-128',
    material: 'oil',
    build: (sim, rng) => {
      sim.fillRect(0, 56, W - 1, H - 1, 'water', rng);
      sim.paintDisc(64, 80, 14, 'oil', rng);
    },
    orderOK: (sim) => meanY(sim, 'oil') > meanY(sim, 'water'), // huile plus dense -> au fond
  },
  {
    name: 'alcool-in-water-128',
    material: 'alcool',
    build: (sim, rng) => {
      sim.fillRect(0, 56, W - 1, H - 1, 'water', rng);
      sim.paintDisc(64, 96, 14, 'alcool', rng);
    },
    orderOK: (sim) => meanY(sim, 'alcool') < meanY(sim, 'water'), // alcool plus léger -> en surface
  },
];

const results = { variant, seed, grid: W + 'x' + H, frames: FRAMES, scenarios: {}, allPass: true };

for (const scenario of scenarios) {
  const sim = new Sim(W, H, flowRule, seed);
  const rng = makeRng(seed * 7 + 13);
  scenario.build(sim, rng);

  const initialCounts = countsByName(sim);
  const activity = [];
  let firstFlatFrame = -1;
  let conservationOK = true;
  let conservationFailFrame = -1;
  const prev = new Uint8Array(sim.grid.length);

  for (let f = 0; f < FRAMES; f++) {
    prev.set(sim.grid);
    sim.frame();
    activity.push(changedCells(prev, sim.grid));

    const counts = countsByName(sim);
    for (const k of Object.keys(initialCounts)) {
      if (counts[k] !== initialCounts[k] && conservationOK) {
        conservationOK = false;
        conservationFailFrame = f;
      }
    }

    if (firstFlatFrame < 0 && f % 10 === 0
        && flatness(sim, scenario.material).variance <= 1.0) {
      firstFlatFrame = f;
    }
  }

  const lateActivity = activity.slice(-60);
  const meanLateActivity = lateActivity.reduce((s, v) => s + v, 0) / lateActivity.length;
  const fMat = flatness(sim, scenario.material);
  const fWater = flatness(sim, 'water');
  const ordered = scenario.orderOK(sim);
  const pass = fMat.variance <= FLAT_LIMIT && conservationOK && ordered;

  results.scenarios[scenario.name] = {
    pass,
    conservationOK,
    conservationFailFrame,
    firstFlatFrame,
    meanLateActivity: Math.round(meanLateActivity * 10) / 10,
    metrics: {
      flatVariance: fMat.variance,
      maxDev: fMat.maxDev,
      span: fMat.span,
      waterFlatVariance: fWater.variance,
      ordered,
      initialCounts,
      finalCounts: countsByName(sim),
    },
  };
  if (!pass) results.allPass = false;

  if (dump) {
    console.error('=== ' + scenario.name + ' (final, ' + variant + ' seed=' + seed + ') ===');
    console.error(ascii(sim));
  }
}

console.log(JSON.stringify(results, null, 2));
process.exitCode = results.allPass ? 0 : 1;
