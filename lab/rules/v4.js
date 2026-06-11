// V4 — diffusion par scan de hauteur.
//
// Pour une paire liquide<->liquide de densités différentes, on estime le
// DÉNIVELÉ local de l'interface par un scan vertical borné (K cellules) :
//   - côté dense : hUp   = nb de cellules contiguës de densité >= D en remontant
//                  depuis la case juste au-dessus de la paire (D = densité du
//                  plus dense des deux) ;
//   - côté léger : hDown = nb de cellules LIQUIDES contiguës de densité < D en
//                  descendant depuis la case juste en dessous de la paire
//                  (liquides seulement : on s'arrête sur solide ET sur vide —
//                  le vide est déjà géré par la règle A + gravité).
// La paire mixte elle-même implique un dénivelé d'au moins 1 ; le dénivelé
// local vaut donc ~ hUp + hDown + 1. Décision :
//   - s = hUp + hDown >= 2 : échange DÉTERMINISTE (poussée de pression nette) ;
//   - s <= 1               : échange p=0.5 (diffusion symétrique de l'interface).
//
// AJUSTEMENTS vs la spec initiale (mesurés sur seeds 1-3) :
//   1. La spec littérale (s>=2 det, s==1 p=0.5, s==0 rien) laissait les marches
//      de 45° figées : oil-in-water finissait à variance 1.26-1.45 (seuil 1.5,
//      seed 2 à 1.45 = quasi-échec), maxDev jusqu'à 3, timeToFlat=-1. Étendre la
//      diffusion p=0.5 au cas s==0 ramène la variance à 0.045 (= v1) et
//      timeToFlat à 10 (v1 : 20). Contrepartie : on perd le "calme parfait"
//      (activité 0) de la version littérale ; l'activité résiduelle redevient
//      celle de v1 (~11-13 sur oil/alcool, ~50-73 sur tri-liquid).
//   2. K : avec des seuils plafonnés à 2, scanner au-delà de 2 cellules ne peut
//      jamais changer la décision — K=2 est EXACT (vérifié : métriques
//      identiques à K=8 sur les 3 seeds), et limite le coût GPU à 4 fetches
//      max par paire mixte (comparable à v1).

const { DENS, TYPE, T_LIQUID } = require('../materials');

const K = 2; // suffisant ET exact : la décision sature à s=2 (cf. note 2)

module.exports = function v4(ctx) {
  const {
    L, R, dL, dR, lLiq, rLiq, lp, rp, blockedBelow, openAbove, densAt, idAt, rnd,
  } = ctx;

  // A. Nivellement de surface (liquide <-> vide) — comportement validé, inchangé.
  if (lLiq && R === 0 && blockedBelow(lp) && openAbove(rp)) return true;
  if (rLiq && L === 0 && blockedBelow(rp) && openAbove(lp)) return true;

  if (!(lLiq && rLiq)) return false;
  if (dL === dR) return false;

  const denseP = dL > dR ? lp : rp;
  const lightP = dL > dR ? rp : lp;
  const D = dL > dR ? dL : dR;

  // hUp : hauteur de colonne dense au-dessus de la ligne de la paire.
  let hUp = 0;
  for (let k = 1; k <= K; k++) {
    if (densAt(denseP.x, denseP.y - k) >= D) hUp++;
    else break;
  }

  // hDown : profondeur de colonne légère (liquides < D) sous la ligne de la paire.
  let hDown = 0;
  for (let k = 1; k <= K; k++) {
    const id = idAt(lightP.x, lightP.y + k);
    if (id > 0 && TYPE[id] === T_LIQUID && DENS[id] < D) hDown++;
    else break;
  }

  if (hUp + hDown >= 2) return true; // dénivelé >= 3 : poussée déterministe
  return rnd < 0.5;                  // dénivelé 1-2 : diffusion symétrique
};
