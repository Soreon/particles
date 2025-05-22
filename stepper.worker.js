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

// Fonction utilitaire pour tenter de placer une particule à une position
function tryPlaceParticle(targetIndex, particleId) {
  if (targetIndex !== null && nextState[targetIndex] === 0) {
    nextState[targetIndex] = particleId;
    return true;
  }
  return false;
}

function doStepLiquidOptimized(i5, s5) {
  getNeighborsOptimized(i5);
  
  // Essayer de descendre
  if (neighborI2 !== null && neighborS2 === 0 && tryPlaceParticle(neighborI2, s5)) {
    return;
  }
  
  // Essayer de descendre en diagonal (les deux côtés sont libres)
  if (neighborI1 !== null && neighborI3 !== null && 
      neighborS1 === 0 && neighborS3 === 0 && 
      neighborS4 === 0 && neighborS6 === 0) {
    const targetIndex = Math.random() < 0.5 ? neighborI1 : neighborI3;
    if (tryPlaceParticle(targetIndex, s5)) {
      return;
    }
  }
  
  // Essayer de descendre en diagonal gauche
  if (neighborI1 !== null && neighborS1 === 0 && neighborS4 === 0 && 
      tryPlaceParticle(neighborI1, s5)) {
    return;
  }
  
  // Essayer de descendre en diagonal droite
  if (neighborI3 !== null && neighborS3 === 0 && neighborS6 === 0 && 
      tryPlaceParticle(neighborI3, s5)) {
    return;
  }
  
  // Essayer de se déplacer latéralement (les deux côtés sont libres)
  if (neighborI4 !== null && neighborI6 !== null && 
      neighborS4 === 0 && neighborS6 === 0 && 
      neighborS7 === 0 && neighborS9 === 0) {
    const targetIndex = Math.random() < 0.5 ? neighborI4 : neighborI6;
    if (tryPlaceParticle(targetIndex, s5)) {
      return;
    }
  }
  
  // Essayer de se déplacer à gauche
  if (neighborI4 !== null && neighborS4 === 0 && neighborS7 === 0 && 
      tryPlaceParticle(neighborI4, s5)) {
    return;
  }
  
  // Essayer de se déplacer à droite
  if (neighborI6 !== null && neighborS6 === 0 && neighborS9 === 0 && 
      tryPlaceParticle(neighborI6, s5)) {
    return;
  }
  
  // Si aucun mouvement n'est possible, rester en place
  nextState[i5] = s5;
}

function doStepSolidOptimized(i5, s5) {
  getNeighborsOptimized(i5);
  
  // Essayer de descendre
  if (neighborI2 !== null && neighborS2 === 0 && tryPlaceParticle(neighborI2, s5)) {
    return;
  }
  
  // Essayer de descendre en diagonal (les deux côtés sont libres)
  if (neighborI1 !== null && neighborI3 !== null && 
      neighborS1 === 0 && neighborS3 === 0 && 
      neighborS4 === 0 && neighborS6 === 0) {
    const targetIndex = Math.random() < 0.5 ? neighborI1 : neighborI3;
    if (tryPlaceParticle(targetIndex, s5)) {
      return;
    }
  }
  
  // Essayer de descendre en diagonal gauche
  if (neighborI1 !== null && neighborS1 === 0 && neighborS4 === 0 && 
      tryPlaceParticle(neighborI1, s5)) {
    return;
  }
  
  // Essayer de descendre en diagonal droite
  if (neighborI3 !== null && neighborS3 === 0 && neighborS6 === 0 && 
      tryPlaceParticle(neighborI3, s5)) {
    return;
  }
  
  // Si aucun mouvement n'est possible, rester en place
  nextState[i5] = s5;
}

function doStepDensity() {
  // Copier nextState dans tempState pour commencer
  for (let i = 0; i < nextState.length; i++) {
    tempState[i] = nextState[i];
  }
  
  // Phase de densité : faire des échanges basés sur la densité
  for (let y = 0; y < gridHeight; y++) {
    for (let x = 0; x < gridWidth; x++) {
      const i5 = xyToIFast(x, y);
      const s5 = tempState[i5];
      
      if (s5 === 0) continue;
      
      const s5Density = densityFast(s5);
      
      // Vérifier le voisin du bas
      const i2 = (y + 1 < gridHeight) ? xyToIFast(x, y + 1) : null;
      if (i2 !== null) {
        const s2 = tempState[i2];
        if (s2 > 0 && s5Density > densityFast(s2)) {
          // Échanger
          tempState[i5] = s2;
          tempState[i2] = s5;
          continue; // Passer au suivant après échange
        }
      }
      
      // Vérifier les voisins diagonaux bas
      const i1 = (y + 1 < gridHeight && x - 1 >= 0) ? xyToIFast(x - 1, y + 1) : null;
      const i3 = (y + 1 < gridHeight && x + 1 < gridWidth) ? xyToIFast(x + 1, y + 1) : null;
      
      if (i1 !== null && i3 !== null) {
        const s1 = tempState[i1];
        const s3 = tempState[i3];
        
        if (s1 > 0 && s3 > 0 && 
            s5Density > densityFast(s1) && s5Density > densityFast(s3)) {
          const targetIndex = Math.random() < 0.5 ? i1 : i3;
          const swapMaterial = tempState[targetIndex];
          tempState[i5] = swapMaterial;
          tempState[targetIndex] = s5;
          continue;
        }
      }
      
      // Vérifier les voisins latéraux
      const i4 = (x - 1 >= 0) ? xyToIFast(x - 1, y) : null;
      const i6 = (x + 1 < gridWidth) ? xyToIFast(x + 1, y) : null;
      
      if (i4 !== null && i6 !== null) {
        const s4 = tempState[i4];
        const s6 = tempState[i6];
        
        if (s4 > 0 && s6 > 0 && 
            s5Density > densityFast(s4) && s5Density > densityFast(s6)) {
          const targetIndex = Math.random() < 0.5 ? i4 : i6;
          const swapMaterial = tempState[targetIndex];
          tempState[i5] = swapMaterial;
          tempState[targetIndex] = s5;
        }
      }
    }
  }
}

function doStep() {
  // Phase 1: Mouvement des particules
  nextState.fill(0);
  
  // Reset des compteurs de particules
  const keys = Object.keys(particleCount);
  for (let k = 0; k < keys.length; k++) {
    particleCount[keys[k]] = 0;
  }
  
  // Boucle principale avec alternance de direction
  for (let y = 0; y < gridHeight; y++) {
    const startX = y % 2 === 0 ? 0 : gridWidth - 1;
    const endX = y % 2 === 0 ? gridWidth : -1;
    const stepX = y % 2 === 0 ? 1 : -1;

    for (let x = startX; x !== endX; x += stepX) {
      const i5 = xyToIFast(x, y);
      const s5 = currentState[i5];
      
      if (s5 === 0) continue;
      
      const materialName = materialNames[s5];
      const materialType = materialTypes[s5];
      
      particleCount[materialName]++;
      
      if (materialType === 'solid') {
        doStepSolidOptimized(i5, s5);
      } else if (materialType === 'liquid') {
        doStepLiquidOptimized(i5, s5);
      } else {
        // Matériau inconnu, rester en place
        nextState[i5] = s5;
      }
    }
  }
  
  postMessage(['setDebugData', particleCount]);
  
  // Phase 2: Ajustement basé sur la densité
  doStepDensity();
  
  // Rotation des buffers
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
