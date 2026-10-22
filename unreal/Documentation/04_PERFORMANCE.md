# 04 — Performance : cible RTX 3050 6 Go, 1920×1080

## Ce que le projet fait, et ce qu'il ne fait pas

Il **règle** des CVars et **mesure** des temps de frame réels
(`UGraphicsSettingsSubsystem::SampleFrame`). Il **ne promet aucun FPS** : le
temps de frame dépend du contenu (nombre de bâtiments, densité de PNJ, météo).

## Profils

| Profil | GI | Reflets | Ombres | Textures | VSM | Fog volumétrique | RT |
|---|---|---|---|---|---|---|---|
| Bas | 0 | 0 | 0 | 1 | non | non | non |
| Moyen | 1 | 1 | 1 | 2 | oui | non | non |
| Élevé (défaut) | 2 | 2 | 2 | 2 | oui | oui | non |
| Ultra | 3 | 3 | 3 | 3 | oui | oui | non |
| Personnalisé | libre | libre | libre | libre | libre | libre | libre |

Chaque valeur correspond à un `sg.*Quality` réel appliqué par `ApplyCVars()`.
Le rayon tracing matériel est **hors profil** : c'est une case à part
(`bHardwareRayTracing`), désactivée par défaut.

## Budget VRAM (6 Go)

- `r.Streaming.PoolSize` : 2 200 (Bas) / 3 000 (Élevé) / 3 800 (Ultra) Mo.
- `r.Streaming.LimitPoolSizeToVRAM=1` : le moteur ne dépasse pas la VRAM.
- Textures Poly Haven : **2k** par défaut (`polyhaven_sync.py --resolution 2k`),
  4k seulement pour les surfaces vues de près (asphalte, béton).

## Réglages qui coûtent le plus, dans l'ordre

1. **Lumen Reflets** (`sg.ReflectionQuality`) — basculer en « Moyen » gagne
   beaucoup, la perte visuelle est faible sur asphalte mouillé.
2. **Volumetric Fog** — un seul volume, mais plein écran : le désactiver est le
   premier levier en cas de pluie dense.
3. **Ombres virtuelles** (VSM) — excellentes mais chères en 6 Go ; « Bas » passe
   en shadow maps classiques.
4. **Densité de foule** — les `APedestrian` coûtent CPU (squelette + tick).
   Au-delà de ~120 PNJ visibles, passer à Mass Entity (voir `06_TESTS.md`).

## Mesurer (commandes réelles)

```
stat unit            → Game / Draw / GPU (ms)
stat fps             → FPS courant
stat gpu             → détail passe par passe
stat streaming       → pool texture, pression VRAM
stat scenerendering  → nombre de draws, primitives
profilegpu           → capture d'une frame complète
```

Le HUD du jeu affiche déjà : FPS moyen (120 frames), 1 % low, temps de frame.
Le 1 % low est la métrique qui compte pour la fluidité perçue.

## Mode fluidité

Le profil « Bas » + DLSS Performance + désactivation du fog volumétrique +
`sg.ShadowQuality=0` constituent le mode fluidité. Il est atteignable en deux
clics depuis le menu Graphismes ; aucun code spécifique n'est requis.

## Ce qu'il reste à mesurer sur une vraie machine

- temps de cook et taille du pak ;
- FPS réels quartier complet (6×6 pâtés, ~40 véhicules, ~120 PNJ) ;
- pic de VRAM en pluie dense + nuit (le pire cas : fog volumétrique + lampadaires
  + reflets mouillés).

Ces trois mesures ne peuvent pas être produites ici : pas de GPU, pas
d'éditeur. Elles sont listées comme **à faire au premier lancement Windows**.
