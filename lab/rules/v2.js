// V2 — "léger-comme-vide" : généralisation de la règle A.
//
// Idée : un liquide traite tout fluide STRICTEMENT plus léger (vide OU liquide,
// jamais solide) comme traversable. La règle A (liquide <-> vide) est conservée
// textuellement ; puis pour les paires liquide <-> liquide de densités
// différentes, le mouvant M est le plus dense, la cible T la plus légère :
// échange si densBelow(Mp) >= dM (M ne peut pas couler sur place) ET
// densAbove(Tp) < dM (la cible est à une interface relative à M).
// Les deux directions (L plus dense / R plus dense) sont couvertes.
//
// Évaluation (seeds 1/2/3) : PASSE les 7 scénarios. Vs v1 :
//  - aplatissement 2x plus rapide (timeToFlat 10 vs 20 sur oil/alcool-in-water) ;
//  - mais agitation résiduelle 3-5x plus élevée (calm ~58 vs ~12 oil-in-water,
//    ~34 vs ~11 alcool-in-water, ~75-103 vs ~49-67 tri-liquid) : les cellules
//    excédentaires de la rangée d'interface (reste de division par 64) sont
//    rebrassées en permanence par la règle déterministe.
//  - Écart testé mais NON retenu (voir rules/v2b.js) : gater A' à p=0.5 ramène
//    le calme au niveau de v1 (~12) mais ralentit l'aplatissement sous v1
//    (timeToFlat 30) ; la version déterministe ci-dessous est celle prescrite.

module.exports = function v2(ctx) {
  const {
    L, R, dL, dR, lLiq, rLiq, lp, rp, densAbove, densBelow, blockedBelow, openAbove,
  } = ctx;

  // A. Nivellement de surface (liquide <-> vide) — comportement validé, inchangé.
  if (lLiq && R === 0 && blockedBelow(lp) && openAbove(rp)) return true;
  if (rLiq && L === 0 && blockedBelow(rp) && openAbove(lp)) return true;

  if (!(lLiq && rLiq)) return false;

  // A'. Règle A généralisée aux paires liquide <-> liquide de densités
  //     différentes : le plus dense M "coule latéralement" à travers le plus
  //     léger T, comme s'il s'agissait de vide relatif.
  if (dL > dR) {
    // M = L, T = R.
    if (densBelow(lp) >= dL && densAbove(rp) < dL) return true;
  } else if (dR > dL) {
    // M = R, T = L.
    if (densBelow(rp) >= dR && densAbove(lp) < dR) return true;
  }

  return false;
};
