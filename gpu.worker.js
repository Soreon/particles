/* eslint-disable no-bitwise */
//
// gpu.worker.js — Simulation + rendu sur GPU (WebGL2).
//
// Tout l'état de la grille vit dans des textures entières R8UI (un texel = un id
// de matériau). On fait du ping-pong entre deux textures : la passe de simulation
// lit l'une et écrit l'autre, puis on échange. Le rendu lit la texture courante et
// la transforme en couleurs via une palette, le tout upscalé gratuitement par le
// GPU (canvas en résolution grille, agrandi en CSS avec image-rendering: pixelated).
//
// Physique : passe de gravité (automate de Margolus, blocs 2x2) + passe
// d'écoulement (paires 2x1) — règles validées par la réplique CPU (lab/).
// Compteurs de particules : readback asynchrone (PBO + fence) toutes les
// COUNT_INTERVAL frames, sans jamais bloquer le pipeline GPU.

let gl = null;
let canvas = null;

let gridWidth = 0;
let gridHeight = 0;

// Ping-pong : deux textures d'état + leurs framebuffers. `current` est l'index
// (0 ou 1) de la texture qui contient l'état à jour / à lire.
const stateTex = [null, null];
const stateFbo = [null, null];
let current = 0;

let paletteTex = null; // 256x1 RGBA8 : couleur par id de matériau
// propsTex sera utilisée en Phase 2 (densité / type) ; on la prépare déjà.
let propsTex = null;

let simProgram = null;
let flowProgram = null;
let renderProgram = null;

// Nombre de sous-pas de simulation par frame (chacun fait avancer la matière
// d'environ une case). Plus il est élevé, plus l'écoulement est rapide.
let substepsPerFrame = 8;
// Passes d'écoulement horizontal des liquides PAR pas de gravité (entrelacées).
// Chaque passe déplace une case ; plus c'est élevé, plus l'eau se disperse/nivelle vite.
let flowPassesPerFrame = 3;
// Pavage de Margolus décalé à chaque sous-pas pour couvrir tous les alignements.
const OFFSETS = [[0, 0], [1, 1], [1, 0], [0, 1]];
let substepCounter = 0;
let flowCounter = 0;

// Localisations d'uniformes mises en cache.
let uSimState = null;
let uSimProps = null;
let uSimOffset = null;
let uSimGrid = null;
let uSimSeed = null;
let uSimFrameSub = null;
let uSimSubsteps = null;
let uSimGravity = null;
let uSimJitterP = null;

// Accélération (cases/frame²) : échelle avec les sous-pas pour un ressenti
// identique à toute résolution (référence labo : G=1 pour S=8).
let gravityG = 1;
// Probabilité de glissade de traînée en vol (anti-colonne de largeur 1).
const JITTER_P = 0.08;
let uFlowState = null;
let uFlowProps = null;
let uFlowOffsetX = null;
let uFlowGrid = null;
let uFlowSeed = null;
let uFlowSub = null;
let uFlowPhase = null;
let uFlowSubsteps = null;
let uRenderState = null;
let uRenderPalette = null;
let uRenderGrid = null;
let uRenderMouse = null;
let uRenderToolSize = null;
let uRenderDragging = null;
let uRenderRingHalfWidth = null;
let uRenderDebugView = null;
// Demi-épaisseur de l'anneau du curseur, en texels : proportionnelle à la
// résolution pour rester visible à l'écran, min 0.75 pour éviter les trous
// (la distance max cercle->centre de cellule est ~0.707).
let ringHalfWidth = 0.75;
// Vue de debug du rendu : 0 = normal, 1 = vy, 2 = vx, 3 = flags.
let debugView = 0;

// Tampon CPU réutilisé pour estampiller le pinceau (4 octets/texel : RGBA8UI).
let brushPatch = new Uint8Array(4);

// État souris reçu du thread principal (coordonnées en cases de la grille).
const mouse = { x: -1, y: -1, toolSize: 1, dragging: false };

// tool -> liste d'ids candidats (pour choisir une variante de couleur au hasard)
let toolIds = {};

// --- Mesure FPS ---
let frameCount = 0;
let lastFpsTime = 0;

// --- Comptage des particules (readback asynchrone PBO, jamais bloquant) ---
const COUNT_INTERVAL = 30; // frames entre deux lancements de readback
let frameIndex = 0;
let countPbo = null;
let countSync = null;
let countArray = null;  // Uint8Array (lecture compacte) ou Uint32Array (repli RGBA)
let countStep = 1;      // éléments de countArray par texel
let countFormat = 0;
let countType = 0;
let bucketOf = null;    // id de matériau -> index de compteur + 1 (0 = ignorer)
let bucketNames = [];   // index de compteur -> nom du matériau

// ---------------------------------------------------------------------------
// Helpers WebGL
// ---------------------------------------------------------------------------

function compileShader(type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    console.error('Shader compile error:', log, '\n', source);
    throw new Error('Shader compile failed: ' + log);
  }
  return shader;
}

function createProgram(vsSource, fsSource) {
  const program = gl.createProgram();
  gl.attachShader(program, compileShader(gl.VERTEX_SHADER, vsSource));
  gl.attachShader(program, compileShader(gl.FRAGMENT_SHADER, fsSource));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    console.error('Program link error:', log);
    throw new Error('Program link failed: ' + log);
  }
  return program;
}

// Crée une texture d'état RGBA8UI (4 octets/cellule : id, vy, vx, flags),
// initialisée avec `data` (Uint8Array, 4 octets/texel) ou à zéro.
// vy/vx : signe-magnitude (bit 7 = signe), la valeur brute 0 = vitesse nulle —
// l'init à zéro de WebGL2 et les patchs du pinceau donnent donc l'état neutre.
// NB : RGBA8UI est color-renderable garanti par la spec ; RGB8UI ne l'est PAS.
function createStateTexture(data) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(
    gl.TEXTURE_2D, 0, gl.RGBA8UI, gridWidth, gridHeight, 0,
    gl.RGBA_INTEGER, gl.UNSIGNED_BYTE, data || null,
  );
  return tex;
}

// Crée une texture de données 256x1 (palette ou propriétés) en RGBA8.
function createLookupTexture(rgbaData) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(
    gl.TEXTURE_2D, 0, gl.RGBA8, 256, 1, 0,
    gl.RGBA, gl.UNSIGNED_BYTE, rgbaData,
  );
  return tex;
}

function createFbo(tex) {
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error('Framebuffer incomplete: 0x' + status.toString(16));
  }
  return fbo;
}

// ---------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------

// Triangle plein écran sans VBO (truc gl_VertexID). Couvre [-1,1]^2.
const FULLSCREEN_VS = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// Passe de simulation — automate de Margolus (bloc 2x2).
//
// On partitionne la grille en blocs 2x2 dont l'origine est décalée de uOffset à
// chaque sous-pas. Chaque cellule appartient à exactement un bloc → pas de
// conflit, masse conservée (on ne fait que des échanges).
//
// Les 4 cellules d'un bloc lisent les mêmes 4 ids et le même aléa (dérivé du coin
// du bloc + uSeed), exécutent la même résolution de gravité, et chacune ne sort
// que sa propre case. Règles :
//   1. Coulée verticale : le plus dense descend dans chaque colonne.
//   2. Diagonale : quand la descente droite est bloquée, glisse en diagonale.
//   3. Liquides : étalement horizontal (nivellement) vers le vide.
const SIM_FS = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;

uniform usampler2D uState;
uniform sampler2D uProps;   // 256x1 : .r = densité (UNORM), .g = type*1/255
uniform ivec2 uOffset;      // décalage du pavage (0/1 sur chaque axe)
uniform ivec2 uGrid;
uniform float uSeed;
uniform int uFrameSub;      // index du sous-pas DANS la frame (0..S-1)
uniform int uSubsteps;      // S : sous-pas par frame (= vitesse terminale)
uniform int uGravity;       // G : accélération, en cases/frame²
uniform float uJitterP;     // probabilité de glissade de traînée en vol

out uvec4 outCell;

float densOf(uint id) { return texelFetch(uProps, ivec2(int(id), 0), 0).r; }
uint typeOf(uint id)  { return uint(texelFetch(uProps, ivec2(int(id), 0), 0).g * 255.0 + 0.5); }
// Cellule complète : .r = id, .g = vy, .b = vx, .a = flags. Les échanges
// portent sur la cellule ENTIÈRE : la charge utile suit structurellement
// sa particule (impossible d'oublier un canal).
uvec4 fetchCell(ivec2 p) { return texelFetch(uState, p, 0); }

// Hash entier (Wang) : précision exacte quelle que soit la taille de grille,
// contrairement à sin() dont la réduction d'argument dépend du driver.
float hashSeeded(ivec2 p, uint seed) {
  uint h = uint(p.x) * 1664525u + uint(p.y) * 1013904223u + seed;
  h ^= h >> 16u;
  h *= 2654435769u;
  h ^= h >> 16u;
  return float(h) * (1.0 / 4294967296.0);
}
float hash(ivec2 p)  { return hashSeeded(p, floatBitsToUint(uSeed)); }
float hash2(ivec2 p) { return hashSeeded(p, floatBitsToUint(uSeed) ^ 0x5bd1e995u); }

// Échéancier de Bresenham temporel : une particule de magnitude m (cases/
// frame) tente sa chute au sous-pas s ssi le quotient entier (s·m)/S change.
// Arithmétique entière non signée : exacte, identique entre les invocations
// d'un bloc et la réplique CPU. m plancher à 1 (pas de particule suspendue).
bool bres(uint m, int s) {
  uint mm = max(m, 1u);
  uint S = uint(uSubsteps);
  return ((uint(s) + 1u) * mm) / S != (uint(s) * mm) / S;
}

const uint T_SOLID = 1u;
const uint T_LIQUID = 2u;

// Impact (transition transit -> posé) : conversion de la vitesse d'arrivée m.
// Liquides : éclaboussure — éjection balistique (vy signé haut + vx latéral)
// UNIQUEMENT vers de l'air libre, sinon fusion + glissade. Solides : petite
// dispersion latérale (restitution ~0) — les colonnes deviennent des CÔNES.
uvec4 impact(uvec4 me, ivec2 pos, uint m, bool airAbove) {
  if (m < 3u) { me.g = 0u; return me; }
  float j1 = hashSeeded(pos, floatBitsToUint(uSeed) ^ 0x12345671u);
  float j2 = hashSeeded(pos, floatBitsToUint(uSeed) ^ 0x89abcdefu);
  uint sx = (j1 < 0.5) ? 0x80u : 0u;
  uint S = uint(uSubsteps);
  if (typeOf(me.r) == T_LIQUID) {
    uint mx = min(m >> 1, max(2u, S >> 2));
    if (airAbove && j2 < 0.5) {
      uint mu = min(m >> 2, S >> 1);
      me.g = (mu > 0u) ? (0x80u | mu) : 0u;
    } else {
      me.g = 0u;
    }
    me.b = (mx > 0u) ? (sx | mx) : 0u;
  } else {
    me.g = 0u;
    uint mx = min(2u, m >> 2);
    me.b = (mx > 0u) ? (sx | mx) : 0u;
  }
  return me;
}

// Mise à jour de la vélocité (une fois par frame, au sous-pas 0). Cycle de vie :
//   - friction vx (jamais entretenu : pas de vitesse fossile) ;
//   - montée balistique (gouttes éjectées) : décélération G, retombée à l'apex ;
//   - peut tomber : vy += G ± 1 (gravité stochastique), plafond S dans le vide,
//     S/2 dans un liquide porteur (vitesse terminale par milieu) ;
//   - bloquée : file d'attente (vy := min) sur cible mobile, IMPACT sur posée.
// belowCell/aboveCell : cellules PRÉ-mise-à-jour ; floorBelow : sous la grille.
uvec4 updateVy(uvec4 me, ivec2 pos, uvec4 belowCell, uvec4 aboveCell, bool floorBelow, bool topAbove) {
  if (me.r == 0u) { me.g = 0u; me.b = 0u; return me; }

  uint mx = me.b & 0x7Fu;
  if (mx > 0u) {
    uint fr = (typeOf(me.r) == T_SOLID) ? 2u : 1u;
    mx = (mx > fr) ? (mx - fr) : 0u;
    me.b = (mx > 0u) ? ((me.b & 0x80u) | mx) : 0u;
  }

  uint m = me.g & 0x7Fu;

  if ((me.g & 0x80u) != 0u) {
    bool aboveLighter = !topAbove && densOf(aboveCell.r) < densOf(me.r);
    int mi = int(m) - uGravity;
    me.g = (aboveLighter && mi > 0) ? (0x80u | uint(mi)) : 1u;
    return me;
  }

  bool airAbove = !topAbove && aboveCell.r == 0u;
  if (floorBelow) return impact(me, pos, m, airAbove);
  if (densOf(belowCell.r) < densOf(me.r)) {
    float j = hashSeeded(pos, floatBitsToUint(uSeed) ^ 0x9e3779b9u);
    int dm = uGravity + ((j < 0.33) ? -1 : ((j < 0.66) ? 0 : 1));
    int cap = (belowCell.r == 0u) ? uSubsteps : max(1, uSubsteps >> 1);
    int mi = clamp(int(m) + dm, 1, cap);
    me.g = uint(mi);
  } else {
    uint mb = belowCell.g & 0x7Fu;
    if (mb == 0u) return impact(me, pos, m, airAbove);
    me.g = min(m, mb);
  }
  return me;
}

void main() {
  ivec2 cell = ivec2(gl_FragCoord.xy);
  int lx = (cell.x - uOffset.x) & 1; // position dans le bloc (0/1)
  int ly = (cell.y - uOffset.y) & 1;
  ivec2 corner = ivec2(cell.x - lx, cell.y - ly); // coin haut-gauche du bloc

  // Bloc qui déborde de la grille : pas de mouvement, mais la mise à jour de
  // vélocité s'applique quand même (toutes les cellules, une fois par frame).
  if (corner.x < 0 || corner.y < 0 || corner.x + 1 >= uGrid.x || corner.y + 1 >= uGrid.y) {
    uvec4 me = fetchCell(cell);
    if (uFrameSub == 0) {
      bool floorB = cell.y + 1 >= uGrid.y;
      bool topB = cell.y - 1 < 0;
      uvec4 below = floorB ? uvec4(0u) : fetchCell(cell + ivec2(0, 1));
      uvec4 above = topB ? uvec4(0u) : fetchCell(cell + ivec2(0, -1));
      me = updateVy(me, cell, below, above, floorB, topB);
    }
    outCell = me;
    return;
  }

  // a=TL, b=TR, c=BL, d=BR (y vers le bas : c/d = rangée du bas)
  uvec4 a = fetchCell(corner);
  uvec4 b = fetchCell(corner + ivec2(1, 0));
  uvec4 c = fetchCell(corner + ivec2(0, 1));
  uvec4 d = fetchCell(corner + ivec2(1, 1));

  // Mise à jour de la vélocité au sous-pas 0, AVANT les échanges, à partir des
  // valeurs pré-mise-à-jour (a/b lisent c/d tels que fetchés ; c/d lisent la
  // rangée sous le bloc). Chaque invocation met à jour les 4 identiquement.
  if (uFrameSub == 0) {
    bool floorBelow = corner.y + 2 >= uGrid.y;
    bool topAbove = corner.y - 1 < 0;
    uvec4 belowC = floorBelow ? uvec4(0u) : fetchCell(corner + ivec2(0, 2));
    uvec4 belowD = floorBelow ? uvec4(0u) : fetchCell(corner + ivec2(1, 2));
    uvec4 aboveA = topAbove ? uvec4(0u) : fetchCell(corner + ivec2(0, -1));
    uvec4 aboveB = topAbove ? uvec4(0u) : fetchCell(corner + ivec2(1, -1));
    uvec4 a2 = updateVy(a, corner, c, aboveA, false, topAbove);
    uvec4 b2 = updateVy(b, corner + ivec2(1, 0), d, aboveB, false, topAbove);
    c = updateVy(c, corner + ivec2(0, 1), belowC, a, floorBelow, false);
    d = updateVy(d, corner + ivec2(1, 1), belowD, b, floorBelow, false);
    a = a2;
    b = b2;
  }

  float da = densOf(a.r), db = densOf(b.r), dc = densOf(c.r), dd = densOf(d.r);
  float rnd = hash(corner);
  uvec4 t; float td;

  // 0. Jitter de traînée : avec une faible probabilité, une particule EN CHUTE
  //    glisse en diagonale même si la chute droite est libre — seul mécanisme
  //    qui casse une colonne de largeur 1 (la diversité de vy ne le peut pas).
  //    (les particules en ascension balistique en sont exclues)
  if (uJitterP > 0.0) {
    float jit = hash2(corner);
    if (jit < uJitterP) {
      if (da > dd && dc > dd && (a.g & 0x80u) == 0u && bres(a.g & 0x7Fu, uFrameSub)) {
        t = a; a = d; d = t; td = da; da = dd; dd = td;
      } else if (db > dc && dd > dc && (b.g & 0x80u) == 0u && bres(b.g & 0x7Fu, uFrameSub)) {
        t = b; b = c; c = t; td = db; db = dc; dc = td;
      }
    }
  }

  // 1. Coulée verticale : le plus dense descend dans chaque colonne, gatée par
  //    l'échéancier du mouvant (qui ne doit pas être en ascension). Branche
  //    symétrique : une particule ÉJECTÉE (vy signé haut) monte dans plus
  //    léger qu'elle — l'arc balistique de l'éclaboussure.
  {
    bool aFall = da > dc && (a.g & 0x80u) == 0u && bres(a.g & 0x7Fu, uFrameSub);
    bool cRise = (c.g & 0x80u) != 0u && dc > da && bres(c.g & 0x7Fu, uFrameSub);
    if (aFall || cRise) { t = a; a = c; c = t; td = da; da = dc; dc = td; }
    bool bFall = db > dd && (b.g & 0x80u) == 0u && bres(b.g & 0x7Fu, uFrameSub);
    bool dRise = (d.g & 0x80u) != 0u && dd > db && bres(d.g & 0x7Fu, uFrameSub);
    if (bFall || dRise) { t = b; b = d; d = t; td = db; db = dd; dd = td; }
  }

  // 2. Diagonale quand la descente droite est bloquée (le dessous n'est pas
  //    plus léger). Dans le VIDE : cadence d'origine (éboulement des tas à
  //    l'air libre intact). Vers un LIQUIDE : gatée par l'échéancier du
  //    mouvant — sinon les avalanches diagonales en escalier descendent un
  //    tas immergé à pleine cadence, comme dans du vide. Les particules en
  //    ascension balistique en sont exclues.
  if (rnd < 0.5) {
    if (da > dd && dc >= da && (a.g & 0x80u) == 0u && (d.r == 0u || bres(a.g & 0x7Fu, uFrameSub))) { t = a; a = d; d = t; td = da; da = dd; dd = td; }
    if (db > dc && dd >= db && (b.g & 0x80u) == 0u && (c.r == 0u || bres(b.g & 0x7Fu, uFrameSub))) { t = b; b = c; c = t; td = db; db = dc; dc = td; }
  } else {
    if (db > dc && dd >= db && (b.g & 0x80u) == 0u && (c.r == 0u || bres(b.g & 0x7Fu, uFrameSub))) { t = b; b = c; c = t; td = db; db = dc; dc = td; }
    if (da > dd && dc >= da && (a.g & 0x80u) == 0u && (d.r == 0u || bres(a.g & 0x7Fu, uFrameSub))) { t = a; a = d; d = t; td = da; da = dd; dd = td; }
  }

  // (L'étalement horizontal des liquides est traité par une passe dédiée, FLOW_FS.)

  // Chaque invocation ne sort que sa propre case du bloc.
  if (lx == 0 && ly == 0) outCell = a;
  else if (lx == 1 && ly == 0) outCell = b;
  else if (lx == 0 && ly == 1) outCell = c;
  else outCell = d;
}`;

// Passe d'écoulement / relaxation de densité (paires 2x1 de Margolus).
//
// Deux règles :
//   A. surface (liquide↔vide) : un liquide s'étale dans un vide de surface —
//      comportement validé, inchangé. Seule règle qui touche au vide.
//   B. interfaces liquide↔liquide : relaxation par SCAN DE HAUTEUR. Une pente à
//      45° est un point fixe de toute règle locale à seuil (les colonnes
//      adjacentes n'y diffèrent que d'une case) → les blobs restaient figés en
//      pyramides. On estime le dénivelé local de l'interface par un scan vertical
//      borné (K=2, exact car la décision sature à 2) : dénivelé fort → poussée
//      déterministe ; sinon → diffusion symétrique p=0.5 du profil de hauteur.
//      Combinée aux échanges verticaux/diagonaux irréversibles de la gravité, la
//      diffusion a un biais net vers l'aplatissement (validé en labo : couches
//      planes en ~10 frames, calme résiduel équivalent à la règle A seule).
//
// Le hash est calculé sur le COIN de la paire : les deux cellules prennent la
// même décision → échange conservatif et sans conflit.
const FLOW_FS = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;

uniform usampler2D uState;
uniform sampler2D uProps;
uniform int uOffsetX;
uniform ivec2 uGrid;
uniform float uSeed;
uniform int uFlowSub;   // sous-pas de la frame (0..S-1), pour l'échéancier vx
uniform int uFlowPhase; // laquelle des 3 passes du sous-pas (0..2)
uniform int uSubsteps;  // S

out uvec4 outCell;

const uint LIQUID = 2u;
const int K = 2;  // portée du scan de dénivelé (exact : la décision sature à 2)
const int KS = 3; // portée du scan posé / en-transit

float densOf(uint id) { return texelFetch(uProps, ivec2(int(id), 0), 0).r; }
uint typeOf(uint id) { return uint(texelFetch(uProps, ivec2(int(id), 0), 0).g * 255.0 + 0.5); }
// fetch : id seul (suffit aux scans) ; fetchCell : cellule complète (id + charge
// utile vy/vx/flags), pour que l'échange transporte tous les canaux.
uint fetch(ivec2 p)  { return texelFetch(uState, p, 0).r; }
uvec4 fetchCell(ivec2 p) { return texelFetch(uState, p, 0); }

// Hash entier (Wang) : précision exacte quelle que soit la taille de grille,
// contrairement à sin() dont la réduction d'argument dépend du driver.
float hash(ivec2 p) {
  uint h = uint(p.x) * 1664525u + uint(p.y) * 1013904223u + floatBitsToUint(uSeed);
  h ^= h >> 16u;
  h *= 2654435769u;
  h ^= h >> 16u;
  return float(h) * (1.0 / 4294967296.0);
}

// Échéancier de Bresenham (identique à SIM_FS) pour les mouvements vx.
bool bres(uint m, int s) {
  uint mm = max(m, 1u);
  uint S = uint(uSubsteps);
  return ((uint(s) + 1u) * mm) / S != (uint(s) * mm) / S;
}

// Densité avec gardes verticales : au-dessus de la grille = vide (0.0),
// en dessous = mur infranchissable (1.0).
float densAt(int x, int y) {
  if (y < 0) return 0.0;
  if (y >= uGrid.y) return 1.0;
  return densOf(fetch(ivec2(x, y)));
}

// Vrai si la matière en p ne peut pas tomber (dessous occupé ou hors grille).
bool blockedBelow(ivec2 p) {
  int by = p.y + 1;
  if (by >= uGrid.y) return true;
  return fetch(ivec2(p.x, by)) != 0u;
}

// Vrai si la case au-dessus de p est vide (p est une case de surface, pas une
// bulle submergée). Empêche l'eau de s'étaler latéralement dans une bulle.
bool openAbove(ivec2 p) {
  int ay = p.y - 1;
  if (ay < 0) return true;
  return fetch(ivec2(p.x, ay)) == 0u;
}

void main() {
  ivec2 cell = ivec2(gl_FragCoord.xy);
  int lx = (cell.x - uOffsetX) & 1;
  int cornerX = cell.x - lx;
  if (cornerX < 0 || cornerX + 1 >= uGrid.x) { outCell = fetchCell(cell); return; }

  ivec2 lp = ivec2(cornerX, cell.y);
  ivec2 rp = ivec2(cornerX + 1, cell.y);
  uvec4 L = fetchCell(lp);
  uvec4 R = fetchCell(rp);
  float dL = densOf(L.r);
  float dR = densOf(R.r);
  bool lLiq = typeOf(L.r) == LIQUID;
  bool rLiq = typeOf(R.r) == LIQUID;

  bool doSwap = false;

  // 0. Mouvement vx (vélocité, première passe de chaque sous-pas) : une
  //    particule à vitesse latérale se déplace vers une case VIDE adjacente
  //    (uniquement — jamais dans un liquide : c'est le mécanisme qui
  //    recréerait les jets en X), à l'échéancier de Bresenham de |vx|.
  if (uFlowPhase == 0) {
    uint mxL = L.b & 0x7Fu;
    uint mxR = R.b & 0x7Fu;
    if (L.r != 0u && R.r == 0u && mxL > 0u && (L.b & 0x80u) == 0u && bres(mxL, uFlowSub)) {
      doSwap = true;
    } else if (R.r != 0u && L.r == 0u && mxR > 0u && (R.b & 0x80u) != 0u && bres(mxR, uFlowSub)) {
      doSwap = true;
    }
  }

  // A. Nivellement de surface (liquide↔vide) : « source en surface OU cible
  //    soutenue ». L'eau DE SURFACE s'étale librement (ruissellement, cascades) ;
  //    l'eau SUBMERGÉE ne glisse que vers une case posée sur quelque chose
  //    (blockedBelow(cible)) — c'est la base d'une colonne qui s'effondre.
  //    Pousser de l'eau submergée vers une case avec du vide dessous ne nivelle
  //    rien : elle ne fait que tomber, et c'est ce qui déchiquetait en traits
  //    horizontaux les cavités de vide peintes au pinceau. Un tube de void se
  //    vide ainsi par le bas pendant que le vide sort par le haut.
  if (!doSwap && lLiq && R.r == 0u && blockedBelow(lp) && openAbove(rp)
      && (openAbove(lp) || blockedBelow(rp))) {
    doSwap = true;
  } else if (!doSwap && rLiq && L.r == 0u && blockedBelow(rp) && openAbove(lp)
      && (openAbove(rp) || blockedBelow(lp))) {
    doSwap = true;
  } else if (!doSwap && lLiq && rLiq && dL != dR) {
    // B. Relaxation des interfaces liquide-liquide POSÉES, par scan de hauteur.
    ivec2 denseP = (dL > dR) ? lp : rp;
    ivec2 lightP = (dL > dR) ? rp : lp;
    float D = max(dL, dR);
    float dLight = min(dL, dR);

    // Posé ou en transit ? La relaxation n'arbitre que les interfaces POSÉES :
    // appliquée à un blob en CHUTE dans un liquide plus léger (ou en ascension
    // dans un plus dense), la poussée latérale le cisaille en jets diagonaux.
    // Discriminant : sous une couche posée, la colonne dense continue jusqu'à
    // un support ; sous un blob en chute, du plus léger apparaît à faible
    // profondeur (les bandes du liquide porteur qui remontent à travers lui).
    bool settled = true;
    for (int k = 1; k <= KS; k++) {
      float dd = densAt(denseP.x, denseP.y + k);
      if (dd < D) { settled = false; break; } // plus léger dessous : en chute
      if (dd > D) break;                      // support (sol/solide/+dense) : posé
    }
    if (settled) {
      for (int k = 1; k <= KS; k++) {
        float dd = densAt(lightP.x, lightP.y - k);
        if (dd > dLight) { settled = false; break; } // plus dense dessus : en ascension
        if (dd < dLight) break;                      // plafond (vide/+léger) : posé
      }
    }

    if (settled) {
      // hUp : hauteur de colonne dense (>= D) au-dessus de la paire, côté dense.
      int hUp = 0;
      for (int k = 1; k <= K; k++) {
        if (densAt(denseP.x, denseP.y - k) >= D) hUp++;
        else break;
      }

      // hDown : profondeur de liquide strictement plus léger sous la paire, côté léger.
      int hDown = 0;
      for (int k = 1; k <= K; k++) {
        int yy = lightP.y + k;
        if (yy >= uGrid.y) break;
        uint id = fetch(ivec2(lightP.x, yy));
        if (id != 0u && typeOf(id) == LIQUID && densOf(id) < D) hDown++;
        else break;
      }

      if (hUp + hDown >= 2) doSwap = true;              // poussée déterministe
      else doSwap = hash(ivec2(cornerX, cell.y)) < 0.5; // diffusion symétrique
    }
  }

  if (doSwap) { uvec4 t = L; L = R; R = t; }
  outCell = (lx == 0) ? L : R;
}`;

// Passe de rendu — convertit les ids en couleurs via la palette, dessine le curseur.
// On retourne l'axe Y pour que la ligne 0 de la grille (le « haut ») soit en haut.
const RENDER_FS = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;

uniform usampler2D uState;
uniform sampler2D uPalette;
uniform ivec2 uGrid;
uniform vec2 uMouse;     // position souris en cases (-1 si hors canvas)
uniform int uToolSize;   // 1 = un point, >1 = anneau de rayon (toolSize-1)
uniform int uDragging;
uniform float uRingHalfWidth; // demi-épaisseur de l'anneau, en texels
uniform int uDebugView;  // 0 = normal, 1 = vy, 2 = vx, 3 = flags

out vec4 fragColor;

const vec3 BG = vec3(0.063, 0.063, 0.078); // fond pour le vide (#101014)

// Décodage signe-magnitude -> [-1, 1] (échelle /64).
float sm(uint v) {
  float m = float(v & 0x7Fu) / 64.0;
  return ((v & 0x80u) != 0u) ? -m : m;
}

void main() {
  ivec2 cell = ivec2(int(gl_FragCoord.x), uGrid.y - 1 - int(gl_FragCoord.y));
  uvec4 cellv = texelFetch(uState, cell, 0);
  uint id = cellv.r;

  vec3 color;
  if (id == 0u) {
    color = BG;
  } else {
    color = texelFetch(uPalette, ivec2(int(id), 0), 0).rgb;
  }

  // Vues de debug des canaux cachés (la charge utile est invisible au rendu
  // normal : sans ces vues, un canal perdu dans un échange serait indétectable).
  if (uDebugView != 0 && id != 0u) {
    if (uDebugView == 1) {
      // vy : chaud (rouge/jaune) vers le bas, froid (cyan) vers le haut.
      float v = sm(cellv.g);
      color = v >= 0.0 ? vec3(min(1.0, v * 2.0), v, 0.05) : vec3(0.05, -v, min(1.0, -v * 2.0));
      color += vec3(0.08); // les particules à vitesse nulle restent visibles
    } else if (uDebugView == 2) {
      // vx : rouge vers la droite, bleu vers la gauche.
      float v = sm(cellv.b);
      color = v >= 0.0 ? vec3(v, 0.1, 0.05) : vec3(0.05, 0.1, -v);
      color += vec3(0.08);
    } else {
      // flags : 3 premiers bits -> R/G/B.
      color = vec3(float(cellv.a & 1u), float((cellv.a >> 1) & 1u), float((cellv.a >> 2) & 1u));
      color += vec3(0.08);
    }
  }

  // Curseur : anneau (ou point) à la position souris.
  if (uMouse.x >= 0.0) {
    vec2 d = vec2(float(cell.x), float(cell.y)) - uMouse;
    float dist = length(d);
    float r = float(uToolSize - 1);
    bool onCursor = (uToolSize == 1)
      ? (cell.x == int(uMouse.x) && cell.y == int(uMouse.y))
      : (abs(dist - r) < uRingHalfWidth);
    if (onCursor) {
      color = vec3(1.0); // curseur blanc, visible sur le fond sombre
    }
  }

  fragColor = vec4(color, 1.0);
}`;

// ---------------------------------------------------------------------------
// Pinceau
// ---------------------------------------------------------------------------

// Choisit un id au hasard parmi les variantes du tool (void -> 0).
function pickId(tool) {
  const ids = toolIds[tool];
  if (!ids || ids.length === 0) return 0;
  return ids[(Math.random() * ids.length) | 0];
}

// Estampille un disque plein de centre (cx,cy) et de rayon (size-1) dans la
// texture courante. Pour ne pas écraser l'existant hors-disque, on écrit ligne
// par ligne le seul segment horizontal interne au disque (via texSubImage2D).
// Chaque texel stampé = [id, vy=0, vx=0, flags=0] : la matière fraîchement
// peinte naît à vitesse nulle (le 0 brut est l'état neutre en signe-magnitude).
function paint(cx, cy, size, tool) {
  const r = size <= 1 ? 0 : size - 1;
  if (cx < 0 || cy < 0 || cx >= gridWidth || cy >= gridHeight) {
    if (r === 0) return;
  }

  gl.bindTexture(gl.TEXTURE_2D, stateTex[current]);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

  if (r === 0) {
    brushPatch[0] = pickId(tool);
    // Émission randomisée (vy initial 0..3) : désynchronise les particules à
    // la source — le levier anti-colonnes le plus puissant (Noita/Powder Toy).
    brushPatch[1] = (Math.random() * 4) | 0;
    brushPatch[2] = 0;
    brushPatch[3] = 0;
    gl.texSubImage2D(
      gl.TEXTURE_2D, 0, cx, cy, 1, 1,
      gl.RGBA_INTEGER, gl.UNSIGNED_BYTE, brushPatch,
    );
    return;
  }

  const r2 = r * r;
  for (let y = cy - r; y <= cy + r; y++) {
    if (y < 0 || y >= gridHeight) continue;
    const dy = y - cy;
    const dxMax = Math.floor(Math.sqrt(Math.max(0, r2 - dy * dy)));
    let segMinX = cx - dxMax; if (segMinX < 0) segMinX = 0;
    let segMaxX = cx + dxMax; if (segMaxX >= gridWidth) segMaxX = gridWidth - 1;
    if (segMinX > segMaxX) continue;
    const segW = segMaxX - segMinX + 1;
    if (brushPatch.length < segW * 4) brushPatch = new Uint8Array(segW * 4);
    for (let x = 0; x < segW; x++) {
      const o = x * 4;
      brushPatch[o] = pickId(tool);
      brushPatch[o + 1] = (Math.random() * 4) | 0; // émission randomisée
      brushPatch[o + 2] = 0;
      brushPatch[o + 3] = 0;
    }
    gl.texSubImage2D(
      gl.TEXTURE_2D, 0, segMinX, y, segW, 1,
      gl.RGBA_INTEGER, gl.UNSIGNED_BYTE, brushPatch,
    );
  }
}

// ---------------------------------------------------------------------------
// Passes
// ---------------------------------------------------------------------------

// Un sous-pas de simulation : lit la texture courante, écrit l'autre, échange.
// sFrame : index du sous-pas dans la frame (0..S-1), pour l'échéancier de
// Bresenham et la mise à jour de vélocité (au sous-pas 0).
function stepSim(sFrame) {
  const offset = OFFSETS[substepCounter % OFFSETS.length];
  substepCounter++;

  const src = current;
  const dst = 1 - current;
  gl.bindFramebuffer(gl.FRAMEBUFFER, stateFbo[dst]);
  gl.viewport(0, 0, gridWidth, gridHeight);
  gl.useProgram(simProgram);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, stateTex[src]);
  gl.uniform1i(uSimState, 0);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, propsTex);
  gl.uniform1i(uSimProps, 1);
  gl.uniform2i(uSimOffset, offset[0], offset[1]);
  gl.uniform2i(uSimGrid, gridWidth, gridHeight);
  gl.uniform1f(uSimSeed, Math.random() * 1000.0);
  gl.uniform1i(uSimFrameSub, sFrame);
  gl.uniform1i(uSimSubsteps, substepsPerFrame);
  gl.uniform1i(uSimGravity, gravityG);
  gl.uniform1f(uSimJitterP, JITTER_P);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  current = dst;
}

// Un sous-pas d'écoulement horizontal des liquides (paires 2x1, offset alterné).
// sFrame/phase : sous-pas de la frame et index de passe (0..2) — les
// mouvements vx sont tentés en phase 0 à l'échéancier de Bresenham.
function stepFlow(offsetX, sFrame, phase) {
  const src = current;
  const dst = 1 - current;
  gl.bindFramebuffer(gl.FRAMEBUFFER, stateFbo[dst]);
  gl.viewport(0, 0, gridWidth, gridHeight);
  gl.useProgram(flowProgram);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, stateTex[src]);
  gl.uniform1i(uFlowState, 0);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, propsTex);
  gl.uniform1i(uFlowProps, 1);
  gl.uniform1i(uFlowOffsetX, offsetX);
  gl.uniform2i(uFlowGrid, gridWidth, gridHeight);
  gl.uniform1f(uFlowSeed, Math.random() * 1000.0);
  gl.uniform1i(uFlowSub, sFrame);
  gl.uniform1i(uFlowPhase, phase);
  gl.uniform1i(uFlowSubsteps, substepsPerFrame);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  current = dst;
}

function render() {
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, gridWidth, gridHeight);
  gl.useProgram(renderProgram);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, stateTex[current]);
  gl.uniform1i(uRenderState, 0);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, paletteTex);
  gl.uniform1i(uRenderPalette, 1);
  gl.uniform2i(uRenderGrid, gridWidth, gridHeight);
  gl.uniform2f(uRenderMouse, mouse.x, mouse.y);
  gl.uniform1i(uRenderToolSize, mouse.toolSize);
  gl.uniform1i(uRenderDragging, mouse.dragging ? 1 : 0);
  gl.uniform1f(uRenderRingHalfWidth, ringHalfWidth);
  gl.uniform1i(uRenderDebugView, debugView);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

// Prépare le comptage : table id -> compteur, et PBO de readback. Le format de
// lecture compact (RED_INTEGER + UNSIGNED_BYTE) n'est pas garanti par la spec
// pour un framebuffer entier — on le sonde, sinon repli sur la combinaison
// garantie RGBA_INTEGER + UNSIGNED_INT (4 entiers par texel, on lit le canal R).
function initCounting() {
  bucketOf = new Uint8Array(256);
  bucketNames = Object.keys(toolIds).filter((n) => n !== 'void');
  bucketNames.forEach((name, i) => {
    for (const id of toolIds[name]) bucketOf[id] = i + 1;
  });

  gl.bindFramebuffer(gl.FRAMEBUFFER, stateFbo[0]);
  const f = gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_FORMAT);
  const t = gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_TYPE);
  const texels = gridWidth * gridHeight;
  if (f === gl.RED_INTEGER && t === gl.UNSIGNED_BYTE) {
    countFormat = gl.RED_INTEGER;
    countType = gl.UNSIGNED_BYTE;
    countArray = new Uint8Array(texels);
    countStep = 1;
  } else if (f === gl.RGBA_INTEGER && t === gl.UNSIGNED_BYTE) {
    // Chemin compact attendu pour un FBO RGBA8UI : 4 octets/texel, id en .r.
    countFormat = gl.RGBA_INTEGER;
    countType = gl.UNSIGNED_BYTE;
    countArray = new Uint8Array(texels * 4);
    countStep = 4;
  } else {
    // Combinaison garantie par la spec (16 octets/texel — lourde, dernier recours).
    countFormat = gl.RGBA_INTEGER;
    countType = gl.UNSIGNED_INT;
    countArray = new Uint32Array(texels * 4);
    countStep = 4;
  }
  countPbo = gl.createBuffer();
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, countPbo);
  gl.bufferData(gl.PIXEL_PACK_BUFFER, countArray.byteLength, gl.STREAM_READ);
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  // Lignes serrées dans le PBO quelle que soit la largeur de grille
  // (PACK_ALIGNMENT vaut 4 par défaut → padding si largeur non multiple de 4).
  gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
}

// Une frame sur COUNT_INTERVAL : lance un readPixels asynchrone vers le PBO,
// borné par une fence. Les frames suivantes : si la fence est signalée, on lit
// le PBO (transfert mémoire pur, le GPU a déjà fini) et on compte côté CPU.
function updateCounts() {
  if (countSync !== null) {
    const status = gl.clientWaitSync(countSync, 0, 0);
    if (status === gl.WAIT_FAILED) {
      // Perte de contexte ou erreur : on jette la fence pour pouvoir relancer.
      gl.deleteSync(countSync);
      countSync = null;
      return;
    }
    if (status === gl.ALREADY_SIGNALED || status === gl.CONDITION_SATISFIED) {
      gl.deleteSync(countSync);
      countSync = null;
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, countPbo);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, countArray);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);

      const bucketCounts = new Uint32Array(bucketNames.length + 1);
      const n = gridWidth * gridHeight;
      const step = countStep;
      for (let i = 0; i < n; i++) {
        bucketCounts[bucketOf[countArray[i * step] & 0xFF]]++;
      }
      const counts = {};
      for (let i = 0; i < bucketNames.length; i++) counts[bucketNames[i]] = bucketCounts[i + 1];
      postMessage(['debugData', counts]);
    }
  } else if (frameIndex % COUNT_INTERVAL === 0) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, stateFbo[current]);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, countPbo);
    gl.readPixels(0, 0, gridWidth, gridHeight, countFormat, countType, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    countSync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    // Garantit la soumission de la fence au serveur GL (sans flush, elle peut ne
    // jamais se signaler si rien d'autre ne pousse le flux de commandes).
    gl.flush();
  }
}

function frame(now) {
  // Gravité et écoulement ENTRELACÉS : après chaque étalement latéral, la gravité
  // suivante fait retomber l'eau (cascade : descend → s'étale → redescend → plat).
  for (let s = 0; s < substepsPerFrame; s++) {
    stepSim(s);
    for (let f = 0; f < flowPassesPerFrame; f++) {
      stepFlow(flowCounter & 1, s, f);
      flowCounter++;
    }
  }
  // Dérive de phase des offsets (+1 « sous-pas fantôme » par frame) : sans elle,
  // l'échéancier d'une vitesse m diviseur de S retombe chaque frame sur les
  // MÊMES offsets de Margolus, et une particule lente à parité défavorable ne
  // serait jamais appariée verticalement avec sa case du dessous (figée).
  substepCounter++;
  render();

  frameIndex++;
  updateCounts();

  frameCount++;
  if (now - lastFpsTime >= 1000) {
    postMessage(['fps', frameCount * 1000 / (now - lastFpsTime)]);
    frameCount = 0;
    lastFpsTime = now;
  }

  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

function initialize(opts) {
  canvas = opts.canvas;
  gridWidth = opts.gridWidth;
  gridHeight = opts.gridHeight;
  toolIds = opts.toolIds;
  if (opts.substepsPerFrame) substepsPerFrame = opts.substepsPerFrame;
  gravityG = Math.max(1, Math.round(substepsPerFrame / 8));

  canvas.width = gridWidth;
  canvas.height = gridHeight;

  gl = canvas.getContext('webgl2', {
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: false,
    premultipliedAlpha: false,
  });
  if (!gl) throw new Error('WebGL2 non disponible');

  simProgram = createProgram(FULLSCREEN_VS, SIM_FS);
  flowProgram = createProgram(FULLSCREEN_VS, FLOW_FS);
  renderProgram = createProgram(FULLSCREEN_VS, RENDER_FS);

  uSimState = gl.getUniformLocation(simProgram, 'uState');
  uSimProps = gl.getUniformLocation(simProgram, 'uProps');
  uSimOffset = gl.getUniformLocation(simProgram, 'uOffset');
  uSimGrid = gl.getUniformLocation(simProgram, 'uGrid');
  uSimSeed = gl.getUniformLocation(simProgram, 'uSeed');
  uSimFrameSub = gl.getUniformLocation(simProgram, 'uFrameSub');
  uSimSubsteps = gl.getUniformLocation(simProgram, 'uSubsteps');
  uSimGravity = gl.getUniformLocation(simProgram, 'uGravity');
  uSimJitterP = gl.getUniformLocation(simProgram, 'uJitterP');

  uFlowState = gl.getUniformLocation(flowProgram, 'uState');
  uFlowProps = gl.getUniformLocation(flowProgram, 'uProps');
  uFlowOffsetX = gl.getUniformLocation(flowProgram, 'uOffsetX');
  uFlowGrid = gl.getUniformLocation(flowProgram, 'uGrid');
  uFlowSeed = gl.getUniformLocation(flowProgram, 'uSeed');
  uFlowSub = gl.getUniformLocation(flowProgram, 'uFlowSub');
  uFlowPhase = gl.getUniformLocation(flowProgram, 'uFlowPhase');
  uFlowSubsteps = gl.getUniformLocation(flowProgram, 'uSubsteps');
  uRenderState = gl.getUniformLocation(renderProgram, 'uState');
  uRenderPalette = gl.getUniformLocation(renderProgram, 'uPalette');
  uRenderGrid = gl.getUniformLocation(renderProgram, 'uGrid');
  uRenderMouse = gl.getUniformLocation(renderProgram, 'uMouse');
  uRenderToolSize = gl.getUniformLocation(renderProgram, 'uToolSize');
  uRenderDragging = gl.getUniformLocation(renderProgram, 'uDragging');
  uRenderRingHalfWidth = gl.getUniformLocation(renderProgram, 'uRingHalfWidth');
  uRenderDebugView = gl.getUniformLocation(renderProgram, 'uDebugView');
  ringHalfWidth = Math.max(0.75, 0.6 * (gridWidth / 160));

  // Lignes serrées pour tous les uploads (UNPACK_ALIGNMENT vaut 4 par défaut :
  // une largeur non multiple de 4 ferait échouer texImage2D → worker mort).
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

  // Textures d'état (data null : WebGL2 garantit l'initialisation à zéro = vide).
  stateTex[0] = createStateTexture(null);
  stateTex[1] = createStateTexture(null);
  stateFbo[0] = createFbo(stateTex[0]);
  stateFbo[1] = createFbo(stateTex[1]);
  current = 0;

  paletteTex = createLookupTexture(opts.palette);
  propsTex = createLookupTexture(opts.props);

  // VAO vide requis pour drawArrays sans attributs en WebGL2.
  gl.bindVertexArray(gl.createVertexArray());

  initCounting();

  console.log('GPU worker initialisé (WebGL2)');
  console.log(`Grille : ${gridWidth}x${gridHeight}, ${substepsPerFrame} sous-pas/frame`);

  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

onmessage = ({ data }) => {
  const [inst, ...args] = data;
  switch (inst) {
    case 'initialize':
      initialize(args[0]);
      break;
    case 'paint':
      // args: [gridX, gridY, size, tool]
      paint(args[0], args[1], args[2], args[3]);
      break;
    case 'mouse':
      // args: [x, y, toolSize, dragging]
      mouse.x = args[0];
      mouse.y = args[1];
      mouse.toolSize = args[2];
      mouse.dragging = args[3];
      break;
    case 'debugView':
      debugView = args[0];
      break;
    default:
      break;
  }
};
