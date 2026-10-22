# 03 — DLSS, DLAA, Reflex et Frame Generation : ce qui est vrai sur RTX 3050

## Le principe appliqué dans le code

`UGraphicsSettingsSubsystem` n'affiche une option que si elle **peut**
fonctionner :

| Option | Condition dans le code | Comportement si absente |
|---|---|---|
| DLSS (Q/É/P/UP), DLAA | `METROPOLIS_WITH_DLSS == 1` **et** GPU NVIDIA | repli **TSR**, message dans le log |
| Reflex | idem DLSS | désactivé, aucune case affichée |
| Frame Generation | DLSS **et** Ada/Blackwell (RTX 40/50) | **refusé** et journalisé |

Sur une **RTX 3050** (Ampere) : DLSS 2/3 upscaling **oui**, Reflex **oui**,
Frame Generation **non** — la technologie n'existe pas sur cette génération de
GPU. Le code refuse explicitement `SetFrameGeneration(true)` plutôt que
d'afficher une case qui ne ferait rien.

## Activer DLSS (licence NVIDIA requise)

1. Télécharger le plugin **NVIDIA DLSS** pour UE 5.8.4 (NVIDIA Developer / Epic
   Marketplace) — son usage est soumis à l'accord NVIDIA, ce n'est pas un
   logiciel libre.
2. Copier dans `Plugins/NVIDIADLSS/`.
3. Dans `Source/METROPOLIS/METROPOLIS.Build.cs`, passer :
   ```csharp
   PublicDefinitions.Add("METROPOLIS_WITH_DLSS=1");
   ```
   et ajouter la dépendance du module du plugin (`NVIDIADLSS`).
4. Recompiler. Le sous-système détecte alors le GPU via `GRHIAdapterName`.

Sans ces étapes, **le projet compile et fonctionne** : il utilise TSR.

## Ce que fait le mode « DLSS x » (mapping réel)

| Mode du menu | `r.ScreenPercentage` | `r.AntiAliasingMethod` |
|---|---|---|
| Désactivé | 100 | 0 |
| TSR (repli) | 100 | 4 |
| DLAA | 100 | 3 |
| Qualité | 66 | 3 |
| Équilibré | 58 | 3 |
| Performance | 50 | 3 |
| Ultra Performance | 33 | 3 |

Ces pourcentages sont les ratios de rendu internes standards du pipeline UE5.
Le plugin DLSS lit `ScreenPercentage` et choisit son preset en conséquence.

## Pourquoi TSR est le repli et pas FSR

TSR est fourni par le moteur, ne dépend d'aucun plugin tiers, et gère le
mouvement des feuillages avec une qualité proche de DLSS en 1080p. C'est le
choix le plus sûr pour une cible 6 Go de VRAM.

## Vérification

Dans la console du jeu (`~`) :

```
r.AntiAliasingMethod        → doit valoir 3 si DLSS, 4 si TSR
r.ScreenPercentage          → 66 en DLSS Qualité
r.NGX.DLSS.FrameGeneration  → 0 sur RTX 3050, quoi qu'il arrive
```

Le HUD affiche les FPS **mesurés** (moyenne 120 frames + 1 % low). Aucune
valeur n'est écrite en dur dans l'interface.
