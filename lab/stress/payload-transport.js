// Test de transport de la charge utile : on marque chaque particule d'un
// traceur (vy/vx/fl dérivés de sa position initiale), on fait tourner la
// physique v8 (qui ignore ces canaux), et on vérifie que le multiset des
// tuples (id, vy, vx, fl) est conservé à chaque frame : un échange qui
// perdrait ou mélangerait un canal casserait immédiatement l'invariant.
// Usage : node lab/stress/payload-transport.js [frames]

const path = require('path');
const { Sim, makeRng, hash01 } = require('../automaton');

const frames = parseInt(process.argv[2], 10) || 120;
const rule = require(path.join('..', 'rules', 'v8.js'));

const sim = new Sim(64, 64, rule, 1);
const rng = makeRng(42);

// Scénario chargé : 3 liquides mélangés + tas de sable + bulles (beaucoup
// d'échanges de tous types : verticaux, diagonaux, écoulement).
const mats = ['water', 'oil', 'alcool'];
for (let y = 30; y < 64; y++) {
  for (let x = 0; x < 64; x++) {
    sim.fillRect(x, y, x, y, mats[(rng() * 3) | 0], rng);
  }
}
for (let r = 0; r <= 10; r++) sim.fillRect(32 - (10 - r), 12 + r, 32 + (10 - r), 12 + r, 'sand', rng);
sim.paintDisc(20, 45, 3, 'void', rng);

// Traceurs : charge utile unique-ish par cellule occupée.
for (let i = 0; i < sim.grid.length; i++) {
  if (sim.grid[i] !== 0) {
    sim.vy[i] = (hash01(i, 1, 7) * 256) | 0;
    sim.vx[i] = (hash01(i, 2, 7) * 256) | 0;
    sim.fl[i] = (hash01(i, 3, 7) * 256) | 0;
  }
}

// Multiset des tuples -> empreinte insensible à l'ordre (somme de hashs).
function multisetHash() {
  let acc = 0;
  for (let i = 0; i < sim.grid.length; i++) {
    const id = sim.grid[i];
    if (id === 0) continue;
    let h = (id | (sim.vy[i] << 8) | (sim.vx[i] << 16)) ^ (sim.fl[i] * 0x9E3779B9);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    acc = (acc + (h >>> 0)) >>> 0;
  }
  return acc;
}

const ref = multisetHash();
let ok = true;
for (let f = 0; f < frames; f++) {
  sim.frame();
  const h = multisetHash();
  if (h !== ref) {
    console.log(`ÉCHEC frame ${f} : multiset des tuples (id,vy,vx,fl) modifié (${ref} -> ${h})`);
    ok = false;
    break;
  }
}
// Vérifie aussi qu'il y a bien eu du mouvement (le test ne tourne pas à vide).
console.log(ok
  ? `TRANSPORT OK : charge utile conservée avec sa particule sur ${frames} frames`
  : 'TRANSPORT CASSÉ');
process.exit(ok ? 0 : 1);
