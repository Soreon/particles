// V8 — v6 + relaxation liquide-liquide réservée aux configurations POSÉES
// (« settled »), pas aux blobs en transit.
//
// Le scan de hauteur (rule B) nivelle les interfaces posées (pyramides, murs),
// mais il cisaillait aussi latéralement les gouttes/blobs EN CHUTE dans un
// liquide plus léger (jets diagonaux en X observés à l'écran : huile versée
// dans l'alcool). Discriminant local : sous une couche posée, la colonne dense
// continue jusqu'à un support (sol, solide, plus dense) ; sous un blob en
// transit, du plus léger apparaît à faible profondeur (les bandes du liquide
// porteur qui remontent à travers le blob pendant la chute). Symétrique pour
// le côté léger (bulle qui monte). Scan borné KS=3 de chaque côté.
//
// Règle A (« source en surface OU cible soutenue ») identique à v6.

const { DENS, TYPE, T_LIQUID } = require('../materials');

const K = 2;  // portée du scan de dénivelé (exact : la décision sature à 2)
const KS = 3; // portée du scan posé/en-transit

module.exports = function v8(ctx) {
  const {
    L, R, dL, dR, lLiq, rLiq, lp, rp, blockedBelow, openAbove, densAt, idAt, rnd,
  } = ctx;

  // A. Nivellement de surface (liquide <-> vide) : source en surface OU cible soutenue.
  if (lLiq && R === 0 && blockedBelow(lp) && openAbove(rp)
      && (openAbove(lp) || blockedBelow(rp))) return true;
  if (rLiq && L === 0 && blockedBelow(rp) && openAbove(lp)
      && (openAbove(rp) || blockedBelow(lp))) return true;

  if (!(lLiq && rLiq)) return false;
  if (dL === dR) return false;

  const denseP = dL > dR ? lp : rp;
  const lightP = dL > dR ? rp : lp;
  const D = dL > dR ? dL : dR;
  const dLight = dL > dR ? dR : dL;

  // Côté dense POSÉ ? Descente : du plus léger avant un support => transit.
  for (let k = 1; k <= KS; k++) {
    const d = densAt(denseP.x, denseP.y + k);
    if (d < D) return false; // plus léger dessous => le dense est en chute
    if (d > D) break;        // support (solide, sol, plus dense) => posé
  }

  // Côté léger POSÉ ? Montée : du plus dense avant un plafond léger => transit.
  for (let k = 1; k <= KS; k++) {
    const d = densAt(lightP.x, lightP.y - k);
    if (d > dLight) return false; // plus dense dessus => le léger est en ascension
    if (d < dLight) break;        // plafond (vide ou plus léger) => posé
  }

  // B. Relaxation des interfaces posées par scan de dénivelé (= v4).
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
