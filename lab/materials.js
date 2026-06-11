// Tables de matériaux — répliquent materials.js (mêmes ids, densités, types).
const T_VOID = 0;
const T_SOLID = 1;
const T_LIQUID = 2;

const DENS = new Uint8Array(256);
const TYPE = new Uint8Array(256);
const NAME_OF = new Array(256).fill('void');

function register(name, idStart, density, type) {
  for (let id = idStart; id < idStart + 10; id++) {
    DENS[id] = density;
    TYPE[id] = type;
    NAME_OF[id] = name;
  }
}

register('sand', 100, 10, T_SOLID);
register('water', 110, 5, T_LIQUID);
register('oil', 120, 6, T_LIQUID);
register('alcool', 130, 4, T_LIQUID);

const MATERIAL_IDS = {
  void: [0],
  sand: Array.from({ length: 10 }, (_, i) => 100 + i),
  water: Array.from({ length: 10 }, (_, i) => 110 + i),
  oil: Array.from({ length: 10 }, (_, i) => 120 + i),
  alcool: Array.from({ length: 10 }, (_, i) => 130 + i),
};

module.exports = { DENS, TYPE, NAME_OF, MATERIAL_IDS, T_VOID, T_SOLID, T_LIQUID };
