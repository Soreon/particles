// Micro-tests des sentinelles hors-grille (haut=0, bas=255) vues par v1 :
// node lab/stress/micro-boundary.js
// - paire de liquides différents SUR LA LIGNE DU HAUT d'une grille pleine :
//   B ne doit pas se déclencher à tort (densAbove=0 jamais > dL) ;
// - paire SUR LA LIGNE DU FOND : C ne doit pas se déclencher à tort (255 jamais < dL) ;
// - cellule isolée de chaque liquide dans un autre liquide -> stratification.

const path = require('path');
const { Sim, makeRng } = require(path.join(__dirname, '..', 'automaton'));
const { meanY, countsByName } = require(path.join(__dirname, '..', 'metrics'));
const rule = require(path.join(__dirname, '..', 'rules', 'v1.js'));

const out = { probes: {} };

// 1. Grille 8x8 100% pleine : ligne du haut moitié eau / moitié alcool, reste eau.
//    L'alcool doit rester en haut (et s'y étaler), jamais replonger.
{
  const sim = new Sim(8, 8, rule, 1);
  const rng = makeRng(5);
  sim.fillRect(0, 0, 7, 7, 'water', rng);
  sim.fillRect(0, 0, 3, 0, 'alcool', rng); // 4 cellules d'alcool sur la ligne 0
  const initial = countsByName(sim);
  let conservationOK = true;
  for (let f = 0; f < 200; f++) {
    sim.frame();
    const c = countsByName(sim);
    for (const k of Object.keys(initial)) if (c[k] !== initial[k]) conservationOK = false;
  }
  // tout l'alcool doit être sur la ligne 0 (4 cellules, 8 colonnes)
  let alcRow0 = 0; let alcElsewhere = 0;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const id = sim.get(x, y);
      if (id >= 130 && id < 140) { if (y === 0) alcRow0++; else alcElsewhere++; }
    }
  }
  out.probes['top-row-alcool-stays-up'] = {
    pass: conservationOK && alcRow0 === 4 && alcElsewhere === 0,
    conservationOK, alcRow0, alcElsewhere,
  };
}

// 2. Grille 8x8 pleine : ligne du FOND moitié huile / moitié eau, reste eau.
//    L'huile doit rester/finir au fond, étalée sur la ligne 7.
{
  const sim = new Sim(8, 8, rule, 1);
  const rng = makeRng(6);
  sim.fillRect(0, 0, 7, 7, 'water', rng);
  sim.fillRect(0, 7, 3, 7, 'oil', rng); // 4 cellules d'huile au fond
  const initial = countsByName(sim);
  let conservationOK = true;
  for (let f = 0; f < 200; f++) {
    sim.frame();
    const c = countsByName(sim);
    for (const k of Object.keys(initial)) if (c[k] !== initial[k]) conservationOK = false;
  }
  let oilRow7 = 0; let oilElsewhere = 0;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const id = sim.get(x, y);
      if (id >= 120 && id < 130) { if (y === 7) oilRow7++; else oilElsewhere++; }
    }
  }
  out.probes['bottom-row-oil-stays-down'] = {
    pass: conservationOK && oilRow7 === 4 && oilElsewhere === 0,
    conservationOK, oilRow7, oilElsewhere,
  };
}

// 3. Cellule UNIQUE d'huile au beau milieu d'un bain d'eau -> doit finir au fond.
{
  const sim = new Sim(32, 32, rule, 1);
  const rng = makeRng(7);
  sim.fillRect(0, 8, 31, 31, 'water', rng);
  sim.set(16, 16, 120); // une seule cellule d'huile
  let conservationOK = true;
  for (let f = 0; f < 300; f++) {
    sim.frame();
    const c = countsByName(sim);
    if ((c.oil || 0) !== 1) conservationOK = false;
  }
  const yo = meanY(sim, 'oil');
  out.probes['single-oil-cell-sinks'] = { pass: conservationOK && yo === 31, conservationOK, oilY: yo };
}

// 4. Cellule UNIQUE d'alcool posée au fond d'un bain d'eau -> doit finir en surface.
{
  const sim = new Sim(32, 32, rule, 1);
  const rng = makeRng(8);
  sim.fillRect(0, 8, 31, 31, 'water', rng);
  sim.set(16, 31, 130); // une seule cellule d'alcool collée au fond
  let conservationOK = true;
  for (let f = 0; f < 300; f++) {
    sim.frame();
    const c = countsByName(sim);
    if ((c.alcool || 0) !== 1) conservationOK = false;
  }
  const ya = meanY(sim, 'alcool');
  out.probes['single-alcool-cell-rises'] = { pass: conservationOK && ya === 8, conservationOK, alcY: ya };
}

out.allPass = Object.values(out.probes).every((p) => p.pass);
console.log(JSON.stringify(out, null, 2));
process.exitCode = out.allPass ? 0 : 1;
