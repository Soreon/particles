// Reproduit le versement continu au pinceau : disque d'eau r=2 peint chaque
// frame en hauteur pendant N frames, puis arrêt. Mesure la forme de la colonne
// et le temps d'effondrement après l'arrêt.
// Usage : node lab/stress/pour.js <variant> [--dump]

const path = require('path');
const { Sim, makeRng } = require('../automaton');
const { ascii, flatness, perColumnCount } = require('../metrics');
const { NAME_OF } = require('../materials');

const variant = process.argv[2] || 'v4';
const dump = process.argv.includes('--dump');

const rule = require(path.join('..', 'rules', variant + '.js'));
const sim = new Sim(64, 64, rule, 1);
const rng = makeRng(7);

// Sol : 4 lignes d'eau au fond (comme la capture utilisateur).
sim.fillRect(0, 60, 63, 63, 'water', rng);

const POUR_FRAMES = 120;
const POUR_X = 40;
const POUR_Y = 8;

// Hauteur de la plus haute cellule d'eau par colonne (pour mesurer la colonne).
function waterTopProfile() {
  const tops = new Array(sim.w).fill(-1);
  for (let x = 0; x < sim.w; x++) {
    for (let y = 0; y < sim.h; y++) {
      if (NAME_OF[sim.get(x, y)] === 'water') { tops[x] = sim.h - y; break; }
    }
  }
  return tops;
}

// Versement.
for (let f = 0; f < POUR_FRAMES; f++) {
  sim.paintDisc(POUR_X, POUR_Y, 2, 'water', rng);
  sim.frame();
}

let tops = waterTopProfile();
let maxH = Math.max(...tops);
console.log(`fin du versement (frame ${POUR_FRAMES}) : hauteur max = ${maxH}, hauteur médiane = ${tops.slice().sort((a, b) => a - b)[32]}`);
if (dump) console.log(ascii(sim));

// Arrêt : on mesure le temps jusqu'à l'aplatissement.
let flatFrame = -1;
for (let f = 0; f < 600; f++) {
  sim.frame();
  if (f % 5 === 0) {
    const fl = flatness(sim, 'water');
    if (fl.variance <= 1.5) { flatFrame = f; break; }
  }
}

tops = waterTopProfile();
maxH = Math.max(...tops);
const fl = flatness(sim, 'water');
console.log(`après arrêt : aplatissement en ${flatFrame >= 0 ? flatFrame + ' frames' : '> 600 frames (ÉCHEC)'} | hauteur max finale = ${maxH} | variance = ${Math.round(fl.variance * 1000) / 1000}`);
if (dump) console.log(ascii(sim));
