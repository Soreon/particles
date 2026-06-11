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
// Clamp [32, 2048] (MAX_TEXTURE_SIZE garanti >= 2048 en WebGL2) et arrondi au
// multiple de 4 : valeurs négatives/énormes/farfelues -> échec opaque sinon.
const requestedGrid = parseInt(urlParams.get('grid'), 10) || 320;
const gridSize = Math.round(Math.min(2048, Math.max(32, requestedGrid)) / 4) * 4;
const gridWidth = gridSize;
const gridHeight = gridSize;

// La gravité fait tomber d'une case par sous-pas : on scale les sous-pas avec
// la grille pour une vitesse visuelle ~constante (8 sous-pas à 160).
const substepsPerFrame = Math.max(4, Math.round(8 * (gridSize / 160)));

// Pinceau : 5 crans, chacun proportionnel à la résolution. On stocke le CRAN
// (1..5) et on calcule la taille en cases — un clamp sur la taille ferait
// dériver les valeurs hors de la grille des crans après une butée.
const toolSizeUnit = Math.max(1, Math.round(gridSize / 160));
const MAX_TOOL_NOTCH = 5;
let toolNotch = 3;

const tools = ['void', 'water', 'sand', 'oil', 'alcool'];

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

function buildLookupTables() {
  const palette = new Uint8Array(256 * 4); // RGBA par id
  const props = new Uint8Array(256 * 4);   // [densité, type, _, _] par id

  materials.forEach((mat, id) => {
    if (mat.color) {
      const hex = mat.color.slice(1);
      palette[id * 4 + 0] = parseInt(hex.slice(0, 2), 16);
      palette[id * 4 + 1] = parseInt(hex.slice(2, 4), 16);
      palette[id * 4 + 2] = parseInt(hex.slice(4, 6), 16);
      palette[id * 4 + 3] = 255;
    }
    props[id * 4 + 0] = mat.density || 0;
    if (mat.type === 'solid') props[id * 4 + 1] = TYPE_SOLID;
    else if (mat.type === 'liquid') props[id * 4 + 1] = TYPE_LIQUID;
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

// --- Démarrage ---

const { palette, props } = buildLookupTables();
const toolIds = buildToolIds();
initializeDebugElements(toolIds);

// clientWidth/clientLeft excluent la bordure 1px du canvas (rect.width = 802) :
// sans ça, le pinceau dérive de 1-2 cases au bord droit/bas aux grandes grilles.
const rect = canvasElement.getBoundingClientRect();
const displayLeft = rect.left + canvasElement.clientLeft;
const displayTop = rect.top + canvasElement.clientTop;
const displayWidth = canvasElement.clientWidth;
const displayHeight = canvasElement.clientHeight;

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

toolElement.textContent = mouse.tool;

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
canvasElement.addEventListener('wheel', (e) => {
  if (e.ctrlKey) {
    e.preventDefault();
    toolNotch += e.deltaY > 0 ? -1 : 1;
    toolNotch = Math.max(1, Math.min(MAX_TOOL_NOTCH, toolNotch));
    mouse.toolSize = toolNotch * toolSizeUnit;
  } else {
    let index = tools.indexOf(mouse.tool) + (e.deltaY > 0 ? 1 : -1);
    index = (index + tools.length) % tools.length;
    mouse.tool = tools[index];
    toolElement.textContent = mouse.tool;
  }
}, { passive: false });

// Touche V : cycle des vues de debug du rendu (normal -> vy -> vx -> flags).
// Visualise les canaux de vélocité, invisibles au rendu normal.
const DEBUG_VIEWS = ['normal', 'vy', 'vx', 'flags'];
let debugView = 0;
window.addEventListener('keydown', (e) => {
  if (e.key === 'v' || e.key === 'V') {
    debugView = (debugView + 1) % DEBUG_VIEWS.length;
    gpuWorker.postMessage(['debugView', debugView]);
    viewElement.textContent = DEBUG_VIEWS[debugView];
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
