# Plan : vélocité par particule + viscosité

> Objectif : que les fluides se comportent comme des fluides — fin des colonnes
> sous le pinceau, inertie, éclaboussures, viscosité par matériau — sans casser
> la physique posée déjà validée, et en restant ultra-optimisé (GPU, automate
> Margolus conservatif).
>
> Plan critiqué et corrigé par revue adversariale (3 lentilles : physique des
> falling-sand games, GPU/WebGL2, intégration projet) avant toute implémentation.

## 1. Pourquoi les colonnes existent

Aujourd'hui chaque cellule = 1 octet (id matériau). Tout tombe d'exactement
1 case par sous-pas, en synchronisme parfait, sans inertie : un jet de pinceau
est un corps rigide vertical, et à l'atterrissage rien ne disperse la matière
latéralement plus vite que l'érosion de surface → la pile monte en colonne.

**Trois mécanismes sont nécessaires (aucun ne suffit seul) :**
1. **Désynchronisation à la source** : vitesses/phases randomisées à l'émission
   (pinceau) — le levier le plus puissant et le moins cher (standard
   Noita/Powder Toy).
2. **Diversité en vol** : gravité accélérée (vy += G) qui étire les jets versés
   en continu, + **jitter latéral de traînée** (faible probabilité de glissade
   diagonale pendant le transit) — le seul mécanisme qui casse une colonne de
   largeur 1, la diversité verticale ne le pouvant structurellement pas
   (interdiction de doublement dans un automate à échanges).
3. **Dispersion à l'impact** : conversion de la vitesse verticale en latérale
   au moment de la pose (éclaboussure pour les liquides, dispersion ±1-2 pour
   le sable).

## 2. Décisions d'architecture (figées après critique)

### État : RGBA8UI mono-texture (4 octets/cellule)
- `.r` id matériau (inchangé — le rendu et le comptage continuent de lire `.r`)
- `.g` **vy signé en signe-magnitude** : bit 7 = signe (1 = vers le haut),
  bits 0-6 = magnitude en cases/frame. **La valeur brute 0 = vitesse nulle** :
  compatible avec l'init à zéro des textures WebGL2 et les patchs de pinceau
  (un biais +128 aurait encodé « vitesse max vers la gauche » sur chaque
  cellule vide — rejeté). Signé dès V1 même si la physique ascendante attend :
  l'encodage ne se migre pas, lui.
- `.b` vx signé, même encodage signe-magnitude, mêmes unités que vy
  (cases/frame, avec son propre Bresenham sur l'index de passe d'écoulement —
  sinon la portée d'une éclaboussure dépendrait de la résolution).
- `.a` réservé : 2 bits de jitter de phase éventuels. PAS de flag « posé »
  stocké (voir ci-dessous).
- RGBA8UI est color-renderable garanti par la spec ES 3.0 (RGB8UI ne l'est
  PAS — ne jamais « économiser » le 4e canal).
- **Repli perf identifié** si la bande passante ×4 coule les iGPU à 800² :
  split MRT en deux textures (R8UI id + RG8UI vélocité) — les scans de
  FLOW_FS (les plus gros consommateurs de fetches) ne lisent que l'id et
  garderaient leur densité de cache ×4. RG8UI/RG16UI mono-texture : rejetés.

### Source de vérité posé/transit : le scan stateless KS=3 existant, seul
Le discriminant posé/transit de v8 (scan de densité borné) est recalculé à
chaque passe, déjà validé, et ne peut pas se périmer. Un flag stocké serait une
deuxième source de vérité divergente aux interfaces (oscillation de régime
garantie). Décision : **le scan KS reste l'unique critère**, `.a` ne stocke
jamais d'état de régime.

### Cycle de vie de la vélocité (le point le plus important du plan)
- **Transit** (le scan dit « en chute/ascension ») : vy += G une fois par
  frame (gaté sur sous-pas s == 0 ; G stochastique ±1 par hash pour faire
  diverger les vy égaux), chute gatée par Bresenham temporel, jitter latéral
  de traînée actif.
- **Pose** (transition transit → posé uniquement) : dispersion d'impact
  (liquide : vy → ±vx éclaboussure ; sable : ±1-2 + dissipation), puis
  **vy := 0**. Jamais de re-déclenchement tant que la cellule reste posée
  (sinon : tas en ébullition permanente). Jamais d'accumulation silencieuse
  de vy en régime posé (sinon : « vitesses fossiles » relâchées des secondes
  plus tard quand le tas est sapé).
- **Posé** : exactement la physique actuelle (règle A, relaxation par scan de
  hauteur, échanges de densité) — intouchée. vx résiduel : friction jusqu'à 0.

### Impacts et collisions intra-jet
- Impact (conversion vy → vx) **uniquement si la cible est posée, solide ou
  sol**. Le critère naïf « cible occupée non mobile » est indécidable
  localement et ferait éclabousser les jets en plein vol (le prédécesseur
  gaté par Bresenham paraît « immobile »).
- **Rattrapage transit-sur-transit** (rapide derrière lent, même colonne) :
  transfert de quantité de mouvement — vy_suiveur := vy_cible (file
  d'attente), jamais d'éclaboussure ni de perte sèche. Sans cette règle, le
  Bresenham fait soit splasher le jet en l'air, soit traverser les particules.

### Sémantique dans un liquide porteur
- Les **échanges de densité ne sont PAS gatés** par le Bresenham : la
  stratification (couches inversées peintes) garde sa cadence actuelle —
  sinon des couches posées à vy=0 ne se stratifieraient plus jamais.
- À l'entrée dans un liquide, vy est **clampé à une vitesse terminale par
  matériau porteur** (lue dans uProps — anticipe la colonne viscosité de V4).
- Remontées (bulles, léger dans dense) : vitesse constante comme aujourd'hui
  (la flottabilité accélérée est hors périmètre).

### Bresenham temporel — détails d'implémentation
- Une particule de vitesse vy tente sa chute au sous-pas s ssi
  `((s+1)*vy)/S != (s*vy)/S` en **arithmétique entière non signée** (exact,
  identique bit à bit entre les 4 invocations d'un bloc et la réplique CPU).
- `s` = index du sous-pas **relatif à la frame** (0..S-1), nouvel uniforme —
  distinct du compteur global utilisé pour le cycle des OFFSETS Margolus.
- Invariant : toute entrée du gate (vy, jitter) vient de la texture ou des
  uniformes, jamais d'une quantité propre à l'invocation.
- Limite assumée et documentée : à vy égaux le Bresenham seul ne désynchronise
  pas — c'est le rôle de l'émission randomisée et du jitter de traînée.

### Viscosité (V4)
- Nouvel octet « fluidité » par matériau dans uProps.
- Gate probabiliste des swaps de nivellement **normalisé par le nombre de
  passes** (p_eff = taux_cible / N_passes) — sinon la même valeur donne une
  viscosité différente selon ?grid=.
- Gate aussi les **glissades diagonales** des liquides (sinon le miel
  avalanche à pleine vitesse tout en nivelant lentement — incohérent).
- La poussée déterministe de la règle B (dénivelé ≥ 2) est **ralentie, jamais
  supprimée** (elle existe parce que 45° est un point fixe).
- Friction de vx proportionnelle à la viscosité.

## 3. Côté labo (à faire AVANT chaque étape shader)

- **Structure-of-arrays** : `sim.grid` (Uint8Array d'ids) reste intact ;
  `sim.vy`, `sim.vx`, `sim.flags` en plans séparés. Tout l'outillage existant
  (metrics, scénarios, stress, probes) continue de marcher sans réécriture.
- **Contrat de règle étendu** : les règles vélocité retournent un descripteur
  d'action (swap + mutations de canaux) ; un adaptateur garde v0-v8
  exécutables comme baselines comparables.
- La physique vélocité = **v9.x** (v9.1 état riche, v9.2 vy, v9.3 vx/impacts,
  v9.4 viscosité) — v8 reste la baseline de non-régression exécutable.
- Nouveaux scénarios chiffrés : bloc 20×20 pré-peint relâché (dispersion),
  jet continu (fragmentation, hauteur de pile), éclaboussure (portée
  latérale), couches inversées (temps de stratification), courbes
  temps-de-nivellement par viscosité.

## 4. Phases et critères d'acceptation

### V1 — État riche, physique identique (le socle)
GPU : RGBA8UI, `out uvec4`, swaps transportant 4 canaux, paint() en
RGBA_INTEGER (patch [id,0,0,0]), readback compteurs : ajouter le chemin
compact RGBA_INTEGER+UNSIGNED_BYTE (4 o/texel — sans lui, tout tomberait dans
le repli 16 o/texel = 10 Mo/readback à 800², hitch assuré), **mode debug du
rendu** (uniforme : id/palette, vy en rampe thermique, vx bleu/rouge, flags) —
sans lui, tout bug de transport de canal serait invisible à l'écran.
Labo : plans SoA + adaptateur de contrat.
**Critères de sortie** :
- plan d'ids **bit-exact** vs v8, frame par frame, même seed, sur les
  7 scénarios + les ~30 cas de stress (assert de buffers, pas de métriques —
  c'est la seule phase où le bit-exact est possible, après on ne l'a plus) ;
- **FPS 320/640/800 mesurés vs baseline d'aujourd'hui** (à archiver AVANT de
  commencer) : ≥ 90 % requis, sinon activer le repli split MRT avant V2 —
  le ×4 de bande passante tombe ICI, pas en V5.

### V2 — Vitesse verticale
vy += G stochastique (transit seulement), Bresenham entier, clamp vitesse
terminale par porteur, file d'attente intra-jet, émission randomisée dans
paint(), jitter latéral de traînée, vy := 0 à la pose (sans dispersion encore).
**Critères** : jet continu fragmenté (occupation de la colonne à mi-chute
< 70 %) ; bloc 20×20 relâché : dispersion mesurable ; vitesse terminale
atteinte et stable ; bulles **non gatées** (drift < 2, durée ≈ actuelle) ;
couches inversées : temps de stratification ≈ actuel ; les 7 scénarios + le
budget de frames revérifiés ; FPS re-mesurés.

### V3 — Impacts et vitesse horizontale (la phase la plus risquée)
Dispersion à la transition transit→posé, vx avec Bresenham sur les passes
d'écoulement, friction.
**Critères** : cône de sable sous versement continu (hauteur ≤ 60 % de la
colonne actuelle, pente ≈ 45°) ; éclaboussure d'eau : portée latérale ≥ 3
cases pour une goutte de hauteur 30 ; **garde-fous obligatoires** :
droplet-drift (croissance ≤ 6 — l'éclaboussure est exactement le mécanisme
qui peut recréer les jets en X éradiqués par v8), void-tube (trait max ≤ 3),
pour (aplatissement ≤ 10 frames) ; FPS re-mesurés.

### V4 — Viscosité
Octet fluidité, gates normalisés (nivellement + diagonales), friction vx.
**Critères** : temps-de-nivellement strictement ordonnés alcool < eau < huile
(ratio ≥ 1,5 entre voisins), identiques à ±20 % entre ?grid=320 et 640
(normalisation) ; toutes les régressions ; FPS.

### V5 — Verrouillage
Suite de stress complète (45 oscillations + 29 cas limites + grande grille +
multi-graines), vérification visuelle utilisateur complète, tag git.

## 5. Rollback
- Labo : v8 intouché et exécutable à tout moment (`node lab/run.js v8`).
- GPU : pendant V1-V2, les deux jeux de shaders (R8UI actuel / RGBA8UI)
  sélectionnables par constante de build — A/B visuel instantané.
- Git : un tag par checkpoint de phase validé (`velocite-v1` … `velocite-v5`).

## 6. Risques restants assumés
- Quantité de mouvement conservée approximativement (transferts locaux, pas
  de bilan global) — assumé, c'est un jeu, pas un solveur.
- L'angle de repos du sable peut s'élargir avec la dispersion d'impact —
  budget de forme à recalibrer dans sand-pile (variance ≥ 8 à re-discuter).
- À 2048², S ≈ 100 sous-pas : coût cubique — hors périmètre de ce plan
  (le plafond pratique restera ~800-1024 sans fusion de passes).
