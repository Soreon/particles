// Configurations de stress pour la chasse aux oscillations / livelocks (règle v1).
//
// Chaque config :
//   name          : identifiant
//   frames        : durée du run (>= 2000 pour les chasses au livelock)
//   build(sim,rng): construit l'état initial
//   track         : [{ material, target }] cibles de variance de planéité finales
//   check(sim)    : critères additionnels (ordre des couches, position) -> { ok, metrics }
//   expectTotallyQuiet  : true si AUCUNE activité n'est légitime (état déjà à l'équilibre)
//   expectEventualQuiet : true si l'activité doit atteindre 0 avant la fin du run
//
// Le budget d'activité résiduelle admis est calculé par le runner à partir du
// nombre de cellules "défaut" (masse hors lignes pleines : count mod W), car
// seules les lignes d'interface partielles peuvent scintiller indéfiniment.

const { meanY } = require('../metrics');

const W = 64;
const H = 64;

function checker(sim, rng, matA, matB, y0, y1) {
  for (let y = y0; y <= y1; y++) {
    for (let x = 0; x < W; x++) {
      sim.fillRect(x, y, x, y, ((x + y) & 1) ? matA : matB, rng);
    }
  }
}

function stripes(sim, rng, matA, matB, y0, y1) {
  for (let x = 0; x < W; x++) {
    sim.fillRect(x, y0, x, y1, (x & 1) ? matA : matB, rng);
  }
}

const configs = [
  {
    name: 'pre-stratified-quiet',
    frames: 2000,
    notes: 'Tri-couche déjà plate (alcool/eau/huile). Toute activité est parasite.',
    build: (sim, rng) => {
      sim.fillRect(0, 28, W - 1, 39, 'alcool', rng);
      sim.fillRect(0, 40, W - 1, 51, 'water', rng);
      sim.fillRect(0, 52, W - 1, 63, 'oil', rng);
    },
    track: [
      { material: 'alcool', target: 0.5 },
      { material: 'water', target: 0.5 },
      { material: 'oil', target: 0.5 },
    ],
    expectTotallyQuiet: true,
  },
  {
    name: 'bump-oil-water',
    frames: 2000,
    notes: 'Interface huile(fond)/eau plate + 1 bosse d\'huile. 1 marcheur résiduel attendu.',
    build: (sim, rng) => {
      sim.fillRect(0, 28, W - 1, 47, 'water', rng);
      sim.fillRect(0, 48, W - 1, 63, 'oil', rng);
      sim.fillRect(32, 47, 32, 47, 'oil', rng); // bosse : huile au-dessus de l'interface
    },
    track: [{ material: 'oil', target: 1.0 }, { material: 'water', target: 1.0 }],
  },
  {
    name: 'bump-dent-oil-water',
    frames: 2000,
    notes: 'Bosse (huile) + creux (eau) sur l\'interface huile/eau : annihilation -> calme total.',
    build: (sim, rng) => {
      sim.fillRect(0, 28, W - 1, 47, 'water', rng);
      sim.fillRect(0, 48, W - 1, 63, 'oil', rng);
      sim.fillRect(44, 47, 44, 47, 'oil', rng);   // bosse
      sim.fillRect(20, 48, 20, 48, 'water', rng); // creux
    },
    track: [{ material: 'oil', target: 0.25 }, { material: 'water', target: 0.25 }],
    expectEventualQuiet: true,
  },
  {
    name: 'bump-alcool-water',
    frames: 2000,
    notes: 'Interface alcool(haut)/eau plate + 1 bosse d\'eau dans l\'alcool. 1 marcheur attendu.',
    build: (sim, rng) => {
      sim.fillRect(0, 28, W - 1, 39, 'alcool', rng);
      sim.fillRect(0, 40, W - 1, 63, 'water', rng);
      sim.fillRect(32, 39, 32, 39, 'water', rng); // bosse : eau au-dessus de l'interface
    },
    track: [{ material: 'alcool', target: 1.0 }, { material: 'water', target: 1.0 }],
  },
  {
    name: 'bump-dent-alcool-water',
    frames: 2000,
    notes: 'Bosse (eau dans alcool) + creux (alcool dans eau) : annihilation -> calme total.',
    build: (sim, rng) => {
      sim.fillRect(0, 28, W - 1, 39, 'alcool', rng);
      sim.fillRect(0, 40, W - 1, 63, 'water', rng);
      sim.fillRect(44, 39, 44, 39, 'water', rng);  // bosse
      sim.fillRect(20, 40, 20, 40, 'alcool', rng); // creux
    },
    track: [{ material: 'alcool', target: 0.25 }, { material: 'water', target: 0.25 }],
    expectEventualQuiet: true,
  },
  {
    name: 'checker-water-oil',
    frames: 3000,
    notes: 'Damier eau/huile 1x1 sur 32 lignes : stratification complète attendue.',
    build: (sim, rng) => checker(sim, rng, 'water', 'oil', 32, 63),
    track: [{ material: 'water', target: 1.5 }, { material: 'oil', target: 1.5 }],
    check: (sim) => {
      const yw = meanY(sim, 'water');
      const yo = meanY(sim, 'oil');
      return { ok: yo > yw, metrics: { waterMeanY: yw, oilMeanY: yo, ordered: yo > yw } };
    },
  },
  {
    name: 'checker-water-alcool',
    frames: 3000,
    notes: 'Damier eau/alcool 1x1 sur 32 lignes : alcool au-dessus attendu.',
    build: (sim, rng) => checker(sim, rng, 'water', 'alcool', 32, 63),
    track: [{ material: 'water', target: 1.5 }, { material: 'alcool', target: 1.5 }],
    check: (sim) => {
      const yw = meanY(sim, 'water');
      const ya = meanY(sim, 'alcool');
      return { ok: ya < yw, metrics: { waterMeanY: yw, alcMeanY: ya, ordered: ya < yw } };
    },
  },
  {
    name: 'checker-oil-alcool',
    frames: 3000,
    notes: 'Damier huile/alcool 1x1 sur 32 lignes : alcool au-dessus attendu.',
    build: (sim, rng) => checker(sim, rng, 'oil', 'alcool', 32, 63),
    track: [{ material: 'oil', target: 1.5 }, { material: 'alcool', target: 1.5 }],
    check: (sim) => {
      const yo = meanY(sim, 'oil');
      const ya = meanY(sim, 'alcool');
      return { ok: ya < yo, metrics: { oilMeanY: yo, alcMeanY: ya, ordered: ya < yo } };
    },
  },
  {
    name: 'stripes-water-oil',
    frames: 3000,
    notes: 'Colonnes alternées eau/huile (32 lignes) : stratification complète attendue.',
    build: (sim, rng) => stripes(sim, rng, 'water', 'oil', 32, 63),
    track: [{ material: 'water', target: 1.5 }, { material: 'oil', target: 1.5 }],
    check: (sim) => {
      const yw = meanY(sim, 'water');
      const yo = meanY(sim, 'oil');
      return { ok: yo > yw, metrics: { waterMeanY: yw, oilMeanY: yo, ordered: yo > yw } };
    },
  },
  {
    name: 'thin-alcool-sandwich',
    frames: 2000,
    notes: 'Couche d\'alcool de 1 cellule entre deux couches d\'eau : doit remonter en couche plate.',
    build: (sim, rng) => {
      sim.fillRect(0, 28, W - 1, 45, 'water', rng);
      sim.fillRect(0, 46, W - 1, 46, 'alcool', rng);
      sim.fillRect(0, 47, W - 1, 63, 'water', rng);
    },
    track: [{ material: 'alcool', target: 0.5 }, { material: 'water', target: 1.0 }],
    check: (sim) => {
      const ya = meanY(sim, 'alcool');
      const yw = meanY(sim, 'water');
      return { ok: ya < yw && ya <= 29, metrics: { alcMeanY: ya, waterMeanY: yw } };
    },
  },
  {
    name: 'oil-drop-1-on-interface',
    frames: 2000,
    notes: 'Goutte d\'huile (1 cellule) posée sur l\'interface eau/alcool : doit couler au fond.',
    build: (sim, rng) => {
      sim.fillRect(0, 28, W - 1, 39, 'alcool', rng);
      sim.fillRect(0, 40, W - 1, 63, 'water', rng);
      sim.fillRect(32, 39, 32, 39, 'oil', rng); // la goutte remplace 1 cellule d'alcool
    },
    track: [{ material: 'alcool', target: 1.0 }, { material: 'water', target: 1.0 }],
    check: (sim) => {
      const yo = meanY(sim, 'oil');
      return { ok: yo >= 62.5, metrics: { oilMeanY: yo } };
    },
  },
  {
    name: 'oil-drop-13-on-interface',
    frames: 2000,
    notes: 'Goutte d\'huile (disque r=2, 13 cellules) sur l\'interface eau/alcool.',
    build: (sim, rng) => {
      sim.fillRect(0, 28, W - 1, 39, 'alcool', rng);
      sim.fillRect(0, 40, W - 1, 63, 'water', rng);
      sim.paintDisc(32, 40, 2, 'oil', rng);
    },
    track: [{ material: 'alcool', target: 1.0 }, { material: 'water', target: 1.0 }],
    check: (sim) => {
      const yo = meanY(sim, 'oil');
      return { ok: yo >= 62.5, metrics: { oilMeanY: yo } };
    },
  },
  {
    name: 'ridge2-dent2-oil-water',
    frames: 2000,
    notes: 'Crête d\'huile 2-haute + 2 creux d\'eau sur l\'interface huile/eau : annihilation totale attendue.',
    build: (sim, rng) => {
      sim.fillRect(0, 28, W - 1, 47, 'water', rng);
      sim.fillRect(0, 48, W - 1, 63, 'oil', rng);
      sim.fillRect(40, 46, 40, 47, 'oil', rng);   // crête 2-haute
      sim.fillRect(20, 48, 21, 48, 'water', rng); // 2 creux
    },
    track: [{ material: 'oil', target: 0.25 }, { material: 'water', target: 0.25 }],
    expectEventualQuiet: true,
  },
  {
    name: 'thin-oil-film-on-top',
    frames: 2000,
    notes: 'Film d\'huile de 1 cellule posé SUR l\'eau : doit couler et tapisser le fond en couche pleine -> calme total.',
    build: (sim, rng) => {
      sim.fillRect(0, 28, W - 1, 28, 'oil', rng);
      sim.fillRect(0, 29, W - 1, 63, 'water', rng);
    },
    track: [{ material: 'oil', target: 0.5 }, { material: 'water', target: 0.5 }],
    check: (sim) => {
      const yo = meanY(sim, 'oil');
      const yw = meanY(sim, 'water');
      return { ok: yo > yw && yo >= 62.5, metrics: { oilMeanY: yo, waterMeanY: yw } };
    },
    expectEventualQuiet: true,
  },
  {
    name: 'tri-liquid-mix-long',
    frames: 3000,
    notes: 'Reprise du scénario tri-liquid-mix sur 3000 frames : l\'activité tardive ~50 vue à 1000 frames doit décroître.',
    build: (sim, rng) => {
      const mats = ['water', 'oil', 'alcool'];
      for (let y = 34; y < H; y++) {
        for (let x = 0; x < W; x++) {
          sim.fillRect(x, y, x, y, mats[(rng() * 3) | 0], rng);
        }
      }
    },
    track: [
      { material: 'alcool', target: 2.0 },
      { material: 'water', target: 2.0 },
      { material: 'oil', target: 2.0 },
    ],
    check: (sim) => {
      const ya = meanY(sim, 'alcool');
      const yw = meanY(sim, 'water');
      const yo = meanY(sim, 'oil');
      return { ok: ya < yw && yw < yo, metrics: { alcMeanY: ya, waterMeanY: yw, oilMeanY: yo } };
    },
  },
];

module.exports = { configs, W, H };
