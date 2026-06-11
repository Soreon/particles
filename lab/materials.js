// Tables de matériaux — répliquent materials.js (mêmes ids, densités, types).
const T_VOID = 0;
const T_SOLID = 1;
const T_LIQUID = 2;
const T_STATIC = 3; // immobile et indéplaçable (pierre)
const T_GAS = 4;    // monte dans le vide, wobble latéral, durée de vie
const T_FIRE = 5;   // immobile, durée de vie, brûle ses voisins inflammables

const DENS = new Uint8Array(256);
const FLUID = new Uint8Array(256); // fluidité 0..255 (255 = parfaitement fluide)
const FLAM = new Uint8Array(256);  // inflammabilité 0..255 (0 = incombustible)
const TYPE = new Uint8Array(256);
const NAME_OF = new Array(256).fill('void');

function register(name, idStart, density, type, fluidity = 0, flam = 0) {
  for (let id = idStart; id < idStart + 10; id++) {
    DENS[id] = density;
    TYPE[id] = type;
    NAME_OF[id] = name;
    FLUID[id] = Math.round(fluidity * 255);
    FLAM[id] = flam;
  }
}

register('sand', 100, 10, T_SOLID);
register('water', 110, 5, T_LIQUID, 0.8);
register('oil', 120, 6, T_LIQUID, 0.25, 170);
register('alcool', 130, 4, T_LIQUID, 1.0, 255);
register('stone', 140, 255, T_STATIC);
register('wood', 150, 255, T_STATIC, 0, 140);
register('fire', 160, 0, T_FIRE);
register('smoke', 170, 1, T_GAS);
register('steam', 180, 1, T_GAS);
// Lave : feu liquide, très visqueuse, dense — fige en pierre au contact de l'eau.
register('lava', 190, 8, T_LIQUID, 0.12);
// Glace : statique — fond près du feu/lave, gèle l'eau adjacente (lentement).
register('ice', 200, 255, T_STATIC);
// Plante : statique inflammable — boit l'eau adjacente pour pousser.
register('plant', 210, 255, T_STATIC, 0, 190);
// Poudre : granulaire — EXPLOSE au contact du feu/lave (souffle + éjections).
register('powder', 220, 7, T_SOLID);

const MATERIAL_IDS = {
  void: [0],
  sand: Array.from({ length: 10 }, (_, i) => 100 + i),
  water: Array.from({ length: 10 }, (_, i) => 110 + i),
  oil: Array.from({ length: 10 }, (_, i) => 120 + i),
  alcool: Array.from({ length: 10 }, (_, i) => 130 + i),
  stone: Array.from({ length: 10 }, (_, i) => 140 + i),
  wood: Array.from({ length: 10 }, (_, i) => 150 + i),
  fire: Array.from({ length: 10 }, (_, i) => 160 + i),
  smoke: Array.from({ length: 10 }, (_, i) => 170 + i),
  steam: Array.from({ length: 10 }, (_, i) => 180 + i),
  lava: Array.from({ length: 10 }, (_, i) => 190 + i),
  ice: Array.from({ length: 10 }, (_, i) => 200 + i),
  plant: Array.from({ length: 10 }, (_, i) => 210 + i),
  powder: Array.from({ length: 10 }, (_, i) => 220 + i),
};

module.exports = {
  DENS, TYPE, FLUID, FLAM, NAME_OF, MATERIAL_IDS,
  T_VOID, T_SOLID, T_LIQUID, T_STATIC, T_GAS, T_FIRE,
};
