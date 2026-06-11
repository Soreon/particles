// V5 — v4 + correctif "cavités" : la règle A exige que la SOURCE soit aussi en
// surface (openAbove(source)).
//
// Sans cela, l'eau submergée s'engouffre latéralement dans toute cavité de vide
// (un tube de void peint au pinceau a "du vide au-dessus" en chaque cellule
// intérieure → openAbove(cible) est vrai partout) : la cavité se découpe en
// bandes horizontales qui s'élargissent — les "traits" observés à l'écran.
// Avec la garde sur la source, seule l'eau DE SURFACE s'étale latéralement
// (nivellement, validé) ; les cavités submergées se résorbent uniquement par
// gravité : le vide remonte verticalement, comme une bulle.
//
// La partie liquide-liquide (scan de hauteur) est strictement identique à v4.

const { DENS, TYPE, T_LIQUID } = require('../materials');

const K = 2; // portée du scan vertical (exact : la décision sature à 2)

module.exports = function v5(ctx) {
  const {
    L, R, dL, dR, lLiq, rLiq, lp, rp, blockedBelow, openAbove, densAt, idAt, rnd,
  } = ctx;

  // A. Nivellement de surface (liquide <-> vide) : source ET cible en surface.
  if (lLiq && R === 0 && blockedBelow(lp) && openAbove(rp) && openAbove(lp)) return true;
  if (rLiq && L === 0 && blockedBelow(rp) && openAbove(lp) && openAbove(rp)) return true;

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
