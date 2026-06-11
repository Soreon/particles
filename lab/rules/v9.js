// V9 — physique de vélocité (phase V2 du plan) : la passe d'écoulement est
// STRICTEMENT v8 (nivellement, relaxation posée) ; la nouveauté vit dans le
// moteur de gravité, activée par la config `engine` ci-dessous :
//   - vy mis à jour une fois par frame (gravité stochastique G±1, vitesse
//     terminale par milieu, file d'attente/pose) ;
//   - chute verticale gatée par l'échéancier de Bresenham temporel ;
//   - jitter de traînée (glissade diagonale en vol, probabilité jitterP) ;
//   - émission randomisée par le pinceau (vy initial 0..3).

const v8 = require('./v8');

module.exports = function v9(ctx) {
  return v8(ctx);
};

module.exports.engine = {
  velocity: true,
  G: 1,        // cases/frame² (échelle labo : S = 8 sous-pas/frame)
  jitterP: 0.08,
};
