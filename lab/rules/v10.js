// V10 — viscosité (phase V4 du plan) : v9 (vélocité) + fluidité par matériau.
//
// La fluidité (0..1, FLUID/255) gate les mouvements latéraux des liquides :
//   - règle A (nivellement liquide<->vide) : p = fluidité du liquide mouvant —
//     l'huile s'étale 4x plus lentement que l'alcool, à toute résolution (le
//     nombre de passes scale déjà avec la grille, le RATIO étalement/chute est
//     donc constant) ;
//   - règle B (relaxation liquide-liquide) : diffusion p = 0.5 × min(fluidités),
//     poussée déterministe p = max(0.3, min(fluidités)) — RALENTIE, jamais
//     supprimée (les pentes à 45° restent des points fixes à casser) ;
//   - moteur (engine.viscosity) : glissades diagonales des liquides gatées par
//     leur fluidité, vitesse terminale par fluidité du porteur, friction vx
//     double pour les visqueux.

const { DENS, TYPE, FLUID, T_LIQUID, T_GAS } = require('../materials');

const K = 2;  // portée du scan de dénivelé (exact : la décision sature à 2)
const KS = 3; // portée du scan posé / en-transit

module.exports = function v10(ctx) {
  const {
    L, R, dL, dR, lLiq, rLiq, lp, rp, blockedBelow, openAbove, densAt, idAt, rnd, rnd2,
  } = ctx;

  // A. Nivellement de surface (liquide <-> vide OU GAZ : un rideau de vapeur
  // ne fait pas barrage à l'eau — elle le déplace, il remonte), gaté par la
  // fluidité du mouvant.
  const passR = R === 0 || TYPE[R] === T_GAS;
  const passL = L === 0 || TYPE[L] === T_GAS;
  if (lLiq && passR && blockedBelow(lp) && openAbove(rp)
      && (openAbove(lp) || blockedBelow(rp))) return rnd2 < FLUID[L] / 255;
  if (rLiq && passL && blockedBelow(rp) && openAbove(lp)
      && (openAbove(rp) || blockedBelow(lp))) return rnd2 < FLUID[R] / 255;

  if (!(lLiq && rLiq)) return false;
  if (dL === dR) return false;

  const denseP = dL > dR ? lp : rp;
  const lightP = dL > dR ? rp : lp;
  const D = dL > dR ? dL : dR;
  const dLight = dL > dR ? dR : dL;
  const fmin = Math.min(FLUID[L], FLUID[R]) / 255;

  // Posé / en transit (identique à v8/v9).
  for (let k = 1; k <= KS; k++) {
    const d = densAt(denseP.x, denseP.y + k);
    if (d < D) return false;
    if (d > D) break;
  }
  for (let k = 1; k <= KS; k++) {
    const d = densAt(lightP.x, lightP.y - k);
    if (d > dLight) return false;
    if (d < dLight) break;
  }

  // B. Relaxation des interfaces posées par scan de dénivelé (identique à v8),
  //    aux cadences modulées par la fluidité.
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

  if (hUp + hDown >= 2) return rnd2 < Math.max(0.3, fmin); // poussée ralentie, jamais nulle
  return rnd < 0.5 * fmin;                                  // diffusion modulée
};

module.exports.engine = {
  velocity: true,
  viscosity: true,
  G: 1,
  jitterP: 0.08,
};
