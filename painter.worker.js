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

// Variables pour le calcul des FPS
let frameCount = 0;
let lastTime = performance.now();
let fps = 0;

function drawGrid() {
  if (currentState === null) return;
  context.clearRect(0, 0, canvasWidth, canvasHeight);
  for (let y = 0; y < gridHeight; y += 1) {
    for (let x = 0; x < gridWidth; x += 1) {
      const p = currentState[(y * gridWidth) + x];
      if (p > 0) {
        context.fillStyle = materials.get(p).color;
        context.fillRect(x * cellWidth, y * cellHeight, cellWidth, cellHeight);
      }
    }
  }
}

function putPixel(x, y) {
  context.fillRect(x * cellWidth, y * cellHeight, cellWidth, cellHeight);
}

function ellipsePoints(x0, y0, x, y) {
  putPixel(x0 + x, y0 + y);
  putPixel(x0 - x, y0 + y);
  putPixel(x0 + x, y0 - y);
  putPixel(x0 - x, y0 - y);

  putPixel(x0 + y, y0 + x);
  putPixel(x0 - y, y0 + x);
  putPixel(x0 + y, y0 - x);
  putPixel(x0 - y, y0 - x);
}

function drawCircle(x0, y0, r) {
  let d = 5 - 4 * r;
  let x = 0;
  let y = r;
  let deltaA = (-2 * r + 5) * 4;
  let deltaB = 3 * 4;

  while (x <= y) {
    for (let i = y; i >= 0; i -= 1) {
      ellipsePoints(x0, y0, x, i);
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

function drawCursor() {
  if (mouse && mouse.x !== -1) {
    context.fillStyle = '#000000';
    const posX = ~~(((mouse.x - left) / canvasWidth) * gridWidth);
    const posY = ~~(((mouse.y - top) / canvasHeight) * gridHeight);
    if (mouse.toolSize === 1) {
      context.fillRect(posX * cellWidth, posY * cellHeight, cellWidth, cellHeight);
    } else {
      drawCircle(posX, posY, mouse.toolSize - 1);
    }
  }
}

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

function setMouse(_mouse) {
  mouse = _mouse;
}

function animate() {
  drawGrid();
  drawCursor();
  calculateFPS();
  requestAnimationFrame(animate);
}

function setCurrentState(_currentState) {
  currentState = _currentState;
}

function onChannelMessage({ data }) {
  const [inst, ...argz] = data;
  switch (inst) {
    case 'setCurrentState':
      setCurrentState(...argz);
      break;
    default: break;
  }
}

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

  context = canvas.getContext('2d');
  top = _top;
  left = _left;
  messageChannel.onmessage = onChannelMessage;
}

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
    default: break;
  }
};
