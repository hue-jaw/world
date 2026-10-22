# METROPOLIS — projet Unreal Engine 5

Ce dossier contient **le projet UE5 source** de METROPOLIS, et rien d'autre.
Il ne contient **aucune démo web** : la version WebGL (v0.9.0) reste à la racine
du dépôt, gelée, comme référence fonctionnelle.

## Ce qui est dans ce dossier

| Élément | État | Comment le vérifier |
|---|---|---|
| `Metropolis.uproject` | réel | JSON valide, Unreal Engine 5.8.4 |
| `Source/Metropolis/` (19 classes C++) | réel | `python3 Scripts/verify_project.py` |
| `Config/*.ini` | réel | sections Engine/Game/Input relues par le script |
| `Scripts/polyhaven_*.py` | réel | interroge l'API officielle, aucun ID en dur |
| `Scripts/verify_project.py` | réel | s'exécute hors éditeur |
| `Content/` | **vide volontairement** | tout asset exige l'éditeur |
| `Maps/`, Blueprints, matériaux, Niagara | **à créer dans l'éditeur** | voir `02_EDITOR_STEPS.md` |

Aucun `.uasset`, `.umap`, ni fichier binaire factice n'est versionné : un
fichier binaire vide serait un mensonge sur l'état du projet. La vérification
automatique échoue si quelqu'un en ajoute un.

## Démarrage rapide

```bash
# 1. Vérifier la structure (aucune installation d'Unreal requise)
python3 Scripts/verify_project.py

# 2. Récupérer les assets Poly Haven (machine connectée)
python3 Scripts/polyhaven_sync.py --dry-run     # liste
python3 Scripts/polyhaven_sync.py --resolution 2k

# 3. Ouvrir le projet
#    Windows + Unreal Engine 5.8.4 → clic droit sur Metropolis.uproject → Generate Visual Studio project files
#    puis double-clic sur Metropolis.uproject
```

Puis suivre `01_INSTALL_WINDOWS.md` → `02_EDITOR_STEPS.md`.

## Architecture en une page

```
Metropolis.uproject
├── Config/                  réglages moteur, jeu, entrées
├── Source/Metropolis/
│   ├── Public/              en-têtes (API des classes)
│   └── Private/             implémentations
├── Content/                 assets (créés dans l'éditeur ; Poly Haven importé)
├── Scripts/                 pipeline Python (Poly Haven + vérification)
└── Documentation/           ce dossier
```

### Les sous-systèmes (le cœur du jeu)

| Classe | Rôle | Équivalent version web |
|---|---|---|
| `URoadNetworkSubsystem` | graphe routier, A*, sens uniques, feux | `web/src/gps.js` |
| `UGPSSubsystem` | itinéraire, manœuvres, recalcul | `web/src/gps.js` |
| `UWeatherSubsystem` | météo, mouillage, cycle jour/nuit | `web/src/environment.js` |
| `UGraphicsSettingsSubsystem` | profils, DLSS/TSR, télémétrie | `web/src/settings.js`, `postfx.js` |
| `UMissionSubsystem` | étapes, chrono, récompenses | `web/src/story.js`, `jobs.js` |
| `AMetropolisVehicle` | véhicule Chaos | `web/src/vehicles.js` |
| `AMetropolisCharacter` | joueur à pied | `web/src/player.js` |
| `AStreetSurfaceActor` | trottoirs/terre-pleins physiques | `web/src/contact.js` |
| `ATrafficAIController` | conduite IA | `web/src/pedestrians.js` (trafic) |
| `APedestrian` | PNJ piétons, parapluie | `web/src/pedestrians.js` |
| `AWeatherVisualController` | soleil/ciel/pluie Niagara | `web/src/environment.js` |
| `UMetropolisSaveGame` | sauvegarde v3 | `web/src/save.js` |

## Limites assumées

1. **Unreal Engine n'est pas installé dans l'environnement de développement
   automatisé** (vérifié : aucun `UnrealEditor` sur le système, aucun serveur
   graphique). Le code C++ n'a donc **pas été compilé** ici : il est écrit
   selon l'API Unreal Engine 5.8.4 et vérifié statiquement (UHT, includes, équilibrage).
2. **Les Blueprints, matériaux, Niagara et la carte** ne peuvent pas être
   produits hors éditeur. Ils sont listés étape par étape dans
   `02_EDITOR_STEPS.md`, avec l'ordre exact à respecter.
3. **Aucun FPS n'est promis.** La télémétrie du HUD mesure ; elle n'annonce pas.
