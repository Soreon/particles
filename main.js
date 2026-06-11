/* eslint-disable no-bitwise */
//
// main.js — Thread principal.
//
// Ne fait quasiment rien côté calcul : il transfère l'OffscreenCanvas au worker
// GPU, construit les tables de lookup (palette de couleurs + propriétés des
// matériaux) à partir de materials.js, et relaie les entrées souris/molette.
// Toute la simulation et le rendu vivent dans gpu.worker.js (WebGL2).
//
// La taille de grille se choisit via l'URL : ?grid=320 (défaut), 640, 800…
// La vitesse de chute et la taille du pinceau sont proportionnelles à la
// résolution, pour garder le même rendu À L'ÉCRAN qu'à 160x160.

import materials from './materials.js';

const canvasElement = document.getElementById('canvas');
const toolElement = document.getElementById('tool');
const debugElement = document.getElementById('debug');
const fpsElement = document.getElementById('fps-value');

const urlParams = new URLSearchParams(window.location.search);
// ?grid= fixe la HAUTEUR de grille ; la largeur est déduite du format de la
// fenêtre (zone disponible à côté du panneau) -> la simulation épouse l'écran.
// Clamp [32, 2048] (MAX_TEXTURE_SIZE garanti >= 2048 en WebGL2) et arrondi au
// multiple de 4 : valeurs négatives/énormes/farfelues -> échec opaque sinon.
const clampGrid = (v) => Math.round(Math.min(2048, Math.max(32, v)) / 4) * 4;
const PANEL_SPACE = 278; // panneau 240 + gouttières/padding
const availW = Math.max(320, window.innerWidth - PANEL_SPACE);
const availH = Math.max(320, window.innerHeight - 20);
const requestedGrid = parseInt(urlParams.get('grid'), 10) || 320;
const gridHeight = clampGrid(requestedGrid);
const gridWidth = clampGrid(Math.round(gridHeight * (availW / availH)));
const gridSize = gridHeight; // référence d'échelle (chute, pinceau)

// La gravité fait tomber d'une case par sous-pas : on scale les sous-pas avec
// la grille pour une vitesse visuelle ~constante (8 sous-pas à 160).
const substepsPerFrame = Math.max(4, Math.round(8 * (gridSize / 160)));

// Pinceau : 5 crans, chacun proportionnel à la résolution. On stocke le CRAN
// (1..5) et on calcule la taille en cases — un clamp sur la taille ferait
// dériver les valeurs hors de la grille des crans après une butée.
const toolSizeUnit = Math.max(1, Math.round(gridSize / 160));
const MAX_TOOL_NOTCH = 5;
let toolNotch = 3;

// Les 10 premiers outils ont un raccourci clavier (touches 1..9, 0).
const tools = ['void', 'water', 'sand', 'oil', 'alcool', 'stone', 'wood', 'fire', 'lava', 'powder', 'ice', 'plant'];
const TOOL_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

const mouse = {
  x: 0,
  y: 0,
  gridX: -1,
  gridY: -1,
  dragging: false,
  tool: 'sand',
  toolSize: 3 * toolSizeUnit,
};

// --- Construction des tables de lookup (indexées par id de matériau, 0..255) ---

const TYPE_VOID = 0;
const TYPE_SOLID = 1;
const TYPE_LIQUID = 2;
const TYPE_STATIC = 3; // immobile et indéplaçable (pierre)
const TYPE_GAS = 4;    // monte, ondule, durée de vie (fumée, vapeur)
const TYPE_FIRE = 5;   // brûle sur place, embrase, durée de vie

function buildLookupTables() {
  const palette = new Uint8Array(256 * 4); // RGBA par id
  const props = new Uint8Array(256 * 4);   // [densité, type, fluidité, inflammabilité]

  materials.forEach((mat, id) => {
    if (mat.color) {
      const hex = mat.color.slice(1);
      palette[id * 4 + 0] = parseInt(hex.slice(0, 2), 16);
      palette[id * 4 + 1] = parseInt(hex.slice(2, 4), 16);
      palette[id * 4 + 2] = parseInt(hex.slice(4, 6), 16);
      palette[id * 4 + 3] = 255;
    }
    props[id * 4 + 0] = mat.density || 0;
    props[id * 4 + 2] = Math.round((mat.fluidity || 0) * 255);
    props[id * 4 + 3] = mat.flammability || 0;
    if (mat.type === 'solid') props[id * 4 + 1] = TYPE_SOLID;
    else if (mat.type === 'liquid') props[id * 4 + 1] = TYPE_LIQUID;
    else if (mat.type === 'static') props[id * 4 + 1] = TYPE_STATIC;
    else if (mat.type === 'gas') props[id * 4 + 1] = TYPE_GAS;
    else if (mat.type === 'fire') props[id * 4 + 1] = TYPE_FIRE;
    else props[id * 4 + 1] = TYPE_VOID;
  });

  return { palette, props };
}

// tool (nom) -> liste d'ids candidats (variantes de couleur)
function buildToolIds() {
  const map = { void: [0] };
  materials.forEach((mat, id) => {
    if (!mat.name || mat.name === 'void') return;
    if (!map[mat.name]) map[mat.name] = [];
    map[mat.name].push(id);
  });
  return map;
}

// --- Panneau de debug : une ligne par matériau + taille de grille ---

const countElements = {};

function addDebugRow(label) {
  const row = debugElement.appendChild(document.createElement('div'));
  row.classList.add('debugRow');
  const labelEl = row.appendChild(document.createElement('span'));
  labelEl.classList.add('debugLabel');
  labelEl.textContent = label.charAt(0).toUpperCase() + label.slice(1) + ': ';
  const valueEl = row.appendChild(document.createElement('span'));
  valueEl.classList.add('debugValue');
  return valueEl;
}

let viewElement = null;

function initializeDebugElements(toolIds) {
  addDebugRow('grid').textContent = gridWidth + 'x' + gridHeight;
  viewElement = addDebugRow('view');
  viewElement.textContent = 'normal';
  for (const name of Object.keys(toolIds)) {
    if (name === 'void') continue;
    countElements[name] = addDebugRow(name);
    countElements[name].textContent = '0';
  }
}

function setDebugData(counts) {
  for (const name of Object.keys(counts)) {
    if (countElements[name]) countElements[name].textContent = counts[name];
  }
}

// --- Barre d'outils pixel art : un bouton par matériau, avec un échantillon
// dessiné à partir des VRAIES variantes de couleurs (mini-canvas 12x12 agrandi
// en pixelated). Le feu scintille en redessinant son échantillon. ---

const toolbarElement = document.getElementById('toolbar');
const toolButtons = {};

function drawSwatch(swatch, name, toolIds) {
  const ctx = swatch.getContext('2d');
  const n = swatch.width;
  if (name === 'void') {
    // gomme : fond sombre + diagonale grise
    ctx.fillStyle = '#101014';
    ctx.fillRect(0, 0, n, n);
    ctx.fillStyle = '#55555f';
    for (let i = 2; i < n - 2; i++) ctx.fillRect(i, n - 1 - i, 1, 1);
    return;
  }
  const ids = toolIds[name];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const id = ids[(Math.random() * ids.length) | 0];
      ctx.fillStyle = materials.get(id).color;
      ctx.fillRect(x, y, 1, 1);
    }
  }
}

function selectTool(name) {
  mouse.tool = name;
  toolElement.textContent = name;
  for (const t of Object.keys(toolButtons)) {
    toolButtons[t].classList.toggle('selected', t === name);
  }
}

function initializeToolbar(toolIds) {
  tools.forEach((name, idx) => {
    const btn = document.createElement('div');
    btn.className = 'toolBtn';
    const key = idx < TOOL_KEYS.length ? TOOL_KEYS[idx] : null;
    btn.title = key ? `${name} (${key})` : name;

    const swatch = document.createElement('canvas');
    swatch.width = 10;
    swatch.height = 10;
    drawSwatch(swatch, name, toolIds);
    btn.appendChild(swatch);

    const label = document.createElement('span');
    label.textContent = key ? `${key} ${name}` : name;
    btn.appendChild(label);

    btn.addEventListener('click', () => selectTool(name));
    toolbarElement.appendChild(btn);
    toolButtons[name] = btn;

    // le feu et la lave vacillent : échantillons redessinés en continu
    if (name === 'fire' || name === 'lava') {
      setInterval(() => drawSwatch(swatch, name, toolIds), 280);
    }
  });
}

// --- Démarrage ---

const { palette, props } = buildLookupTables();
const toolIds = buildToolIds();
initializeDebugElements(toolIds);
initializeToolbar(toolIds);

// clientWidth/clientLeft excluent la bordure 1px du canvas : sans ça, le
// pinceau dérive de 1-2 cases au bord droit/bas aux grandes grilles.
// Le canvas est dimensionné par la fenêtre (plein écran) : on re-mesure à
// chaque redimensionnement.
let displayLeft = 0;
let displayTop = 0;
let displayWidth = 1;
let displayHeight = 1;

function updateDisplayMetrics() {
  const rect = canvasElement.getBoundingClientRect();
  displayLeft = rect.left + canvasElement.clientLeft;
  displayTop = rect.top + canvasElement.clientTop;
  displayWidth = canvasElement.clientWidth;
  displayHeight = canvasElement.clientHeight;
}

// Dimensionne le canvas pour remplir la zone disponible en respectant
// EXACTEMENT le format de la grille (cellules carrées, pas d'étirement).
function fitCanvas() {
  const w = Math.max(320, window.innerWidth - PANEL_SPACE);
  const h = Math.max(320, window.innerHeight - 20);
  const scale = Math.min(w / gridWidth, h / gridHeight);
  canvasElement.style.width = `${Math.floor(gridWidth * scale)}px`;
  canvasElement.style.height = `${Math.floor(gridHeight * scale)}px`;
  updateDisplayMetrics();
}
fitCanvas();
window.addEventListener('resize', fitCanvas);

const offscreen = canvasElement.transferControlToOffscreen();
const gpuWorker = new Worker('gpu.worker.js');

gpuWorker.postMessage(['initialize', {
  canvas: offscreen,
  gridWidth,
  gridHeight,
  substepsPerFrame,
  palette,
  props,
  toolIds,
}], [offscreen, palette.buffer, props.buffer]);

selectTool(mouse.tool);

// --- Conversion coordonnées écran -> cases de la grille ---

function updateGridPosition() {
  mouse.gridX = ~~(((mouse.x - displayLeft) / displayWidth) * gridWidth);
  mouse.gridY = ~~(((mouse.y - displayTop) / displayHeight) * gridHeight);
}

// --- Entrées ---

canvasElement.addEventListener('mousedown', () => { mouse.dragging = true; });
canvasElement.addEventListener('mouseup', () => { mouse.dragging = false; });
canvasElement.addEventListener('mousemove', (e) => {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
  updateGridPosition();
});
canvasElement.addEventListener('mouseleave', () => {
  mouse.gridX = -1;
  mouse.gridY = -1;
});
// La sélection de matériau se fait par les boutons de la barre d'outils ;
// la molette règle la taille du pinceau (avec ou sans CTRL).
canvasElement.addEventListener('wheel', (e) => {
  e.preventDefault();
  toolNotch += e.deltaY > 0 ? -1 : 1;
  toolNotch = Math.max(1, Math.min(MAX_TOOL_NOTCH, toolNotch));
  mouse.toolSize = toolNotch * toolSizeUnit;
}, { passive: false });

// Touche V : cycle des vues de debug du rendu (normal -> vy -> vx -> temp).
// Touches 1..9, 0 : sélection directe d'outil (via e.code Digit*, indépendant
// de la disposition clavier — sur AZERTY les chiffres non shiftés marchent).
const DEBUG_VIEWS = ['normal', 'vy', 'vx', 'temp'];
let debugView = 0;
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  if (e.key === 'v' || e.key === 'V') {
    debugView = (debugView + 1) % DEBUG_VIEWS.length;
    gpuWorker.postMessage(['debugView', debugView]);
    viewElement.textContent = DEBUG_VIEWS[debugView];
    return;
  }
  if (e.code.startsWith('Digit')) {
    const idx = TOOL_KEYS.indexOf(e.code.slice(5));
    if (idx >= 0 && idx < tools.length) selectTool(tools[idx]);
  }
});

// Boucle d'entrée : envoie l'état souris (pour le curseur) et peint si on drague.
setInterval(() => {
  gpuWorker.postMessage(['mouse', mouse.gridX, mouse.gridY, mouse.toolSize, mouse.dragging]);
  if (mouse.dragging && mouse.gridX >= 0) {
    gpuWorker.postMessage(['paint', mouse.gridX, mouse.gridY, mouse.toolSize, mouse.tool]);
  }
}, 10);

// --- Retours du worker ---

gpuWorker.onmessage = ({ data }) => {
  const [inst, ...args] = data;
  switch (inst) {
    case 'fps':
      fpsElement.textContent = Math.round(args[0]);
      break;
    case 'debugData':
      setDebugData(args[0]);
      break;
    default:
      break;
  }
};
