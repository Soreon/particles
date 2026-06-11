// Harnais de stress pour les cas limites des règles d'écoulement.
// N'altère AUCUN fichier du labo : on réutilise Sim/metrics/materials tels quels.

const path = require('path');
const { Sim, makeRng } = require(path.join(__dirname, '..', 'automaton'));
const {
  countsByName, flatness, meanY, changedCells, ascii,
} = require(path.join(__dirname, '..', 'metrics'));
const { NAME_OF, MATERIAL_IDS } = require(path.join(__dirname, '..', 'materials'));

// --- Métriques supplémentaires ---

// Cellules de vide "submergées" : vide avec de la matière plus haut dans la colonne.
function submergedVoid(sim) {
  let n = 0;
  for (let x = 0; x < sim.w; x++) {
    let seenMatter = false;
    for (let y = 0; y < sim.h; y++) {
      const id = sim.get(x, y);
      if (id !== 0) seenMatter = true;
      else if (seenMatter) n++;
    }
  }
  return n;
}

// Matière "suspendue" : cellule non-vide avec du vide juste en dessous (transitoire
// normal pendant l'écoulement, doit tendre vers 0 au repos).
function hangingMatter(sim) {
  let n = 0;
  for (let y = 0; y < sim.h - 1; y++) {
    for (let x = 0; x < sim.w; x++) {
      if (sim.get(x, y) !== 0 && sim.get(x, y + 1) === 0) n++;
    }
  }
  return n;
}

// Profil de surface : y de la première cellule non-vide par colonne (h si colonne vide).
function surfaceProfile(sim) {
  const ys = [];
  for (let x = 0; x < sim.w; x++) {
    let y = 0;
    while (y < sim.h && sim.get(x, y) === 0) y++;
    ys.push(y);
  }
  return ys;
}

function varianceOf(arr) {
  if (arr.length === 0) return 0;
  const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
  return arr.reduce((s, v) => s + (v - mean) * (v - mean), 0) / arr.length;
}

function surfaceVariance(sim) {
  return varianceOf(surfaceProfile(sim));
}

// Liquide directement sous du sable (au repos doit être 0 : la gravité verticale
// échange systématiquement dense-sur-léger).
function liquidUnderSand(sim) {
  let n = 0;
  for (let y = 0; y < sim.h - 1; y++) {
    for (let x = 0; x < sim.w; x++) {
      const top = NAME_OF[sim.get(x, y)];
      const below = NAME_OF[sim.get(x, y + 1)];
      if (top === 'sand' && (below === 'water' || below === 'oil' || below === 'alcool')) n++;
    }
  }
  return n;
}

// Remplit chaque cellule actuellement vide d'un rectangle avec un matériau
// (pour immerger une structure sans l'écraser).
function fillVoid(sim, x0, y0, x1, y1, material, rng) {
  const ids = MATERIAL_IDS[material];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (x >= 0 && x < sim.w && y >= 0 && y < sim.h && sim.get(x, y) === 0) {
        sim.set(x, y, ids[(rng() * ids.length) | 0]);
      }
    }
  }
}

// --- Exécution d'un cas ---
// cas = { name, w, h, frames, build(sim, rng), check(sim, env) -> { pass, metrics } }
function runCase(c, rule, seed) {
  const sim = new Sim(c.w, c.h, rule, seed);
  const rng = makeRng(seed * 7 + 13);
  let error = null;
  let conservationOK = true;
  let firstBreakFrame = -1;
  let meanLateActivity = 0;
  let verdict = { pass: false, metrics: {} };

  try {
    c.build(sim, rng);
    const initial = countsByName(sim);
    const prev = new Uint8Array(sim.grid.length);
    const activity = [];

    for (let f = 0; f < c.frames; f++) {
      prev.set(sim.grid);
      sim.frame();
      activity.push(changedCells(prev, sim.grid));

      // Conservation STRICTE par matériau, à chaque frame.
      const counts = countsByName(sim);
      const keys = new Set([...Object.keys(initial), ...Object.keys(counts)]);
      for (const k of keys) {
        if ((counts[k] || 0) !== (initial[k] || 0)) {
          conservationOK = false;
          if (firstBreakFrame < 0) firstBreakFrame = f;
        }
      }
    }

    const late = activity.slice(-60);
    meanLateActivity = late.length ? late.reduce((s, v) => s + v, 0) / late.length : 0;
    verdict = c.check(sim, { meanLateActivity });
  } catch (e) {
    error = String((e && e.stack) || e);
  }

  return {
    pass: !error && conservationOK && verdict.pass,
    error,
    conservationOK,
    firstBreakFrame,
    meanLateActivity: Math.round(meanLateActivity * 10) / 10,
    metrics: verdict.metrics,
    sim,
  };
}

module.exports = {
  Sim,
  makeRng,
  runCase,
  submergedVoid,
  hangingMatter,
  surfaceVariance,
  surfaceProfile,
  liquidUnderSand,
  fillVoid,
  flatness,
  meanY,
  ascii,
  countsByName,
  NAME_OF,
  MATERIAL_IDS,
};
