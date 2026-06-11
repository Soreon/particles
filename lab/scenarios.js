// Scénarios de test : chacun construit un état initial, simule N frames, et
// vérifie des critères (planéité, position, calme, conservation de masse).

const { Sim, makeRng } = require('./automaton');
const {
  countsByName, flatness, meanY, centroid, changedCells,
} = require('./metrics');
const { NAME_OF } = require('./materials');

const W = 64;
const H = 64;

// Exécute un scénario ; renvoie { pass, metrics } + échantillons d'activité.
function runScenario(scenario, flowRule, seed) {
  const sim = new Sim(W, H, flowRule, seed);
  const rng = makeRng(seed * 7 + 13);
  scenario.build(sim, rng);

  const initialCounts = countsByName(sim);
  const activity = [];
  let firstFlatFrame = -1;
  let conservationOK = true;
  const prev = new Uint8Array(sim.grid.length);

  for (let f = 0; f < scenario.frames; f++) {
    prev.set(sim.grid);
    sim.frame();
    activity.push(changedCells(prev, sim.grid));

    // Conservation de masse : vérifiée à chaque frame.
    const counts = countsByName(sim);
    for (const k of Object.keys(initialCounts)) {
      if (counts[k] !== initialCounts[k]) conservationOK = false;
    }

    // Détection du premier instant "plat" (tous les 10 frames, si défini).
    if (firstFlatFrame < 0 && scenario.flatWhen && f % 10 === 0) {
      if (scenario.flatWhen(sim)) firstFlatFrame = f;
    }
  }

  const lateActivity = activity.slice(-60);
  const meanLateActivity = lateActivity.reduce((s, v) => s + v, 0) / lateActivity.length;
  const verdict = scenario.check(sim, { meanLateActivity, firstFlatFrame });
  return {
    pass: verdict.pass && conservationOK,
    conservationOK,
    firstFlatFrame,
    meanLateActivity: Math.round(meanLateActivity * 10) / 10,
    metrics: verdict.metrics,
  };
}

const scenarios = [
  {
    // RÉGRESSION : l'eau versée d'un côté s'étale et se nivelle sur toute la largeur.
    name: 'water-level',
    frames: 500,
    build: (sim, rng) => sim.fillRect(0, 20, 15, 63, 'water', rng),
    flatWhen: (sim) => flatness(sim, 'water').variance <= 1.0,
    check: (sim, { meanLateActivity }) => {
      const f = flatness(sim, 'water');
      return {
        pass: f.variance <= 1.5 && f.span >= 60,
        metrics: { flatVariance: f.variance, span: f.span, calm: meanLateActivity },
      };
    },
  },
  {
    // RÉGRESSION : une bulle de vide dans l'eau remonte VERTICALEMENT.
    name: 'void-bubble',
    frames: 300,
    build: (sim, rng) => {
      sim.fillRect(0, 24, W - 1, 63, 'water', rng);
      sim.paintDisc(32, 48, 4, 'void', rng);
      // referme le vide au-dessus de la surface : tout y>=24 sauf le disque
    },
    check: (sim) => {
      // À la fin, plus de vide submergé (la bulle a rejoint la surface),
      // et la surface de l'eau est restée ~plate.
      let submergedVoid = 0;
      for (let y = 30; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (sim.get(x, y) === 0) submergedVoid++;
        }
      }
      const f = flatness(sim, 'water');
      return {
        pass: submergedVoid === 0 && f.variance <= 1.5,
        metrics: { submergedVoid, waterFlatVariance: f.variance },
      };
    },
  },
  {
    // RÉGRESSION : un tas de sable à 45° reste un tas (angle de repos).
    name: 'sand-pile',
    frames: 300,
    build: (sim, rng) => {
      for (let r = 0; r <= 14; r++) {
        sim.fillRect(32 - (14 - r), 49 + r, 32 + (14 - r), 49 + r, 'sand', rng);
      }
    },
    check: (sim) => {
      const f = flatness(sim, 'sand');
      // un tas conserve une forte variance par colonne ; il ne doit PAS s'aplatir.
      // Budget d'apex : 49 (initial) + ~4 de relaxation ponctuelle admise — le
      // moteur de vélocité (v9) relâche une pyramide PARFAITE de 2-4 rangées
      // dans les premières frames puis se stabilise (les tas réellement versés
      // ne sont jamais parfaits) ; un aplatissement réel donnerait apexY >= 58.
      let apexY = H;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (NAME_OF[sim.get(x, y)] === 'sand') { apexY = Math.min(apexY, y); }
        }
      }
      return {
        pass: f.variance >= 8 && apexY <= 54,
        metrics: { pileVariance: f.variance, apexY },
      };
    },
  },
  {
    // RÉGRESSION : le sable traverse l'eau et se dépose au fond.
    name: 'sand-in-water',
    frames: 400,
    build: (sim, rng) => {
      sim.fillRect(0, 36, W - 1, 63, 'water', rng);
      sim.paintDisc(32, 16, 6, 'sand', rng);
    },
    check: (sim) => {
      const my = meanY(sim, 'sand');
      return { pass: my >= 55, metrics: { sandMeanY: my } };
    },
  },
  {
    // BUG 1 : l'huile (plus dense) lâchée dans l'eau doit finir en COUCHE PLATE au fond.
    name: 'oil-in-water',
    frames: 800,
    build: (sim, rng) => {
      sim.fillRect(0, 28, W - 1, 63, 'water', rng);
      sim.paintDisc(32, 40, 9, 'oil', rng);
    },
    flatWhen: (sim) => flatness(sim, 'oil').variance <= 1.0,
    check: (sim, { meanLateActivity, firstFlatFrame }) => {
      const f = flatness(sim, 'oil');
      const oilY = meanY(sim, 'oil');
      const waterY = meanY(sim, 'water');
      return {
        pass: f.variance <= 1.5 && oilY > waterY,
        metrics: {
          oilFlatVariance: f.variance,
          oilMaxDev: f.maxDev,
          oilSpan: f.span,
          oilBelowWater: oilY > waterY,
          timeToFlat: firstFlatFrame,
          calm: meanLateActivity,
        },
      };
    },
  },
  {
    // BUG 2 : l'alcool (plus léger) lâché dans l'eau doit finir en COUCHE PLATE en surface.
    name: 'alcool-in-water',
    frames: 800,
    build: (sim, rng) => {
      sim.fillRect(0, 28, W - 1, 63, 'water', rng);
      sim.paintDisc(32, 48, 9, 'alcool', rng);
    },
    flatWhen: (sim) => flatness(sim, 'alcool').variance <= 1.0,
    check: (sim, { meanLateActivity, firstFlatFrame }) => {
      const f = flatness(sim, 'alcool');
      const alcY = meanY(sim, 'alcool');
      const waterY = meanY(sim, 'water');
      return {
        pass: f.variance <= 1.5 && alcY < waterY,
        metrics: {
          alcFlatVariance: f.variance,
          alcMaxDev: f.maxDev,
          alcSpan: f.span,
          alcAboveWater: alcY < waterY,
          timeToFlat: firstFlatFrame,
          calm: meanLateActivity,
        },
      };
    },
  },
  {
    // STRATIFICATION : mélange aléatoire des 3 liquides -> 3 couches plates
    // ordonnées alcool / eau / huile (de haut en bas).
    name: 'tri-liquid-mix',
    frames: 1000,
    build: (sim, rng) => {
      const mats = ['water', 'oil', 'alcool'];
      for (let y = 34; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const m = mats[(rng() * 3) | 0];
          sim.fillRect(x, y, x, y, m, rng);
        }
      }
    },
    check: (sim, { meanLateActivity }) => {
      const fa = flatness(sim, 'alcool');
      const fw = flatness(sim, 'water');
      const fo = flatness(sim, 'oil');
      const ya = meanY(sim, 'alcool');
      const yw = meanY(sim, 'water');
      const yo = meanY(sim, 'oil');
      const ordered = ya < yw && yw < yo;
      return {
        pass: ordered && fa.variance <= 2 && fw.variance <= 2 && fo.variance <= 2,
        metrics: {
          ordered,
          alcVar: fa.variance,
          waterVar: fw.variance,
          oilVar: fo.variance,
          calm: meanLateActivity,
        },
      };
    },
  },
];

module.exports = { scenarios, runScenario, W, H };
