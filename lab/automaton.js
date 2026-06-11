// Réplique CPU exacte de l'automate GPU (gpu.worker.js) pour tester la physique
// hors navigateur : mêmes blocs Margolus, mêmes offsets, même boucle de frame.
// La passe d'écoulement est enfichable (lab/rules/*.js) pour comparer des
// variantes de règles sur les mêmes scénarios.

const { DENS, TYPE, T_LIQUID, MATERIAL_IDS } = require('./materials');

// Hash déterministe -> [0,1) (équivalent du hash() des shaders).
function hash01(x, y, salt) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(salt, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// PRNG mulberry32 pour la construction des scénarios (peinture).
function makeRng(seed) {
  let s = seed >>> 0;
  return function rng() {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Sim {
  constructor(w, h, flowRule, seed = 1) {
    this.w = w;
    this.h = h;
    this.flowRule = flowRule;
    this.seed = seed | 0;
    this.grid = new Uint8Array(w * h);
    this.next = new Uint8Array(w * h);
    this.substepCounter = 0;
    this.flowCounter = 0;
    this.substepsPerFrame = 8;
    this.flowPassesPerStep = 3;
    this.OFFSETS = [[0, 0], [1, 1], [1, 0], [0, 1]];
  }

  // --- Passe de gravité : miroir exact de SIM_FS (bloc 2x2 de Margolus) ---
  gravityStep(ox, oy, salt) {
    const { w, h, grid, next } = this;
    next.set(grid);
    for (let y0 = oy; y0 + 1 < h; y0 += 2) {
      for (let x0 = ox; x0 + 1 < w; x0 += 2) {
        const i0 = y0 * w + x0;
        const i1 = i0 + 1;
        const i2 = i0 + w;
        const i3 = i2 + 1;
        let a = grid[i0]; let b = grid[i1];
        let c = grid[i2]; let d = grid[i3];
        let da = DENS[a]; let db = DENS[b];
        let dc = DENS[c]; let dd = DENS[d];
        const rnd = hash01(x0, y0, salt + this.seed * 7919);
        let t; let td;

        // 1. Coulée verticale : le plus dense descend dans chaque colonne.
        if (da > dc) { t = a; a = c; c = t; td = da; da = dc; dc = td; }
        if (db > dd) { t = b; b = d; d = t; td = db; db = dd; dd = td; }

        // 2. Diagonale quand la descente droite est bloquée.
        if (rnd < 0.5) {
          if (da > dd && dc >= da) { t = a; a = d; d = t; td = da; da = dd; dd = td; }
          if (db > dc && dd >= db) { t = b; b = c; c = t; td = db; db = dc; dc = td; }
        } else {
          if (db > dc && dd >= db) { t = b; b = c; c = t; td = db; db = dc; dc = td; }
          if (da > dd && dc >= da) { t = a; a = d; d = t; td = da; da = dd; dd = td; }
        }

        next[i0] = a; next[i1] = b; next[i2] = c; next[i3] = d;
      }
    }
    const tmp = this.grid; this.grid = this.next; this.next = tmp;
  }

  // --- Passe d'écoulement : paires 2x1, règle enfichable (miroir de FLOW_FS) ---
  flowStep(offsetX, salt) {
    const { w, h, grid, next } = this;
    next.set(grid);
    const self = this;

    // Helpers identiques au shader (lecture depuis l'état AVANT la passe).
    const densAt = (x, y) => {
      if (y < 0) return 0;            // au-dessus de la grille = vide
      if (y >= h) return 255;         // sous la grille = mur infranchissable
      return DENS[grid[y * w + x]];
    };
    const densAbove = (p) => densAt(p.x, p.y - 1);
    const densBelow = (p) => densAt(p.x, p.y + 1);
    const blockedBelow = (p) => (p.y + 1 >= h) || grid[(p.y + 1) * w + p.x] !== 0;
    const openAbove = (p) => (p.y - 1 < 0) || grid[(p.y - 1) * w + p.x] === 0;

    for (let y = 0; y < h; y++) {
      for (let x0 = offsetX; x0 + 1 < w; x0 += 2) {
        const iL = y * w + x0;
        const iR = iL + 1;
        const L = grid[iL];
        const R = grid[iR];
        if (L === R) continue;
        const ctx = {
          L,
          R,
          dL: DENS[L],
          dR: DENS[R],
          lLiq: TYPE[L] === T_LIQUID,
          rLiq: TYPE[R] === T_LIQUID,
          lp: { x: x0, y },
          rp: { x: x0 + 1, y },
          densAbove,
          densBelow,
          blockedBelow,
          openAbove,
          densAt,
          idAt: (x, yy) => ((x < 0 || x >= w || yy < 0 || yy >= h) ? -1 : grid[yy * w + x]),
          rnd: hash01(x0, y, salt + self.seed * 104729),
        };
        if (self.flowRule(ctx)) {
          next[iL] = R;
          next[iR] = L;
        }
      }
    }
    const tmp = this.grid; this.grid = this.next; this.next = tmp;
  }

  // --- Boucle de frame : miroir exact de frame() dans gpu.worker.js ---
  frame() {
    for (let s = 0; s < this.substepsPerFrame; s++) {
      const off = this.OFFSETS[this.substepCounter % 4];
      this.substepCounter++;
      this.gravityStep(off[0], off[1], this.substepCounter);
      for (let f = 0; f < this.flowPassesPerStep; f++) {
        this.flowStep(this.flowCounter & 1, 7777 + this.flowCounter);
        this.flowCounter++;
      }
    }
  }

  // --- Outils de construction de scénarios ---
  set(x, y, id) {
    if (x >= 0 && x < this.w && y >= 0 && y < this.h) this.grid[y * this.w + x] = id;
  }

  get(x, y) {
    return this.grid[y * this.w + x];
  }

  fillRect(x0, y0, x1, y1, material, rng) {
    const ids = MATERIAL_IDS[material];
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        this.set(x, y, ids[(rng() * ids.length) | 0]);
      }
    }
  }

  paintDisc(cx, cy, r, material, rng) {
    const ids = MATERIAL_IDS[material];
    const r2 = r * r;
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        const dx = x - cx; const dy = y - cy;
        if (dx * dx + dy * dy <= r2) this.set(x, y, ids[(rng() * ids.length) | 0]);
      }
    }
  }
}

module.exports = { Sim, makeRng, hash01 };
