# Modèles 3D — licences et attribution

Tous les modèles livrés avec METROPOLIS sont sous **CC0 1.0 Universal** (domaine public) :
utilisation commerciale, modification et redistribution autorisées, sans obligation
d'attribution. Les crédits ci-dessous sont fournis par courtoisie et pour la traçabilité.

## Véhicules — Kenney « Car Kit » (CC0 1.0)

- Auteur : **Kenney** — https://kenney.nl/assets/car-kit
- Fichiers : `models/car_sedan.glb`, `car_hatchback-sports.glb`, `car_suv.glb`,
  `car_sedan-sports.glb`, `car_taxi.glb`, `car_van.glb`, `car_police.glb`
- Source de téléchargement : miroir GitHub `Arslan12216775/kenney_car-kit`,
  `Models/GLB format/` (licence d'origine conservée : `License.txt` — « License: (Creative Commons Zero, CC0) »).
- Traitement : `gltf-transform optimize` (quantification KHR_mesh_quantization,
  textures WebP 256 px, palette de matériaux fusionnée). Géométrie et textures d'origine inchangées sur le fond.

## Personnages — Quaternius « Ultimate Modular Men » (CC0 1.0)

- Auteur : **Quaternius** — https://quaternius.com/packs/ultimatemodularcharacters.html
- Fichiers : `models/char_Casual.glb`, `char_Casual2.glb`, `char_Suit.glb`, `char_Worker.glb`, `char_Punk.glb`
- Source de téléchargement : miroir GitHub `trebeljahr/quaternius-showcase`,
  `public/glb/modular_men/` (voir son `LICENSES.md` : `modular_men_pack` → `CC0-1.0`).
- Traitement : `gltf-transform optimize` (quantification, palette de matériaux).
- Animations : **aucune animation n'est fournie dans ces fichiers** ; les cycles de marche/idle
  sont générés procéduralement au runtime par `web/src/assets.js` (rotation des os du squelette).

## Règles de contribution

Tout nouvel asset doit être **CC0 ou CC-BY** (avec attribution dans ce fichier), placé dans
`web/assets/models/`, puis `npm run build` met à jour l'embarquement base64. Les formats
attendaient : glTF binaire `.glb`, Y-up, une unité = un mètre, avant du véhicule vers **+Z**.
