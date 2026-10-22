# 06 — Tests

## Principe

**Aucun succès n'est déclaré sans exécution.** Deux familles de tests :

| Famille | Exécutable ici ? | Où |
|---|---|---|
| Statique (structure, UHT, config, API) | **oui** | `Scripts/verify_project.py` |
| Moteur (PIE, cook, FPS, collisions) | **non** — exige UE5 | liste ci-dessous |

## Test exécutable

```bash
python3 Scripts/verify_project.py
```

Couverture :

| Contrôle | Ce qu'il attrape |
|---|---|
| `uproject` | JSON cassé, module manquant, version non-UE5 |
| `sources` | `.h` sans `.cpp`, fichier vide, encodage invalide |
| `uht` | `UCLASS` sans `GENERATED_BODY`, `.generated.h` mal placé |
| `syntax` | accolades/parenthèses déséquilibrées |
| `config` | section Engine absente, GameMode inexistant, pool VRAM > 4 Go |
| `content` | `.uasset` factice versionné, fichier vide |
| `api` | endpoint Poly Haven absent du schéma OpenAPI officiel |

Intégration à la porte qualité du dépôt : `tools/test_unreal_project.mjs`,
compté dans `npm test`.

## Les 10 tests du cahier des charges (§19)

| # | Test | Comment l'exécuter (Windows + UE5) | Critère de réussite |
|---|---|---|---|
| 1 | Démarrage du jeu | `Play` dans l'éditeur | carte chargée, joueur spawné, HUD visible |
| 2 | Conduite | posséder `BP_MetropolisVehicle`, rouler | vitesse monte, braquage, frein, aucune roue qui flotte |
| 3 | Montée de trottoir | viser un trottoir à 30 km/h | la voiture **monte**, suspension comprimée, pas de blocage |
| 4 | Terre-plein | viser un îlot arboré | montée possible, herbe = adhérence réduite (HUD : surface) |
| 5 | Trafic | attendre 60 s à un carrefour | véhicules circulent, s'arrêtent au rouge, ne se traversent pas |
| 6 | PNJ | suivre un piéton sous la pluie | parapluie s'ouvre, contourne les arbres, pas de traversée de mur |
| 7 | GPS | définir une destination | tracé sur les routes, manœuvre annoncée, recalcul après écart |
| 8 | Météo | `T` ×3 puis attendre | pluie Niagara, surfaces mouillées, séchage progressif, grip réduit |
| 9 | Graphismes | changer de profil en jeu | CVars appliquées, pas de crash, DLSS absent → TSR |
| 10 | Sauvegarde | `F5`, relancer, `F9` | position, heure et météo restaurées ; v3 incompatible refusée |

### Journal de test à remplir

```
Date :            Machine (GPU / pilote) :
Test 1  □OK □KO   remarque :
…
Test 10 □OK □KO   remarque :
```

## Ce qui a été exécuté le 22/10

- `verify_project.py` : voir le compte rendu (nombre de contrôles, 0 échec).
- `polyhaven_check.py` : manifeste absent → sortie 0 volontaire (pas d'assets
  inventés).
- Les 10 tests moteur : **non exécutés**, faute d'Unreal Engine et de GPU dans
  l'environnement. Ils ne sont donc pas déclarés réussis.
