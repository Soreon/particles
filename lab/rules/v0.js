// V0 — miroir exact du FLOW_FS actuel de gpu.worker.js (règles A..E).
// Sert de référence : doit reproduire les bugs observés (pyramides liquide-liquide).

module.exports = function v0(ctx) {
  const {
    L, R, dL, dR, lLiq, rLiq, lp, rp, densAbove, densBelow, blockedBelow, openAbove,
  } = ctx;

  // A. Nivellement de surface (liquide <-> vide).
  if (lLiq && R === 0 && blockedBelow(lp) && openAbove(rp)) return true;
  if (rLiq && L === 0 && blockedBelow(rp) && openAbove(lp)) return true;

  if (!(lLiq && rLiq)) return false;

  // B. Flottabilité : léger coincé se décale vers où du plus dense le surplombe.
  if (dR > dL && densAbove(lp) <= dL && densAbove(rp) > dL) return true;
  if (dL > dR && densAbove(rp) <= dR && densAbove(lp) > dR) return true;

  // C. Tassement : dense coincé se décale vers où du plus léger est dessous.
  if (dR < dL && densBelow(lp) >= dL && densBelow(rp) < dL) return true;
  if (dL < dR && densBelow(rp) >= dR && densBelow(lp) < dR) return true;

  // D. Étalement du léger sur le dense.
  if (dR > dL && densBelow(lp) <= dL && densBelow(rp) >= dR) return true;
  if (dL > dR && densBelow(rp) <= dR && densBelow(lp) >= dL) return true;

  // E. Étalement du dense sous le léger.
  if (dR < dL && densAbove(lp) >= dL && densAbove(rp) <= dR) return true;
  if (dL < dR && densAbove(rp) >= dR && densAbove(lp) <= dL) return true;

  return false;
};
