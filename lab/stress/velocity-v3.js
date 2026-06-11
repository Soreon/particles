// Scénarios de validation V3 (impacts + vitesse horizontale).
// Usage : node lab/stress/velocity-v3.js <variant>
//
// 1. sand-cone : versement continu de sable en l'air — la dispersion d'impact
//    doit produire un CÔNE (~45°) au lieu d'une colonne (le cas de la capture
//    utilisateur). Critère : aspect hauteur/demi-base <= 1.4.
// 2. splash : goutte d'eau lâchée de haut sur un bassin — l'éclaboussure doit
//    projeter de l'eau latéralement (portée >= 3) et éjecter des gouttes
//    au-dessus de la surface (arcs balistiques).

const path = require('path');
const { Sim, makeRng } = require('../automaton');
const { NAME_OF } = require('../materials');

const variant = process.argv[2] || 'v9';
const rule = require(path.join('..', 'rules', variant + '.js'));

// --- 1. Cône de sable ---
{
  const sim = new Sim(64, 64, rule, 1);
  const rng = makeRng(21);
  for (let f = 0; f < 150; f++) {
    sim.paintDisc(32, 4, 2, 'sand', rng); sim.paintDisc(32, 7, 2, 'sand', rng);
    sim.frame();
  }
  for (let f = 0; f < 30; f++) sim.frame(); // laisse retomber/s'éboulir

  let apexY = 64; let minX = 64; let maxX = -1;
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      if (NAME_OF[sim.get(x, y)] === 'sand') {
        if (y < apexY) apexY = y;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
  }
  const height = 64 - apexY;
  const halfBase = (maxX - minX + 1) / 2;
  const aspect = height / halfBase;
  console.log(`sand-cone : hauteur ${height}, base ${maxX - minX + 1}, aspect h/demi-base = ${aspect.toFixed(2)} ${aspect <= 1.4 ? 'OK (cône)' : 'ÉCHEC (colonne)'}`);
}

// --- 2. Éclaboussure ---
{
  const sim = new Sim(64, 64, rule, 1);
  const rng = makeRng(22);
  sim.fillRect(0, 44, 63, 63, 'water', rng); // bassin
  sim.paintDisc(32, 10, 2, 'water', rng);    // goutte lâchée de haut (~34 de chute)

  let maxReach = 0;      // portée latérale de l'eau projetée AU-DESSUS de la surface
  let airborneSeen = 0;  // gouttes en vol au-dessus de la surface après l'impact
  for (let f = 0; f < 40; f++) {
    sim.frame();
    if (f < 6) continue; // attend l'impact
    for (let y = 0; y < 43; y++) {
      for (let x = 0; x < 64; x++) {
        if (NAME_OF[sim.get(x, y)] === 'water') {
          const reach = Math.abs(x - 32);
          if (reach > maxReach && reach < 25) maxReach = reach;
          airborneSeen++;
        }
      }
    }
  }
  const ok = maxReach >= 3 && airborneSeen > 0;
  console.log(`splash    : portée latérale max = ${maxReach} (>= 3), présence aérienne cumulée = ${airborneSeen} cellules-frames ${ok ? 'OK (éclaboussure)' : 'ÉCHEC (pas de splash)'}`);
}
