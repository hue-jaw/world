# 01 — Installation Windows 11 + Unreal Engine 5.8.4

## Prérequis matériels

| Élément | Votre configuration | Commentaire |
|---|---|---|
| GPU | RTX 3050 6 Go | cible du projet, 1920×1080, profil « Élevé » + DLSS Qualité |
| CPU | Xeon E3-1240 v2 (4 c / 8 t) | suffisant pour la simulation ; le trafic IA est plafonné à 20 Hz |
| RAM | 20 Go | 16 Go minimum pour l'éditeur, 32 Go conseillés avec Lumen |
| Disque | SSD, 40 Go libres | UE 5.8 + DerivedDataCache + projet |

## Logiciels

| Logiciel | Version exacte | Où |
|---|---|---|
| Unreal Engine | **5.8.4** | Epic Games Launcher → Bibliothèque |
| Visual Studio | **Community 2026** | visualstudio.microsoft.com |
| MSVC | **v145 (14.50.35717 ou plus récent)** | VS Installer → Composants individuels |
| Windows SDK | 10.0.22621 ou plus récent | VS Installer |
| .NET | 8.0 SDK | nécessaire à UnrealBuildTool |

Dans VS Installer, cocher :

- **Développement de bureau en C++**
- **Développement de jeux avec C++** (ou « Unreal Engine installer »)
- **MSVC v145** + **Windows 11 SDK**

> ⚠️ VS 2022 (MSVC v143) **ne suffit plus** pour UE 5.8 : UBT réclame le toolset v145.

> **Raccourci** : une fois UE 5.8.4 et Visual Studio installés, lancez
> `Scripts\Build-Metropolis.bat` (double-clic). Il nettoie les caches, compile
> `MetropolisEditor` et isole la première erreur dans `BuildLog.txt`.
> Les sections suivantes détaillent chaque étape et servent de dépannage.

## 1. Nettoyer l'ancienne version (obligatoire)

Passer de 5.5 (ou 5.4) à 5.8.4 avec d'anciens intermédiaires provoque des erreurs
trompeuses (« missing modules », BuildId mismatch). Fermer l'éditeur, puis :

```bat
cd C:\chemin\vers\Metropolis
rmdir /s /q Binaries Intermediate DerivedDataCache Saved .vs 2>nul
del /q *.sln 2>nul
```

## 2. Lier le projet à UE 5.8

1. clic droit sur `Metropolis.uproject` → **Switch Unreal Engine version…**
2. choisir **5.8**. S'il n'apparaît pas : `...` → parcourir
   `C:\Program Files\Epic Games\UE_5.8`.
3. clic droit à nouveau → **Generate Visual Studio project files**.

## 3. Compiler

```bat
"C:\Program Files\Epic Games\UE_5.8\Engine\Build\BatchFiles\Build.bat" ^
   MetropolisEditor Win64 Development ^
   -project="%CD%\Metropolis.uproject" -waitmutex
```

Ou dans Visual Studio : ouvrir `Metropolis.sln`, configuration
**Development Editor** / **Win64**, `Ctrl+Shift+B`.

Premier build : 10 à 25 minutes selon la machine (shaders + module).

## 4. Lancer et jouer immédiatement

1. double-clic sur `Metropolis.uproject` ;
2. `File → New Level → Empty Level` (aucune carte n'est fournie : un `.umap`
   ne peut être créé que par l'éditeur) ;
3. **Play**.

Le GameMode construit alors le quartier : rues, trottoirs physiques, bâtiments,
voitures garées, graphe routier, joueur. Aucun asset à importer pour cette
première vérification.

Commandes par défaut (à câbler sur les assets Enhanced Input, étape 3 de
`02_EDITOR_STEPS.md`) :

| Touche | Action |
|---|---|
| ZQSD / WASD | marcher |
| Souris | regarder |
| Espace | sauter |
| Maj | sprint |
| E | entrer dans un véhicule |
| V | vue 1re / 3e personne |
| T | avancer l'horloge de 2 h (test météo) |
| F5 / F9 | sauvegarder / charger |
| H | masquer le HUD |

## 5. Si la compilation échoue

1. lire la **première** erreur du log (`Saved/Logs/*.log` ou sortie VS) ;
2. comparer au tableau §8 de `08_RAPPORT_UE58.md` ;
3. en cas de doute, repartir d'un arbre propre : supprimer `Binaries`,
   `Intermediate`, `Saved`, `DerivedDataCache`, régénérer, recompiler.

## 6. Packaging (plus tard)

```bat
"C:\Program Files\Epic Games\UE_5.8\Engine\Build\BatchFiles\RunUAT.bat" ^
   BuildCookRun -project="%CD%\Metropolis.uproject" -noP4 -platform=Win64 ^
   -clientconfig=Shipping -cook -allmaps -build -stage -pak -archive ^
   -archivedirectory="%CD%\Build"
```

`+DirectoriesToAlwaysCook` est déjà configuré pour `/Game/Maps` et
`/Game/PolyHaven` dans `Config/DefaultGame.ini`.

## 7. Vérification statique (sans éditeur)

```bash
python3 Scripts/verify_project.py
```

Doit afficher `VERIFICATION UNREAL : N ✓ / 0 échec`. Ce script ne remplace pas
une compilation : il vérifie les règles UHT, les noms de modules, la cohérence
des cibles 5.8 et l'absence de binaires factices.
