# 05 — Poly Haven : pipeline d'assets

## Règles

- API officielle : `https://api.polyhaven.com` (schéma embarqué :
  `Scripts/polyhaven_openapi.yml`, récupéré depuis le dépôt
  `github.com/Poly-Haven/Public-API`).
- Licence des assets : **CC0** (aucune attribution obligatoire, aucune
  restriction d'usage commercial).
- **Aucun identifiant n'est codé en dur.** Le script interroge `/assets`, filtre
  sur les métadonnées réelles, et n'écrit dans le manifeste que des assets qui
  existent, avec taille et MD5 renvoyés par l'API.

## Utilisation

```bash
cd Scripts

# 1. Voir ce qui serait récupéré (aucun octet téléchargé)
python3 polyhaven_sync.py --dry-run

# 2. Télécharger réellement (2k par défaut)
python3 polyhaven_sync.py --resolution 2k

# 3. Un seul asset (debug) — l'ID doit exister dans /assets
python3 polyhaven_sync.py --only <id_reel>

# 4. Contrôler le manifeste hors ligne
python3 polyhaven_check.py
```

Résultat :

```
Content/PolyHaven/raw/<asset_id>/...
Scripts/polyhaven_manifest.generated.json
```

## Priorités (§13 du cahier des charges)

| Groupe | Type | Recherche | Nombre |
|---|---|---|---|
| Arbres | models | `tree` | 8 |
| Végétation | models | `plant`, `bush`, `fern`, `grass` | 8 |
| Rochers | models | `rock`, `stone`, `boulder` | 6 |
| Asphalte | textures | `asphalt`, `road` | 4 |
| Béton | textures | `concrete`, `cement` | 6 |
| Briques | textures | `brick`, `facade` | 6 |
| HDRI | hdris | `city`, `urban`, `sky` | 4 |
| Mobilier | models | `bench`, `lamp`, `hydrant`, `sign` | 8 |

Les termes sont des **filtres de recherche**, pas des noms d'assets. Le
manifeste final contient les IDs réels.

## Import dans l'éditeur

```bat
UnrealEditor-Cmd.exe METROPOLIS.uproject -run=pythonscript ^
  -script="Scripts/polyhaven_import_ue.py"
```

ou `Outils → Exécuter un script Python` dans l'éditeur.

Le script :

1. importe les `.gltf` et textures dans `/Game/PolyHaven/<groupe>/` ;
2. active **Nanite** et règle les LOD sur les meshes ;
3. crée les **Physical Materials** (`PM_Asphalt`, `PM_Concrete`, `PM_Grass`…)
   avec des frottements réalistes ;
4. crée les **Material Instances PBR** si `M_Master_PBR` existe ;
5. écrit `Scripts/polyhaven_import_report.json`.

## État vérifié dans cet environnement (22/10)

| Hôte | Résultat |
|---|---|
| `api.polyhaven.com` | **inaccessible** (HTTP 000) |
| `polyhaven.com` | **inaccessible** (HTTP 000) |
| `dl.polyhaven.org` | **non testé** (le CDN de téléchargement) |

Conséquence : **aucun asset n'a été téléchargé ici**, et aucun fichier du
dossier `Content/` ne prétend en être un. Le pipeline est écrit, testé
syntaxiquement, et son manifeste est validé hors ligne ; il s'exécute sur une
machine connectée.

## Après import — réglages à faire dans l'éditeur

- **Arbres** : collisions capsules sur le tronc (les PNJ et la voiture doivent
  les heurter — exigence « les arbres bloquent »), LOD auto + Nanite pour les
  feuillages denses.
- **Asphalte** : tuiles 4 m, matériau `MI_Asphalt` avec normal map et
  `Wetness` branché sur la rugosité (route sèche/mouillée sans doublon d'asset).
- **HDRI** : `Sky Light → Source Type = SLS_SpecifiedCubemap`, intensité pilotée
  par la météo ; ne pas activer `Real Time Capture` en même temps.
