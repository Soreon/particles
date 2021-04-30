/* eslint-disable no-unused-vars */
import materials from './materials.js';

const canvas = document.getElementById('canvas').transferControlToOffscreen();

const painterWorker = new Worker('painter.worker.js');
const stepperWorker = new Worker('stepper.worker.js');
const messageChannel = new MessageChannel();

const canvasWidth = 800;
const canvasHeight = 800;

const gridWidth = 160;
const gridHeight = 160;

const cellWidth = Math.floor(canvasWidth / gridWidth);
const cellHeight = Math.floor(canvasHeight / gridHeight);

const mouse = {
  x: 0,
  y: 0,
  dragging: false,
};

const debugData = {
  count: {
    water: 0,
    sand: 0,
  },
};

function getRandomIntInclusive(_min, _max) {
  const min = Math.ceil(_min);
  const max = Math.floor(_max);
  return Math.floor(Math.random() * (max - min + 1) + min);
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

function setRandomCellOn() {
  const array = ['sand', 'water'];
  stepperWorker.postMessage(['setCell', 63, 0, Math.random() < 0.25 ? getRandomMaterial(array) : 0]);
  stepperWorker.postMessage(['setCell', 64, 0, Math.random() < 0.25 ? getRandomMaterial(array) : 0]);
  stepperWorker.postMessage(['setCell', 65, 0, Math.random() < 0.25 ? getRandomMaterial(array) : 0]);
}

function displayDebug() {
  document.getElementById('waterCount').textContent = debugData.count.water;
  document.getElementById('sandCount').textContent = debugData.count.sand;
}

function initialize() {
  stepperWorker.postMessage(['initialize', gridWidth, gridHeight, materials, messageChannel.port1], [messageChannel.port1]);
  stepperWorker.postMessage(['process']);

  painterWorker.postMessage(['initialize', cellWidth, cellHeight, canvasWidth, canvasHeight, gridWidth, gridHeight, canvas, materials, messageChannel.port2], [canvas, messageChannel.port2]);
  painterWorker.postMessage(['animate']);
}

function eraseCellAtPixelPosition(x, y) {
  const { top, left } = document.getElementById('canvas').getBoundingClientRect();
  const posX = Math.floor(((x - left) / canvasWidth) * gridWidth);
  const posY = Math.floor(((y - top) / canvasHeight) * gridHeight);
  stepperWorker.postMessage(['setCell', posX, posY, 0]);
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
document.getElementById('canvas').addEventListener('click', (e) => {
  eraseCellAtPixelPosition(e.clientX, e.clientY);
});

initialize();

setInterval(() => {
  setRandomCellOn();
  if (mouse.dragging) eraseCellAtPixelPosition(mouse.x, mouse.y);
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
