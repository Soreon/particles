// Scénarios de l'écosystème de matériaux (pierre/bois/feu/fumée/vapeur).
// NB : les transformations brisent la conservation par conception — ces
// scénarios valident des bilans de TRANSFORMATION, pas la conservation.
// Usage : node lab/stress/materials-eco.js <variant>

const path = require('path');
const { Sim, makeRng } = require('../automaton');
const { NAME_OF } = require('../materials');

const variant = process.argv[2] || 'v11';
const rule = require(path.join('..', 'rules', variant + '.js'));

function count(sim, name) {
  let n = 0;
  for (let i = 0; i < sim.grid.length; i++) if (NAME_OF[sim.grid[i]] === name) n++;
  return n;
}

// --- 1. La pierre est immobile et retient les liquides (bassin) ---
{
  const sim = new Sim(64, 64, rule, 1);
  const rng = makeRng(41);
  // bassin en U : fond + parois jusqu'à mi-hauteur, ouvert au-dessus
  sim.fillRect(10, 50, 53, 52, 'stone', rng);
  sim.fillRect(10, 30, 12, 52, 'stone', rng);
  sim.fillRect(51, 30, 53, 52, 'stone', rng);
  sim.fillRect(20, 10, 43, 18, 'water', rng); // eau versée dedans
  const stone0 = count(sim, 'stone');
  for (let f = 0; f < 200; f++) sim.frame();
  const stone1 = count(sim, 'stone');
  // l'eau est-elle contenue ? (aucune eau sous le fond du bassin)
  let leaked = 0;
  for (let y = 53; y < 64; y++) for (let x = 0; x < 64; x++) if (NAME_OF[sim.get(x, y)] === 'water') leaked++;
  console.log(`pierre/bassin : pierre ${stone0}->${stone1} (immobile: ${stone0 === stone1 ? 'oui' : 'NON'}), eau échappée sous le bassin = ${leaked} ${stone0 === stone1 && leaked === 0 ? 'OK' : 'ÉCHEC'}`);
}

// --- 2. Le bois est un solide de construction : il reste où on le dessine ---
{
  const sim = new Sim(64, 64, rule, 1);
  const rng = makeRng(42);
  sim.fillRect(0, 30, 63, 32, 'wood', rng);  // plancher pleine largeur en plein air
  sim.fillRect(24, 10, 39, 16, 'water', rng); // eau versée dessus
  for (let f = 0; f < 150; f++) sim.frame();
  // le plancher n'a pas bougé d'une case et l'eau ne passe pas à travers
  let intact = 0; let moved = 0;
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      if (NAME_OF[sim.get(x, y)] === 'wood') {
        if (y >= 30 && y <= 32) intact++;
        else moved++;
      }
    }
  }
  let waterBelow = 0; // fuite à travers le bois (aucun contournement possible)
  for (let y = 33; y < 64; y++) for (let x = 0; x < 64; x++) if (NAME_OF[sim.get(x, y)] === 'water') waterBelow++;
  console.log(`bois rigide : ${intact} cellules en place, ${moved} déplacées, eau passée à travers = ${waterBelow} ${moved === 0 && waterBelow === 0 ? 'OK (solide de construction)' : 'ÉCHEC'}`);
}

// --- 3. Le feu brûle le bois (combustion + fumée), puis s'éteint ---
{
  const sim = new Sim(64, 64, rule, 1);
  const rng = makeRng(43);
  sim.fillRect(20, 56, 43, 63, 'wood', rng); // tas de bois au sol
  sim.fillRect(30, 54, 33, 55, 'fire', rng); // étincelle dessus
  const wood0 = count(sim, 'wood');
  let smokeSeen = 0; let fireSeen = 0;
  for (let f = 0; f < 600; f++) {
    sim.frame();
    smokeSeen = Math.max(smokeSeen, count(sim, 'smoke'));
    fireSeen = Math.max(fireSeen, count(sim, 'fire'));
  }
  const wood1 = count(sim, 'wood');
  const fireLeft = count(sim, 'fire');
  const burned = wood0 - wood1;
  const verdict3 = burned > wood0 * 0.5 && smokeSeen > 5 && fireLeft === 0 ? 'OK (brûle puis meurt)' : 'ÉCHEC';
  console.log(`combustion : bois ${wood0}->${wood1} (brûlé ${burned}), pic feu ${fireSeen}, pic fumée ${smokeSeen}, feu restant ${fireLeft} ${verdict3}`);
}

// --- 4. L'eau éteint le feu ; eau + feu -> vapeur -> pluie ---
{
  const sim = new Sim(64, 64, rule, 1);
  const rng = makeRng(44);
  sim.fillRect(20, 60, 43, 63, 'fire', rng);  // braises au sol
  sim.fillRect(24, 20, 39, 30, 'water', rng); // eau lâchée dessus
  let steamSeen = 0;
  for (let f = 0; f < 300; f++) {
    sim.frame();
    steamSeen = Math.max(steamSeen, count(sim, 'steam'));
  }
  const fireLeft = count(sim, 'fire');
  const waterLeft = count(sim, 'water');
  console.log(`extinction : feu restant ${fireLeft}, pic vapeur ${steamSeen}, eau restante ${waterLeft} ${fireLeft === 0 && steamSeen > 3 ? 'OK (éteint + vapeur)' : 'ÉCHEC'}`);
}

// --- 5. La fumée monte et se dissipe ; la vapeur retombe en pluie ---
{
  const sim = new Sim(64, 64, rule, 1);
  const rng = makeRng(45);
  sim.fillRect(28, 56, 35, 60, 'smoke', rng);
  sim.fillRect(28, 61, 35, 63, 'steam', rng);
  const steam0 = count(sim, 'steam');
  let topSmoke = 0; // de la fumée vue dans le tiers haut = elle monte
  let rained = 0;
  for (let f = 0; f < 400; f++) {
    sim.frame();
    for (let y = 0; y < 20; y++) for (let x = 0; x < 64; x++) {
      if (NAME_OF[sim.get(x, y)] === 'smoke') topSmoke++;
    }
    rained = Math.max(rained, count(sim, 'water'));
  }
  const smokeLeft = count(sim, 'smoke');
  const steamLeft = count(sim, 'steam');
  console.log(`gaz : fumée vue en haut ${topSmoke > 0 ? 'oui' : 'NON'}, dissipée (${smokeLeft} restante), vapeur ${steam0}->${steamLeft}, pluie max ${rained} cellules ${topSmoke > 0 && smokeLeft === 0 && rained > 0 ? 'OK (cycle complet)' : 'ÉCHEC'}`);
}
