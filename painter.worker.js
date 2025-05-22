/* eslint-disable no-bitwise */
let canvas = null;
let context = null;
let top = -1;
let left = -1;

let cellWidth = null;
let cellHeight = null;
let canvasWidth = null;
let canvasHeight = null;
let gridWidth = null;
let gridHeight = null;
let currentState = null;
let materials = null;
let messageChannel = null;
let mouse = null;

// Variables pour le rendu optimisé avec ImageData
let imageData = null;
let imageDataBuffer = null;
let materialColors = null;

// Variables pour le calcul des FPS
let frameCount = 0;
let lastTime = performance.now();
let fps = 0;

/**
 * Pré-calcule toutes les couleurs des matériaux en format RGBA 32-bit
 */
function precomputeMaterialColors() {
  const maxMaterialId = Math.max(...materials.keys());
  materialColors = new Uint32Array(maxMaterialId + 1);
  
  materials.forEach((material, id) => {
    if (material.color) {
      // Convertir couleur hex en RGBA 32-bit (format ABGR pour little-endian)
      const hex = material.color.slice(1); // Supprimer le #
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      const a = 255; // Alpha opaque
      
      // Format ABGR pour compatibilité little-endian
      materialColors[id] = (a << 24) | (b << 16) | (g << 8) | r;
    } else {
      materialColors[id] = 0; // Transparent pour void
    }
  });
}

/**
 * Remplit un bloc rectangulaire de pixels dans l'ImageData
 */
function fillBlock(data, startX, startY, blockWidth, blockHeight, color32) {
  if (color32 === 0) return; // Skip transparent pixels
  
  const endX = Math.min(startX + blockWidth, canvasWidth);
  const endY = Math.min(startY + blockHeight, canvasHeight);
  
  // Extraire les composantes RGBA du color32
  const r = color32 & 0xFF;
  const g = (color32 >> 8) & 0xFF;
  const b = (color32 >> 16) & 0xFF;
  const a = (color32 >> 24) & 0xFF;
  
  for (let y = startY; y < endY; y++) {
    for (let x = startX; x < endX; x++) {
      const pixelIndex = (y * canvasWidth + x) * 4;
      data[pixelIndex] = r;     // Rouge
      data[pixelIndex + 1] = g; // Vert
      data[pixelIndex + 2] = b; // Bleu
      data[pixelIndex + 3] = a; // Alpha
    }
  }
}

/**
 * Version optimisée du rendu de la grille avec ImageData
 */
function drawGridOptimized() {
  if (currentState === null) return;
  
  // Créer l'ImageData une seule fois
  if (!imageData) {
    imageData = context.createImageData(canvasWidth, canvasHeight);
    imageDataBuffer = imageData.data;
  }
  
  // Effacer l'image (plus rapide que clearRect)
  imageDataBuffer.fill(0);
  
  // Rendu optimisé - redessiner toutes les particules à chaque frame
  for (let gridY = 0; gridY < gridHeight; gridY++) {
    for (let gridX = 0; gridX < gridWidth; gridX++) {
      const gridIndex = gridY * gridWidth + gridX;
      const particleId = currentState[gridIndex];
      
      if (particleId > 0) {
        const pixelX = gridX * cellWidth;
        const pixelY = gridY * cellHeight;
        const color = materialColors[particleId];
        fillBlock(imageDataBuffer, pixelX, pixelY, cellWidth, cellHeight, color);
      }
    }
  }
  
  // Dessiner l'ImageData d'un coup
  context.putImageData(imageData, 0, 0);
}

/**
 * Version optimisée pour dessiner un pixel unique
 */
function putPixelOptimized(gridX, gridY, color32) {
  if (gridX < 0 || gridX >= gridWidth || gridY < 0 || gridY >= gridHeight) return;
  
  const pixelX = gridX * cellWidth;
  const pixelY = gridY * cellHeight;
  
  fillBlock(imageDataBuffer, pixelX, pixelY, cellWidth, cellHeight, color32);
}

/**
 * Dessine les points d'une ellipse optimisée
 */
function ellipsePointsOptimized(x0, y0, x, y, color32) {
  putPixelOptimized(x0 + x, y0 + y, color32);
  putPixelOptimized(x0 - x, y0 + y, color32);
  putPixelOptimized(x0 + x, y0 - y, color32);
  putPixelOptimized(x0 - x, y0 - y, color32);
  
  putPixelOptimized(x0 + y, y0 + x, color32);
  putPixelOptimized(x0 - y, y0 + x, color32);
  putPixelOptimized(x0 + y, y0 - x, color32);
  putPixelOptimized(x0 - y, y0 - x, color32);
}

/**
 * Algorithme de cercle de Bresenham optimisé
 */
function drawCircleOptimized(x0, y0, r, color32) {
  let d = 5 - 4 * r;
  let x = 0;
  let y = r;
  let deltaA = (-2 * r + 5) * 4;
  let deltaB = 3 * 4;

  while (x <= y) {
    for (let i = y; i >= 0; i -= 1) {
      ellipsePointsOptimized(x0, y0, x, i, color32);
    }

    if (d > 0) {
      d += deltaA;
      y -= 1;
      x += 1;
      deltaA += 4 * 4;
      deltaB += 2 * 2;
    } else {
      d += deltaB;
      x += 1;
      deltaA += 2 * 4;
      deltaB += 2 * 4;
    }
  }
}

/**
 * Rendu du curseur optimisé
 */
function drawCursorOptimized() {
  if (!mouse || mouse.x === -1 || !imageData) return;
  
  const posX = ~~(((mouse.x - left) / canvasWidth) * gridWidth);
  const posY = ~~(((mouse.y - top) / canvasHeight) * gridHeight);
  
  // Couleur noire pour le curseur (format ABGR)
  const cursorColor = 0xFF000000; // Alpha=255, R=G=B=0
  
  if (mouse.toolSize === 1) {
    putPixelOptimized(posX, posY, cursorColor);
  } else {
    drawCircleOptimized(posX, posY, mouse.toolSize - 1, cursorColor);
  }
}

/**
 * Calcul des FPS optimisé
 */
function calculateFPS() {
  frameCount++;
  const currentTime = performance.now();
  
  if (currentTime - lastTime >= 1000) {
    fps = frameCount;
    frameCount = 0;
    lastTime = currentTime;
    
    // Envoyer les FPS au thread principal
    postMessage(['fps', fps]);
  }
}

/**
 * Met à jour les informations de la souris
 */
function setMouse(_mouse) {
  mouse = _mouse;
}

/**
 * Boucle d'animation optimisée
 */
function animate() {
  // Rendu de la grille optimisé
  drawGridOptimized();
  
  // Rendu du curseur optimisé
  drawCursorOptimized();
  
  // Puis appliquer l'ImageData finale
  if (imageData && mouse && mouse.x !== -1) {
    context.putImageData(imageData, 0, 0);
  }
  
  // Calcul des FPS
  calculateFPS();
  
  // Continuer l'animation
  requestAnimationFrame(animate);
}

/**
 * Met à jour l'état actuel de la simulation
 */
function setCurrentState(_currentState) {
  currentState = _currentState;
}

/**
 * Gestionnaire des messages du canal de communication
 */
function onChannelMessage({ data }) {
  const [inst, ...argz] = data;
  switch (inst) {
    case 'setCurrentState':
      setCurrentState(...argz);
      break;
    default: 
      break;
  }
}

/**
 * Initialisation du worker avec optimisations
 */
function initialize(_cellWidth, _cellHeight, _canvasWidth, _canvasHeight, _gridWidth, _gridHeight, _canvas, _materials, _messageChannel, _top, _left) {
  cellWidth = _cellWidth;
  cellHeight = _cellHeight;
  canvasWidth = _canvasWidth;
  canvasHeight = _canvasHeight;
  gridWidth = _gridWidth;
  gridHeight = _gridHeight;
  canvas = _canvas;
  materials = _materials;
  messageChannel = _messageChannel;
  top = _top;
  left = _left;

  // Initialiser le contexte
  context = canvas.getContext('2d');
  
  // Optimisations du contexte
  context.imageSmoothingEnabled = false;
  context.webkitImageSmoothingEnabled = false;
  context.mozImageSmoothingEnabled = false;
  
  // Pré-calculer les couleurs des matériaux
  precomputeMaterialColors();
  
  // Configurer le canal de communication
  messageChannel.onmessage = onChannelMessage;
  
  console.log('Painter worker initialized with ImageData optimization');
  console.log(`Grid: ${gridWidth}x${gridHeight}, Canvas: ${canvasWidth}x${canvasHeight}`);
  console.log(`Cell size: ${cellWidth}x${cellHeight}`);
  console.log(`Materials precomputed: ${materialColors.length}`);
}

/**
 * Gestionnaire principal des messages
 */
onmessage = ({ data }) => {
  const [inst, ...argz] = data;

  switch (inst) {
    case 'initialize':
      initialize(...argz);
      break;
    case 'setMouse':
      setMouse(...argz);
      break;
    case 'animate':
      animate();
      break;
    default: 
      break;
  }
};
