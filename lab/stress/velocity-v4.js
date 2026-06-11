// Scénarios de validation V4 (viscosité).
// Usage : node lab/stress/velocity-v4.js <variant>
//
// 1. time-to-level : un bloc de chaque liquide versé au centre d'un sol vide —
//    les temps d'aplatissement doivent être STRICTEMENT ordonnés
//    alcool < eau < huile, avec un ratio >= 1.5 entre voisins.
// 2. terminal par porteur : un grain de sable coule plus lentement dans
//    l'huile que dans l'eau.

const path = require('path');
const { Sim, makeRng } = require('../automaton');
const { flatness } = require('../metrics');
const { NAME_OF } = require('../materials');

const variant = process.argv[2] || 'v10';
const rule = require(path.join('..', 'rules', variant + '.js'));

// --- 1. Temps de nivellement par liquide ---
{
  const times = {};
  for (const mat of ['alcool', 'water', 'oil']) {
    const sim = new Sim(64, 64, rule, 1);
    const rng = makeRng(31);
    sim.fillRect(22, 40, 41, 55, mat, rng); // bloc 20x16 au-dessus du sol
    let t = -1;
    for (let f = 0; f < 1500; f++) {
      sim.frame();
      if (f % 5 === 0) {
        const fl = flatness(sim, mat);
        if (fl.variance <= 1.5 && fl.span >= 56) { t = f; break; }
      }
    }
    times[mat] = t;
  }
  const ordered = times.alcool > 0 && times.water > 0 && times.oil > 0
    && times.alcool <= times.water && times.water < times.oil;
  const r1 = times.water / Math.max(1, times.alcool);
  const r2 = times.oil / Math.max(1, times.water);
  console.log(`time-to-level : alcool=${times.alcool}f, eau=${times.water}f, huile=${times.oil}f | ratios x${r1.toFixed(1)}, x${r2.toFixed(1)} ${ordered && r2 >= 1.5 ? 'OK (viscosités distinctes)' : 'ÉCHEC'}`);
}

// --- 2. Vitesse terminale par porteur ---
{
  function sinkTime(carrier) {
    const sim = new Sim(64, 64, rule, 1);
    const rng = makeRng(32);
    sim.fillRect(0, 8, 63, 63, carrier, rng);
    sim.set(32, 3, 100, 0); // grain de sable
    for (let f = 0; f < 400; f++) {
      sim.frame();
      let bottom = -1;
      for (let y = 0; y < 64; y++) for (let x = 30; x <= 34; x++) if (NAME_OF[sim.get(x, y)] === 'sand') bottom = Math.max(bottom, y);
      if (bottom >= 62) return f;
    }
    return 999;
  }
  const tw = sinkTime('water');
  const to = sinkTime('oil');
  console.log(`terminal porteur : fond atteint dans l'eau en ${tw}f, dans l'huile en ${to}f ${to > tw * 1.3 ? 'OK (huile freine plus)' : 'ÉCHEC'}`);
}
