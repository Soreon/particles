// V11 — nouveaux matériaux : pierre (statique), bois (solide flottant),
// feu, fumée, vapeur (gaz à durée de vie) + transformations (combustion,
// extinction, vaporisation, condensation/pluie).
//
// La passe d'écoulement est STRICTEMENT v10 (nivellement + viscosité) : les
// nouveaux types y sont inertes (les règles ne touchent que les liquides).
// Toute la nouveauté vit dans le moteur :
//   - movable() : pierre et feu immobiles/indéplaçables ;
//   - solide-à-travers-solide interdit (le sable se pose SUR le bois) ;
//   - gaz : poussée d'Archimède permanente (vy signé haut), wobble latéral,
//     durée de vie dans .a/fl ;
//   - transformations par cellule sur l'état pré-frame (sans conflit).
//
// NB : les transformations brisent volontairement la conservation de masse
// (combustion, évaporation) — les scénarios à feu sont validés hors du
// harnais à assert de conservation.

const v10 = require('./v10');

module.exports = function v11(ctx) {
  return v10(ctx);
};

module.exports.engine = {
  velocity: true,
  viscosity: true,
  transforms: true,
  G: 1,
  jitterP: 0.08,
};
