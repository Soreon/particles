// Reproduit le rapport utilisateur : sable qui s'accumule sous l'eau ->
// les avalanches diagonales ne doivent PAS descendre à pleine cadence
// (comme dans du vide). On effondre un mur de sable immergé et on mesure
// la vitesse de descente du front : elle doit rester bornée par la vitesse
// terminale en liquide (~S/4 effectif), pas approcher la chute libre (~S).
// Usage : node lab/stress/underwater-avalanche.js <variant>

const path = require('path');
const { Sim, makeRng } = require('../automaton');
const { NAME_OF } = require('../materials');

const variant = process.argv[2] || 'v9';
const rule = require(path.join('..', 'rules', variant + '.js'));

const sim = new Sim(64, 64, rule, 1);
const rng = makeRng(17);

// Bassin d'eau profond + mur de sable raide (5 de large, 24 de haut) au fond.
sim.fillRect(0, 8, 63, 63, 'water', rng);
sim.fillRect(20, 39, 24, 63, 'sand', rng);

// Le mur s'effondre vers la droite : on suit, frame par frame, l'avancée du
// front de sable (la cellule de sable la plus à droite) et sa vitesse de
// descente le long de la pente (max de descente d'une colonne par frame).
let maxColumnDrop = 0;
const prevBottom = new Array(64).fill(-1);
for (let f = 0; f < 60; f++) {
  sim.frame();
  for (let x = 0; x < 64; x++) {
    let bottom = -1;
    let top = 64;
    for (let y = 0; y < 64; y++) {
      if (NAME_OF[sim.get(x, y)] === 'sand') { bottom = y; if (y < top) top = y; }
    }
    // descente du SOMMET de colonne (le front qui dévale la pente)
    if (prevBottom[x] >= 0 && top < 64) {
      const drop = top - prevBottom[x];
      if (drop > maxColumnDrop && drop < 30) maxColumnDrop = drop;
    }
    prevBottom[x] = top < 64 ? top : -1;
  }
}

const S = sim.substepsPerFrame;
const bound = (S >> 1) + 2; // vitesse terminale liquide stockée + marge
console.log(`avalanche immergée : descente max d'un front = ${maxColumnDrop} cases/frame (borne ${bound}, chute libre ~${S}) ${maxColumnDrop <= bound ? 'OK' : 'ÉCHEC (avalanche en chute libre)'}`);
