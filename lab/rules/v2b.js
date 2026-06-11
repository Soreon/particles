// V2b — scratch d'expérimentation : V2 avec la règle A' gatée à p=0.5
// pour mesurer l'effet sur le calme résiduel. (Non destinée à être retenue
// telle quelle ; sert uniquement à comparer avec v2 déterministe.)

module.exports = function v2b(ctx) {
  const {
    L, R, dL, dR, lLiq, rLiq, lp, rp, densAbove, densBelow, blockedBelow, openAbove, rnd,
  } = ctx;

  // A. Nivellement de surface (liquide <-> vide) — comportement validé, inchangé.
  if (lLiq && R === 0 && blockedBelow(lp) && openAbove(rp)) return true;
  if (rLiq && L === 0 && blockedBelow(rp) && openAbove(lp)) return true;

  if (!(lLiq && rLiq)) return false;

  // A' gatée à p=0.5.
  if (rnd < 0.5) {
    if (dL > dR) {
      if (densBelow(lp) >= dL && densAbove(rp) < dL) return true;
    } else if (dR > dL) {
      if (densBelow(rp) >= dR && densAbove(lp) < dR) return true;
    }
  }

  return false;
};
