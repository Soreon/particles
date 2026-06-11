// Comparaison v0 vs v1 sur les scénarios n'impliquant que eau + vide
// (water-level, void-bubble) : la règle A étant identique et les règles B-E /
// glissements ne touchant que les paires liquide-liquide, les deux variantes
// doivent produire des trajectoires BIT-IDENTIQUES (grille égale à chaque frame).
// Usage : node lab/stress/compare-calm.js [--seed N]

const path = require('path');
const { Sim, makeRng } = require('../automaton');
const { scenarios } = require('../scenarios');
const { changedCells } = require('../metrics');

const args = process.argv.slice(2);
const seedArg = args.indexOf('--seed');
const seed = seedArg >= 0 ? parseInt(args[seedArg + 1], 10) : 1;

const v0 = require(path.join(__dirname, '..', 'rules', 'v0.js'));
const v1 = require(path.join(__dirname, '..', 'rules', 'v1.js'));

const targets = scenarios.filter((s) => s.name === 'water-level' || s.name === 'void-bubble');
const out = { seed, scenarios: {}, identical: true };

for (const scenario of targets) {
  const simA = new Sim(64, 64, v0, seed);
  const simB = new Sim(64, 64, v1, seed);
  scenario.build(simA, makeRng(seed * 7 + 13));
  scenario.build(simB, makeRng(seed * 7 + 13));

  let firstDivergence = -1;
  let maxDiffCells = 0;
  for (let f = 0; f < scenario.frames; f++) {
    simA.frame();
    simB.frame();
    const diff = changedCells(simA.grid, simB.grid);
    if (diff > 0 && firstDivergence < 0) firstDivergence = f;
    if (diff > maxDiffCells) maxDiffCells = diff;
  }

  const identical = firstDivergence < 0;
  out.scenarios[scenario.name] = { identical, firstDivergence, maxDiffCells };
  if (!identical) out.identical = false;
}

console.log(JSON.stringify(out, null, 2));
process.exitCode = out.identical ? 0 : 1;
