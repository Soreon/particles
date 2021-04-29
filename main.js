import materials from './materials.js';

const canvas = document.getElementById('canvas').transferControlToOffscreen();

const worker = new Worker('worker.js');

const canvasWidth = 800;
const canvasHeight = 800;

const gridWidth = 160;
const gridHeight = 160;

const cellWidth = Math.floor(canvasWidth / gridWidth);
const cellHeight = Math.floor(canvasHeight / gridHeight);

let currentState = new Uint8Array(gridWidth * gridHeight);
const nextState = new Uint8Array(gridWidth * gridHeight);

let mouse = {
  x: 0,
  y: 0,
  dragging: false,
}

let debugData = {
  count: {
    water: 0,
    sand: 0,
  }
}

function getRandomIntInclusive(_min, _max) {
  const min = Math.ceil(_min);
  const max = Math.floor(_max);
  return Math.floor(Math.random() * (max - min + 1) + min);
}

function xyToI(x, y) {
  if (x < 0) return null;
  if (x >= gridWidth) return null;
  if (y < 0) return null;
  if (y >= gridHeight) return null;

  return (y * gridWidth) + x;
}

function iToXy(i) {
  if (i < 0) return null;
  if (i >= gridWidth * gridHeight) return null;

  const n = i / gridWidth;
  const y = Math.floor(n);
  const x = Math.round((n - y) * gridWidth);
  return [x, y];
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
  // for (let i = 0; i < gridWidth; i++) {
  //     currentState[i] = Math.random() < 0.05 ? 1 : 0;
  // }
  const array = ['sand', 'water'];
  currentState[63] = Math.random() < 0.25 ? getRandomMaterial(array) : 0;
  currentState[64] = Math.random() < 0.25 ? getRandomMaterial(array) : 0;
  currentState[65] = Math.random() < 0.25 ? getRandomMaterial(array) : 0;
}

function getNeighborCells(i) {
  const [x, y] = iToXy(i);
  const i1 = xyToI(x - 1, y + 1);
  const i2 = xyToI(x + 0, y + 1);
  const i3 = xyToI(x + 1, y + 1);
  const i4 = xyToI(x - 1, y + 0);
  const i6 = xyToI(x + 1, y + 0);
  const i7 = xyToI(x - 1, y - 1);
  const i8 = xyToI(x + 0, y - 1);
  const i9 = xyToI(x + 1, y - 1);
  return {
    i1,
    i2,
    i3,
    i4,
    i5: i,
    i6,
    i7,
    i8,
    i9,
    s1: currentState[i1] ?? null,
    s2: currentState[i2] ?? null,
    s3: currentState[i3] ?? null,
    s4: currentState[i4] ?? null,
    s5: currentState[i],
    s6: currentState[i6] ?? null,
    s7: currentState[i7] ?? null,
    s8: currentState[i8] ?? null,
    s9: currentState[i9] ?? null,
  };
}

function doStepWater(i5, s5) {
  const {
    s1, s2, s3, s4, s6, s8, i1, i2, i3, i4, i6,
  } = getNeighborCells(i5);

  if (s2 === 0 && nextState[i2] === 0) {
    if (nextState[i2] === 0) {
      nextState[i2] = s5;
      return;
    }
  } else if (s1 === 0 && s3 === 0) {
    const ia = Math.random() < 0.5 ? i1 : i3;
    if (nextState[ia] === 0) {
      nextState[ia] = s5;
      return;
    }
  } else if (s1 === 0 && nextState[i1] === 0) {
    if (nextState[i1] === 0) {
      nextState[i1] = s5;
      return;
    }
  } else if (s3 === 0 && nextState[i3] === 0) {
    if (nextState[i3] === 0) {
      nextState[i3] = s5;
      return;
    }
  } else if (s4 === 0 && s6 === 0) {
    const ir = Math.random() < 0.5 ? i4 : i6;
    if (nextState[ir] === 0) {
      nextState[ir] = s5;
      return;
    }
  } else if (s4 === 0 && nextState[i4] === 0) {
    if (nextState[i4] === 0) {
      nextState[i4] = s5;
      return;
    }
  } else if (s6 === 0 && nextState[i6] === 0) {
    if (nextState[i6] === 0) {
      nextState[i6] = s5;
      return;
    }
  }
  nextState[i5] = s5;
}

function doStepSand(i5, s5) {
  const {
    s1, s2, s3, i1, i2, i3,
  } = getNeighborCells(i5);
  if (s2 === 0) {
    if(nextState[i2] === 0) {
      nextState[i2] = s5;
      return;
    }
  } /* else if (s2 !== null && materials.get(s5).density > materials.get(s2).density) {
    nextState[i2] = s5;
    nextState[i5] = s2;
  }*/ else if (s1 === 0 && s3 === 0) {
    const ir = Math.random() < 0.5 ? i1 : i3;
    if(nextState[ir] === 0) {
      nextState[ir] = s5;
      return;
    }
  } else if (s1 === 0) {
    if(nextState[i1] === 0) {
      nextState[i1] = s5;
      return;
    }
  } else if (s3 === 0) {
    if(nextState[i3] === 0) {
      nextState[i3] = s5;
      return;
    }
  }
  nextState[i5] = s5;
}

function doStepDensity(i5, s5) {
  const {
    s2, s8, i8
  } = getNeighborCells(i5);
  if ((s2 === null || s2 !== 0) && s8 !== null && materials.get(s8).density > materials.get(s5).density) {
    nextState[i5] = s8;
    nextState[i8] = s5;
  }
}

function displayDebug() {
  document.getElementById('waterCount').textContent = debugData.count.water;
  document.getElementById('sandCount').textContent = debugData.count.sand;
}

function doStep() {
  nextState.fill(0);
  debugData.count.sand = 0;
  debugData.count.water = 0;
  for (let y = 0; y < gridHeight; y += 1) {
    for (let x = 0; x < gridWidth; x += 1) {
      const i5 = xyToI(x, y);
      const s5 = currentState[i5];

      switch (materials.get(s5).name) {
        case 'sand': doStepSand(i5, s5);
          debugData.count.sand += 1;
          break;
        case 'water': doStepWater(i5, s5);
          debugData.count.water += 1;
          break;
        default: break;
      }
    }
  }
  for (let y = 0; y < gridHeight; y += 1) {
    for (let x = 0; x < gridWidth; x += 1) {
      const i5 = xyToI(x, y);
      const s5 = currentState[i5];
      doStepDensity(i5, s5);
    }
  }
  currentState = [...nextState];
}

function initialize() {
  currentState.fill(0);
  worker.postMessage(['initialize', cellWidth, cellHeight, canvasWidth, canvasHeight, gridWidth, gridHeight, canvas, materials], [canvas]);
  worker.postMessage(['setPos', currentState]);
  worker.postMessage(['animate']);
}


function eraseCellAtPixelPosition(x, y) {
  const { top, left } = document.getElementById('canvas').getBoundingClientRect();

  const posX = Math.floor(((x - left) / canvasWidth) * gridWidth);
  const posY = Math.floor(((y - top) / canvasHeight) * gridHeight);

  currentState[xyToI(posX, posY)] = 0;
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
  doStep();
  if (mouse.dragging) eraseCellAtPixelPosition(mouse.x, mouse.y);
  displayDebug();
  worker.postMessage(['setPos', currentState]);
}, 10);
