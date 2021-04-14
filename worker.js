let canvas = null;
let context = null;

let cellWidth = null;
let cellHeight = null;
let canvasWidth = null;
let canvasHeight = null;
let gridWidth = null;
let gridHeight = null;
let pos = null;
let materials = null;

function drawGrid() {
  context.clearRect(0, 0, canvasWidth, canvasHeight);
  for (let y = 0; y < gridHeight; y += 1) {
    for (let x = 0; x < gridWidth; x += 1) {
      const p = pos[(y * gridWidth) + x];
      if (p > 0) {
        context.fillStyle = materials.get(p).color;
        context.fillRect(x * cellWidth, y * cellHeight, cellWidth, cellHeight);
      }
    }
  }
}

function animate() {
  drawGrid();
  requestAnimationFrame(animate);
}

function initialize(_cellWidth, _cellHeight, _canvasWidth, _canvasHeight, _gridWidth, _gridHeight, _canvas, _materials) {
  cellWidth = _cellWidth;
  cellHeight = _cellHeight;
  canvasWidth = _canvasWidth;
  canvasHeight = _canvasHeight;
  gridWidth = _gridWidth;
  gridHeight = _gridHeight;
  canvas = _canvas;
  materials = _materials;
  context = canvas.getContext('2d');
}

function setPos(_pos) {
  pos = _pos;
}

onmessage = ({ data }) => {
  const [inst, ...argz] = data;

  switch (inst) {
    case 'initialize':
      initialize(...argz);
      break;
    case 'setPos':
      setPos(...argz);
      break;
    case 'animate':
      animate();
      break;
    default: break;
  }
};
