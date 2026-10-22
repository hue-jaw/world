# 13 — METROPOLIS V3 : passage à Unreal Engine 5.8.4 (22/10)

## 1. Décision

**Unreal Engine 5.8.4** pour la version finale. Le prototype WebGL v0.9.0 est
**gelé** : il reste la référence fonctionnelle (comportements validés,
réglages mesurés), il ne reçoit plus de fonctionnalités.

Raison : le cahier des charges V3 exige Nanite, Lumen, World Partition, Chaos
Vehicles, Niagara, Mass Entity, DLSS/Reflex, VSM — aucun n'existe dans une
pile WebGL. Continuer en three.js aurait produit une démo, pas le jeu demandé.

## 2. Audit de l'environnement (commandes réelles, 22/10)

| Disponible et vérifié | Indisponible et vérifié | Non encore vérifié |
|---|---|---|
| Debian 12 x86_64 ; bash ; écriture `/home/user` ; g++/gcc/make/python3/zip ; Node 22 + npm + registry ; GitHub (API, push, Releases, Actions) ; PyPI ; build HTML/Electron | Éditeur UE 5.8.4 (aucun binaire sur le système) ; affichage graphique (`DISPLAY` vide, xvfb absent) → ni éditeur, ni PIE, ni cook ; clang++, cmake, dotnet, mono, 7z ; `api.polyhaven.com`, `polyhaven.com`, `raw.githubusercontent.com` ; Meshy/Sketchfab/Kenney/Quaternius ; compilation Windows locale (runner GitHub uniquement) | `dl.polyhaven.org` (CDN de téléchargement) ; installation d'UE5 dans GitHub Actions ; identifiants d'assets Poly Haven |

**Conséquence honnête** : on peut produire le *code source* du projet, ses
configs, son pipeline d'assets et sa documentation — **pas** les niveaux, les
Blueprints, les matériaux, ni un exécutable jouable. Ces derniers exigent
l'éditeur, sur un poste Windows.

## 3. Ce qui a été livré

### Code C++ (19 classes exportées — 18 `UCLASS` + 1 interface — dans `unreal/Source/Metropolis/`)

| Domaine | Classes | Points vérifiables dans le code |
|---|---|---|
| Réseau routier | `URoadNetworkSubsystem` | A* avec pénalité de virage, sens uniques, fermetures, index spatial |
| GPS | `UGPSSubsystem` | projection sur tracé, recalcul avec seuil + cooldown, manœuvres, ETA |
| Météo | `UWeatherSubsystem`, `AWeatherVisualController` | mouillage montée 8 s / séchage 90 s, grip 1,0→0,62, soleil/lune, fog volumétrique, Niagara pluie/éclaboussures |
| Graphismes | `UGraphicsSettingsSubsystem` | 4 profils + personnalisé, CVars réels, DLSS gaté, Frame Generation **refusée** hors Ada/Blackwell, FPS mesurés |
| Véhicule | `AMetropolisVehicle` | Chaos, 4 vues, sonde de surface, `IInteractable`, fiche `UVehicleDataAsset` |
| Joueur | `AMetropolisCharacter` | pas de 36 cm, sprint, entrée véhicule, vue 1re/3e |
| Voirie | `AStreetSurfaceActor` | 15/16/18 cm, biseau 14 cm, collision **complexe** (aucun mur invisible) |
| Trafic | `ATrafficAIController` | physique réelle, feux, limitations, profil×6, distance de sécurité météo |
| PNJ | `APedestrian` | trottoirs, parapluie animé, contournement des arbres, abri sous orage |
| Missions | `UMissionSubsystem`, `UMissionDataAsset` | étapes, chrono, récompenses, GameplayTags |
| Sauvegarde | `UMetropolisSaveGame` | v3, refus propre des versions antérieures |
| Jeu | `AMetropolisGameMode`, `AMetropolisPlayerController`, `AMetropolisHUD` | spawn sûr, sauvegarde, pause, HUD Canvas sans asset |

### Config

`DefaultEngine.ini` : Lumen GI/reflets, Nanite, VSM, post-process, pool VRAM
3 500 Mo (limite 6 Go), sous-pas physique à 120 Hz, profils de collision
`Vehicle`/`StreetSurface`. `DefaultInput.ini` : Enhanced Input. `DefaultGame.ini` :
packaging en IoStore compressé.

### Pipeline Poly Haven

- `polyhaven_api.py` : client conforme au schéma OpenAPI officiel (embarqué).
- `polyhaven_sync.py` : sélection par recherche (jamais d'ID codé en dur),
  téléchargement, **vérification MD5**, manifeste avec auteur/licence CC0.
- `polyhaven_import_ue.py` : import éditeur, Nanite, LOD, Physical Materials,
  Material Instances, rapport JSON.
- `polyhaven_check.py` : contrôle hors ligne du manifeste.

### Documentation

`unreal/Documentation/` : installation Windows, étapes éditeur (9 sections
ordonnées), DLSS et vérités matérielles, performance 3050 6 Go, Poly Haven,
tests, migration WebGL→UE5.

## 4. Tests exécutés

| Suite | Résultat |
|---|---|
| `unreal/Scripts/verify_project.py` | **269 ✓ / 0 échec** — uproject, UHT, includes, syntaxe, config, Content, API OpenAPI |
| `tools/test_unreal_project.mjs` | **57 ✓ / 0 échec** — intégration, classes attendues, règles de vérité |
| Porte qualité WebGL (inchangée) | **341 ✓ / 0 échec** |
| **Total** | **398 ✓ / 0 échec** |

Non exécutés, et donc **non déclarés réussis** : compilation UE5, PIE,
cook, les 10 tests moteur (§19). Ils exigent Windows + UE 5.8.4 + GPU.

## 5. Ce qu'il reste à faire, dans l'ordre

1. Sur un poste Windows : installer UE 5.8.4 + VS 2022, générer les fichiers de
   projet, compiler (`unreal/Documentation/01_INSTALL_WINDOWS.md`).
2. Créer la carte `L_DemoDistrict`, `M_Master_PBR`, les assets Enhanced Input,
   les Blueprints, Niagara (`02_EDITOR_STEPS.md`, 9 étapes).
3. Lancer `polyhaven_sync.py` puis `polyhaven_import_ue.py` sur une machine
   connectée (l'API est bloquée ici).
4. Exécuter les 10 tests moteur et remplir le journal de `06_TESTS.md`.
5. Mesurer réellement les FPS sur la 3050, puis ajuster les profils — les
   valeurs actuelles sont des budgets, pas des promesses.
