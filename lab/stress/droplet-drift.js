// Reproduit la capture utilisateur : vue remplie d'alcool, gouttes d'huile
// peintes en haut. Les gouttes doivent couler VERTICALEMENT (pas en diagonale).
// On mesure la dérive horizontale du centroïde de l'huile pendant la chute,
// et le miroir : goutte d'alcool qui remonte dans l'huile.
// Usage : node lab/stress/droplet-drift.js <variant>

const path = require('path');
const { Sim, makeRng } = require('../automaton');
const { centroid, flatness } = require('../metrics');
const { NAME_OF } = require('../materials');

const variant = process.argv[2] || 'v6';
const rule = require(path.join('..', 'rules', variant + '.js'));

function run(label, fillMat, dropMat, dropY, expectSink) {
  const sim = new Sim(64, 64, rule, 1);
  const rng = makeRng(11);
  sim.fillRect(0, 0, 63, 63, fillMat, rng);
  sim.paintDisc(32, dropY, 3, dropMat, rng);

  // Dispersion horizontale : largeur (max-min x) des cellules du matériau.
  // Une goutte qui tombe droit garde ~son diamètre initial ; des jets en
  // diagonale font exploser la largeur.
  function spreadX() {
    let min = Infinity; let max = -Infinity;
    for (let y = 0; y < sim.h; y++) {
      for (let x = 0; x < sim.w; x++) {
        if (NAME_OF[sim.get(x, y)] === dropMat) { min = Math.min(min, x); max = Math.max(max, x); }
      }
    }
    return max - min + 1;
  }

  const start = centroid(sim, (id) => NAME_OF[id] === dropMat);
  const initialSpread = spreadX();
  let maxSpread = initialSpread;
  let maxDriftX = 0;
  let lastY = start.y;
  for (let f = 0; f < 120; f++) {
    sim.frame();
    const c = centroid(sim, (id) => NAME_OF[id] === dropMat);
    if (!c) break;
    maxDriftX = Math.max(maxDriftX, Math.abs(c.x - start.x));
    maxSpread = Math.max(maxSpread, spreadX());
    lastY = c.y;
  }
  const growth = maxSpread - initialSpread;
  console.log(`${label}: chute ${Math.abs(lastY - start.y).toFixed(0)} cases | largeur ${initialSpread} -> ${maxSpread} (croissance ${growth}) | dérive centroïde ${maxDriftX.toFixed(1)} ${growth <= 6 ? 'OK' : 'JETS DIAGONAUX'}`);
}

console.log(`=== ${variant} ===`);
run('huile coule dans alcool   ', 'alcool', 'oil', 8, true);
run('alcool remonte dans huile ', 'oil', 'alcool', 55, false);
