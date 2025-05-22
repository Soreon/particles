let gridWidth = null;
let gridHeight = null;
let materials = null;
let currentState = null;
let nextState = null;
let tempState = null;
let messageChannel = null;

const particleCount = {};

let speedMultiplier = 1;

// Variables globales réutilisées pour éviter les allocations d'objets
let neighborI1, neighborI2, neighborI3, neighborI4, neighborI6, neighborI7, neighborI8, neighborI9;
let neighborS1, neighborS2, neighborS3, neighborS4, neighborS5, neighborS6, neighborS7, neighborS8, neighborS9;
let currentX, currentY;

// Cache pour les densités des matériaux (évite les appels répétés à materials.get())
let materialDensities = null;
let materialTypes = null;
let materialNames = null;

function initialize(_gridWidth, _gridHeight, _materials, _messageChannel) {
  gridWidth = _gridWidth;
  gridHeight = _gridHeight;
  materials = _materials;
  currentState = new Uint16Array(gridWidth * gridHeight);
  nextState = new Uint16Array(gridWidth * gridHeight);
  tempState = new Uint16Array(gridWidth * gridHeight);
  messageChannel = _messageChannel;
  currentState.fill(0);

  // Pré-calculer les propriétés des matériaux pour éviter les lookups
  const maxMaterialId = Math.max(...materials.keys());
  materialDensities = new Uint8Array(maxMaterialId + 1);
  materialTypes = new Array(maxMaterialId + 1);
  materialNames = new Array(maxMaterialId + 1);
  
  materials.forEach((material, id) => {
    materialDensities[id] = material.density || 0;
    materialTypes[id] = material.type || 'void';
    materialNames[id] = material.name || 'void';
  });

  const materialsArray = [...new Set([...materials].map((e) => e[1].name))].filter((e) => e !== 'void');
  for (let i = 0; i < materialsArray.length; i++) {
    particleCount[materialsArray[i]] = 0;
  }
}

// Conversion optimisée sans vérification de bounds (assumant des coordonnées valides)
function xyToIFast(x, y) {
  return (y * gridWidth) + x;
}

// Avec vérification de bounds pour les cas critiques
function xyToI(x, y) {
  if (x < 0 || x >= gridWidth || y < 0 || y >= gridHeight) return null;
  return (y * gridWidth) + x;
}

function iToXy(i) {
  if (i < 0 || i >= gridWidth * gridHeight) return null;
  const y = Math.floor(i / gridWidth);
  const x = i - (y * gridWidth);
  return [x, y];
}

// Fonction optimisée pour obtenir la densité directement du cache
function densityFast(materialId) {
  return materialDensities[materialId];
}

// Version optimisée sans allocation d'objet - utilise les variables globales
function getNeighborsOptimized(i) {
  // Calcul direct des coordonnées sans allocation
  currentY = Math.floor(i / gridWidth);
  currentX = i - (currentY * gridWidth);
  
  // Calcul direct des indices des voisins
  const yMinus1 = currentY - 1;
  const yPlus1 = currentY + 1;
  const xMinus1 = currentX - 1;
  const xPlus1 = currentX + 1;
  
  // Indices des voisins (null si hors limites)
  neighborI7 = (yMinus1 >= 0 && xMinus1 >= 0) ? (yMinus1 * gridWidth + xMinus1) : null;
  neighborI8 = (yMinus1 >= 0) ? (yMinus1 * gridWidth + currentX) : null;
  neighborI9 = (yMinus1 >= 0 && xPlus1 < gridWidth) ? (yMinus1 * gridWidth + xPlus1) : null;
  
  neighborI4 = (xMinus1 >= 0) ? (currentY * gridWidth + xMinus1) : null;
  // neighborI5 = i (centre)
  neighborI6 = (xPlus1 < gridWidth) ? (currentY * gridWidth + xPlus1) : null;
  
  neighborI1 = (yPlus1 < gridHeight && xMinus1 >= 0) ? (yPlus1 * gridWidth + xMinus1) : null;
  neighborI2 = (yPlus1 < gridHeight) ? (yPlus1 * gridWidth + currentX) : null;
  neighborI3 = (yPlus1 < gridHeight && xPlus1 < gridWidth) ? (yPlus1 * gridWidth + xPlus1) : null;
  
  // États des voisins
  neighborS7 = (neighborI7 !== null) ? currentState[neighborI7] : 0;
  neighborS8 = (neighborI8 !== null) ? currentState[neighborI8] : 0;
  neighborS9 = (neighborI9 !== null) ? currentState[neighborI9] : 0;
  neighborS4 = (neighborI4 !== null) ? currentState[neighborI4] : 0;
  neighborS5 = currentState[i];
  neighborS6 = (neighborI6 !== null) ? currentState[neighborI6] : 0;
  neighborS1 = (neighborI1 !== null) ? currentState[neighborI1] : 0;
  neighborS2 = (neighborI2 !== null) ? currentState[neighborI2] : 0;
  neighborS3 = (neighborI3 !== null) ? currentState[neighborI3] : 0;
}

// Version optimisée pour buffer spécifique
function getNeighborsFromBufferOptimized(i, buffer) {
  // Réutilise les mêmes calculs de coordonnées
  currentY = Math.floor(i / gridWidth);
  currentX = i - (currentY * gridWidth);
  
  const yMinus1 = currentY - 1;
  const yPlus1 = currentY + 1;
  const xMinus1 = currentX - 1;
  const xPlus1 = currentX + 1;
  
  neighborI7 = (yMinus1 >= 0 && xMinus1 >= 0) ? (yMinus1 * gridWidth + xMinus1) : null;
  neighborI8 = (yMinus1 >= 0) ? (yMinus1 * gridWidth + currentX) : null;
  neighborI9 = (yMinus1 >= 0 && xPlus1 < gridWidth) ? (yMinus1 * gridWidth + xPlus1) : null;
  neighborI4 = (xMinus1 >= 0) ? (currentY * gridWidth + xMinus1) : null;
  neighborI6 = (xPlus1 < gridWidth) ? (currentY * gridWidth + xPlus1) : null;
  neighborI1 = (yPlus1 < gridHeight && xMinus1 >= 0) ? (yPlus1 * gridWidth + xMinus1) : null;
  neighborI2 = (yPlus1 < gridHeight) ? (yPlus1 * gridWidth + currentX) : null;
  neighborI3 = (yPlus1 < gridHeight && xPlus1 < gridWidth) ? (yPlus1 * gridWidth + xPlus1) : null;
  
  neighborS7 = (neighborI7 !== null) ? buffer[neighborI7] : 0;
  neighborS8 = (neighborI8 !== null) ? buffer[neighborI8] : 0;
  neighborS9 = (neighborI9 !== null) ? buffer[neighborI9] : 0;
  neighborS4 = (neighborI4 !== null) ? buffer[neighborI4] : 0;
  neighborS5 = buffer[i];
  neighborS6 = (neighborI6 !== null) ? buffer[neighborI6] : 0;
  neighborS1 = (neighborI1 !== null) ? buffer[neighborI1] : 0;
  neighborS2 = (neighborI2 !== null) ? buffer[neighborI2] : 0;
  neighborS3 = (neighborI3 !== null) ? buffer[neighborI3] : 0;
}

function doStepLiquidOptimized(i5, s5) {
  getNeighborsOptimized(i5);
  
  // Utilise les variables globales directement au lieu de destructuring
  if (neighborS2 === 0 && nextState[neighborI2] === 0) {
    nextState[neighborI2] = s5;
    return;
  } else if (neighborS1 === 0 && neighborS3 === 0 && neighborS4 === 0 && neighborS6 === 0) {
    const targetIndex = Math.random() < 0.5 ? neighborI1 : neighborI3;
    if (nextState[targetIndex] === 0) {
      nextState[targetIndex] = s5;
      return;
    }
  } else if (neighborS1 === 0 && nextState[neighborI1] === 0 && neighborS4 === 0) {
    nextState[neighborI1] = s5;
    return;
  } else if (neighborS3 === 0 && nextState[neighborI3] === 0 && neighborS6 === 0) {
    nextState[neighborI3] = s5;
    return;
  } else if (neighborS4 === 0 && neighborS6 === 0 && neighborS7 === 0 && neighborS9 === 0) {
    const targetIndex = Math.random() < 0.5 ? neighborI4 : neighborI6;
    if (nextState[targetIndex] === 0) {
      nextState[targetIndex] = s5;
      return;
    }
  } else if (neighborS4 === 0 && nextState[neighborI4] === 0 && neighborS7 === 0) {
    nextState[neighborI4] = s5;
    return;
  } else if (neighborS6 === 0 && nextState[neighborI6] === 0 && neighborS9 === 0) {
    nextState[neighborI6] = s5;
    return;
  }
  nextState[i5] = s5;
}

function doStepSolidOptimized(i5, s5) {
  getNeighborsOptimized(i5);
  
  if (neighborS2 === 0) {
    if (nextState[neighborI2] === 0) {
      nextState[neighborI2] = s5;
      return;
    }
  } else if (neighborS1 === 0 && neighborS3 === 0 && neighborS4 === 0 && neighborS6 === 0) {
    const targetIndex = Math.random() < 0.5 ? neighborI1 : neighborI3;
    if (nextState[targetIndex] === 0) {
      nextState[targetIndex] = s5;
      return;
    }
  } else if (neighborS1 === 0 && neighborS4 === 0) {
    if (nextState[neighborI1] === 0) {
      nextState[neighborI1] = s5;
      return;
    }
  } else if (neighborS3 === 0 && neighborS6 === 0) {
    if (nextState[neighborI3] === 0) {
      nextState[neighborI3] = s5;
      return;
    }
  }
  nextState[i5] = s5;
}

function doStepDensityToBufferOptimized(i5, s5, sourceBuffer, targetBuffer) {
  getNeighborsFromBufferOptimized(i5, sourceBuffer);
  
  if (s5 === 0) return;
  
  const s5Density = densityFast(s5);
  
  if (neighborS2 > 0 && s5Density > densityFast(neighborS2)) {
    targetBuffer[neighborI2] = s5;
    targetBuffer[i5] = neighborS2;
  } else if (neighborS1 > 0 && neighborS4 > 0 && neighborS3 > 0 && neighborS6 > 0 && 
             s5Density > densityFast(neighborS1) && s5Density > densityFast(neighborS4) && 
             s5Density > densityFast(neighborS3) && s5Density > densityFast(neighborS6)) {
    const targetIndex = Math.random() < 0.5 ? neighborI1 : neighborI3;
    const swapMaterial = sourceBuffer[targetIndex];
    targetBuffer[targetIndex] = s5;
    targetBuffer[i5] = swapMaterial;
  } else if (neighborS1 > 0 && neighborS4 > 0 && 
             s5Density > densityFast(neighborS1) && s5Density > densityFast(neighborS4)) {
    targetBuffer[neighborI1] = s5;
    targetBuffer[i5] = neighborS1;
  } else if (neighborS3 > 0 && neighborS6 > 0 && 
             s5Density > densityFast(neighborS3) && s5Density > densityFast(neighborS6)) {
    targetBuffer[neighborI3] = s5;
    targetBuffer[i5] = neighborS3;
  } else {
    targetBuffer[i5] = s5;
  }
}

function doStep() {
  nextState.fill(0);
  
  // Reset des compteurs de particules - optimisé
  const keys = Object.keys(particleCount);
  for (let k = 0; k < keys.length; k++) {
    particleCount[keys[k]] = 0;
  }
  
  // Boucle principale optimisée
  for (let y = 0; y < gridHeight; y++) {
    const startX = y % 2 === 0 ? 0 : gridWidth - 1;
    const endX = y % 2 === 0 ? gridWidth : -1;
    const stepX = y % 2 === 0 ? 1 : -1;

    for (let x = startX; x !== endX; x += stepX) {
      const i5 = xyToIFast(x, y);
      const s5 = currentState[i5];
      
      if (s5 === 0) continue; // Skip vide
      
      const materialName = materialNames[s5];
      const materialType = materialTypes[s5];
      
      particleCount[materialName]++;
      
      // Switch optimisé avec comparaisons directes
      if (materialType === 'solid') {
        doStepSolidOptimized(i5, s5);
      } else if (materialType === 'liquid') {
        doStepLiquidOptimized(i5, s5);
      }
    }
  }
  
  postMessage(['setDebugData', particleCount]);
  
  // Phase de densité optimisée
  tempState.fill(0);
  for (let y = 0; y < gridHeight; y++) {
    for (let x = 0; x < gridWidth; x++) {
      const i5 = xyToIFast(x, y);
      const s5 = nextState[i5];
      if (s5 > 0) {
        tempState[i5] = s5;
        doStepDensityToBufferOptimized(i5, s5, nextState, tempState);
      }
    }
  }
  
  // Rotation des buffers sans allocation
  const temp = currentState;
  currentState = tempState;
  tempState = nextState;
  nextState = temp;
}

function process() {
  setInterval(() => {
    doStep();
    messageChannel.postMessage(['setCurrentState', currentState]);
  }, 10);
}

function setCell(x, y, v) {
  const i = xyToI(x, y);
  if (i !== null) {
    currentState[i] = v;
  }
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
