// Sondes complémentaires : node lab/stress/extra-probes.js [variant]
// 1. Grilles de dimensions IMPAIRES (9x9, 63x63) — non requises par la tâche mais
//    cas limite du pavage Margolus / des paires 2x1.
// 2. Stabilité long-terme : tri-mix plein, 3000 frames — l'ordre des couches ne
//    doit jamais se défaire après stratification ; mesure du bruit résiduel.

const path = require('path');
const { Sim, makeRng } = require(path.join(__dirname, '..', 'automaton'));
const { flatness, meanY, changedCells, countsByName } = require(path.join(__dirname, '..', 'metrics'));

const variant = process.argv[2] || 'v1';
const rule = require(path.join(__dirname, '..', 'rules', variant + '.js'));
const out = { variant, probes: {} };

// --- 1. Grilles impaires : nivellement d'eau versée à gauche ---
for (const [w, h] of [[9, 9], [63, 63]]) {
  const sim = new Sim(w, h, rule, 1);
  const rng = makeRng(20);
  sim.fillRect(0, Math.floor(h / 2), Math.floor(w / 2) - 1, h - 1, 'water', rng);
  const initial = countsByName(sim);
  let conservationOK = true;
  for (let f = 0; f < 500; f++) {
    sim.frame();
    const c = countsByName(sim);
    if ((c.water || 0) !== initial.water) conservationOK = false;
  }
  const fl = flatness(sim, 'water');
  out.probes[`odd-${w}x${h}-level`] = {
    pass: conservationOK && fl.variance <= 1.5 && fl.span >= w - 1,
    conservationOK,
    flatVariance: fl.variance,
    span: fl.span,
  };
}

// --- 2. Long-run : tri-mix 100% plein, 3000 frames, ordre vérifié périodiquement ---
{
  const sim = new Sim(64, 64, rule, 1);
  const rng = makeRng(99);
  const mats = ['water', 'oil', 'alcool'];
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) sim.fillRect(x, y, x, y, mats[(rng() * 3) | 0], rng);
  }
  const initial = countsByName(sim);
  let conservationOK = true;
  let orderBreaks = 0;
  let firstOrdered = -1;
  const activityWindows = [];
  const prev = new Uint8Array(sim.grid.length);
  let winAcc = 0;

  for (let f = 0; f < 3000; f++) {
    prev.set(sim.grid);
    sim.frame();
    winAcc += changedCells(prev, sim.grid);
    if ((f + 1) % 500 === 0) { activityWindows.push(Math.round(winAcc / 500)); winAcc = 0; }

    const c = countsByName(sim);
    for (const k of Object.keys(initial)) if (c[k] !== initial[k]) conservationOK = false;

    if (f % 50 === 0) {
      const ya = meanY(sim, 'alcool'); const yw = meanY(sim, 'water'); const yo = meanY(sim, 'oil');
      const ordered = ya < yw && yw < yo;
      if (ordered && firstOrdered < 0) firstOrdered = f;
      if (firstOrdered >= 0 && !ordered) orderBreaks++; // dé-stratification après coup ?
    }
  }
  const fa = flatness(sim, 'alcool'); const fw = flatness(sim, 'water'); const fo = flatness(sim, 'oil');
  out.probes['longrun-3000f-full-tri-mix'] = {
    pass: conservationOK && orderBreaks === 0 && firstOrdered >= 0
      && fa.variance <= 3 && fw.variance <= 3 && fo.variance <= 3,
    conservationOK,
    firstOrderedFrame: firstOrdered,
    orderBreaksAfterStratified: orderBreaks,
    finalVariances: { alcool: fa.variance, water: fw.variance, oil: fo.variance },
    meanActivityPer500fWindow: activityWindows, // décroît ? plateau ?
  };
}

out.allPass = Object.values(out.probes).every((p) => p.pass);
console.log(JSON.stringify(out, null, 2));
process.exitCode = out.allPass ? 0 : 1;
