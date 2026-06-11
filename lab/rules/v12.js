// V12 — LA CHALEUR : une température par cellule (canal .a / plan fl).
//
// Le « void » est de l'AIR : il porte une température, la diffuse, et la
// chaleur y CONVECTE (conductivité verticale dopée quand l'air/gaz du dessous
// est plus chaud — les panaches montent). Les transitions de phase deviennent
// des SEUILS de température au lieu de règles de contact :
//
//   eau >= 100 -> vapeur          vapeur < 90 -> eau (condensation)
//   eau <= 16 -> glace            glace >= 40 -> eau (fonte)
//   pierre >= 230 -> lave         lave < 200 -> pierre (CHAUDE -> rougeoie)
//   bois >= 150, plante >= 130, huile >= 120, alcool >= 105 -> feu
//   poudre >= 90 -> explosion     fumée < 40 -> disparaît
//
// Le feu est une SOURCE (T=220, combustible dans .b — il est immobile, son
// canal vx est libre). La lave n'est PAS entretenue : peinte à 255, elle est
// son propre réservoir de chaleur et fige en refroidissant. La glace est un
// réservoir de froid fini (elle se réchauffe en gelant son entourage).
// L'air dissipe lentement vers l'ambiant (32) ; les bords du monde aussi.
//
// La passe d'écoulement reste v10 (nivellement + viscosité), inchangée.

const v10 = require('./v10');
const { TYPE, T_GAS } = require('../materials');

module.exports = function v12(ctx) {
  const { L, R, lp, rp, idAt } = ctx;

  // Nivellement INVERSÉ des gaz : miroir vertical exact de la règle A des
  // liquides. Un gaz bloqué AU-DESSUS (plafond, ou son propre nuage) s'étale
  // latéralement vers une case d'air « de surface de plafond » — sinon la
  // fumée s'accumule en tours inversées au lieu de napper les plafonds.
  const blockedAbove = (p) => p.y - 1 < 0 || idAt(p.x, p.y - 1) !== 0;
  const openBelow = (p) => idAt(p.x, p.y + 1) === 0;
  if (TYPE[L] === T_GAS && R === 0 && blockedAbove(lp) && openBelow(rp)
      && (openBelow(lp) || blockedAbove(rp))) return true;
  if (TYPE[R] === T_GAS && L === 0 && blockedAbove(rp) && openBelow(lp)
      && (openBelow(rp) || blockedAbove(lp))) return true;

  return v10(ctx);
};

module.exports.engine = {
  velocity: true,
  viscosity: true,
  heat: true,
  G: 1,
  jitterP: 0.08,
};
