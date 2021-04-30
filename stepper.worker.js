let gridWidth = null;
let gridHeight = null;
let materials = null;
let currentState = null;
let nextState = null;
let messageChannel = null;

const particleCount = {
  water: 0,
  sand: 0,
};

function initialize(_gridWidth, _gridHeight, _materials, _messageChannel) {
  gridWidth = _gridWidth;
  gridHeight = _gridHeight;
  materials = _materials;
  currentState = new Uint16Array(gridWidth * gridHeight);
  nextState = new Uint16Array(gridWidth * gridHeight);
  messageChannel = _messageChannel;
  currentState.fill(0);
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
    s1, s2, s3, s4, s6, i1, i2, i3, i4, i6,
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

/** TODO: Inverser le fonctionnement de step
 *  Si on imagine 9 cellules :
 * ┌─────┬─────┬─────┐
 * │  7  │  8  │  9  │
 * ├─────┼─────┼─────┤
 * │  4  │  5  │  6  │
 * ├─────┼─────┼─────┤
 * │  1  │  2  │  3  │
 * └─────┴─────┴─────┘
 * L'ordre de parcours et 7 8 9 4 5 6 1 2 3
 * La règle du s3 de la case 7 s'applique avant la règle s2 de la case 8
 * On raisonne actuellement du point de vue des particules.
 * Il faudrait raisonner d'un point de vue cellule (emplacement).
 * Le fait d'inverser le fonctionnement nececite de créer un nouveau système.
 * EX: En reprenant la grille, si 2 et 3 sont vides, la case 6 pourrait activer la
 * régle s9 de 2 et la règle s8 de 3.
 * Il faut un moyen de flaguer les particules déjà gérés (grille intermediaire ?)
 */
function doStepSand(i5, s5) {
  const {
    s1, s2, s3, i1, i2, i3,
  } = getNeighborCells(i5);
  if (s2 === 0) {
    if (nextState[i2] === 0) {
      nextState[i2] = s5;
      return;
    }
  } else if (s1 === 0 && s3 === 0) {
    const ir = Math.random() < 0.5 ? i1 : i3;
    if (nextState[ir] === 0) {
      nextState[ir] = s5;
      return;
    }
  } else if (s1 === 0) {
    if (nextState[i1] === 0) {
      nextState[i1] = s5;
      return;
    }
  } else if (s3 === 0) {
    if (nextState[i3] === 0) {
      nextState[i3] = s5;
      return;
    }
  }
  nextState[i5] = s5;
}

function doStepDensity(i5, s5) {
  const {
    i1, s1, i2, s2, i3, s3,
  } = getNeighborCells(i5);
  if (s2 > 0 && materials.get(s5).density > materials.get(s2).density) {
    nextState[i2] = s5;
    nextState[i5] = s2;
  } else if (s1 > 0 && s3 > 0 && materials.get(s5).density > materials.get(s1).density && materials.get(s5).density > materials.get(s3).density) {
    const ir = Math.random() < 0.5 ? i1 : i3;
    const sr = currentState[ir];
    nextState[ir] = s5;
    nextState[i5] = sr;
  } else if (s1 > 0 && materials.get(s5).density > materials.get(s1).density) {
    nextState[i1] = s5;
    nextState[i5] = s1;
  } else if (s3 > 0 && materials.get(s5).density > materials.get(s3).density) {
    nextState[i3] = s5;
    nextState[i5] = s3;
  }
}

function doStepMaterial(i5, s5) {
  const {
    s1, s2, s3, i1, i2, i3,
  } = getNeighborCells(i5);
  if (s2 === 0) {
    if (nextState[i2] === 0) {
      nextState[i2] = s5;
      return;
    }
  } else if (s1 === 0 && s3 === 0) {
    const ir = Math.random() < 0.5 ? i1 : i3;
    if (nextState[ir] === 0) {
      nextState[ir] = s5;
      return;
    }
  } else if (s1 === 0) {
    if (nextState[i1] === 0) {
      nextState[i1] = s5;
      return;
    }
  } else if (s3 === 0) {
    if (nextState[i3] === 0) {
      nextState[i3] = s5;
      return;
    }
  }
  nextState[i5] = s5;
}

function doStep() {
  nextState.fill(0);
  Object.keys(particleCount).forEach((key) => { particleCount[key] = 0; });
  for (let y = 0; y < gridHeight; y += 1) {
    for (let x = 0; x < gridWidth; x += 1) {
      const i5 = xyToI(x, y);
      const s5 = currentState[i5];
      const { name: materialName } = materials.get(s5);
      particleCount[materialName] += 1;
      switch (materialName) {
        case 'sand': doStepSand(i5, s5);
          break;
        case 'water': doStepWater(i5, s5);
          break;
        default: break;
      }
    }
  }
  postMessage(['setDebugData', particleCount]);
  currentState = [...nextState];
  for (let y = 0; y < gridHeight; y += 1) {
    for (let x = 0; x < gridWidth; x += 1) {
      const i5 = xyToI(x, y);
      const s5 = currentState[i5];
      doStepDensity(i5, s5);
    }
  }
  currentState = [...nextState];
}

function process() {
  setInterval(() => {
    doStep();
    messageChannel.postMessage(['setCurrentState', currentState]);
  }, 10);
}

function setCell(x, y, v) {
  const i = xyToI(x, y);
  currentState[i] = v;
}

onmessage = ({ data }) => {
  const [inst, ...argz] = data;

  switch (inst) {
    case 'initialize':
      initialize(...argz);
      break;
    case 'process':
      process(...argz);
      break;
    case 'setCell':
      setCell(...argz);
      break;
    default: break;
  }
};
