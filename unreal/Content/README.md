# Content/ — contenu produit par l'éditeur

Ce dossier est **volontairement vide de tout asset binaire**.

Les `.uasset` (matériaux, Blueprints, Niagara) et `.umap` (niveaux) ne peuvent
être créés que par Unreal Editor : les générer hors éditeur produirait des
fichiers corrompus. La vérification automatique
(`Scripts/verify_project.py`) **échoue** si un `.uasset` factice apparaît ici.

Remplissage prévu :

```
Content/
├── Maps/            L_DemoDistrict (World Partition)        ← éditeur, étape 1
├── PolyHaven/       meshes + textures importés (CC0)        ← Scripts/polyhaven_import_ue.py
│   ├── raw/         téléchargements bruts (ignorés par Git)
│   └── Materials/   M_Master_PBR, MI_*, PM_*                ← éditeur + script
├── Input/           IMC_*, IA_*                              ← éditeur, étape 3
├── Vehicles/        BP_MetropolisVehicle                    ← éditeur, étape 4
├── Characters/      BP_MetropolisCharacter, BP_Pedestrian
└── VFX/             NS_Rain, NS_Splashes                    ← éditeur, étape 5
```

Ordre exact et réglages détaillés : `../Documentation/02_EDITOR_STEPS.md`.
