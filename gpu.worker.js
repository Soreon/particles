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
// Phase 1 : la passe de simulation est l'identité (copie). On valide ainsi le
// pipeline (textures, ping-pong, rendu, pinceau) avant d'écrire la vraie physique.

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
let uFlowState = null;
let uFlowProps = null;
let uFlowOffsetX = null;
let uFlowGrid = null;
let uFlowSeed = null;
let uRenderState = null;
let uRenderPalette = null;
let uRenderGrid = null;
let uRenderMouse = null;
let uRenderToolSize = null;
let uRenderDragging = null;

// Tampon CPU réutilisé pour estampiller le pinceau (taille max d'un disque r<=8).
let brushPatch = new Uint8Array(1);

// État souris reçu du thread principal (coordonnées en cases de la grille).
const mouse = { x: -1, y: -1, toolSize: 1, dragging: false };

// tool -> liste d'ids candidats (pour choisir une variante de couleur au hasard)
let toolIds = {};

// --- Mesure FPS ---
let frameCount = 0;
let lastFpsTime = 0;

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

// Crée une texture d'état R8UI initialisée avec `data` (Uint8Array) ou à zéro.
function createStateTexture(data) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(
    gl.TEXTURE_2D, 0, gl.R8UI, gridWidth, gridHeight, 0,
    gl.RED_INTEGER, gl.UNSIGNED_BYTE, data || null,
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

out uint outId;

float densOf(uint id) { return texelFetch(uProps, ivec2(int(id), 0), 0).r; }
uint typeOf(uint id)  { return uint(texelFetch(uProps, ivec2(int(id), 0), 0).g * 255.0 + 0.5); }
uint fetch(ivec2 p)   { return texelFetch(uState, p, 0).r; }

float hash(ivec2 p) {
  return fract(sin(dot(vec2(p), vec2(127.1, 311.7)) + uSeed) * 43758.5453);
}

void main() {
  ivec2 cell = ivec2(gl_FragCoord.xy);
  int lx = (cell.x - uOffset.x) & 1; // position dans le bloc (0/1)
  int ly = (cell.y - uOffset.y) & 1;
  ivec2 corner = ivec2(cell.x - lx, cell.y - ly); // coin haut-gauche du bloc

  // Bloc qui déborde de la grille : on ne bouge pas (sera traité à un autre offset).
  if (corner.x < 0 || corner.y < 0 || corner.x + 1 >= uGrid.x || corner.y + 1 >= uGrid.y) {
    outId = fetch(cell);
    return;
  }

  // a=TL, b=TR, c=BL, d=BR (y vers le bas : c/d = rangée du bas)
  uint a = fetch(corner);
  uint b = fetch(corner + ivec2(1, 0));
  uint c = fetch(corner + ivec2(0, 1));
  uint d = fetch(corner + ivec2(1, 1));
  float da = densOf(a), db = densOf(b), dc = densOf(c), dd = densOf(d);
  float rnd = hash(corner);
  uint t; float td;

  // 1. Coulée verticale : le plus dense descend dans chaque colonne.
  if (da > dc) { t = a; a = c; c = t; td = da; da = dc; dc = td; }
  if (db > dd) { t = b; b = d; d = t; td = db; db = dd; dd = td; }

  // 2. Diagonale quand la descente droite est bloquée (le dessous n'est pas plus léger).
  //    Ordre des deux diagonales choisi par l'aléa pour éviter tout biais gauche/droite.
  if (rnd < 0.5) {
    if (da > dd && dc >= da) { t = a; a = d; d = t; td = da; da = dd; dd = td; }
    if (db > dc && dd >= db) { t = b; b = c; c = t; td = db; db = dc; dc = td; }
  } else {
    if (db > dc && dd >= db) { t = b; b = c; c = t; td = db; db = dc; dc = td; }
    if (da > dd && dc >= da) { t = a; a = d; d = t; td = da; da = dd; dd = td; }
  }

  // (L'étalement horizontal des liquides est traité par une passe dédiée, FLOW_FS,
  //  beaucoup plus efficace pour niveler que l'étalement intra-bloc.)

  // Chaque invocation ne sort que sa propre case du bloc.
  if (lx == 0 && ly == 0) outId = a;
  else if (lx == 1 && ly == 0) outId = b;
  else if (lx == 0 && ly == 1) outId = c;
  else outId = d;
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

out uint outId;

const uint LIQUID = 2u;
const int K = 2;  // portée du scan de dénivelé (exact : la décision sature à 2)
const int KS = 3; // portée du scan posé / en-transit

float densOf(uint id) { return texelFetch(uProps, ivec2(int(id), 0), 0).r; }
uint typeOf(uint id) { return uint(texelFetch(uProps, ivec2(int(id), 0), 0).g * 255.0 + 0.5); }
uint fetch(ivec2 p)  { return texelFetch(uState, p, 0).r; }

float hash(ivec2 p) {
  return fract(sin(dot(vec2(p), vec2(127.1, 311.7)) + uSeed) * 43758.5453);
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
  if (cornerX < 0 || cornerX + 1 >= uGrid.x) { outId = fetch(cell); return; }

  ivec2 lp = ivec2(cornerX, cell.y);
  ivec2 rp = ivec2(cornerX + 1, cell.y);
  uint L = fetch(lp);
  uint R = fetch(rp);
  float dL = densOf(L);
  float dR = densOf(R);
  bool lLiq = typeOf(L) == LIQUID;
  bool rLiq = typeOf(R) == LIQUID;

  bool doSwap = false;

  // A. Nivellement de surface (liquide↔vide) : « source en surface OU cible
  //    soutenue ». L'eau DE SURFACE s'étale librement (ruissellement, cascades) ;
  //    l'eau SUBMERGÉE ne glisse que vers une case posée sur quelque chose
  //    (blockedBelow(cible)) — c'est la base d'une colonne qui s'effondre.
  //    Pousser de l'eau submergée vers une case avec du vide dessous ne nivelle
  //    rien : elle ne fait que tomber, et c'est ce qui déchiquetait en traits
  //    horizontaux les cavités de vide peintes au pinceau. Un tube de void se
  //    vide ainsi par le bas pendant que le vide sort par le haut.
  if (lLiq && R == 0u && blockedBelow(lp) && openAbove(rp)
      && (openAbove(lp) || blockedBelow(rp))) {
    doSwap = true;
  } else if (rLiq && L == 0u && blockedBelow(rp) && openAbove(lp)
      && (openAbove(rp) || blockedBelow(lp))) {
    doSwap = true;
  } else if (lLiq && rLiq && dL != dR) {
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

  if (doSwap) { uint t = L; L = R; R = t; }
  outId = (lx == 0) ? L : R;
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

out vec4 fragColor;

const vec3 BG = vec3(0.063, 0.063, 0.078); // fond pour le vide (#101014)

void main() {
  ivec2 cell = ivec2(int(gl_FragCoord.x), uGrid.y - 1 - int(gl_FragCoord.y));
  uint id = texelFetch(uState, cell, 0).r;

  vec3 color;
  if (id == 0u) {
    color = BG;
  } else {
    color = texelFetch(uPalette, ivec2(int(id), 0), 0).rgb;
  }

  // Curseur : anneau (ou point) à la position souris.
  if (uMouse.x >= 0.0) {
    vec2 d = vec2(float(cell.x), float(cell.y)) - uMouse;
    float dist = length(d);
    float r = float(uToolSize - 1);
    bool onCursor = (uToolSize == 1)
      ? (cell.x == int(uMouse.x) && cell.y == int(uMouse.y))
      : (abs(dist - r) < 0.6);
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
function paint(cx, cy, size, tool) {
  const r = size <= 1 ? 0 : size - 1;
  if (cx < 0 || cy < 0 || cx >= gridWidth || cy >= gridHeight) {
    if (r === 0) return;
  }

  gl.bindTexture(gl.TEXTURE_2D, stateTex[current]);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

  if (r === 0) {
    brushPatch[0] = pickId(tool);
    gl.texSubImage2D(
      gl.TEXTURE_2D, 0, cx, cy, 1, 1,
      gl.RED_INTEGER, gl.UNSIGNED_BYTE, brushPatch,
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
    if (brushPatch.length < segW) brushPatch = new Uint8Array(segW);
    for (let x = 0; x < segW; x++) brushPatch[x] = pickId(tool);
    gl.texSubImage2D(
      gl.TEXTURE_2D, 0, segMinX, y, segW, 1,
      gl.RED_INTEGER, gl.UNSIGNED_BYTE, brushPatch,
    );
  }
}

// ---------------------------------------------------------------------------
// Passes
// ---------------------------------------------------------------------------

// Un sous-pas de simulation : lit la texture courante, écrit l'autre, échange.
function stepSim() {
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
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  current = dst;
}

// Un sous-pas d'écoulement horizontal des liquides (paires 2x1, offset alterné).
function stepFlow(offsetX) {
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
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

function frame(now) {
  // Gravité et écoulement ENTRELACÉS : après chaque étalement latéral, la gravité
  // suivante fait retomber l'eau (cascade : descend → s'étale → redescend → plat).
  for (let s = 0; s < substepsPerFrame; s++) {
    stepSim();
    for (let f = 0; f < flowPassesPerFrame; f++) {
      stepFlow(flowCounter & 1);
      flowCounter++;
    }
  }
  render();

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

  uFlowState = gl.getUniformLocation(flowProgram, 'uState');
  uFlowProps = gl.getUniformLocation(flowProgram, 'uProps');
  uFlowOffsetX = gl.getUniformLocation(flowProgram, 'uOffsetX');
  uFlowGrid = gl.getUniformLocation(flowProgram, 'uGrid');
  uFlowSeed = gl.getUniformLocation(flowProgram, 'uSeed');
  uRenderState = gl.getUniformLocation(renderProgram, 'uState');
  uRenderPalette = gl.getUniformLocation(renderProgram, 'uPalette');
  uRenderGrid = gl.getUniformLocation(renderProgram, 'uGrid');
  uRenderMouse = gl.getUniformLocation(renderProgram, 'uMouse');
  uRenderToolSize = gl.getUniformLocation(renderProgram, 'uToolSize');
  uRenderDragging = gl.getUniformLocation(renderProgram, 'uDragging');

  // Textures d'état (initialisées à zéro = vide).
  const zero = new Uint8Array(gridWidth * gridHeight);
  stateTex[0] = createStateTexture(zero);
  stateTex[1] = createStateTexture(zero);
  stateFbo[0] = createFbo(stateTex[0]);
  stateFbo[1] = createFbo(stateTex[1]);
  current = 0;

  paletteTex = createLookupTexture(opts.palette);
  propsTex = createLookupTexture(opts.props);

  // VAO vide requis pour drawArrays sans attributs en WebGL2.
  gl.bindVertexArray(gl.createVertexArray());

  console.log('GPU worker initialisé (WebGL2)');
  console.log(`Grille : ${gridWidth}x${gridHeight}`);

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
    default:
      break;
  }
};
