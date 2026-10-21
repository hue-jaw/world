# v0.4 — Réglages, menus et rendu

Ce document décrit **ce qui est réellement implémenté**, avec ses limites.
Toute affirmation de rendu non mesurable en headless est signalée comme telle.

## 1. Architecture ajoutée

| Module | Rôle | Ne dépend pas du DOM |
|---|---|---|
| `web/src/settings.js` | état persistant + application moteur | oui (testable Node) |
| `web/src/menu.js` | menu pause 4 onglets | non (construit le DOM) |
| `web/src/icons.js` | pont Reicon → SVG inline | oui |

`settings.js` **applique** des réglages concrets : taille de shadow map, type de
filtrage, rayon/biais, portée de la caméra d'ombre, intensité du soleil et de
l'hémisphérique, exposition du renderer, `envMapIntensity` des matériaux.

`menu.js` ne contient **aucune logique de jeu** : il lit `settings`, écrit via
`set()` et émet des intentions. Le moteur applique. Cela évite le module
fourre-tout et permet de tester les réglages sans navigateur.

## 2. Réglages exposés

### Graphismes
- **Ombres** : Désactivées / Basse (512, Basic) / Moyenne (1024, PCF) /
  Haute (1536, PCF doux) / Ultra (2048, PCF doux).
- **Lumière** : Basse / Moyenne / Haute / Ultra → hémisphérique 0,55 → 0,92,
  soleil 2,0 → 2,6, exposition 1,00 → 1,09, reflets 0,55 → 1,25.
- **Mode RTX** : voir §5.
- **Météo** : Automatique ou forcée (Dégagé, Nuageux, Pluie, Orage, Brouillard).
- **Bonus** : densité de trafic (60 / 100 / 150 %), piétons (0 / 100 / 160 %),
  flèches GPS.

### Contrôles
Vue caméra (3e / habitacle), caméra automatique, sensibilité souris,
inversion de l'axe vertical, plus la liste complète des touches.

### Manette
État de connexion réel (hot-plug), zone morte (12 / 18 / 26 %), sensibilité,
vibrations, et le mapping v0.4 : **L3 = sprint**, **R3 = recentrage**,
**BACK = vue**, **START / D-Pad ↑ = menu**.

### Spécial (debug)
Panneau F1, compteur FPS, téléportation garage, sportive d'essai, effacement de
la recherche, +3 h, argent de test, effacement de sauvegarde, remise à zéro des
réglages, et un **diagnostic live** (véhicules, IA, police, piétons, chunks).

## 3. Persistance

Clé `metropolis_settings`, version `1`. Seules les clés connues sont relues :
une valeur corrompue ne casse pas le chargement (testé). Les réglages sont
écrits à chaque changement.

## 4. Pause réelle

`ctx.paused` gèle **simulation** (`env`, `city`, `traffic`, `peds`, `player`,
`missions`, `gps`, HUD) tout en continuant le rendu. Le menu reste interactif :
il lit la manette lui-même (`poll()`), sinon START ne pourrait jamais refermer
le menu puisque le joueur n'est plus mis à jour.

## 5. Limite honnête : le « mode RTX »

WebGL 2 n'expose pas le ray tracing matériel. Le mode RTX est une
**approximation assumée** :
- `envMapIntensity` × 1,75 sur tous les matériaux (reflets du ciel PMREM) ;
- rugosité abaissée de 10 % (reflets plus nets) ;
- ombres adoucies, exposition relevée.

Ce n'est **pas** du path tracing, ni du RTX NVIDIA. Le menu l'écrit noir sur
blanc à l'utilisateur. La vraie cible reste UE5 + Lumen/Nanite/Path Tracer
(cf. `docs/00`).

## 6. Coût

- Aucune allocation par frame : les réglages sont appliqués sur événement.
- `settings.apply()` parcourt la scène (une fois par changement) pour mettre à
  jour `envMapIntensity` et invalider les shaders d'ombre.
- `setVehicleMaterialBoost()` couvre les véhicules créés **après** le réglage :
  sans lui, deux voitures côte à côte pouvaient différer.

## 7. Tests

`node tools/test_v04.mjs` → **24 vérifications**, dont :
taille réelle de shadow map par preset, intensité de lumière et exposition,
effet mesuré du RTX sur `envMapIntensity`, météo forcée, persistance,
robustesse d'une valeur corrompue, pause réelle, rendu des 4 onglets,
désactivation effective des missions en mode Libre, et rendu des 26 icônes
Reicon sans URL externe.

> Non testable ici : le rendu WebGL lui-même (pas de GPU headless). L'aspect
> final des vitres, de la fumée et des chevrons doit être validé à l'écran.
