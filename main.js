const canvas = document.getElementById('canvas').transferControlToOffscreen();

const worker = new Worker('worker.js');

const canvasWidth = 640;
const canvasHeight = 640;

const gridWidth = 128;
const gridHeight = 128;

const cellWidth = canvasWidth / gridWidth | 0;
const cellHeight = canvasHeight / gridHeight | 0;

let currentState = new Uint8Array(gridWidth * gridHeight);
const nextState = new Uint8Array(gridWidth * gridHeight);

const materials = new Map();
materials.set(100, '#afa971');
materials.set(101, '#c5bf87');
materials.set(102, '#dbd59e');
materials.set(103, '#e3dda5');
materials.set(104, '#beb781');
materials.set(105, '#d2cb94');
materials.set(106, '#cfc892');
materials.set(107, '#d6cf98');
materials.set(108, '#d6cf98');
materials.set(109, '#c9c08f');

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
    const x = (n - y) * gridWidth;
    return [x, y];
}

function setRandomCellOn() {
    // for (let i = 0; i < gridWidth; i++) {
    //     currentState[i] = Math.random() < 0.05 ? 1 : 0;
    // }
    currentState[63] = Math.random() < 0.05 ? (Math.floor(Math.random() * 9) + 100) : 0;
    currentState[64] = Math.random() < 0.05 ? (Math.floor(Math.random() * 9) + 100) : 0;
    currentState[65] = Math.random() < 0.05 ? (Math.floor(Math.random() * 9) + 100) : 0;
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

function doStep() {
    nextState.fill(0);
    for (let y = 0; y < gridHeight; y++) {
        for (let x = 0; x < gridWidth; x++) {
            const i5 = xyToI(x, y);
            const s5 = currentState[i5];
            if (s5 > 0) {
                const { s1, s2, s3, i1, i2, i3 } = getNeighborCells(i5);
                if (s2 === 0) {
                    nextState[i2] = s5;
                    continue;
                } else if (s1 === 0 && s3 === 0) {
                    nextState[Math.random() < 0.5 ? i1 : i3] = s5;
                    continue;
                } else if (s1 === 0) {
                    nextState[i1] = s5;
                    continue;
                } else if (s3 === 0) {
                    nextState[i3] = s5;
                    continue;
                } else {
                    nextState[i5] = s5;
                }
            }
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

initialize();

setInterval(() => {
    setRandomCellOn();
    doStep();
    worker.postMessage(['setPos', currentState]);
}, 10);