// Réplique CPU exacte de l'automate GPU (gpu.worker.js) pour tester la physique
// hors navigateur : mêmes blocs Margolus, mêmes offsets, même boucle de frame.
// La passe d'écoulement est enfichable (lab/rules/*.js) pour comparer des
// variantes de règles sur les mêmes scénarios.

const {
  DENS, TYPE, FLUID, FLAM, MATERIAL_IDS,
  T_SOLID, T_LIQUID, T_STATIC, T_GAS, T_FIRE,
} = require('./materials');

// Immobile et indéplaçable : la pierre (barrières) et le feu (état qui brûle
// sur place — les flammes qui « montent » sont des langues spawnées au-dessus).
function movable(id) {
  const t = TYPE[id];
  return t !== T_STATIC && t !== T_FIRE;
}

// --- Moteur thermique (v12) ---
const AMBIENT = 32;
// Conductivité par matériau (en /64 par paire de voisins, max sûr ~12 :
// la somme des 4 paires doit rester < 64 pour une diffusion stable).
const COND = new Uint8Array(256).fill(6);
COND[0] = 1; // l'AIR est un vrai isolant (k=1) : la chaleur y voyage par
             // CONVECTION (les panaches montent sans saigner latéralement)
function setCond(idStart, k) { for (let i = idStart; i < idStart + 10; i++) COND[i] = k; }
setCond(100, 3);  // sable
setCond(110, 8);  // eau (bonne conductrice : refroidit vite la lave)
setCond(120, 5);  // huile
setCond(130, 6);  // alcool
setCond(140, 5);  // pierre (conduit assez pour faire bouillir au travers de la croûte)
setCond(150, 2);  // bois (isolant)
setCond(160, 8);  // feu (rayonne fort)
setCond(170, 6);  // fumée
setCond(180, 6);  // vapeur
setCond(190, 5);  // lave
setCond(200, 8);  // glace (mord fort : la banquise gagne contre la rechauffe)
setCond(210, 3);  // plante
setCond(220, 3);  // poudre
// Convection : bonus de conductivité VERTICALE quand la cellule du dessous
// est de l'air/du gaz plus chaud (les panaches montent).
const CONV_BONUS = 24;
// Capacité thermique (décalage) : 1 = chauffe/refroidit 2x plus lentement à
// flux égal — l'eau est un énorme tampon (elle refroidit la lave AVANT de
// bouillir), sans quoi elle flashe en vapeur avant que la croûte ne prenne.
const HEATCAP = new Uint8Array(256);
for (let i = 110; i <= 119; i++) HEATCAP[i] = 1; // eau
for (let i = 200; i <= 209; i++) HEATCAP[i] = 1; // glace
for (let i = 170; i <= 189; i++) HEATCAP[i] = 3; // gaz : adiabatiques en plein air (refroidissent par CONTACT froid : plafonds, murs, sommet du monde)
// Température initiale à la pose (pinceau / scénarios).
function initTemp(id) {
  if (id >= 190 && id <= 199) return 255; // lave
  if (TYPE[id] === T_FIRE) return 220;
  if (id >= 200 && id <= 209) return 4;   // glace (réservoir de froid)
  if (id >= 170 && id <= 179) return 180;  // fumée (née très chaude : longue montée)
  if (id >= 180 && id <= 189) return 170;  // vapeur (chaleur latente embarquée)
  return AMBIENT;
}

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
    this.engineTransforms = !!eng.transforms;
    this.engineHeat = !!eng.heat;
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
    if (this.engineHeat) this.fl.fill(AMBIENT); // le monde démarre à l''ambiant
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

  // Transformations (feu/fumée/vapeur/combustion) : chaque cellule décide de
  // SON propre sort d'après ses voisins lus dans l'instantané pré-frame
  // (this.next sert de snapshot) — sans conflit, comme les invocations GPU.
  // Renvoie true si le sort de la cellule est entièrement réglé pour la frame.
  transformCell(i, x, y, salt) {
    const { w, h, grid, next, vy, vx, fl, flN } = this;
    const id = next[i]; // état pré-frame
    const type = TYPE[id];
    const up = y > 0 ? next[i - w] : 0;
    const dn = y + 1 < h ? next[i + w] : 0;
    const lf = x > 0 ? next[i - 1] : 0;
    const rt = x + 1 < w ? next[i + 1] : 0;
    const r1 = hash01(x, y, salt ^ 0x51f15e0d);
    const r2 = hash01(x, y, salt ^ 0x3c6ef372);
    const variant = (r2 * 10) | 0;

    const isWater = (v) => v >= 110 && v <= 119;
    const isLava = (v) => v >= 190 && v <= 199;
    const isIce = (v) => v >= 200 && v <= 209;
    const isPowder = (v) => v >= 220 && v <= 229;
    const isPlant = (v) => v >= 210 && v <= 219;
    // « chaud » = feu ou lave (les deux embrasent / font fondre / vaporisent)
    const hot = (v) => TYPE[v] === T_FIRE || isLava(v);
    // souffle : feu d'explosion (bit 7 de la durée de vie, payload pré-frame)
    const blastAt = (j, v) => TYPE[v] === T_FIRE && (flN[j] & 0x80) !== 0;

    // Vide : langues de flammes et fumée naissent AU-DESSUS d'un feu/de la lave.
    if (id === 0) {
      if (TYPE[dn] === T_FIRE || isLava(dn)) {
        const pFlame = isLava(dn) ? 0.04 : 0.12;
        const pSmoke = isLava(dn) ? 0.06 : 0.16;
        if (r1 < pFlame) {
          grid[i] = 160 + variant; // langue de flamme, vie courte
          fl[i] = 4 + ((r2 * 5) | 0);
          vy[i] = 0; vx[i] = 0;
          return true;
        }
        if (r1 < pSmoke) {
          grid[i] = 170 + variant; // bouffée de fumée
          fl[i] = 0;
          vy[i] = 0; vx[i] = 0;
          return true;
        }
      }
      return false;
    }

    const nearHot = hot(up) || hot(dn) || hot(lf) || hot(rt);
    const nearWater = isWater(up) || isWater(dn) || isWater(lf) || isWater(rt);
    const nearBlast = (y > 0 && blastAt(i - w, up)) || (y + 1 < h && blastAt(i + w, dn))
      || (x > 0 && blastAt(i - 1, lf)) || (x + 1 < w && blastAt(i + 1, rt));

    // Feu : vit sur place, éteint par l'eau, meurt en fumée ou en rien.
    // Le bit 7 de la durée de vie marque un feu d'EXPLOSION (souffle).
    if (type === T_FIRE) {
      const blastBit = fl[i] & 0x80;
      let life = fl[i] & 0x7F;
      if (life === 0) life = 25 + ((r2 * 30) | 0); // allumage frais
      if (nearWater && r1 < 0.6) {
        grid[i] = 170 + variant; fl[i] = 0; vy[i] = 0; vx[i] = 0;
        return true;
      }
      life--;
      if (life <= 1) {
        grid[i] = r1 < 0.75 ? 0 : 170 + variant;
        fl[i] = 0; vy[i] = 0; vx[i] = 0;
      } else {
        fl[i] = blastBit | life;
      }
      return true;
    }

    // Gaz (fumée/vapeur) : durée de vie, montée, wobble ; la vapeur se
    // condense (pluie), plus vite sous un plafond.
    if (type === T_GAS) {
      const isSteam = id >= 180;
      if (fl[i] === 0) fl[i] = isSteam ? 100 + ((r2 * 100) | 0) : 70 + ((r2 * 80) | 0);
      fl[i] -= (y > 0 && up !== 0) ? 3 : 1; // plafond : dissipation/condensation accélérée
      if (fl[i] <= 1) {
        if (isSteam && r1 < 0.5) {
          grid[i] = 110 + variant; // condensation : goutte de pluie
          fl[i] = 0; vy[i] = 0; vx[i] = 0;
        } else {
          grid[i] = 0; fl[i] = 0; vy[i] = 0; vx[i] = 0;
        }
        return true;
      }
      vy[i] = 0x80 | Math.max(3, this.substepsPerFrame >> 2); // poussée d'Archimède (proportionnelle à la résolution)
      if (r1 < 0.3) vx[i] = (r2 < 0.5 ? 0x80 : 0) | 1; // wobble du panache
      return true;
    }

    // Poudre : EXPLOSE au contact du chaud ou d'un souffle (chaîne éclair).
    if (isPowder(id) && (nearHot || nearBlast) && r1 < 0.9) {
      grid[i] = 160 + variant;
      fl[i] = 0x80 | (5 + ((r2 * 5) | 0)); // feu d'explosion : bref + souffle
      vy[i] = 0; vx[i] = 0;
      return true;
    }

    // Souffle : une cellule mobile voisine d'un feu d'explosion est ÉJECTÉE
    // (impulsion balistique loin du souffle, avec une composante vers le haut
    // même en latéral : les explosions soulèvent) — c'est l'onde de choc.
    if (nearBlast && movable(id) && type !== T_STATIC && r1 < 0.8) {
      const S = this.substepsPerFrame;
      const fromBelow = y + 1 < h && blastAt(i + w, dn);
      const fromLeft = x > 0 && blastAt(i - 1, lf);
      const fromRight = x + 1 < w && blastAt(i + 1, rt);
      vy[i] = 0x80 | (fromBelow ? (S >> 1) : Math.max(1, S >> 2));
      if (fromLeft && !fromRight) vx[i] = S >> 2;          // poussée à droite
      else if (fromRight && !fromLeft) vx[i] = 0x80 | (S >> 2); // à gauche
      else if (r1 < 0.4) vx[i] = (r2 < 0.5 ? 0x80 : 0) | (S >> 2);
      return true;
    }

    // Lave : fige en PIERRE au contact de l'eau (l'eau, elle, se vaporise).
    if (isLava(id) && nearWater && r1 < 0.7) {
      grid[i] = 140 + variant; fl[i] = 0; vy[i] = 0; vx[i] = 0;
      return true;
    }

    // Glace : fond au contact du chaud.
    if (isIce(id) && nearHot && r1 < 0.5) {
      grid[i] = 110 + variant; fl[i] = 0; vy[i] = 0; vx[i] = 0;
      return true;
    }

    // Combustion : un inflammable au contact du chaud s'embrase (durée de vie
    // de la flamme selon le combustible : alcool bref et vif, bois durable).
    if (FLAM[id] > 0 && nearHot && r1 < (FLAM[id] / 255) * 0.3) {
      grid[i] = 160 + variant;
      fl[i] = 20 + ((255 - FLAM[id]) >> 1) + ((r2 * 10) | 0);
      vy[i] = 0; vx[i] = 0;
      return true;
    }

    // Eau : vaporisée par le chaud ; gelée (lentement) par la glace adjacente ;
    // bue par une plante adjacente (c'est ainsi que la plante pousse).
    if (isWater(id)) {
      if (nearHot && r1 < 0.3) {
        grid[i] = 180 + variant; fl[i] = 0; vy[i] = 0; vx[i] = 0;
        return true;
      }
      if ((isIce(up) || isIce(dn) || isIce(lf) || isIce(rt)) && r1 < 0.015) {
        grid[i] = 200 + variant; fl[i] = 0; vy[i] = 0; vx[i] = 0;
        return true;
      }
      if ((isPlant(up) || isPlant(dn) || isPlant(lf) || isPlant(rt)) && r1 < 0.06) {
        grid[i] = 210 + variant; fl[i] = 0; vy[i] = 0; vx[i] = 0;
        return true;
      }
    }

    return false;
  }

  // Passe thermique + transformations (v12) pour UNE cellule, sur l'état
  // pré-frame. Diffusion entière stable (somme des 4 paires < 64/64), avec
  // convection : la conductivité verticale est dopée quand la cellule du
  // dessous est de l'air/du gaz plus chaud. Renvoie true si la cellule est
  // entièrement gérée (air, feu, gaz, transformée).
  transformCellHeat(i, x, y, salt) {
    const { w, h, grid, next, vy, vx, vxN, fl, flN } = this;
    const id = next[i]; // état pré-frame
    const type = TYPE[id];
    const r1 = hash01(x, y, salt ^ 0x51f15e0d);
    const r2 = hash01(x, y, salt ^ 0x3c6ef372);
    const variant = (r2 * 10) | 0;

    const idUp = y > 0 ? next[i - w] : 0;
    const idDn = y + 1 < h ? next[i + w] : 0;
    const idLf = x > 0 ? next[i - 1] : 0;
    const idRt = x + 1 < w ? next[i + 1] : 0;
    const tUp = y > 0 ? flN[i - w] : AMBIENT;
    const tDn = y + 1 < h ? flN[i + w] : AMBIENT;
    const tLf = x > 0 ? flN[i - 1] : AMBIENT;
    const tRt = x + 1 < w ? flN[i + 1] : AMBIENT;

    // --- 1. Diffusion (les bords du monde sont à l'ambiant) ---
    const myK = COND[id];
    let T = flN[i];
    // Le bonus convectif ne concerne que l'AIR PUR : les gaz (fumée, vapeur)
    // transportent leur chaleur en SE DÉPLAÇANT, pas en super-conduisant —
    // sinon un panache de fumée se vide de sa chaleur en quelques frames.
    let kUp = Math.min(myK, COND[idUp]);
    let kDn = Math.min(myK, COND[idDn]);
    if (idDn === 0 && tDn > T) kDn += CONV_BONUS; // je reçois le panache d'en bas
    if (id === 0 && T > tUp) kUp += CONV_BONUS;   // je suis l'air chaud qui donne
    let kLf = Math.min(myK, COND[idLf]);
    let kRt = Math.min(myK, COND[idRt]);
    // Conduction gaz<->liquide FAIBLE : une goutte qui retombe à travers un
    // panache de vapeur chaude ne doit pas re-bouillir en vol (sinon boucle
    // bouillir/condenser = blizzard churné dans le nuage).
    const gl = (a2, b2) => (TYPE[a2] === T_GAS && TYPE[b2] === T_LIQUID) || (TYPE[a2] === T_LIQUID && TYPE[b2] === T_GAS);
    if (gl(id, idUp)) kUp = Math.min(kUp, 2);
    if (gl(id, idDn)) kDn = Math.min(kDn, 2);
    if (gl(id, idLf)) kLf = Math.min(kLf, 2);
    if (gl(id, idRt)) kRt = Math.min(kRt, 2);
    const acc = (tUp - T) * kUp + (tDn - T) * kDn + (tLf - T) * kLf + (tRt - T) * kRt;
    const capSh = 6 + HEATCAP[id];
    const dither = (hash01(x, y, salt ^ 0x7ed55d16) * (1 << capSh)) | 0;
    T += (acc + dither) >> capSh;
    if (id >= 190 && id <= 199) T += (255 - T) >> 4; // masse thermique de la lave
    if (id === 0) T += (AMBIENT - T) >> 6; // l'air dissipe doucement vers l'ambiant
    if (T < 0) T = 0;
    if (T > 255) T = 255;

    const isWater = (v) => v >= 110 && v <= 119;
    const isLava = (v) => v >= 190 && v <= 199;
    const isIce = (v) => v >= 200 && v <= 209;
    const isPlant = (v) => v >= 210 && v <= 219;
    const isPowder = (v) => v >= 220 && v <= 229;
    // souffle : feu d'explosion (bit 7 du combustible, désormais dans vx)
    const blastAt = (j, v) => TYPE[v] === T_FIRE && (vxN[j] & 0x80) !== 0;

    // --- 2. Air : porte la température, fait naître les langues de flammes ---
    if (id === 0) {
      fl[i] = T;
      if (TYPE[idDn] === T_FIRE || isLava(idDn)) {
        const pFlame = isLava(idDn) ? 0.04 : 0.12;
        const pSmoke = isLava(idDn) ? 0.06 : 0.16;
        if (r1 < pFlame) {
          grid[i] = 160 + variant;
          vx[i] = 4 + ((r2 * 5) | 0); // langue : combustible bref
          fl[i] = 220; vy[i] = 0;
          return true;
        }
        if (r1 < pSmoke) {
          grid[i] = 170 + variant;
          fl[i] = 140; vy[i] = 0; vx[i] = 0; // fumée née chaude
          return true;
        }
      }
      vy[i] = 0; vx[i] = 0;
      return true;
    }

    const nearWater = isWater(idUp) || isWater(idDn) || isWater(idLf) || isWater(idRt);
    const nearBlast = (y > 0 && blastAt(i - w, idUp)) || (y + 1 < h && blastAt(i + w, idDn))
      || (x > 0 && blastAt(i - 1, idLf)) || (x + 1 < w && blastAt(i + 1, idRt));

    // --- 3. Feu : SOURCE de chaleur (T=220), combustible dans vx, immobile ---
    if (type === T_FIRE) {
      const blastBit = vx[i] & 0x80;
      let fuel = vx[i] & 0x7F;
      if (fuel === 0) fuel = 25 + ((r2 * 30) | 0); // allumage frais (pinceau)
      if (nearWater && r1 < 0.6) {
        grid[i] = 170 + variant; fl[i] = 140; vy[i] = 0; vx[i] = 0;
        return true;
      }
      fuel--;
      if (fuel <= 1) {
        grid[i] = r1 < 0.75 ? 0 : 170 + variant;
        fl[i] = r1 < 0.75 ? T : 140;
        vy[i] = 0; vx[i] = 0;
      } else {
        vx[i] = blastBit | fuel;
        fl[i] = 220; // le feu maintient sa température
        vy[i] = 0;
      }
      return true;
    }

    // --- 4. Gaz : montée + wobble ; condensation/dissipation PAR REFROIDISSEMENT ---
    if (type === T_GAS) {
      const isSteam = id >= 180;
      if (y === 0) T = Math.max(0, T - 8); // le sommet du monde est un ciel ouvert
      if (isSteam && T < 60) {
        grid[i] = 110 + variant; fl[i] = T; vy[i] = 0; vx[i] = 0; // pluie
        return true;
      }
      if (!isSteam && T < 40) {
        grid[i] = 0; fl[i] = T; vy[i] = 0; vx[i] = 0; // la fumée froide se dissout
        return true;
      }
      fl[i] = T;
      vy[i] = 0x80 | 2;
      if (r1 < 0.3) vx[i] = (r2 < 0.5 ? 0x80 : 0) | 1;
      return true;
    }

    // --- 5. Poudre : explose dès 90 degrés ou au souffle ---
    if (isPowder(id) && ((T >= 90 && r1 < 0.9) || (nearBlast && r1 < 0.9))) {
      grid[i] = 160 + variant;
      vx[i] = 0x80 | (5 + ((r2 * 5) | 0));
      fl[i] = 220; vy[i] = 0;
      return true;
    }

    // --- 6. Souffle : éjection balistique des voisins mobiles ---
    if (nearBlast && movable(id) && type !== T_STATIC && r1 < 0.8) {
      const S = this.substepsPerFrame;
      const fromBelow = y + 1 < h && blastAt(i + w, idDn);
      const fromLeft = x > 0 && blastAt(i - 1, idLf);
      const fromRight = x + 1 < w && blastAt(i + 1, idRt);
      vy[i] = 0x80 | (fromBelow ? (S >> 1) : Math.max(1, S >> 2));
      if (fromLeft && !fromRight) vx[i] = S >> 2;
      else if (fromRight && !fromLeft) vx[i] = 0x80 | (S >> 2);
      else if (r1 < 0.4) vx[i] = (r2 < 0.5 ? 0x80 : 0) | (S >> 2);
      fl[i] = T;
      return true;
    }

    // --- 7. Transitions de phase par température ---
    // Lave : figeage DOUX (équilibres mesurés : ~201° à l'air libre, ~183°
    // sous l'eau — protégée par son matelas de vapeur, effet Leidenfrost
    // émergent). < 170 : fige toujours ; 170-190 : probabiliste (plus c'est
    // froid, plus vite) ; >= 190 : reste en fusion. Refond à 230 (hystérésis).
    // ... et UNIQUEMENT posée (du soutien dessous) : une coulée EN CHUTE ne
    // fige jamais en vol (sinon : pierre statique qui lévite en plein air).
    // ... ET au repos (vitesse ~nulle) : une colonne de coulée a du soutien
    // local mais elle BOUGE — seule la lave posée et immobile peut croûter.
    // ... ET sans voisin d'air (les bords d'un jet en chute sont exclus : les
    // embouteillages transitoires de la file d'attente ne croûtent plus en vol).
    const lavaSupported = y + 1 >= h || idDn !== 0;
    const lavaAtRest = (vy[i] & 0x80) === 0 && (vy[i] & 0x7F) <= 1;
    const noAirNeighbor = idUp !== 0 && idDn !== 0 && idLf !== 0 && idRt !== 0;
    if (isLava(id) && lavaSupported && lavaAtRest && (noAirNeighbor || y + 1 >= h) && T < 190
        && (T < 150 || r1 < (190 - T) * 0.012)) {
      grid[i] = 140 + variant; fl[i] = T; vy[i] = 0; vx[i] = 0;
      return true;
    }
    if (id >= 140 && id <= 149 && T >= 230) { // la pierre fond en lave
      grid[i] = 190 + variant; fl[i] = T; vy[i] = 0; vx[i] = 0;
      return true;
    }
    if (isIce(id) && T >= 40) { // la glace fond
      grid[i] = 110 + variant; fl[i] = T; vy[i] = 0; vx[i] = 0;
      return true;
    }
    if (isWater(id)) {
      if (T >= 100) { // ébullition : la vapeur emporte la chaleur latente
        grid[i] = 180 + variant; fl[i] = Math.max(T, 170); vy[i] = 0; vx[i] = 0;
        return true;
      }
      if (T <= 24) { // gel (hystérésis avec la fonte à 40 ; ambiant 32 = sûr)
        // la glace fraîche naît plus froide (chaleur latente de solidification
        // évacuée) : le front de banquise se propage en s'affaiblissant
        grid[i] = 200 + variant; fl[i] = Math.max(0, T - 8); vy[i] = 0; vx[i] = 0;
        return true;
      }
      // une plante adjacente boit l'eau (croissance, non thermique)
      if ((isPlant(idUp) || isPlant(idDn) || isPlant(idLf) || isPlant(idRt)) && r1 < 0.06) {
        grid[i] = 210 + variant; fl[i] = T; vy[i] = 0; vx[i] = 0;
        return true;
      }
    }
    // Ignition par CONTACT direct avec feu/lave (flamme-pilote chimique)
    if (FLAM[id] > 0) {
      const hot = (v) => TYPE[v] === T_FIRE || isLava(v);
      if ((hot(idUp) || hot(idDn) || hot(idLf) || hot(idRt)) && r1 < (FLAM[id] / 255) * 0.3) {
        grid[i] = 160 + variant;
        vx[i] = 20 + ((255 - FLAM[id]) >> 1) + ((r2 * 10) | 0);
        fl[i] = 220; vy[i] = 0;
        return true;
      }
    }
    // Ignition par température (bois 150, plante 130, huile 120, alcool 105)
    if (FLAM[id] > 0) {
      const ign = id >= 150 && id <= 159 ? 150
        : (isPlant(id) ? 130 : (id >= 120 && id <= 129 ? 120 : 105));
      if (T >= ign && r1 < 0.5) {
        grid[i] = 160 + variant;
        vx[i] = 20 + ((255 - FLAM[id]) >> 1) + ((r2 * 10) | 0);
        fl[i] = 220; vy[i] = 0;
        return true;
      }
    }

    // --- 8. Rien à transformer : on stocke la température et on continue ---
    fl[i] = T;
    if (type === T_STATIC) { vy[i] = 0; vx[i] = 0; return true; }
    return false;
  }

  velocityUpdate(salt) {
    const { w, h, grid, vy, vyN, vx } = this;
    const S = this.substepsPerFrame;
    // Plafond en liquide : S/2 stocké -> ~S/4 effectif. Une particule lente ne
    // tombe qu'à ~m/2 par frame (taxe d'alignement : ses sous-pas programmés ne
    // coïncident avec le bon appariement Margolus qu'une frame sur deux).
    const capLiquid = Math.max(1, S >> 1);
    vyN.set(vy); // instantané pré-mise-à-jour
    if (this.engineTransforms || this.engineHeat) {
      this.next.set(grid);   // snapshot ids pré-frame
      this.flN.set(this.fl); // snapshot durées de vie / températures
      if (this.engineHeat) this.vxN.set(this.vx); // combustible du feu (souffles)
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (this.engineHeat) {
          if (this.transformCellHeat(i, x, y, salt)) continue;
        } else if (this.engineTransforms && this.transformCell(i, x, y, salt)) {
          continue;
        }
        const id = grid[i];
        if (id === 0) { vy[i] = 0; vx[i] = 0; continue; }
        if (TYPE[id] === T_STATIC) { vy[i] = 0; vx[i] = 0; continue; }

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
            if (da > dd && dc > dd && movable(a) && movable(d) && !(TYPE[a] === T_SOLID && TYPE[d] === T_SOLID) && (vy[oa] & 0x80) === 0 && this.bres(vy[oa] & 0x7F, sFrame)) {
              t = a; a = d; d = t; td = da; da = dd; dd = td; t = oa; oa = od; od = t;
            } else if (db > dc && dd > dc && movable(b) && movable(c) && !(TYPE[b] === T_SOLID && TYPE[c] === T_SOLID) && (vy[ob] & 0x80) === 0 && this.bres(vy[ob] & 0x7F, sFrame)) {
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
          // Paires échangeables : ni pierre ni feu (immobiles/indéplaçables),
          // et jamais solide-à-travers-solide (le sable ne percole pas le bois).
          const pairOk = (m, n) => movable(m) && movable(n)
            && !(TYPE[m] === T_SOLID && TYPE[n] === T_SOLID);
          const aFall = da > dc && pairOk(a, c) && (!ev || ((vy[oa] & 0x80) === 0 && this.bres(vy[oa] & 0x7F, sFrame))) && carrierOk(c);
          const cRise = ev && (vy[oc] & 0x80) !== 0 && dc > da && pairOk(c, a) && this.bres(vy[oc] & 0x7F, sFrame);
          if (aFall || cRise) {
            t = a; a = c; c = t; td = da; da = dc; dc = td; t = oa; oa = oc; oc = t;
          }
          const bFall = db > dd && pairOk(b, d) && (!ev || ((vy[ob] & 0x80) === 0 && this.bres(vy[ob] & 0x7F, sFrame))) && carrierOk(d);
          const dRise = ev && (vy[od] & 0x80) !== 0 && dd > db && pairOk(d, b) && this.bres(vy[od] & 0x7F, sFrame);
          if (bFall || dRise) {
            t = b; b = d; d = t; td = db; db = dd; dd = td; t = ob; ob = od; od = t;
          }

          // 1ter. Diagonale ASCENDANTE des gaz (miroir de l'éboulement des
          //       tas) : un gaz bloqué droit au-dessus glisse en diagonale-haut
          //       vers l'air — les nuages s'étalent sous les plafonds au lieu
          //       de rester en blocs.
          if (ev) {
            const gasDiag = (oSrc, idSrc, idDiag, idAbove) =>
              TYPE[idSrc] === T_GAS && idDiag === 0 && idAbove !== 0
              && (vy[oSrc] & 0x80) !== 0 && this.bres(vy[oSrc] & 0x7F, sFrame);
            // c (bas-gauche) monte en diagonale vers b (haut-droit)
            if (gasDiag(oc, c, b, a)) {
              t = b; b = c; c = t; td = db; db = dc; dc = td; t = ob; ob = oc; oc = t;
            } else if (gasDiag(od, d, a, b)) {
              t = a; a = d; d = t; td = da; da = dd; dd = td; t = oa; oa = od; od = t;
            }
          }

          // 1bis. CONVECTION réelle (chaleur) : deux cellules d'AIR superposées
          //       échangent leur charge utile si celle du bas est plus chaude —
          //       l'air chaud MONTE à la cadence des sous-pas (panaches rapides).
          //       Ids identiques : seule la chaleur voyage, rien ne bouge à l'écran.
          if (this.engineHeat) {
            if (a === 0 && c === 0 && fl[oc] > fl[oa]) {
              t = oa; oa = oc; oc = t;
            }
            if (b === 0 && d === 0 && fl[od] > fl[ob]) {
              t = ob; ob = od; od = t;
            }
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
          if (ev && !(movable(a) && movable(d) && !(TYPE[a] === T_SOLID && TYPE[d] === T_SOLID))) return false;
          if (!ev) return true;
          if ((vy[oa] & 0x80) !== 0) return false;
          if (this.engineViscosity && TYPE[a] === T_LIQUID && hashV >= FLUID[a] / 255) return false;
          return d === 0 || this.bres(vy[oa] & 0x7F, sFrame);
        };
        const gB = () => {
          if (ev && !(movable(b) && movable(c) && !(TYPE[b] === T_SOLID && TYPE[c] === T_SOLID))) return false;
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
    const openAbove = (p) => {
      if (p.y - 1 < 0) return true;
      const a = grid[(p.y - 1) * w + p.x];
      return a === 0 || TYPE[a] === T_GAS; // un gaz au-dessus = surface ouverte
    };

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
          // (le feu stocke son COMBUSTIBLE dans vx, et les immobiles ne
          //  glissent pas : exclus du mouvement latéral)
          const mobileL = TYPE[L] !== T_FIRE && TYPE[L] !== T_STATIC;
          const mobileR = TYPE[R] !== T_FIRE && TYPE[R] !== T_STATIC;
          if (mobileL && L !== 0 && R === 0 && mxL > 0 && (vx[iL] & 0x80) === 0 && self.bres(mxL, sFrame)) vxSwap = true;
          else if (mobileR && R !== 0 && L === 0 && mxR > 0 && (vx[iR] & 0x80) !== 0 && self.bres(mxR, sFrame)) vxSwap = true;
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
      this.fl[i] = this.engineHeat ? initTemp(id) : 0;
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
