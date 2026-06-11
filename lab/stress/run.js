// Chasse aux oscillations / livelocks sur la règle d'écoulement.
//
//   node lab/stress/run.js [variant=v1] [--seeds 1,2,3] [--config name] [--frames N] [--dump]
//
// Pour chaque config x seed :
//  - run long (frames de la config, >= 2000), conservation de masse vérifiée à chaque frame ;
//  - activité = changedCells entre frames (cf lab/metrics.js), fenêtres début/milieu/fin ;
//  - planéité échantillonnée toutes les 25 frames -> progrès en 2e moitié de run ;
//  - détection de cycles : hash de la grille sur les 256 dernières frames.
//
// Verdicts :
//  settled-ok      activité tardive = 0 et planéité dans la cible
//  residual-ok     activité tardive faible (<= budget marcheurs) et planéité dans la cible
//  FROZEN          activité = 0 mais planéité hors cible (gel)
//  LIVELOCK        activité élevée persistante SANS progrès de planéité
//  CHURN-AT-TARGET planéité dans la cible mais activité tardive au-dessus du budget
//  still-converging planéité hors cible mais qui progresse encore (run trop court)

const path = require('path');
const { Sim, makeRng } = require('../automaton');
const { countsByName, flatness, changedCells, ascii, meanY } = require('../metrics');
const { configs } = require('./configs');

const args = process.argv.slice(2);
const variant = (args[0] && !args[0].startsWith('--')) ? args[0] : 'v1';
const seedsArg = args.indexOf('--seeds');
const seeds = seedsArg >= 0 ? args[seedsArg + 1].split(',').map(Number) : [1, 2, 3];
const cfgArg = args.indexOf('--config');
const only = cfgArg >= 0 ? args[cfgArg + 1] : null;
const framesArg = args.indexOf('--frames');
const framesOverride = framesArg >= 0 ? parseInt(args[framesArg + 1], 10) : null;
const dump = args.includes('--dump');

const rule = require(path.join(__dirname, '..', 'rules', variant + '.js'));

const W = 64;
const H = 64;
const LATE_WINDOW = 300;        // fenêtre d'activité tardive
// Quantum mesuré : 1.5 à 4.3 cellules changées/frame par cellule "défaut"
// (sub-monocouche). 5.0 laisse une marge ; au-delà = churn non explicable.
const RESIDUAL_PER_DEFECT = 5.0;
const RESIDUAL_FLOOR = 2;       // marge pour le bruit d'échantillonnage

function r3(v) { return Math.round(v * 1000) / 1000; }

function mean(arr, from, to) {
  let s = 0; let n = 0;
  for (let i = Math.max(0, from); i < Math.min(arr.length, to); i++) { s += arr[i]; n++; }
  return n ? s / n : 0;
}

function fnv(grid) {
  let h = 0x811c9dc5 | 0;
  for (let i = 0; i < grid.length; i++) {
    h = Math.imul(h ^ grid[i], 16777619);
  }
  return h >>> 0;
}

function runOne(cfg, seed) {
  const frames = framesOverride || cfg.frames;
  const sim = new Sim(W, H, rule, seed);
  const rng = makeRng(seed * 7 + 13);
  cfg.build(sim, rng);

  const initialCounts = countsByName(sim);
  const prev = new Uint8Array(sim.grid.length);
  const activity = new Array(frames).fill(0);
  const flatSeries = {}; // material -> [{f, v, maxDev}]
  for (const t of cfg.track) flatSeries[t.material] = [];
  let conservationBrokenAt = -1;
  let lastChangeFrame = -1;
  const lateHashes = [];

  for (let f = 0; f < frames; f++) {
    prev.set(sim.grid);
    sim.frame();
    const ch = changedCells(prev, sim.grid);
    activity[f] = ch;
    if (ch > 0) lastChangeFrame = f;

    if (conservationBrokenAt < 0) {
      const counts = countsByName(sim);
      for (const k of Object.keys(initialCounts)) {
        if (counts[k] !== initialCounts[k]) conservationBrokenAt = f;
      }
      for (const k of Object.keys(counts)) {
        if (!(k in initialCounts)) conservationBrokenAt = f;
      }
    }

    if (f % 25 === 0 || f === frames - 1) {
      for (const t of cfg.track) {
        const fl = flatness(sim, t.material);
        flatSeries[t.material].push({ f, v: r3(fl.variance), maxDev: r3(fl.maxDev) });
      }
    }
    if (f >= frames - 256) lateHashes.push(fnv(sim.grid));
  }

  // --- Synthèse d'activité ---
  const lateMean = mean(activity, frames - LATE_WINDOW, frames);
  const lateMax = Math.max(...activity.slice(-LATE_WINDOW));
  let zeroLate = 0;
  for (let i = frames - LATE_WINDOW; i < frames; i++) if (activity[i] === 0) zeroLate++;
  const windows = {
    'f0-100': r3(mean(activity, 0, 100)),
    'q2': r3(mean(activity, Math.floor(frames * 0.25), Math.floor(frames * 0.25) + 100)),
    'q3': r3(mean(activity, Math.floor(frames * 0.5), Math.floor(frames * 0.5) + 100)),
    'q4': r3(mean(activity, Math.floor(frames * 0.75), Math.floor(frames * 0.75) + 100)),
    late: r3(lateMean),
    lateMax,
    zeroFramesLate: zeroLate,
  };

  // --- Progrès de planéité en 2e moitié ---
  const flatFinal = {};
  const flatMid = {};
  let stillImproving = false;
  for (const t of cfg.track) {
    const series = flatSeries[t.material];
    const last = series[series.length - 1];
    const midIdx = Math.floor(series.length / 2);
    flatFinal[t.material] = last;
    flatMid[t.material] = series[midIdx];
    if (series[midIdx].v - last.v > 0.05) stillImproving = true;
  }
  const flatOK = cfg.track.every((t) => flatFinal[t.material].v <= t.target);

  // --- Cycles exacts dans les 256 dernières frames ---
  const distinctLateStates = new Set(lateHashes).size;

  // --- Cellules "défaut" : masse hors lignes pleines (count mod W) ---
  // Seules les lignes d'interface partielles peuvent diffuser indéfiniment ;
  // leur nombre borne l'activité résiduelle légitime.
  const finalCounts = countsByName(sim);
  let defectCells = 0;
  for (const n of Object.values(finalCounts)) {
    const partial = n % W;
    defectCells += Math.min(partial, W - partial);
  }

  // --- Check additionnel ---
  let checkOK = true;
  let checkMetrics = null;
  if (cfg.check) {
    const c = cfg.check(sim);
    checkOK = c.ok;
    checkMetrics = c.metrics;
  }

  // --- Verdict ---
  const budget = defectCells * RESIDUAL_PER_DEFECT + (defectCells > 0 ? RESIDUAL_FLOOR : 0);
  let verdict;
  if (lateMean === 0) {
    verdict = (flatOK && checkOK) ? 'settled-ok' : 'FROZEN';
  } else if (flatOK && checkOK) {
    verdict = lateMean <= budget ? 'residual-ok' : 'CHURN-AT-TARGET';
  } else {
    verdict = stillImproving ? 'still-converging' : 'LIVELOCK';
  }
  if (cfg.expectTotallyQuiet && activity.some((a) => a > 0)) {
    verdict = 'SPURIOUS-ACTIVITY';
  }
  if (cfg.expectEventualQuiet && lateMean > 0 && verdict.indexOf('ok') >= 0) {
    verdict = 'NO-QUIESCENCE';
  }

  const report = {
    config: cfg.name,
    seed,
    frames,
    verdict,
    conservationOK: conservationBrokenAt < 0,
    conservationBrokenAt: conservationBrokenAt < 0 ? null : conservationBrokenAt,
    activity: windows,
    defectCells,
    residualBudget: budget,
    activityPerDefect: defectCells > 0 ? r3(lateMean / defectCells) : null,
    lastChangeFrame,
    distinctLateStates,
    flatMid,
    flatFinal,
    checkOK,
    checkMetrics,
  };

  if (dump) {
    console.error('=== ' + cfg.name + ' seed=' + seed + ' (final, verdict=' + verdict + ') ===');
    console.error(ascii(sim));
  }
  return report;
}

const results = { variant, seeds, runs: [], problems: [] };
for (const cfg of configs) {
  if (only && cfg.name !== only) continue;
  for (const seed of seeds) {
    const r = runOne(cfg, seed);
    results.runs.push(r);
    const bad = ['FROZEN', 'LIVELOCK', 'CHURN-AT-TARGET', 'SPURIOUS-ACTIVITY', 'NO-QUIESCENCE', 'still-converging'];
    if (bad.includes(r.verdict) || !r.conservationOK) {
      results.problems.push({ config: cfg.name, seed, verdict: r.verdict, conservationOK: r.conservationOK });
    }
  }
}

console.log(JSON.stringify(results, null, 2));
