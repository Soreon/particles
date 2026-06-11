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

// --- 6. Lave : fige en pierre au contact de l'eau (+ vapeur) ---
{
  const sim = new Sim(64, 64, rule, 1);
  const rng = makeRng(46);
  sim.fillRect(0, 50, 63, 63, 'lava', rng);
  sim.fillRect(20, 20, 43, 30, 'water', rng);
  let steamSeen = 0;
  for (let f = 0; f < 300; f++) {
    sim.frame();
    steamSeen = Math.max(steamSeen, count(sim, 'steam'));
  }
  const stone = count(sim, 'stone');
  console.log(`lave : pierre formée = ${stone}, pic vapeur = ${steamSeen} ${stone > 20 && steamSeen > 3 ? 'OK (fige + vaporise)' : 'ÉCHEC'}`);
}

// --- 7. Glace : gèle l'eau adjacente, fond près du feu ---
{
  const sim = new Sim(64, 64, rule, 1);
  const rng = makeRng(47);
  sim.fillRect(0, 50, 63, 63, 'water', rng);
  sim.fillRect(28, 48, 35, 49, 'ice', rng); // glaçon posé sur l'eau
  const ice0 = count(sim, 'ice');
  for (let f = 0; f < 400; f++) sim.frame();
  const iceGrown = count(sim, 'ice');
  // Phase de fonte : on retire l'eau restante (le gel rampant s'arrête — on ne
  // mesure QUE la fonte), puis du feu ré-allumé directement AU CONTACT.
  for (let i = 0; i < sim.grid.length; i++) {
    if (NAME_OF[sim.grid[i]] === 'water') { sim.grid[i] = 0; sim.vy[i] = 0; sim.vx[i] = 0; sim.fl[i] = 0; }
  }
  for (let f = 0; f < 250; f++) {
    if (f % 20 === 0) {
      // nappe de feu posée sur la première cellule de glace de chaque colonne
      for (let x = 0; x < 64; x++) {
        for (let y = 1; y < 63; y++) {
          if (NAME_OF[sim.get(x, y + 1)] === 'ice' && sim.get(x, y) === 0) { sim.set(x, y, 160, 0); break; }
        }
      }
    }
    sim.frame();
  }
  const iceMelted = count(sim, 'ice');
  console.log(`glace : ${ice0} -> ${iceGrown} (gel rampant) -> ${iceMelted} après feu ${iceGrown > ice0 * 1.5 && iceMelted < iceGrown ? 'OK (gèle puis fond)' : 'ÉCHEC'}`);
}

// --- 8. Plante : boit l'eau pour pousser, puis brûle ---
{
  const sim = new Sim(64, 64, rule, 1);
  const rng = makeRng(48);
  sim.fillRect(0, 52, 63, 63, 'water', rng);
  sim.fillRect(30, 50, 33, 51, 'plant', rng); // bouture au bord de l'eau
  const plant0 = count(sim, 'plant');
  const water0 = count(sim, 'water');
  for (let f = 0; f < 500; f++) sim.frame();
  const plantGrown = count(sim, 'plant');
  const waterDrunk = water0 - count(sim, 'water');
  sim.fillRect(28, 40, 35, 49, 'fire', rng); // on y met le feu
  for (let f = 0; f < 400; f++) sim.frame();
  const plantBurned = count(sim, 'plant');
  console.log(`plante : ${plant0} -> ${plantGrown} (a bu ~${waterDrunk} d'eau) -> ${plantBurned} après feu ${plantGrown > plant0 * 2 && plantBurned < plantGrown ? 'OK (pousse puis brûle)' : 'ÉCHEC'}`);
}

// --- 9. Poudre : explose en chaîne avec souffle (éjections balistiques) ---
{
  const sim = new Sim(64, 64, rule, 1);
  const rng = makeRng(49);
  sim.fillRect(24, 56, 39, 63, 'powder', rng); // baril de poudre au sol
  sim.fillRect(24, 52, 39, 55, 'sand', rng);   // sable PAR-DESSUS (témoin de fontaine)
  sim.fillRect(10, 60, 23, 63, 'sand', rng);   // et à côté (témoin du souffle latéral)
  const powder0 = count(sim, 'powder');
  sim.fillRect(23, 59, 23, 59, 'fire', rng);   // étincelle sur le flanc
  let ejected = 0; // cellules en ascension balistique (sable/poudre soufflés)
  let burnFrames = 0;
  for (let f = 0; f < 200; f++) {
    sim.frame();
    if (count(sim, 'powder') > 0) burnFrames = f;
    let up = 0;
    for (let i = 0; i < sim.grid.length; i++) {
      if (sim.grid[i] !== 0 && (sim.vy[i] & 0x80) !== 0 && sim.grid[i] < 160) up++;
    }
    ejected = Math.max(ejected, up);
  }
  const powderLeft = count(sim, 'powder');
  console.log(`poudre : ${powder0} -> ${powderLeft} (consommée en ~${burnFrames}f), pic d'éjections balistiques = ${ejected} ${powderLeft === 0 && burnFrames < 60 && ejected > 10 ? 'OK (explosion + souffle)' : 'ÉCHEC'}`);
}
