// Scénarios de validation V2 (vitesse verticale).
// Usage : node lab/stress/velocity-v2.js <variant>
//
// 1. stream-frag : jet continu versé d'un point — avec vélocité, le jet doit
//    se FRAGMENTER (occupation de la colonne à mi-chute < 70 % ; v8 : ~100 %).
// 2. released-block : bloc de sable 20x20 relâché d'un coup (le cas
//    pathologique du Bresenham : tous les vy identiques) — la gravité
//    stochastique et le jitter de traînée doivent le disperser mesurablement.
// 3. terminal-velocity : une particule en chute libre atteint un plateau de
//    vitesse ~S cases/frame dans le vide, et nettement moins dans l'eau.

const path = require('path');
const { Sim, makeRng } = require('../automaton');
const { NAME_OF } = require('../materials');

const variant = process.argv[2] || 'v9';
const rule = require(path.join('..', 'rules', variant + '.js'));

// --- 1. Fragmentation du jet ---
{
  const sim = new Sim(64, 64, rule, 1);
  const rng = makeRng(5);
  // verse du sable depuis un point pendant 40 frames
  for (let f = 0; f < 40; f++) {
    sim.paintDisc(32, 4, 1, 'sand', rng);
    sim.frame();
  }
  // occupation de la colonne x=31..33 entre y=12 et y=44 (zone de chute)
  let occupied = 0; let total = 0;
  for (let y = 12; y < 44; y++) {
    for (let x = 31; x <= 33; x++) {
      total++;
      if (NAME_OF[sim.get(x, y)] === 'sand') occupied++;
    }
  }
  const ratio = occupied / total;
  console.log(`stream-frag      : occupation de la colonne à mi-chute = ${(ratio * 100).toFixed(0)}% ${ratio < 0.7 ? 'OK (fragmenté)' : 'ÉCHEC (jet rigide)'}`);
}

// --- 2. Bloc relâché ---
{
  const sim = new Sim(64, 64, rule, 1);
  const rng = makeRng(6);
  sim.fillRect(22, 4, 41, 23, 'sand', rng); // bloc 20x20 en l'air
  // boîte englobante initiale : 20x20
  let minX = 64; let maxX = -1; let minY = 64; let maxY = -1;
  let maxH = 0; let maxW = 0;
  for (let f = 0; f < 30; f++) {
    sim.frame();
    minX = 64; maxX = -1; minY = 64; maxY = -1;
    let landed = false;
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        if (NAME_OF[sim.get(x, y)] === 'sand') {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          if (y === 63) landed = true;
        }
      }
    }
    if (landed) break;
    maxH = Math.max(maxH, maxY - minY + 1);
    maxW = Math.max(maxW, maxX - minX + 1);
  }
  const stretch = maxH / 20;
  const widen = maxW / 20;
  const ok = stretch >= 1.2 || widen >= 1.1;
  console.log(`released-block   : étirement vertical x${stretch.toFixed(2)}, élargissement x${widen.toFixed(2)} ${ok ? 'OK (dispersé)' : 'ÉCHEC (corps rigide)'}`);
}

// --- 3. Vitesse terminale ---
{
  function measure(fillMat, label, expectMax) {
    const sim = new Sim(64, 64, rule, 1);
    const rng = makeRng(7);
    if (fillMat) sim.fillRect(0, 8, 63, 63, fillMat, rng);
    sim.set(32, 2, 100, 0); // un grain de sable, vy=0
    let prevY = 2;
    const speeds = [];
    for (let f = 0; f < 14; f++) {
      sim.frame();
      let yNow = -1;
      for (let y = 0; y < 64; y++) {
        if (NAME_OF[sim.get(32, y)] === 'sand' || NAME_OF[sim.get(31, y)] === 'sand' || NAME_OF[sim.get(33, y)] === 'sand') yNow = y;
      }
      if (yNow < 0 || yNow >= 62) break;
      speeds.push(yNow - prevY);
      prevY = yNow;
    }
    // Régime établi = médiane des 5 dernières vitesses (exclut le transitoire
    // d'entrée dans le milieu — la pénétration à pleine vitesse est physique).
    const last = speeds.slice(-5).sort((p, q) => p - q);
    const steady = last[Math.min(2, last.length - 1)] || 0;
    const ok = steady >= 1 && steady <= expectMax;
    console.log(`terminal (${label}) : vitesses/frame = [${speeds.join(', ')}] | régime établi = ${steady} (attendu 1..${expectMax}) ${ok ? 'OK' : 'ÉCHEC'}`);
  }
  measure(null, 'vide ', 8);
  measure('water', 'eau  ', 3);
}
