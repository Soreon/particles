// Reproduit le geste utilisateur : un tube de void peint verticalement dans
// l'eau (pinceau traîné). Dump ASCII au fil du temps pour voir la dynamique
// de l'effondrement (traits horizontaux ?).
// Usage : node lab/stress/void-tube.js <variant> [frames...]

const path = require('path');
const { Sim, makeRng } = require('../automaton');
const { ascii, countsByName } = require('../metrics');

const variant = process.argv[2] || 'v4';
const dumpAt = process.argv.slice(3).map(Number);
const frames = dumpAt.length ? Math.max(...dumpAt) : 12;
const snaps = dumpAt.length ? dumpAt : [0, 1, 2, 4, 8, 12];

const rule = require(path.join('..', 'rules', variant + '.js'));
const sim = new Sim(64, 64, rule, 1);
const rng = makeRng(99);

// Eau pleine sauf 8 lignes d'air en haut.
sim.fillRect(0, 8, 63, 63, 'water', rng);
// Tube de void 3 de large, de la surface jusqu'à y=52 (pinceau traîné vers le bas).
sim.fillRect(30, 9, 32, 52, 'void', rng);

console.log('=== frame 0 (état initial) ===');
console.log(ascii(sim));

for (let f = 1; f <= frames; f++) {
  sim.frame();
  if (snaps.includes(f)) {
    console.log(`=== frame ${f} ===`);
    console.log(ascii(sim));
  }
}
console.log('counts:', JSON.stringify(countsByName(sim)));
