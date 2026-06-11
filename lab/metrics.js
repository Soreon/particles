// Métriques d'évaluation des scénarios : conservation de masse, planéité des
// couches (variance des comptes par colonne), activité (calme), centroïdes.

const { NAME_OF } = require('./materials');

function countsByName(sim) {
  const counts = {};
  for (let i = 0; i < sim.grid.length; i++) {
    const name = NAME_OF[sim.grid[i]];
    if (name === 'void') continue;
    counts[name] = (counts[name] || 0) + 1;
  }
  return counts;
}

// Nombre de cellules du matériau par colonne (une couche plate => valeurs égales).
function perColumnCount(sim, material) {
  const cols = new Array(sim.w).fill(0);
  for (let y = 0; y < sim.h; y++) {
    for (let x = 0; x < sim.w; x++) {
      if (NAME_OF[sim.grid[y * sim.w + x]] === material) cols[x]++;
    }
  }
  return cols;
}

function variance(arr) {
  const vals = arr.filter((v) => true);
  if (vals.length === 0) return 0;
  const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
  return vals.reduce((s, v) => s + (v - mean) * (v - mean), 0) / vals.length;
}

// Variance des comptes par colonne, restreinte aux colonnes où le matériau
// est présent + ses voisines (ignore les colonnes vides au bord du domaine).
function flatness(sim, material) {
  const cols = perColumnCount(sim, material);
  const present = cols.map((c, i) => ({ c, i })).filter((e) => e.c > 0);
  if (present.length === 0) return { variance: 0, maxDev: 0, span: 0 };
  const lo = present[0].i;
  const hi = present[present.length - 1].i;
  const region = cols.slice(lo, hi + 1);
  const mean = region.reduce((s, v) => s + v, 0) / region.length;
  const v = region.reduce((s, x) => s + (x - mean) * (x - mean), 0) / region.length;
  const maxDev = Math.max(...region.map((x) => Math.abs(x - mean)));
  return { variance: v, maxDev, span: hi - lo + 1 };
}

function meanY(sim, material) {
  let sum = 0; let n = 0;
  for (let y = 0; y < sim.h; y++) {
    for (let x = 0; x < sim.w; x++) {
      if (NAME_OF[sim.grid[y * sim.w + x]] === material) { sum += y; n++; }
    }
  }
  return n === 0 ? -1 : sum / n;
}

function centroid(sim, predicate) {
  let sx = 0; let sy = 0; let n = 0;
  for (let y = 0; y < sim.h; y++) {
    for (let x = 0; x < sim.w; x++) {
      if (predicate(sim.grid[y * sim.w + x], x, y)) { sx += x; sy += y; n++; }
    }
  }
  return n === 0 ? null : { x: sx / n, y: sy / n, count: n };
}

function changedCells(a, b) {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
}

// Rendu ASCII pour inspection visuelle dans les logs.
function ascii(sim) {
  const CHAR = { void: '.', sand: 'S', water: 'w', oil: 'O', alcool: 'a' };
  const lines = [];
  for (let y = 0; y < sim.h; y++) {
    let line = '';
    for (let x = 0; x < sim.w; x++) line += CHAR[NAME_OF[sim.grid[y * sim.w + x]]];
    lines.push(line);
  }
  return lines.join('\n');
}

module.exports = {
  countsByName, perColumnCount, variance, flatness, meanY, centroid, changedCells, ascii,
};
