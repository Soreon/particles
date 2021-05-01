/* eslint-disable no-bitwise */
/* eslint-disable no-unused-vars */
import materials from './materials.js';

const canvas = document.getElementById('canvas').transferControlToOffscreen();
const { top, left } = document.getElementById('canvas').getBoundingClientRect();

const painterWorker = new Worker('painter.worker.js');
const stepperWorker = new Worker('stepper.worker.js');
const messageChannel = new MessageChannel();

const canvasWidth = 800;
const canvasHeight = 800;

const gridWidth = 160;
const gridHeight = 160;

const cellWidth = ~~(canvasWidth / gridWidth);
const cellHeight = ~~(canvasHeight / gridHeight);

const tools = ['void', 'water', 'sand'];
const mouse = {
  x: 0,
  y: 0,
  dragging: false,
  tool: 'void',
  toolSize: 1,
};

const debugData = {
  count: {
    water: 0,
    sand: 0,
  },
};

function getRandomIntInclusive(_min, _max) {
  const min = Math.ceil(_min);
  const max = ~~(_max);
  return ~~(Math.random() * (max - min + 1) + min);
}

function getMaterialIds(material) {
  return [...materials].filter((e) => e[1].name === material).map((e) => e[0]);
}

function getRandomMaterial(array) {
  let min = Infinity;
  let max = -Infinity;

  materials.forEach((e, k) => {
    if (array.includes(e.name)) {
      min = Math.min(min, k);
      max = Math.max(max, k);
    }
  });

  return getRandomIntInclusive(min, max);
}

function displayDebug() {
  document.getElementById('waterCount').textContent = debugData.count.water;
  document.getElementById('sandCount').textContent = debugData.count.sand;
  document.getElementById('tool').textContent = mouse.tool;
}

function initialize() {
  stepperWorker.postMessage(['initialize', gridWidth, gridHeight, materials, messageChannel.port1], [messageChannel.port1]);
  stepperWorker.postMessage(['process']);

  painterWorker.postMessage(['initialize', cellWidth, cellHeight, canvasWidth, canvasHeight, gridWidth, gridHeight, canvas, materials, messageChannel.port2, top, left], [canvas, messageChannel.port2]);
  painterWorker.postMessage(['animate']);
}

function setCellAtPixelPosition(x, y, v) {
  const posX = ~~(((x - left) / canvasWidth) * gridWidth);
  const posY = ~~(((y - top) / canvasHeight) * gridHeight);
  const matIds = getMaterialIds(v);
  const matId = matIds[~~(Math.random() * matIds.length)];
  stepperWorker.postMessage(['setCell', posX, posY, matId]);
}

function setDebugData(particleCount) {
  debugData.count = particleCount;
}

document.getElementById('canvas').addEventListener('mousedown', () => { mouse.dragging = true; });
document.getElementById('canvas').addEventListener('mouseup', () => { mouse.dragging = false; });
document.getElementById('canvas').addEventListener('mousemove', (e) => {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
});
document.getElementById('canvas').addEventListener('mouseleave', (e) => {
  mouse.x = -1;
  mouse.y = -1;
});
document.getElementById('canvas').addEventListener('wheel', (e) => {
  if (e.ctrlKey) {
    e.preventDefault();
    if (e.deltaY > 0) {
      mouse.toolSize -= 1;
    } else {
      mouse.toolSize += 1;
    }
    mouse.toolSize = Math.max(mouse.toolSize, 1);
    mouse.toolSize = Math.min(mouse.toolSize, 5);
  } else {
    let index = tools.indexOf(mouse.tool);
    if (e.deltaY > 0) {
      index += 1;
    } else {
      index -= 1;
    }
    index += tools.length;
    index %= tools.length;
    mouse.tool = tools[index];
  }
});

function ellipsePoints(x0, y0, x, y) {
  setCellAtPixelPosition(x0 + x, y0 + y, mouse.tool);
  setCellAtPixelPosition(x0 - x, y0 + y, mouse.tool);
  setCellAtPixelPosition(x0 + x, y0 - y, mouse.tool);
  setCellAtPixelPosition(x0 - x, y0 - y, mouse.tool);
  setCellAtPixelPosition(x0 + y, y0 + x, mouse.tool);
  setCellAtPixelPosition(x0 - y, y0 + x, mouse.tool);
  setCellAtPixelPosition(x0 + y, y0 - x, mouse.tool);
  setCellAtPixelPosition(x0 - y, y0 - x, mouse.tool);
}

function setCellsAtPixelPosition(x0, y0, r) {
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

initialize();

setInterval(() => {
  if (mouse.dragging) {
    if (mouse.toolSize === 1) {
      setCellAtPixelPosition(mouse.x, mouse.y, mouse.tool);
    } else {
      setCellsAtPixelPosition(mouse.x, mouse.y, mouse.toolSize + 1, mouse.tool);
    }
  }
  painterWorker.postMessage(['setMouse', mouse]);
  displayDebug();
}, 10);

stepperWorker.onmessage = ({ data }) => {
  const [inst, ...argz] = data;

  switch (inst) {
    case 'setDebugData':
      setDebugData(...argz);
      break;
    default: break;
  }
};
