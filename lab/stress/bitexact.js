// Empreinte bit-exacte de la physique : pour chaque scénario, hash FNV-1a
// chaîné du plan d'ids à chaque frame. Deux moteurs/règles sont bit-exacts
// ssi leurs empreintes finales sont identiques.
// Usage :
//   node lab/stress/bitexact.js v8 --save ref.json     (capturer la référence)
//   node lab/stress/bitexact.js v8 --check ref.json    (comparer à la référence)

const fs = require('fs');
const path = require('path');
const { Sim, makeRng } = require('../automaton');
const { scenarios } = require('../scenarios');

const variant = process.argv[2] || 'v8';
const mode = process.argv[3]; // --save | --check
const file = process.argv[4];

const rule = require(path.join('..', 'rules', variant + '.js'));

function fnv1a(hash, byte) {
  let h = hash ^ byte;
  return Math.imul(h, 16777619) >>> 0;
}

function gridHash(grid, seed) {
  let h = seed >>> 0;
  for (let i = 0; i < grid.length; i++) h = fnv1a(h, grid[i]);
  return h >>> 0;
}

const result = {};
for (const scenario of scenarios) {
  for (const seed of [1, 2]) {
    const sim = new Sim(64, 64, rule, seed);
    const rng = makeRng(seed * 7 + 13);
    scenario.build(sim, rng);
    let chain = 0x811c9dc5;
    // 120 frames suffisent : toute divergence de règle apparaît en quelques frames.
    for (let f = 0; f < 120; f++) {
      sim.frame();
      chain = gridHash(sim.grid, chain);
    }
    result[`${scenario.name}/s${seed}`] = chain;
  }
}

if (mode === '--save') {
  fs.writeFileSync(file, JSON.stringify(result, null, 2));
  console.log('référence sauvegardée :', file);
} else if (mode === '--check') {
  const ref = JSON.parse(fs.readFileSync(file, 'utf8'));
  let ok = true;
  for (const k of Object.keys(ref)) {
    if (result[k] !== ref[k]) { console.log('DIVERGENCE', k, ':', ref[k], '->', result[k]); ok = false; }
  }
  console.log(ok ? 'BIT-EXACT : toutes les empreintes identiques' : 'ÉCHEC bit-exact');
  process.exit(ok ? 0 : 1);
} else {
  console.log(JSON.stringify(result, null, 2));
}
