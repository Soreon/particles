// V1 — candidat : A (vide) + B/C (cliquets productifs) + glissements d'interface.
//
// Idée : à 45°, les colonnes adjacentes ne diffèrent que d'une case → aucune règle
// par dénivelé >= 2 ne se déclenche (point fixe → pyramides). On ajoute donc un
// GLISSEMENT le long de l'interface (marche aléatoire symétrique, p=0.5) qui
// diffuse le profil de hauteur ; combiné au cliquet C/B + diagonale de gravité
// (irréversibles), la diffusion a un biais net vers l'aplatissement.

module.exports = function v1(ctx) {
  const {
    L, R, dL, dR, lLiq, rLiq, lp, rp, densAbove, densBelow, blockedBelow, openAbove, rnd,
  } = ctx;

  // A. Nivellement de surface (liquide <-> vide) — comportement validé, inchangé.
  if (lLiq && R === 0 && blockedBelow(lp) && openAbove(rp)) return true;
  if (rLiq && L === 0 && blockedBelow(rp) && openAbove(lp)) return true;

  if (!(lLiq && rLiq)) return false;

  // B. Flottabilité (cliquet) : léger coincé -> colonne où du plus dense le
  //    surplombe (il y remontera verticalement ensuite).
  if (dR > dL && densAbove(lp) <= dL && densAbove(rp) > dL) return true;
  if (dL > dR && densAbove(rp) <= dR && densAbove(lp) > dR) return true;

  // C. Tassement (cliquet) : dense coincé -> colonne où du plus léger est dessous
  //    (il y descendra ensuite).
  if (dR < dL && densBelow(lp) >= dL && densBelow(rp) < dL) return true;
  if (dL < dR && densBelow(rp) >= dR && densBelow(lp) < dR) return true;

  // Glissements d'interface (diffusion, p=0.5 pour rester symétrique) :
  if (rnd < 0.5) {
    // 1b. Dense glissant le long de son interface SUPÉRIEURE (érode les tas de
    //     dense sous un léger, ex. huile sous l'eau) : du plus léger au-dessus
    //     des deux cases, du non-plus-léger en dessous des deux.
    if (dR < dL && densAbove(lp) < dL && densAbove(rp) < dL
        && densBelow(lp) >= dL && densBelow(rp) >= dL) return true;
    if (dL < dR && densAbove(rp) < dR && densAbove(lp) < dR
        && densBelow(rp) >= dR && densBelow(lp) >= dR) return true;

    // 2b. Léger glissant le long de son interface INFÉRIEURE (érode les cônes
    //     inversés de léger dans un dense, ex. alcool dans l'eau) : du plus dense
    //     en dessous des deux cases, du non-plus-dense au-dessus des deux.
    if (dL < dR && densBelow(lp) > dL && densBelow(rp) > dL
        && densAbove(lp) <= dL && densAbove(rp) <= dL) return true;
    if (dR < dL && densBelow(rp) > dR && densBelow(lp) > dR
        && densAbove(rp) <= dR && densAbove(lp) <= dR) return true;
  }

  return false;
};
