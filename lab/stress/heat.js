// Scénarios du moteur thermique (v12).
// Usage : node lab/stress/heat.js <variant>

const path = require('path');
const { Sim, makeRng } = require('../automaton');
const { NAME_OF } = require('../materials');

const variant = process.argv[2] || 'v12';
const rule = require(path.join('..', 'rules', variant + '.js'));

function count(sim, name) {
  let n = 0;
  for (let i = 0; i < sim.grid.length; i++) if (NAME_OF[sim.grid[i]] === name) n++;
  return n;
}

// --- 1. LE scénario utilisateur : lave + eau -> croûte PROGRESSIVE + vapeur continue ---
{
  const sim = new Sim(64, 64, rule, 1);
  const rng = makeRng(51);
  sim.fillRect(0, 40, 63, 63, 'lava', rng);  // mer de lave
  sim.fillRect(0, 20, 63, 35, 'water', rng); // océan d'eau au-dessus
  const crustAt = [];
  let steamPeak = 0;
  let steamSum = 0;
  let hotStone = 0; // pierre au-dessus de 100 degrés (fait bouillir l'eau)
  for (let f = 0; f < 600; f++) {
    sim.frame();
    if (f === 30 || f === 150 || f === 580) crustAt.push(count(sim, 'stone'));
    const sNow = count(sim, 'steam');
    steamPeak = Math.max(steamPeak, sNow);
    steamSum += sNow;
    if (f === 60) {
      for (let i = 0; i < sim.grid.length; i++) {
        if (NAME_OF[sim.grid[i]] === 'stone' && sim.fl[i] > 100) hotStone++;
      }
    }
  }
  const growing = crustAt[0] > 0 && crustAt[1] > crustAt[0] && crustAt[2] >= crustAt[1];
  console.log(`croûte lave/eau : pierre à f30/f150/f580 = ${crustAt.join('/')}, pierre BRÛLANTE (>100°) à f60 = ${hotStone}, vapeur cumulée = ${steamSum} ${growing && hotStone > 50 && steamSum > 25 ? 'OK (croûte progressive + chaude)' : 'ÉCHEC'}`);
}

// --- 2. La pierre fond au contact prolongé de la lave ---
{
  const sim = new Sim(64, 64, rule, 1);
  const rng = makeRng(52);
  sim.fillRect(0, 30, 63, 63, 'lava', rng);   // grand réservoir de lave
  sim.fillRect(24, 42, 39, 47, 'stone', rng); // bloc de pierre IMMERGÉ dedans
  const stone0 = count(sim, 'stone');
  for (let f = 0; f < 900; f++) sim.frame();
  // on ne compte que la zone du bloc immergé (la surface du lac peut croûter)
  let stone1 = 0;
  for (let y = 40; y <= 49; y++) for (let x = 22; x <= 41; x++) if (NAME_OF[sim.get(x, y)] === 'stone') stone1++;
  console.log(`pierre fond : ${stone0} -> ${stone1} cellules de pierre ${stone1 < stone0 * 0.7 ? 'OK (la lave la digère)' : 'ÉCHEC'}`);
}

// --- 3. Convection : la chaleur monte PAR L'AIR et fait fondre un plafond de glace ---
{
  const sim = new Sim(64, 64, rule, 1);
  const rng = makeRng(53);
  sim.fillRect(0, 56, 63, 63, 'lava', rng); // lave au sol
  sim.fillRect(0, 16, 63, 20, 'ice', rng);  // plafond de glace, ~35 cases d'AIR entre les deux
  const ice0 = count(sim, 'ice');
  let meltStart = -1;
  let ceilT = 0;
  for (let f = 0; f < 900; f++) {
    sim.frame();
    if (meltStart < 0 && count(sim, 'ice') < ice0) meltStart = f;
    for (let x = 0; x < 64; x++) ceilT = Math.max(ceilT, sim.fl[21 * 64 + x]);
  }
  const delivered = ceilT >= 40;
  const v3 = delivered && meltStart >= 0 ? 'OK (la convection livre la chaleur)' : 'ÉCHEC';
  console.log(`convection : air sous plafond chauffé à ${ceilT}° (ambiant 32) à travers ~35 cases, fonte amorcée à f${meltStart} ${v3}`);
}

// --- 4. Banquise auto-limitée : un glaçon gèle l'eau autour... jusqu'à épuiser son froid ---
{
  const sim = new Sim(64, 64, rule, 1);
  const rng = makeRng(54);
  sim.fillRect(0, 40, 63, 63, 'water', rng); // grand bassin
  sim.fillRect(28, 38, 35, 39, 'ice', rng);  // petit glaçon posé dessus
  const ice0 = count(sim, 'ice');
  let iceMax = ice0;
  for (let f = 0; f < 800; f++) {
    sim.frame();
    iceMax = Math.max(iceMax, count(sim, 'ice'));
  }
  const iceEnd = count(sim, 'ice');
  const waterLeft = count(sim, 'water');
  const grew = iceMax > ice0 * 1.5;
  const bounded = waterLeft > 500; // il reste BEAUCOUP d'eau (pas de gel infini)
  const v4 = grew && bounded ? 'OK (gèle puis épuise son froid)' : 'ÉCHEC';
  console.log(`banquise : glaçon ${ice0} -> pic ${iceMax} -> fin ${iceEnd}, eau restante ${waterLeft} ${v4}`);
}

// --- 5. Ignition à distance : l'air chauffé par un brasier embrase l'alcool voisin ---
{
  const sim = new Sim(64, 64, rule, 1);
  const rng = makeRng(55);
  sim.fillRect(10, 58, 25, 63, 'lava', rng);    // brasier (lave persistante)
  sim.fillRect(32, 60, 50, 63, 'alcool', rng);  // flaque d'alcool à 6 cases d'air
  let ignited = -1;
  for (let f = 0; f < 800; f++) {
    sim.frame();
    if (count(sim, 'fire') > 3 && ignited < 0) { ignited = f; break; }
  }
  console.log(`ignition à distance : alcool embrasé ${ignited >= 0 ? 'à f' + ignited : 'jamais'} (sans contact direct) ${ignited >= 0 ? 'OK' : 'ÉCHEC'}`);
}

// --- 6. Condensation thermique : la vapeur se condense en montant (refroidie) ---
{
  const sim = new Sim(64, 64, rule, 1);
  const rng = makeRng(56);
  sim.fillRect(24, 56, 39, 63, 'steam', rng);
  let rained = 0;
  for (let f = 0; f < 500; f++) {
    sim.frame();
    rained = Math.max(rained, count(sim, 'water'));
  }
  console.log(`condensation : pluie max = ${rained} cellules d'eau ${rained > 5 ? 'OK (la vapeur refroidit et pleut)' : 'ÉCHEC'}`);
}

// --- 7. Un feu de camp ne fait PAS fondre la pierre (seuils corrects) ---
{
  const sim = new Sim(64, 64, rule, 1);
  const rng = makeRng(57);
  sim.fillRect(20, 56, 43, 63, 'stone', rng); // âtre en pierre
  sim.fillRect(28, 52, 35, 55, 'wood', rng);  // bûches
  sim.fillRect(30, 51, 33, 51, 'fire', rng);  // allumage
  const stone0 = count(sim, 'stone');
  for (let f = 0; f < 500; f++) sim.frame();
  const lavaMade = count(sim, 'lava');
  const stone1 = count(sim, 'stone');
  console.log(`feu de camp : pierre ${stone0} -> ${stone1}, lave créée = ${lavaMade} ${lavaMade === 0 && stone1 === stone0 ? 'OK (le feu ne fond pas la pierre)' : 'ÉCHEC'}`);
}

// --- 8. Les gaz NAPPENT les plafonds (nivellement inversé, pas de tours) ---
{
  const sim = new Sim(64, 64, rule, 1);
  const rng = makeRng(58);
  sim.fillRect(8, 20, 55, 22, 'stone', rng); // plafond de pierre
  sim.fillRect(0, 58, 63, 63, 'lava', rng);  // lave : production continue de fumée
  let aspect = 99;
  for (let f = 0; f < 500; f++) sim.frame();
  // forme du nuage de fumée sous le plafond : large et plat, pas une tour
  let minX = 64; let maxX = -1; let minY = 64; let maxY = -1; let n = 0;
  for (let y = 23; y < 45; y++) {
    for (let x = 0; x < 64; x++) {
      if (NAME_OF[sim.get(x, y)] === 'smoke') {
        n++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  aspect = n > 10 ? height / width : 99;
  const v8r = n > 10 && aspect < 0.6 ? 'OK (nappe sous plafond)' : 'ÉCHEC (tour inversée)';
  console.log(`gaz/plafond : nuage ${n} cellules, ${width}x${height} (aspect ${aspect.toFixed(2)}) ${v8r}`);
}

// --- 9. La lave en CHUTE ne fige jamais en vol (pas de pierre lévitante) ---
{
  const sim = new Sim(64, 64, rule, 1);
  const rng = makeRng(59);
  // versement continu de lave depuis le haut, longue chute dans l'air
  for (let f = 0; f < 120; f++) {
    sim.paintDisc(32, 4, 2, 'lava', rng);
    sim.frame();
  }
  for (let f = 0; f < 100; f++) sim.frame();
  // aucune pierre suspendue : toute pierre doit avoir du soutien sous elle
  let floating = 0;
  for (let y = 0; y < 62; y++) {
    for (let x = 0; x < 64; x++) {
      if (NAME_OF[sim.get(x, y)] === 'stone' && sim.get(x, y + 1) === 0) floating++;
    }
  }
  const arrived = count(sim, 'lava') + count(sim, 'stone');
  console.log(`lave en chute : ${arrived} cellules arrivées, pierre suspendue = ${floating} ${floating === 0 && arrived > 100 ? 'OK (pas de lévitation)' : 'ÉCHEC'}`);
}
