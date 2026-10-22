# 🌆 METROPOLIS — Open-world vivant

Un jeu open-world 3D en construction : une métropole fictive où le trafic, les piétons, la météo et l'heure forment un écosystème — pas un décor. Production par phases strictes : **vertical slice jouable d'abord**, extension ensuite.

## 🎮 Jouer tout de suite à la vertical slice

### Option 1 — double-clic, zéro installation *(le plus simple)*
Téléchargez **`METROPOLIS.html`** et **double-cliquez dessus**. Le jeu complet s'ouvre dans votre navigateur, hors-ligne, sans serveur. `F11` = plein écran. La sauvegarde est automatique.

> Ce fichier regroupe le jeu, les styles et Three.js en un seul document (4,3 Mo — modèles 3D et textures embarqués). Pour le régénérer : `npm run build` à la racine.

### Option 2 — exécutable Windows `.exe`
**[⬇ Télécharger METROPOLIS.exe](https://github.com/hue-jaw/world/releases/latest)** — portable, sans installation, sans droits administrateur, 100 % hors-ligne. Construit automatiquement par GitHub Actions à chaque mise à jour.
Pour le compiler soi-même : `cd desktop && npm install && npm run dist:win`. Détails : [`desktop/README.md`](desktop/README.md).

### Option 3 — mode développement (serveur local, itération rapide)
```bash
cd web
npm install            # une seule fois (three + esbuild)
npm start              # http://localhost:8000
```

**Contenu jouable :** métropole **streamée de 8,2 km** (autoroute en anneau, avenues, circuit privé) · personnage 3e personne **modélisé et animé** · **8 véhicules** modélisés dont une **moto** · trafic IA qui respecte feux et voies · 44 PNJ **modélisés** avec routines quotidiennes · **cycle jour 20 min / nuit 20 min** · météo dynamique avec **reflets sur chaussée mouillée** · police, poursuites, arrestations · missions de livraison chronométrées · **GPS : flèches au sol + tracé sur la mini-carte** · **caméra automatique** · **manettes Xbox One / PS4 / PS5 / Switch Pro** · **économie** : logements (accès au toit), achat de véhicules, agrandissement du garage, améliorations moteur/pneus/freins · **santé** et blessures (chutes, accidents) · sauvegarde automatique · audio 100 % procédural.

| Touche | Action |
|---|---|
| `Z Q S D` / flèches | Se déplacer · conduire |
| Souris (glisser) · molette | Caméra · zoom |
| `F` | Entrer / sortir d'un véhicule |
| `Maj` · `Espace` | Sprint · saut / frein à main |
| `H` · `L` · `M` | Klaxon · phares · son |
| `T` · `G` · `F1` | +3 h · météo suivante · panneau debug |
| `C` | Caméra automatique (suit la direction) / libre |
| `B` · `J` | Boutique, garage, logements · emploi / petites annonces |
| `Échap` | Fermer un panneau · passer une cinématique |
| `E` | Monter au toit d'un immeuble acheté (et redescendre) |
| `V` · `R` | Vue habitacle ↔ 3e personne · recentrer la caméra |
| `Échap` | Menu : Graphismes · Contrôles · Manette · Spécial |
| 🎮 Manette | `L3` sprint · `R3` recentrer · `BACK` vue · `START` / `D-Pad ↑` menu · `X` entrer/sortir · `A` frein à main |

## 🧪 Tests & build

```bash
npm test        # 392 vérifications : smoke, fonctionnalités, intégration, v0.4→v0.9,
                # assets 3D, rendu, bundle livrable, projet Unreal (51)
npm run build   # régénère METROPOLIS.html (fichier unique, double-cliquable)
```

| Suite | Contrôles | Couvre |
|---|---|---|
| `smoke_test` | 19 | simulation 30 s, mission, conduite, police, météo, sauvegarde |
| `test_features` | 42 | systèmes de gameplay |
| `test_integration` | 15 | UI + économie + GPS + boucle |
| `test_v04` / `test_v05` | 25 / 20 | poursuite, drift, ville variable, ponts |
| `test_v06` | 20 | façades, arbres, saut, L3, moto |
| `test_v07` | 19 | GPS temps réel : recalcul, flèches, manœuvres |
| `test_v08` | 32 | franchissement, histoire, emploi, cinématique, carrosserie |
| `test_v09` | 25 | **post-traitement, ciel, mobilier, habitacles, foule** |
| `check_assets` | 112 | 13 modèles 3D embarqués |
| `test_render` / `test_bundle` | 7 / 5 | rendu sans GPU, fichier livré + stabilisation |

## 🌇 v0.9 — Le rendu passe un cap

- **Post-traitement** : GTAO (occlusion ambiante), bloom des sources lumineuses,
  sortie ACES. Palier réglable (*Réglages → Graphismes*), repli automatique si
  le GPU refuse.
- **Ciel atmosphérique** : dôme shader (dégradé + brume), halo solaire, nuages
  en sprites. Fini le fond bleu uni et les boîtes grises.
- **Rue vivante** : ~1 100 objets instanciés (poubelles, bornes, bacs à fleurs,
  abribus), châteaux d'eau et antennes sur les toits.
- **Habitacles** : planche de bord, volant, sièges, rétroviseur — visibles à
  travers les vitres et en vue 1ʳᵉ personne.
- **Ombres de contact** sous les véhicules, les 44 PNJ et le joueur.
- **Foule variée** : chaque passant a sa teinte et sa taille.
- Détail : [`docs/12_GRAPHISMES_v0.9.md`](docs/12_GRAPHISMES_v0.9.md).

## 📖 v0.8 — On arrive sans rien

- **Plus de livreur au démarrage.** En mode Histoire, le joueur démarre **sans
  emploi, sans toit, avec 35 $** : aucune course ne se déclenche toute seule.
- **Progression réelle** : petites annonces (45–75 $) → 3 annonces + 150 $ de
  caution → embauche (**140 $/jour**, courses ×1,6, van de société) → achat d'un
  logement. Panneau **Emploi (J)**.
- **Cinématique d'ouverture** : 5 plans, 34 s, caméra scénarisée + lettrage,
  passable d'un clic.
- **Terre-pleins et îlots franchissables** : marche maximale 0,36 m ; troncs,
  murs et immeubles restent infranchissables ; les voitures n'y montent pas.
- **Carrosserie** : ombre de contact, vitrage physique translucide, rétroviseurs,
  plaques, bas de caisse, échappements, becquet, barres de toit.
- **Rendu** : résolution plafonnée à ×2, ombres 2048 px PCFSoft (portée 120 m).
- Détail et décisions : [`docs/11_HISTOIRE_EMPLOI_v0.8.md`](docs/11_HISTOIRE_EMPLOI_v0.8.md).

## 🧭 v0.7 — GPS temps réel

- **Les flèches suivent le joueur** : toute la géométrie (chevrons, ruban bleu,
  mini-carte) repart de la position réelle, pas du point où la destination a
  été posée.
- **Recalcul automatique** : sortie de route détectée à plus de 20 m, ou
  rafraîchissement toutes les 2,5 s de conduite. A* mesuré à **0,62 ms** pour
  2,3 km — donc sans saccade, sans worker.
- **Prochaine manœuvre** dans un bandeau : `⬅ Tournez à gauche · Rue des
  Tanneurs — 180 m · 4 min · 1,9 km restants`.
- **Arrivée** détectée à moins de 14 m : flèches et ruban s'éteignent.
- Détail et mesures : [`docs/10_GPS_TEMPS_REEL_v0.7.md`](docs/10_GPS_TEMPS_REEL_v0.7.md).

## 🚨 v0.4 — poursuite, drift, GPS, caméra et menu

- **Police qui poursuit vraiment** : les unités n'apparaissent plus « par magie »
  devant le joueur. Le spawn cherche un nœud routier **derrière la caméra,
  entre 100 et 240 m**, et la conduite utilise un **point d'interception**
  (position future du joueur) pour couper la route — pas un simple suivi.
  Un mur n'est plus un délit : heurter un bâtiment, un lampadaire ou une
  bordure n'émet plus aucun crime.
- **Textures au loin corrigées** : les bâtiments hors du cœur détaillé sont
  désormais rendus avec de **vraies façades** en projection triplanaire
  (`makeFacadeInstancedMaterial`), une seule texture par palette et un
  InstancedMesh par palette. C'était la cause du « plus de textures quand on
  s'éloigne du spawn » : ces chunks utilisaient un matériau blanc uni.
- **Conducteur visible** dans tous les véhicules de trafic (silhouette assise
  procédurale fusionnée : **1 draw call par voiture**, tête masquée en vue
  habitacle) et **vitres transparentes** (découpe des triangles de verre par
  échantillonnage de la palette, matériau `MeshPhysical`-like dédié).
- **Drift** : le frein à main fait chuter l'adhérence latérale à 0,10 et
  injecte un couple de lacet de survirage entretenu par la vitesse. Mesuré :
  **angle de dérive > 8°**, **survirage > 25 %** par rapport au même virage
  sans frein à main. **Crissement de pneus synthétisé** (bruit passe-bande
  2,4 kHz + LFO) piloté par la glisse réelle, et **fumée de pneus** en pool fixe.
- **GPS** : ruban bleu continu de 2,9 m de large au sol, **96 chevrons** couvrant
  jusqu'à **900 m** (vérifié : > 150 m), et mini-carte style Google Maps
  (liseré sombre + bleu vif + flèches). Le tracé n'est plus tronqué à 660 m.
- **Vue habitacle** : caméra placée à la position réelle du conducteur
  (à gauche du volant), FOV 74–82°, tête du conducteur masquée, retour 3e
  personne progressif. `V` / `BACK` pour basculer, `R` / `R3` pour recentrer.
- **Menu complet** (`Échap`, `START`, D-Pad ↑ ou bouton ⚙️) : Graphismes
  (ombres, lumière, mode RTX, météo, densité de trafic/piétons), Contrôles,
  Manette (zone morte, sensibilité, vibrations) et Spécial (debug, argent,
  garage, sauvegarde). **Icônes Reicon** (npm, hors-ligne) rendues en SVG inline.
- **Modes Histoire / Libre** : en Libre, les livraisons s'arrêtent, on pose une
  destination d'un clic sur la mini-carte, et la météo est librement réglable.
- **Honnêteté sur le « RTX »** : WebGL n'expose pas le ray tracing matériel.
  Le mode RTX est une approximation assumée (reflets PBR renforcés ×1,75,
  ombres plus douces, exposition relevée), documentée comme telle dans le menu.


## 🎨 Textures HD & animations (v0.3.1)

- **Textures full HD procédurales**, zéro asset externe : façades **1024²**
  (albédo jour + émissive nuit + relief), sol de la métropole **2048²**
  (32 px/m), asphalte 1024², trottoirs et herbe 512². Détail métrique
  supplémentaire (256 px/m) branché dans un shader, sans coût par frame.
- **Pneus parfaitement circulaires** : rayons mesurés sur modèle non étiré,
  échelle uniforme appliquée aux pivots. Vérifié au repos et en rotation.
- **Marche et course distinctes** : un cycle paramétré par la vitesse
  (amplitude de hanche 0,44 → 0,80 rad, coudes 0,10 → 1,15 rad, buste incliné,
  rebond 1,8 → 7 cm), cadence asservie à la distance parcourue donc sans
  glissement de pieds. Transition continue, sans à-coup.

Détails techniques et mesures : [`docs/04_TEXTURES_ET_ANIMATIONS_HD.md`](docs/04_TEXTURES_ET_ANIMATIONS_HD.md)
Réglages, menus et rendu v0.4 : [`docs/06_REGLAGES_RENDU_ET_MENUS_v0.4.md`](docs/06_REGLAGES_RENDU_ET_MENUS_v0.4.md)
et budget mémoire dans [`docs/03`](docs/03_RISQUES_ET_PERFORMANCE.md).

| Aperçu | Fichier |
|---|---|
| Planche de textures | `previews/textures.png` |
| Sol vu à hauteur d'œil | `previews/ground_eye.png` |
| Véhicules (cercles de contrôle) | `previews/cars.png` |
| Cycles marche / course | `previews/chars.png` |

## 🌍 Le monde (v0.3)

| Élément | Détail |
|---|---|
| **Surface** | 8,19 km de côté (grille de 129 × 129 routes, maille de 64 m) |
| **Streaming** | seuls les chunks proches (256 m) sont matérialisés ; le reste = données (0 coût de rendu) |
| **Cœur détaillé** | 448 m : 138 bâtiments, parc, station-service, PNJ, missions, boutiques |
| **Autoroute** | anneau de 4 km + 4 avenues radiales, glissières, lampadaires |
| **Circuit privé** | anneau asphalté de 336 m avec glissières et arche de départ |
| **Toits** | les immeubles possédés donnent accès à leur toit (vue sur la ville, chute possible) |

## 💰 Économie et progression

- **Argent** gagné par les missions de livraison (90 $ + 0,80 $/m + bonus de rapidité).
- **Logements** (8 biens, de 5 000 $ à ~42 000 $) : point de réapparition, soins, accès au toit.
- **Garage** : 2 → 4 → 6 emplacements (6 000 $ puis 15 000 $).
- **Véhicules** achetables (moto, citadine, berline, taxi, SUV, utilitaire, sportive) livrés devant l'atelier.
- **Améliorations** moteur / pneus / freins, 3 niveaux, appliquées à une copie de la fiche technique.
- Tout est **sauvegardé** (format v2).

## 🎨 Modèles 3D (CC0, embarqués)

Les personnages, véhicules et l'avatar du joueur sont de **vrais modèles 3D** depuis la v0.2, embarqués dans le bundle (aucun téléchargement au lancement) :

| Contenu | Source | Licence | Traitement |
|---|---|---|---|
| 7 véhicules (citadine, berline, SUV, sportive, taxi, utilitaire, police) | Kenney « Car Kit » | **CC0** | quantification, textures PNG 256 px, roues indexées |
| 5 citoyens + joueur | Quaternius « Ultimate Modular Men » | **CC0** | quantification, palette fusionnée, **animation procédurale du squelette** |

- Détails et fichiers : [`web/assets/LICENSES.md`](web/assets/LICENSES.md)
- Les modèles sont **normalisés au mètre** à l'exécution : longueur = physique du véhicule, pieds au sol, avant vers +Z.
- Les animations de marche/idle sont **calculées sur les os** (les packs CC0 n'en fournissent pas) : hanches en opposition de phase, genoux fléchis, bras le long du corps.
- Si un modèle manque, chaque système **retombe automatiquement** sur ses primitives : le jeu ne casse jamais.
- Pour ajouter un modèle : déposer le `.glb` dans `web/assets/models/`, l'associer dans `web/src/assets.js`, puis `npm run build`.

## 🏗️ Produit cible : Unreal Engine 5.5

`unreal/` contient désormais **le projet UE5.5 source complet de la migration V3** : 18 classes C++ (17 UCLASS + 1 interface), graphe routier et GPS (A*), météo avec mouillage/séchage, profils graphiques + DLSS/TSR, véhicule Chaos, voirie physique (trottoirs chanfreinés franchissables), trafic IA, PNJ météo, missions, sauvegarde v3, pipeline Poly Haven et vérificateur exécutable.

```bash
python3 unreal/Scripts/verify_project.py    # 251 contrôles statiques, 0 échec
node tools/test_unreal_project.mjs          # 51 contrôles d'intégration, 0 échec
```

Guide : [`unreal/README.md`](unreal/README.md) · rapport de chantier : [`docs/13_V3_UNREAL.md`](docs/13_V3_UNREAL.md).

⚠️ **Compilation non réalisée ici** : Unreal Editor est absent de l'environnement de développement automatisé (vérifié), aucun GPU ni serveur graphique. Le code est vérifié statiquement (règles UHT, includes, configs) et les étapes qui exigent l'éditeur sont listées une par une. Aucun asset `.uasset` factice n'est versionné.

## 📚 Documentation

| Document | Contenu |
|---|---|
| [`docs/00_DECISION_MOTEUR_ET_VISION.md`](docs/00_DECISION_MOTEUR_ET_VISION.md) | Choix UE5 vs Unity 6 (motivé critère par critère), vision, rôle du prototype web |
| [`docs/01_ARCHITECTURE.md`](docs/01_ARCHITECTURE.md) | Systèmes, dépendances, bus d'événements, LOD de simulation, data-driven, mapping web ↔ UE5 |
| [`docs/02_PLAN_DE_PRODUCTION.md`](docs/02_PLAN_DE_PRODUCTION.md) | Phases 1→5, critères de sortie, backlog immédiat |
| [`docs/03_RISQUES_ET_PERFORMANCE.md`](docs/03_RISQUES_ET_PERFORMANCE.md) | Budgets chiffrés par plateforme et par système, 10 risques majeurs et mitigations |
| [`docs/09_FIX_V0.6.md`](docs/09_FIX_V0.6.md) | Correctifs façades / arbres / saut / L3 / moto, avec mesures |
| [`docs/10_GPS_TEMPS_REEL_v0.7.md`](docs/10_GPS_TEMPS_REEL_v0.7.md) | GPS temps réel : projection, recalcul, manœuvres, coût A* |
| [`docs/11_HISTOIRE_EMPLOI_v0.8.md`](docs/11_HISTOIRE_EMPLOI_v0.8.md) | v0.8 : franchissement, histoire, emploi, carrosserie, moteur |
| [`docs/12_GRAPHISMES_v0.9.md`](docs/12_GRAPHISMES_v0.9.md) | v0.9 : post-traitement, ciel, mobilier, habitacles, foule |

## 📁 Structure

```
METROPOLIS.html   Le jeu entier en un fichier, double-cliquable (généré)
/web              Sources de la vertical slice (modules ES + serveur de dev)
  assets/models   Modèles 3D CC0 (.glb) + LICENSES.md
/desktop          Coquille Electron → METROPOLIS.exe portable
/unreal           Projet Unreal Engine 5.5 (source C++, scripts Poly Haven, docs)
/docs             Décisions · architecture · plan · risques & performance
/tools            Build fichier unique + tests automatisés headless
```

**Philosophie (non négociable) :** prototype fonctionnel > système complexe cassé · immersion > taille artificielle de carte · aucun système sans budget de performance ni test.
