let canvas = null;
let context = null;

let cellWidth = null;
let cellHeight = null;
let canvasWidth = null;
let canvasHeight = null;
let gridWidth = null;
let gridHeight = null;
let pos = null;

function drawGrid() {
    context.clearRect(0, 0, canvasWidth, canvasHeight);
    context.beginPath();
    for (let y = 0; y < gridHeight; y++) {
        for (let x = 0; x < gridWidth; x++) {
            const p = pos[(y * gridWidth) + x];
            if (p === 1) context.rect(x * cellWidth, y * cellHeight, cellWidth, cellHeight);
        }
    }
    context.fill();
}

function animate() {
    drawGrid();
    requestAnimationFrame(animate);
}

function initialize(_cellWidth, _cellHeight, _canvasWidth, _canvasHeight, _gridWidth, _gridHeight, _canvas) {
    cellWidth = _cellWidth;
    cellHeight = _cellHeight;
    canvasWidth = _canvasWidth;
    canvasHeight = _canvasHeight;
    gridWidth = _gridWidth;
    gridHeight = _gridHeight;
    canvas = _canvas;
    context = canvas.getContext('2d');
};

function setPos(_pos) {
    pos = _pos;
}

onmessage = ({ data }) => {
    const [inst, ...argz] = data;

    switch (inst) {
        case 'initialize':
            console.log('initialize');
            initialize(...argz);
            break;
        case 'setPos':
            console.log('setPos');
            setPos(...argz);
            break;
        case 'animate':
            console.log('animate');
            animate();
            break;
    }
}