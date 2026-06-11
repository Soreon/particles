// Cas limites pour la règle v1. Densités : alcool 4 < eau 5 < huile 6 < sable 10.
// Ordre stable attendu (haut -> bas) : alcool / eau / huile / sable.

const {
  submergedVoid, hangingMatter, surfaceVariance, liquidUnderSand, fillVoid,
  flatness, meanY, NAME_OF, MATERIAL_IDS,
} = require('./harness');

const cases = [];

// =====================================================================
// 1. Blobs collés aux bords / coins / fond
// =====================================================================

cases.push({
  name: 'corner-blob-bottom-left',
  w: 64, h: 64, frames: 400,
  build: (sim, rng) => sim.paintDisc(2, 58, 6, 'water', rng), // déborde mur gauche + fond
  check: (sim, { meanLateActivity }) => {
    const f = flatness(sim, 'water');
    return {
      pass: f.variance <= 1.5 && submergedVoid(sim) === 0 && hangingMatter(sim) <= 2,
      metrics: { flatVariance: f.variance, span: f.span, submergedVoid: submergedVoid(sim), hanging: hangingMatter(sim), calm: meanLateActivity },
    };
  },
});

cases.push({
  name: 'corner-blob-bottom-right',
  w: 64, h: 64, frames: 400,
  build: (sim, rng) => sim.paintDisc(61, 61, 6, 'oil', rng), // déborde mur droit + fond
  check: (sim, { meanLateActivity }) => {
    const f = flatness(sim, 'oil');
    return {
      pass: f.variance <= 1.5 && submergedVoid(sim) === 0 && hangingMatter(sim) <= 2,
      metrics: { flatVariance: f.variance, span: f.span, submergedVoid: submergedVoid(sim), hanging: hangingMatter(sim), calm: meanLateActivity },
    };
  },
});

cases.push({
  name: 'top-edge-blob-falls',
  w: 64, h: 64, frames: 400,
  build: (sim, rng) => sim.paintDisc(32, 2, 5, 'alcool', rng), // tronqué par le bord haut
  check: (sim, { meanLateActivity }) => {
    const f = flatness(sim, 'alcool');
    const my = meanY(sim, 'alcool');
    return {
      pass: f.variance <= 1.5 && my >= 60 && submergedVoid(sim) === 0,
      metrics: { flatVariance: f.variance, meanY: my, submergedVoid: submergedVoid(sim), calm: meanLateActivity },
    };
  },
});

cases.push({
  name: 'wall-column-full-height',
  w: 64, h: 64, frames: 600,
  // colonne d'eau de 2 de large collée au mur gauche, pleine hauteur -> 2 lignes plates
  build: (sim, rng) => sim.fillRect(0, 0, 1, 63, 'water', rng),
  check: (sim, { meanLateActivity }) => {
    const f = flatness(sim, 'water');
    return {
      pass: f.variance <= 1.0 && f.span >= 60 && submergedVoid(sim) === 0,
      metrics: { flatVariance: f.variance, span: f.span, submergedVoid: submergedVoid(sim), calm: meanLateActivity },
    };
  },
});

cases.push({
  name: 'full-grid-no-void-tri-mix',
  w: 64, h: 64, frames: 1500,
  // grille 100% pleine (aucun vide) : stratification sans aide de la règle A
  build: (sim, rng) => {
    const mats = ['water', 'oil', 'alcool'];
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        sim.fillRect(x, y, x, y, mats[(rng() * 3) | 0], rng);
      }
    }
  },
  check: (sim, { meanLateActivity }) => {
    const ya = meanY(sim, 'alcool'); const yw = meanY(sim, 'water'); const yo = meanY(sim, 'oil');
    const fa = flatness(sim, 'alcool'); const fw = flatness(sim, 'water'); const fo = flatness(sim, 'oil');
    return {
      pass: ya < yw && yw < yo && fa.variance <= 3 && fw.variance <= 3 && fo.variance <= 3,
      metrics: { ya, yw, yo, alcVar: fa.variance, waterVar: fw.variance, oilVar: fo.variance, calm: meanLateActivity },
    };
  },
});

// =====================================================================
// 2. Petites grilles et grilles non carrées
// =====================================================================

cases.push({
  name: 'tiny-8x8-level',
  w: 8, h: 8, frames: 300,
  build: (sim, rng) => sim.fillRect(0, 2, 3, 7, 'water', rng), // moitié gauche -> 3 lignes
  check: (sim, { meanLateActivity }) => {
    const f = flatness(sim, 'water');
    return {
      pass: f.variance <= 1.0 && f.span >= 7 && submergedVoid(sim) === 0,
      metrics: { flatVariance: f.variance, span: f.span, calm: meanLateActivity },
    };
  },
});

cases.push({
  name: 'tiny-8x8-single-column',
  w: 8, h: 8, frames: 300,
  build: (sim, rng) => sim.fillRect(0, 0, 0, 7, 'water', rng), // 8 cellules -> 1 ligne
  check: (sim, { meanLateActivity }) => {
    const f = flatness(sim, 'water');
    return {
      pass: f.variance <= 0.5 && f.span === 8,
      metrics: { flatVariance: f.variance, span: f.span, calm: meanLateActivity },
    };
  },
});

cases.push({
  name: 'tiny-8x8-bilayer-inverted',
  w: 8, h: 8, frames: 300,
  build: (sim, rng) => {
    sim.fillRect(0, 4, 7, 5, 'oil', rng);   // huile au-dessus
    sim.fillRect(0, 6, 7, 7, 'water', rng); // eau en dessous -> doit s'inverser
  },
  check: (sim, { meanLateActivity }) => {
    const yw = meanY(sim, 'water'); const yo = meanY(sim, 'oil');
    const fw = flatness(sim, 'water'); const fo = flatness(sim, 'oil');
    return {
      pass: yo > yw && fw.variance <= 1.0 && fo.variance <= 1.0,
      metrics: { yw, yo, waterVar: fw.variance, oilVar: fo.variance, calm: meanLateActivity },
    };
  },
});

cases.push({
  name: 'small-16x16-tri-mix',
  w: 16, h: 16, frames: 800,
  build: (sim, rng) => {
    const mats = ['water', 'oil', 'alcool'];
    for (let y = 8; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        sim.fillRect(x, y, x, y, mats[(rng() * 3) | 0], rng);
      }
    }
  },
  check: (sim, { meanLateActivity }) => {
    const ya = meanY(sim, 'alcool'); const yw = meanY(sim, 'water'); const yo = meanY(sim, 'oil');
    const fa = flatness(sim, 'alcool'); const fw = flatness(sim, 'water'); const fo = flatness(sim, 'oil');
    return {
      pass: ya < yw && yw < yo && fa.variance <= 2.5 && fw.variance <= 2.5 && fo.variance <= 2.5,
      metrics: { ya, yw, yo, alcVar: fa.variance, waterVar: fw.variance, oilVar: fo.variance, calm: meanLateActivity },
    };
  },
});

cases.push({
  name: 'tall-32x96-inverted-stack',
  w: 32, h: 96, frames: 1500,
  build: (sim, rng) => {
    sim.fillRect(0, 66, 31, 75, 'oil', rng);    // huile en haut (la plus dense)
    sim.fillRect(0, 76, 31, 85, 'water', rng);  // eau au milieu
    sim.fillRect(0, 86, 31, 95, 'alcool', rng); // alcool au fond (le plus léger)
  },
  check: (sim, { meanLateActivity }) => {
    const ya = meanY(sim, 'alcool'); const yw = meanY(sim, 'water'); const yo = meanY(sim, 'oil');
    const fa = flatness(sim, 'alcool'); const fw = flatness(sim, 'water'); const fo = flatness(sim, 'oil');
    return {
      pass: ya < yw && yw < yo && fa.variance <= 2 && fw.variance <= 2 && fo.variance <= 2,
      metrics: { ya, yw, yo, alcVar: fa.variance, waterVar: fw.variance, oilVar: fo.variance, calm: meanLateActivity },
    };
  },
});

cases.push({
  name: 'wide-96x32-spread',
  w: 96, h: 32, frames: 800,
  build: (sim, rng) => sim.fillRect(0, 8, 23, 31, 'water', rng), // bloc à gauche -> 6 lignes sur 96
  check: (sim, { meanLateActivity }) => {
    const f = flatness(sim, 'water');
    return {
      pass: f.variance <= 1.5 && f.span >= 90 && submergedVoid(sim) === 0,
      metrics: { flatVariance: f.variance, span: f.span, calm: meanLateActivity },
    };
  },
});

// =====================================================================
// 3. Couches minces (1-2 cellules)
// =====================================================================

// Couche mince INVERSÉE posée SUR un bloc : le mince (plus dense) doit couler au fond.
function thinOnTop(name, thinMat, blockMat, rows) {
  cases.push({
    name,
    w: 64, h: 64, frames: 600,
    build: (sim, rng) => {
      sim.fillRect(0, 40, 63, 63, blockMat, rng);
      sim.fillRect(0, 40 - rows, 63, 39, thinMat, rng);
    },
    check: (sim, { meanLateActivity }) => {
      const yThin = meanY(sim, thinMat); const yBlock = meanY(sim, blockMat);
      const fThin = flatness(sim, thinMat); const fBlock = flatness(sim, blockMat);
      return {
        pass: yThin > yBlock && fThin.variance <= 1.0 && fBlock.variance <= 1.0 && fThin.span >= 60,
        metrics: { yThin, yBlock, thinVar: fThin.variance, blockVar: fBlock.variance, thinSpan: fThin.span, calm: meanLateActivity },
      };
    },
  });
}
thinOnTop('thin1-oil-on-water', 'oil', 'water', 1);
thinOnTop('thin2-oil-on-water', 'oil', 'water', 2);
thinOnTop('thin1-water-on-alcool', 'water', 'alcool', 1);
thinOnTop('thin1-oil-on-alcool', 'oil', 'alcool', 1);

// Couche mince INVERSÉE glissée SOUS un bloc, contre le fond : le mince (plus léger)
// doit remonter à la surface (teste le bord bas : densBelow hors-grille = 255).
function thinUnder(name, thinMat, blockMat, rows) {
  cases.push({
    name,
    w: 64, h: 64, frames: 600,
    build: (sim, rng) => {
      sim.fillRect(0, 40, 63, 63 - rows, blockMat, rng);
      sim.fillRect(0, 64 - rows, 63, 63, thinMat, rng);
    },
    check: (sim, { meanLateActivity }) => {
      const yThin = meanY(sim, thinMat); const yBlock = meanY(sim, blockMat);
      const fThin = flatness(sim, thinMat); const fBlock = flatness(sim, blockMat);
      return {
        pass: yThin < yBlock && fThin.variance <= 1.0 && fBlock.variance <= 1.0 && fThin.span >= 60,
        metrics: { yThin, yBlock, thinVar: fThin.variance, blockVar: fBlock.variance, thinSpan: fThin.span, calm: meanLateActivity },
      };
    },
  });
}
thinUnder('thin1-alcool-under-water', 'alcool', 'water', 1);
thinUnder('thin2-alcool-under-water', 'alcool', 'water', 2);
thinUnder('thin1-water-under-oil', 'water', 'oil', 1);
thinUnder('thin1-alcool-under-oil', 'alcool', 'oil', 1);

// Couche mince STABLE (déjà dans le bon ordre) : doit rester intacte et calme.
function thinStable(name, topMat, bottomMat) {
  cases.push({
    name,
    w: 64, h: 64, frames: 300,
    build: (sim, rng) => {
      sim.fillRect(0, 43, 63, 43, topMat, rng);    // 1 ligne du léger
      sim.fillRect(0, 44, 63, 63, bottomMat, rng); // bloc du dense dessous
    },
    check: (sim, { meanLateActivity }) => {
      const fTop = flatness(sim, topMat);
      const yTop = meanY(sim, topMat); const yBot = meanY(sim, bottomMat);
      return {
        pass: yTop < yBot && fTop.variance <= 0.5 && meanLateActivity <= 5,
        metrics: { yTop, yBot, topVar: fTop.variance, calm: meanLateActivity },
      };
    },
  });
}
thinStable('thin1-water-on-oil-stable', 'water', 'oil');
thinStable('thin1-alcool-on-water-stable', 'alcool', 'water');

// =====================================================================
// 4. Sandwich vertical : colonnes pleine hauteur côte à côte
// =====================================================================

cases.push({
  name: 'sandwich-water-oil-water',
  w: 64, h: 64, frames: 2000,
  build: (sim, rng) => {
    sim.fillRect(0, 16, 20, 63, 'water', rng);
    sim.fillRect(21, 16, 42, 63, 'oil', rng);
    sim.fillRect(43, 16, 63, 63, 'water', rng);
  },
  check: (sim, { meanLateActivity }) => {
    const yw = meanY(sim, 'water'); const yo = meanY(sim, 'oil');
    const fw = flatness(sim, 'water'); const fo = flatness(sim, 'oil');
    return {
      pass: yo > yw && fw.variance <= 2.5 && fo.variance <= 2.5,
      metrics: { yw, yo, waterVar: fw.variance, oilVar: fo.variance, calm: meanLateActivity },
    };
  },
});

cases.push({
  name: 'sandwich-alcool-water-alcool',
  w: 64, h: 64, frames: 2000,
  build: (sim, rng) => {
    sim.fillRect(0, 16, 20, 63, 'alcool', rng);
    sim.fillRect(21, 16, 42, 63, 'water', rng);
    sim.fillRect(43, 16, 63, 63, 'alcool', rng);
  },
  check: (sim, { meanLateActivity }) => {
    const ya = meanY(sim, 'alcool'); const yw = meanY(sim, 'water');
    const fa = flatness(sim, 'alcool'); const fw = flatness(sim, 'water');
    return {
      pass: yw > ya && fa.variance <= 2.5 && fw.variance <= 2.5,
      metrics: { ya, yw, alcVar: fa.variance, waterVar: fw.variance, calm: meanLateActivity },
    };
  },
});

cases.push({
  name: 'sandwich-tri-columns',
  w: 64, h: 64, frames: 2000,
  build: (sim, rng) => {
    sim.fillRect(0, 16, 20, 63, 'oil', rng);
    sim.fillRect(21, 16, 42, 63, 'alcool', rng);
    sim.fillRect(43, 16, 63, 63, 'water', rng);
  },
  check: (sim, { meanLateActivity }) => {
    const ya = meanY(sim, 'alcool'); const yw = meanY(sim, 'water'); const yo = meanY(sim, 'oil');
    const fa = flatness(sim, 'alcool'); const fw = flatness(sim, 'water'); const fo = flatness(sim, 'oil');
    return {
      pass: ya < yw && yw < yo && fa.variance <= 2.5 && fw.variance <= 2.5 && fo.variance <= 2.5,
      metrics: { ya, yw, yo, alcVar: fa.variance, waterVar: fw.variance, oilVar: fo.variance, calm: meanLateActivity },
    };
  },
});

// =====================================================================
// 5. Huile versée directement sur une couche d'alcool (sans eau)
// =====================================================================

cases.push({
  name: 'oil-poured-on-alcool',
  w: 64, h: 64, frames: 800,
  build: (sim, rng) => {
    sim.fillRect(0, 48, 63, 63, 'alcool', rng); // couche d'alcool au fond
    sim.paintDisc(32, 30, 8, 'oil', rng);       // goutte d'huile au-dessus
  },
  check: (sim, { meanLateActivity }) => {
    const ya = meanY(sim, 'alcool'); const yo = meanY(sim, 'oil');
    const fa = flatness(sim, 'alcool'); const fo = flatness(sim, 'oil');
    return {
      pass: yo > ya && fa.variance <= 2 && fo.variance <= 2 && submergedVoid(sim) === 0,
      metrics: { ya, yo, alcVar: fa.variance, oilVar: fo.variance, submergedVoid: submergedVoid(sim), calm: meanLateActivity },
    };
  },
});

// =====================================================================
// 6. Sable + liquides
// =====================================================================

cases.push({
  name: 'sand-through-oil-water-interface',
  w: 64, h: 64, frames: 600,
  build: (sim, rng) => {
    sim.fillRect(0, 28, 63, 45, 'water', rng); // eau au-dessus (ordre stable eau/huile)
    sim.fillRect(0, 46, 63, 63, 'oil', rng);   // huile au fond
    sim.paintDisc(32, 10, 6, 'sand', rng);     // sable lâché en l'air
  },
  check: (sim, { meanLateActivity }) => {
    const ys = meanY(sim, 'sand'); const yw = meanY(sim, 'water'); const yo = meanY(sim, 'oil');
    const fw = flatness(sim, 'water');
    return {
      pass: ys > yo && yo > yw && ys >= 55 && liquidUnderSand(sim) === 0 && fw.variance <= 2.5,
      metrics: { ys, yo, yw, liquidUnderSand: liquidUnderSand(sim), waterVar: fw.variance, calm: meanLateActivity },
    };
  },
});

cases.push({
  name: 'submerged-sand-pile-stays',
  w: 64, h: 64, frames: 600,
  build: (sim, rng) => {
    // même pyramide que le scénario sand-pile, puis immersion complète
    for (let r = 0; r <= 14; r++) {
      sim.fillRect(32 - (14 - r), 49 + r, 32 + (14 - r), 49 + r, 'sand', rng);
    }
    fillVoid(sim, 0, 30, 63, 63, 'water', rng);
  },
  check: (sim, { meanLateActivity }) => {
    const fs = flatness(sim, 'sand');
    let apexY = sim.h;
    for (let y = 0; y < sim.h; y++) {
      for (let x = 0; x < sim.w; x++) {
        if (NAME_OF[sim.get(x, y)] === 'sand') apexY = Math.min(apexY, y);
      }
    }
    const sv = surfaceVariance(sim);
    return {
      pass: fs.variance >= 8 && apexY <= 52 && sv <= 1.0 && liquidUnderSand(sim) === 0,
      metrics: { pileVariance: fs.variance, apexY, waterSurfaceVar: sv, liquidUnderSand: liquidUnderSand(sim), calm: meanLateActivity },
    };
  },
});

// =====================================================================
// 7. Vide + 2 liquides : bulle à une interface huile/eau
// =====================================================================

cases.push({
  name: 'void-bubble-at-oil-water-interface',
  w: 64, h: 64, frames: 500,
  build: (sim, rng) => {
    sim.fillRect(0, 28, 63, 45, 'water', rng);
    sim.fillRect(0, 46, 63, 63, 'oil', rng);
    sim.paintDisc(32, 46, 4, 'void', rng); // bulle à cheval sur l'interface
  },
  check: (sim, { meanLateActivity }) => {
    const yw = meanY(sim, 'water'); const yo = meanY(sim, 'oil');
    const fo = flatness(sim, 'oil');
    const sv = surfaceVariance(sim);
    return {
      pass: submergedVoid(sim) === 0 && yo > yw && fo.variance <= 2.5 && sv <= 1.5,
      metrics: { submergedVoid: submergedVoid(sim), yw, yo, oilVar: fo.variance, surfaceVar: sv, calm: meanLateActivity },
    };
  },
});

cases.push({
  name: 'void-bubble-deep-in-oil',
  w: 64, h: 64, frames: 600,
  build: (sim, rng) => {
    sim.fillRect(0, 28, 63, 45, 'water', rng);
    sim.fillRect(0, 46, 63, 63, 'oil', rng);
    sim.paintDisc(32, 58, 3, 'void', rng); // bulle profonde, doit traverser huile PUIS eau
  },
  check: (sim, { meanLateActivity }) => {
    const yw = meanY(sim, 'water'); const yo = meanY(sim, 'oil');
    const fo = flatness(sim, 'oil');
    return {
      pass: submergedVoid(sim) === 0 && yo > yw && fo.variance <= 2.5,
      metrics: { submergedVoid: submergedVoid(sim), yw, yo, oilVar: fo.variance, calm: meanLateActivity },
    };
  },
});

cases.push({
  name: 'tiny-16x16-bubble-near-full',
  w: 16, h: 16, frames: 300,
  build: (sim, rng) => {
    sim.fillRect(0, 2, 15, 15, 'water', rng); // presque pleine
    sim.paintDisc(8, 10, 3, 'void', rng);     // bulle au milieu
  },
  check: (sim, { meanLateActivity }) => {
    const f = flatness(sim, 'water');
    return {
      pass: submergedVoid(sim) === 0 && f.variance <= 1.5,
      metrics: { submergedVoid: submergedVoid(sim), flatVariance: f.variance, calm: meanLateActivity },
    };
  },
});

module.exports = { cases };
