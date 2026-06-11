// Réplique CPU exacte de l'automate GPU (gpu.worker.js) pour tester la physique
// hors navigateur : mêmes blocs Margolus, mêmes offsets, même boucle de frame.
// La passe d'écoulement est enfichable (lab/rules/*.js) pour comparer des
// variantes de règles sur les mêmes scénarios.

const { DENS, TYPE, FLUID, T_SOLID, T_LIQUID, MATERIAL_IDS } = require('./materials');

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
    // Moteur de vélocité (V2+) : activé par la règle via flowRule.engine.
    // velocity : vy mis à jour à s=0 (gravité, file d'attente, pose) et chute
    // verticale gatée par Bresenham temporel. G : accélération (cases/frame²).
    // jitterP : probabilité de glissade diagonale de traînée en vol.
    const eng = (flowRule && flowRule.engine) || {};
    this.engineVelocity = !!eng.velocity;
    this.engineViscosity = !!eng.viscosity;
    this.G = eng.G || 1;
    this.jitterP = eng.jitterP || 0;
    this.grid = new Uint8Array(w * h);
    this.next = new Uint8Array(w * h);
    // Charge utile par particule (structure-of-arrays, miroir des canaux
    // .g/.b/.a de la texture RGBA8UI côté GPU). Transportée avec la particule
    // dans tous les échanges. vy/vx : signe-magnitude (bit 7 = signe,
    // valeur brute 0 = vitesse nulle — l'état neutre est le zéro).
    this.vy = new Uint8Array(w * h);
    this.vyN = new Uint8Array(w * h);
    this.vx = new Uint8Array(w * h);
    this.vxN = new Uint8Array(w * h);
    this.fl = new Uint8Array(w * h);
    this.flN = new Uint8Array(w * h);
    this.substepCounter = 0;
    this.flowCounter = 0;
    this.substepsPerFrame = 8;
    this.flowPassesPerStep = 3;
    this.OFFSETS = [[0, 0], [1, 1], [1, 0], [0, 1]];
  }

  // Rotation des doubles tampons (ids + charge utile), après chaque passe.
  swapBuffers() {
    let t = this.grid; this.grid = this.next; this.next = t;
    t = this.vy; this.vy = this.vyN; this.vyN = t;
    t = this.vx; this.vx = this.vxN; this.vxN = t;
    t = this.fl; this.fl = this.flN; this.flN = t;
  }

  // Échéancier de Bresenham temporel : une particule de magnitude m (cases/
  // frame) tente sa chute au sous-pas s ssi le quotient entier (s·m)/S change.
  // m est plancher à 1 pour qu'aucune particule capable de tomber ne reste
  // suspendue (le cas vy=0 sous-frame, avant la mise à jour suivante).
  bres(m, sFrame) {
    const S = this.substepsPerFrame;
    const mm = m > 0 ? m : 1;
    return (((sFrame + 1) * mm / S) | 0) !== ((sFrame * mm / S) | 0);
  }

  // Mise à jour de la vélocité, une fois par frame (au sous-pas s=0), à partir
  // d'un instantané pré-mise-à-jour (vyN sert de scratch — miroir du GPU qui
  // lit la texture source). Cycle de vie :
  //   - peut tomber (plus léger strictement dessous) : vy += G ± 1 (gravité
  //     stochastique pour faire diverger les vy égaux), plafonnée à S dans le
  //     vide, S/4 dans un liquide porteur (vitesse terminale par milieu) ;
  //   - bloquée (dessous pas plus léger) : vy := min(vy, vy_dessous) — file
  //     d'attente dans un jet (transfert), et pose (le posé a vy=0) sans
  //     jamais accumuler de vitesse fossile.
  // Impact (transition transit -> posé, cible posée ou sol) : conversion de la
  // vitesse verticale d'arrivée m. Liquides : éclaboussure — une partie des
  // gouttes est ÉJECTÉE balistiquement (vy signé vers le haut + vx latéral),
  // le reste glisse en surface (vx seul). Solides : petite dispersion latérale
  // (restitution ~0) — c'est elle qui transforme les colonnes en CÔNES.
  applyImpact(i, x, y, id, m, salt) {
    if (m < 3) { this.vy[i] = 0; return; } // atterrissage doux : simple pose
    const S = this.substepsPerFrame;
    const j1 = hash01(x, y, salt ^ 0x12345671);
    const j2 = hash01(x, y, salt ^ 0x89abcdef);
    const sx = j1 < 0.5 ? 0x80 : 0; // signe latéral aléatoire (0x80 = gauche)
    if (TYPE[id] === T_LIQUID) {
      const mx = Math.min(m >> 1, Math.max(2, S >> 2));
      // Éjection balistique UNIQUEMENT vers de l'air libre : une goutte qui
      // percute une couche immergée (huile au fond de l'alcool) ne doit pas
      // rebondir À TRAVERS le liquide du dessus.
      const airAbove = y - 1 >= 0 && this.grid[i - this.w] === 0;
      if (airAbove && j2 < 0.5) {
        const mu = Math.min(m >> 2, S >> 1); // éjection : repart vers le haut
        this.vy[i] = mu > 0 ? (0x80 | mu) : 0;
      } else {
        this.vy[i] = 0; // fusion dans la surface
      }
      this.vx[i] = mx > 0 ? (sx | mx) : 0;
    } else {
      this.vy[i] = 0;
      const mx = Math.min(2, m >> 2);
      this.vx[i] = mx > 0 ? (sx | mx) : 0;
    }
  }

  velocityUpdate(salt) {
    const { w, h, grid, vy, vyN, vx } = this;
    const S = this.substepsPerFrame;
    // Plafond en liquide : S/2 stocké -> ~S/4 effectif. Une particule lente ne
    // tombe qu'à ~m/2 par frame (taxe d'alignement : ses sous-pas programmés ne
    // coïncident avec le bon appariement Margolus qu'une frame sur deux).
    const capLiquid = Math.max(1, S >> 1);
    vyN.set(vy); // instantané pré-mise-à-jour
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const id = grid[i];
        if (id === 0) { vy[i] = 0; vx[i] = 0; continue; }

        // Friction latérale (une fois par frame) : les solides s'arrêtent vite,
        // les liquides glissent. vx n'est jamais entretenu (pas de fossile).
        const mxOld = vx[i] & 0x7F;
        if (mxOld > 0) {
          const fr = TYPE[id] === T_SOLID ? 2 : (this.engineViscosity && FLUID[id] < 128 ? 2 : 1);
          const mx = mxOld - fr;
          vx[i] = mx > 0 ? ((vx[i] & 0x80) | mx) : 0;
        }

        const v = vyN[i];
        let m = v & 0x7F;

        // Montée balistique (gouttes éjectées) : décélération G, retombée au
        // sommet de l'arc ou sous un plafond.
        if ((v & 0x80) !== 0) {
          const aboveLighter = y - 1 >= 0 && DENS[grid[i - w]] < DENS[id];
          m -= this.G;
          vy[i] = (aboveLighter && m > 0) ? (0x80 | m) : 1;
          continue;
        }

        if (y + 1 >= h) { this.applyImpact(i, x, y, id, m, salt); continue; }
        const below = grid[i + w];
        if (DENS[below] < DENS[id]) {
          // Chute possible : gravité stochastique, plafond selon le milieu.
          const j = hash01(x, y, salt + this.seed * 31337);
          m += this.G + (j < 0.33 ? -1 : (j < 0.66 ? 0 : 1));
          let cap = below === 0 ? S : capLiquid;
          if (this.engineViscosity && below !== 0) cap = Math.max(1, (cap * FLUID[below] / 255) | 0);
          if (m < 1) m = 1;
          if (m > cap) m = cap;
          vy[i] = m;
        } else {
          // Bloquée : file d'attente sur une cible mobile, impact sur une posée.
          const mBelow = vyN[i + w] & 0x7F;
          if (mBelow === 0) this.applyImpact(i, x, y, id, m, salt);
          else vy[i] = Math.min(m, mBelow);
        }
      }
    }
  }

  // --- Passe de gravité : miroir exact de SIM_FS (bloc 2x2 de Margolus) ---
  // Les origines (oa..od) sont permutées avec les valeurs : la charge utile
  // suit sa particule structurellement (impossible d'oublier un canal).
  gravityStep(ox, oy, salt, sFrame) {
    const { w, h, grid, next, vy, vyN, vx, vxN, fl, flN } = this;
    const ev = this.engineVelocity;

    // Mise à jour de la vélocité une fois par frame, avant les échanges.
    if (ev && sFrame === 0) this.velocityUpdate(salt);

    next.set(grid);
    vyN.set(vy);
    vxN.set(vx);
    flN.set(fl);
    for (let y0 = oy; y0 + 1 < h; y0 += 2) {
      for (let x0 = ox; x0 + 1 < w; x0 += 2) {
        const i0 = y0 * w + x0;
        const i1 = i0 + 1;
        const i2 = i0 + w;
        const i3 = i2 + 1;
        let a = grid[i0]; let b = grid[i1];
        let c = grid[i2]; let d = grid[i3];
        let oa = i0; let ob = i1;
        let oc = i2; let od = i3;
        let da = DENS[a]; let db = DENS[b];
        let dc = DENS[c]; let dd = DENS[d];
        const rnd = hash01(x0, y0, salt + this.seed * 7919);
        let t; let td;

        // 0. Jitter de traînée (vélocité) : avec une faible probabilité, une
        //    particule EN CHUTE glisse en diagonale même si la chute droite est
        //    libre — seul mécanisme qui casse une colonne de largeur 1 (la
        //    diversité de vy ne le peut pas : pas de doublement possible).
        if (ev && this.jitterP > 0) {
          const jit = hash01(x0, y0, salt ^ 0x5bd1e995);
          if (jit < this.jitterP) {
            if (da > dd && dc > dd && (vy[oa] & 0x80) === 0 && this.bres(vy[oa] & 0x7F, sFrame)) {
              t = a; a = d; d = t; td = da; da = dd; dd = td; t = oa; oa = od; od = t;
            } else if (db > dc && dd > dc && (vy[ob] & 0x80) === 0 && this.bres(vy[ob] & 0x7F, sFrame)) {
              t = b; b = c; c = t; td = db; db = dc; dc = td; t = ob; ob = oc; oc = t;
            }
          }
        }

        // 1. Coulée verticale : le plus dense descend dans chaque colonne,
        //    gatée par l'échéancier du mouvant (qui ne doit pas être en
        //    ascension). Branche symétrique : une particule ÉJECTÉE (vy signé
        //    haut) monte dans plus léger qu'elle — l'arc balistique du splash.
        {
          // Gate de porteur visqueux : tomber DANS un liquide passe aussi le
          // filtre de sa fluidité — vitesses effectives fractionnaires
          // (< 1 case/frame dans l'huile), impossibles via vy seul (plancher
          // à 1 + taxe d'alignement qui écrase les différences de cap).
          const hashC = this.engineViscosity ? hash01(x0, y0, salt ^ 0x68bc21eb) : 0;
          const carrierOk = (target) => !this.engineViscosity || target === 0
            || TYPE[target] !== T_LIQUID || hashC < FLUID[target] / 255;
          const aFall = da > dc && (!ev || ((vy[oa] & 0x80) === 0 && this.bres(vy[oa] & 0x7F, sFrame))) && carrierOk(c);
          const cRise = ev && (vy[oc] & 0x80) !== 0 && dc > da && this.bres(vy[oc] & 0x7F, sFrame);
          if (aFall || cRise) {
            t = a; a = c; c = t; td = da; da = dc; dc = td; t = oa; oa = oc; oc = t;
          }
          const bFall = db > dd && (!ev || ((vy[ob] & 0x80) === 0 && this.bres(vy[ob] & 0x7F, sFrame))) && carrierOk(d);
          const dRise = ev && (vy[od] & 0x80) !== 0 && dd > db && this.bres(vy[od] & 0x7F, sFrame);
          if (bFall || dRise) {
            t = b; b = d; d = t; td = db; db = dd; dd = td; t = ob; ob = od; od = t;
          }
        }

        // 2. Diagonale quand la descente droite est bloquée.
        //    Vélocité : gatée par l'échéancier du mouvant quand la DESTINATION
        //    est un liquide (sinon les avalanches diagonales en escalier
        //    descendent un tas immergé à pleine cadence, comme dans du vide).
        //    Dans le vide/air : cadence d'origine (éboulement des tas intact).
        // (les particules en ascension balistique sont exclues des diagonales ;
        //  avec viscosité, les liquides glissent en diagonale à leur fluidité —
        //  l'huile avale ses pentes lentement, en cohérence avec son nivellement)
        const hashV = this.engineViscosity ? hash01(x0, y0, salt ^ 0x2545f491) : 0;
        const gA = () => {
          if (!ev) return true;
          if ((vy[oa] & 0x80) !== 0) return false;
          if (this.engineViscosity && TYPE[a] === T_LIQUID && hashV >= FLUID[a] / 255) return false;
          return d === 0 || this.bres(vy[oa] & 0x7F, sFrame);
        };
        const gB = () => {
          if (!ev) return true;
          if ((vy[ob] & 0x80) !== 0) return false;
          if (this.engineViscosity && TYPE[b] === T_LIQUID && hashV >= FLUID[b] / 255) return false;
          return c === 0 || this.bres(vy[ob] & 0x7F, sFrame);
        };
        if (rnd < 0.5) {
          if (da > dd && dc >= da && gA()) { t = a; a = d; d = t; td = da; da = dd; dd = td; t = oa; oa = od; od = t; }
          if (db > dc && dd >= db && gB()) { t = b; b = c; c = t; td = db; db = dc; dc = td; t = ob; ob = oc; oc = t; }
        } else {
          if (db > dc && dd >= db && gB()) { t = b; b = c; c = t; td = db; db = dc; dc = td; t = ob; ob = oc; oc = t; }
          if (da > dd && dc >= da && gA()) { t = a; a = d; d = t; td = da; da = dd; dd = td; t = oa; oa = od; od = t; }
        }

        next[i0] = a; next[i1] = b; next[i2] = c; next[i3] = d;
        vyN[i0] = vy[oa]; vyN[i1] = vy[ob]; vyN[i2] = vy[oc]; vyN[i3] = vy[od];
        vxN[i0] = vx[oa]; vxN[i1] = vx[ob]; vxN[i2] = vx[oc]; vxN[i3] = vx[od];
        flN[i0] = fl[oa]; flN[i1] = fl[ob]; flN[i2] = fl[oc]; flN[i3] = fl[od];
      }
    }
    this.swapBuffers();
  }

  // --- Passe d'écoulement : paires 2x1, règle enfichable (miroir de FLOW_FS) ---
  // sFrame/phase (vélocité) : les mouvements vx sont tentés sur la première
  // des 3 passes de chaque sous-pas (phase 0), avec le même échéancier de
  // Bresenham que vy — vx est donc en cases/frame, comme vy, quelle que soit
  // la résolution.
  flowStep(offsetX, salt, sFrame = 0, phase = 0) {
    const { w, h, grid, next, vy, vyN, vx, vxN, fl, flN } = this;
    next.set(grid);
    vyN.set(vy);
    vxN.set(vx);
    flN.set(fl);
    const self = this;
    const ev = this.engineVelocity;

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

        // Mouvement vx (vélocité, phase 0) : une particule à vitesse latérale
        // se déplace vers une case VIDE adjacente (uniquement — jamais dans un
        // liquide : c'est le mécanisme qui recréerait les jets en X).
        if (ev && phase === 0) {
          const mxL = vx[iL] & 0x7F;
          const mxR = vx[iR] & 0x7F;
          let vxSwap = false;
          if (L !== 0 && R === 0 && mxL > 0 && (vx[iL] & 0x80) === 0 && self.bres(mxL, sFrame)) vxSwap = true;
          else if (R !== 0 && L === 0 && mxR > 0 && (vx[iR] & 0x80) !== 0 && self.bres(mxR, sFrame)) vxSwap = true;
          if (vxSwap) {
            next[iL] = R; next[iR] = L;
            vyN[iL] = vy[iR]; vyN[iR] = vy[iL];
            vxN[iL] = vx[iR]; vxN[iR] = vx[iL];
            flN[iL] = fl[iR]; flN[iR] = fl[iL];
            continue;
          }
        }

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
          rnd2: hash01(x0, y, salt ^ 0x7f4a7c15),
        };
        if (self.flowRule(ctx)) {
          next[iL] = R;
          next[iR] = L;
          vyN[iL] = vy[iR]; vyN[iR] = vy[iL];
          vxN[iL] = vx[iR]; vxN[iR] = vx[iL];
          flN[iL] = fl[iR]; flN[iR] = fl[iL];
        }
      }
    }
    this.swapBuffers();
  }

  // --- Boucle de frame : miroir exact de frame() dans gpu.worker.js ---
  frame() {
    for (let s = 0; s < this.substepsPerFrame; s++) {
      const off = this.OFFSETS[this.substepCounter % 4];
      this.substepCounter++;
      this.gravityStep(off[0], off[1], this.substepCounter, s);
      for (let f = 0; f < this.flowPassesPerStep; f++) {
        this.flowStep(this.flowCounter & 1, 7777 + this.flowCounter, s, f);
        this.flowCounter++;
      }
    }
    // Mode vélocité : dérive de phase des offsets (+1 « sous-pas fantôme » par
    // frame). Sans elle, l'échéancier de Bresenham d'une vitesse m diviseur de
    // S retombe chaque frame sur les MÊMES sous-pas, donc les MÊMES offsets de
    // Margolus (S multiple de 4) : une particule lente à parité défavorable ne
    // serait jamais appariée verticalement avec sa case du dessous → figée.
    if (this.engineVelocity) this.substepCounter++;
  }

  // --- Outils de construction de scénarios ---
  // Écrire une cellule remet sa charge utile à zéro, sauf vy optionnel :
  // avec le moteur de vélocité, le pinceau émet des vitesses initiales
  // randomisées (0..3) — le levier anti-colonnes le plus puissant
  // (désynchronisation à la source, standard Noita/Powder Toy).
  set(x, y, id, vy0 = 0) {
    if (x >= 0 && x < this.w && y >= 0 && y < this.h) {
      const i = y * this.w + x;
      this.grid[i] = id;
      this.vy[i] = vy0;
      this.vx[i] = 0;
      this.fl[i] = 0;
    }
  }

  emitVy(rng) {
    return this.engineVelocity ? (rng() * 4) | 0 : 0;
  }

  get(x, y) {
    return this.grid[y * this.w + x];
  }

  fillRect(x0, y0, x1, y1, material, rng) {
    const ids = MATERIAL_IDS[material];
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        this.set(x, y, ids[(rng() * ids.length) | 0], this.emitVy(rng));
      }
    }
  }

  paintDisc(cx, cy, r, material, rng) {
    const ids = MATERIAL_IDS[material];
    const r2 = r * r;
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        const dx = x - cx; const dy = y - cy;
        if (dx * dx + dy * dy <= r2) this.set(x, y, ids[(rng() * ids.length) | 0], this.emitVy(rng));
      }
    }
  }
}

module.exports = { Sim, makeRng, hash01 };
