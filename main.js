/* eslint-disable no-bitwise */
//
// main.js — Thread principal.
//
// Ne fait quasiment rien côté calcul : il transfère l'OffscreenCanvas au worker
// GPU, construit les tables de lookup (palette de couleurs + propriétés des
// matériaux) à partir de materials.js, et relaie les entrées souris/molette.
// Toute la simulation et le rendu vivent dans gpu.worker.js (WebGL2).

import materials from './materials.js';

const canvasElement = document.getElementById('canvas');
const toolElement = document.getElementById('tool');
const fpsElement = document.getElementById('fps-value');

const gridWidth = 160;
const gridHeight = 160;

const tools = ['void', 'water', 'sand', 'oil', 'alcool'];

const mouse = {
  x: 0,
  y: 0,
  gridX: -1,
  gridY: -1,
  dragging: false,
  tool: 'sand',
  toolSize: 3,
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

// --- Démarrage ---

const { palette, props } = buildLookupTables();
const toolIds = buildToolIds();

const rect = canvasElement.getBoundingClientRect();
const displayLeft = rect.left;
const displayTop = rect.top;
const displayWidth = rect.width;
const displayHeight = rect.height;

const offscreen = canvasElement.transferControlToOffscreen();
const gpuWorker = new Worker('gpu.worker.js');

gpuWorker.postMessage(['initialize', {
  canvas: offscreen,
  gridWidth,
  gridHeight,
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
    mouse.toolSize += e.deltaY > 0 ? -1 : 1;
    mouse.toolSize = Math.max(1, Math.min(5, mouse.toolSize));
  } else {
    let index = tools.indexOf(mouse.tool) + (e.deltaY > 0 ? 1 : -1);
    index = (index + tools.length) % tools.length;
    mouse.tool = tools[index];
    toolElement.textContent = mouse.tool;
  }
}, { passive: false });

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
    default:
      break;
  }
};
