// V6 — règle A : « source en surface OU cible soutenue ».
//
// Deux exigences contradictoires sur l'étalement latéral liquide→vide :
//   - une COLONNE versée doit s'effondrer vite → l'eau submergée de la base
//     doit pouvoir glisser latéralement (comportement v4) ;
//   - une CAVITÉ peinte (tube de void) ne doit PAS être déchiquetée en traits
//     horizontaux par l'eau submergée qui s'y engouffre (correctif v5).
// La discrimination locale : à la base d'une colonne, la case de vide visée est
// SOUTENUE (blockedBelow(cible) : sol ou eau dessous). Au milieu d'un tube, la
// case visée a du vide dessous — y pousser de l'eau ne nivelle rien (elle ne
// fait que tomber et découper la cavité).
//   → eau de surface : libre (openAbove(source)) — ruissellement, cascades ;
//   → eau submergée : seulement vers une case soutenue (blockedBelow(cible)).
// Un tube se vide ainsi par le bas pendant que le vide sort par le haut.
//
// La partie liquide-liquide (scan de hauteur) est strictement identique à v4/v5.

const { DENS, TYPE, T_LIQUID } = require('../materials');

const K = 2; // portée du scan vertical (exact : la décision sature à 2)

module.exports = function v6(ctx) {
  const {
    L, R, dL, dR, lLiq, rLiq, lp, rp, blockedBelow, openAbove, densAt, idAt, rnd,
  } = ctx;

  // A. Nivellement de surface (liquide <-> vide).
  if (lLiq && R === 0 && blockedBelow(lp) && openAbove(rp)
      && (openAbove(lp) || blockedBelow(rp))) return true;
  if (rLiq && L === 0 && blockedBelow(rp) && openAbove(lp)
      && (openAbove(rp) || blockedBelow(lp))) return true;

  if (!(lLiq && rLiq)) return false;
  if (dL === dR) return false;

  // B. Relaxation des interfaces liquide-liquide par scan de hauteur (= v4).
  const denseP = dL > dR ? lp : rp;
  const lightP = dL > dR ? rp : lp;
  const D = dL > dR ? dL : dR;

  let hUp = 0;
  for (let k = 1; k <= K; k++) {
    if (densAt(denseP.x, denseP.y - k) >= D) hUp++;
    else break;
  }

  let hDown = 0;
  for (let k = 1; k <= K; k++) {
    const id = idAt(lightP.x, lightP.y + k);
    if (id > 0 && TYPE[id] === T_LIQUID && DENS[id] < D) hDown++;
    else break;
  }

  if (hUp + hDown >= 2) return true;
  return rnd < 0.5;
};
