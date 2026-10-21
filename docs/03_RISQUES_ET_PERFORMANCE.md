# METROPOLIS — Risques techniques & objectifs de performance

## 1. Objectifs de performance (budgets contractuels)

### Cibles produit UE5

| Plateforme | Résolution | FPS cible | Budget frame | Notes |
|---|---|---|---|---|
| PC milieu de gamme (RTX 3060 / Ryzen 5) | 1080p→1440p upscale | **60** | 16,6 ms | Lumen logiciel, Nanite, TSR |
| PC haut de gamme | 4K upscale | 60 | 16,6 ms | Lumen HW RT optionnel |
| Consoles current-gen | 1440p→4K | 30 « qualité » / 60 « perf » | 33 / 16,6 ms | Profils Scalability dédiés |

### Budgets par système (à 60 fps, frame de 16,6 ms)

| Poste | Budget | Garde-fou |
|---|---|---|
| CPU gameplay total | ≤ 8 ms | Tick par LOD (§01.3), Mass multithread |
| Trafic (300 véh. simulés) | ≤ 1,5 ms | Physique Chaos seulement < 70 m ; au-delà cinématique sur voies |
| Citoyens (2 000 agents ville) | ≤ 1,5 ms | Mass fragments ; acteurs complets < 50 près du joueur |
| Streaming (World Partition) | ≤ 2 ms/frame en continu, 0 hitch > 50 ms | Chargement asynchrone, HLOD, budgets d'IO par frame |
| GPU total | ≤ 13 ms | Lumen surfacique, ombres VSM mises en cache, Nanite > 90 % des meshes |
| Draw calls | ≤ 2 500 (après Nanite/instancing) | ISM/HISM pour mobilier, matériaux partagés |
| Mémoire | ≤ 9 Go RAM / 6 Go VRAM (1080p) | Streaming de textures, pooling d'acteurs |

### Budgets prototype web (mesurables dès maintenant, panneau F1)

- 60 fps sur laptop intégré récent ; draw calls ville ≈ 150 grâce à l'instancing (plateformes, arbres, lampadaires, marquages chacun en 1 appel) et aux matériaux partagés.
- Lumières dynamiques simultanées bornées : 1 soleil/lune + 1 hémisphérique + 2 phares joueur + ≤ 2 gyrophares. **C'est le poste qui explose en premier sur le web** — tout le reste est émissif factice.
- Simulation : coût proportionnel au voisinage (LOD ci-dessus), pas à la ville.

## 2. Risques techniques majeurs & mitigations

| # | Risque | Prob. × Impact | Mitigation (déjà en place / prévue) |
|---|---|---|---|
| R1 | **Le trafic se bloque** (interblocages aux intersections) — le bug n°1 des open-worlds | Élevée × Fort | Proto : pas de demi-tour, engagement d'intersection, despawn au loin. UE5 : ZoneGraph avec files et priorités + « unstuck » statistique (téléport discret hors champ). Test automatisé : 30 min de sim autonome sans vitesse moyenne < seuil. |
| R2 | **Coût CPU de la foule** qui croît avec la carte | Élevée × Fort | LOD de simulation dès la v0.1 (prouvé dans le proto). UE5 : Mass plutôt qu'Actors partout ; jamais de tick « every frame » sans budget. |
| R3 | **Hitches de streaming** en conduisant vite | Moyenne × Fort | World Partition + HLOD + vitesse de prédiction de chargement selon vélocité joueur ; budget IO/frame ; proto : spawn/despawn par distance avec pooling (aucune allocation en roulant). |
| R4 | **Lumen + nuit + pluie** = éclairage instable/bruité | Moyenne × Moyen | Signatures lumineuses limitées (émissifs + peu de vraies lumières), réglages Lumen par profil, tests visuels nuit/pluie dans la checklist de chaque phase. Le proto valide la *direction artistique* à bas coût (fenêtres émissives, halos). |
| R5 | **Physique véhicules** : collisions tunneling à haute vitesse | Moyenne × Moyen | Proto : 2 cercles de collision + clamp dt. UE5 : sous-pas Chaos (sub-stepping) et CCD sur le véhicule joueur. |
| R6 | **Scope creep** (tout vouloir en phase 1) | Élevée × Fort | Plan phasé avec critères de sortie (§02) ; toute feature hors phase va au backlog, pas dans le sprint. |
| R7 | **Code UE5 non validé** tant qu'aucun poste UE5 n'a compilé le squelette | Certaine × Moyen | Tâche n°3 du backlog : première compilation = jalon explicite. Le code suit les API UE 5.5 stables et reste minimal ; les écarts attendus sont de l'ordre de l'ajustement, pas de la réécriture. |
| R8 | **Sauvegardes cassées** entre versions | Faible × Fort | Format versionné dès la v0.1 + migration par numéro ; tests roundtrip automatisés. |
| R9 | **Audio web** (autoplay) / saturation d'oscillateurs | Faible × Faible | Démarrage audio sur geste utilisateur (bouton JOUER) ; graphes audio permanents recyclés, pas d'allocation par son. |
| R10 | **Déterminisme procédural** perdu (ville qui change entre sessions) | Faible × Moyen | RNG seedé unique pour la génération ; toute évolution du générateur = bump de version de seed documenté. |

## 3. Plan de profiling permanent (brief §21/§23)

- **Web (actuel)** : panneau F1 (FPS, draw calls, triangles, effectifs par système, niveaux LOD) + smoke test CI (`node tools/smoke_test.mjs`) à chaque modification de système.
- **UE5 (phase 1 bis)** : Unreal Insights branché dès le premier bloc ; `stat unit/game/gpu` en HUD dev ; tests d'automatisation de performance (scénario de conduite enregistré, seuils sur frame time p95) ; revue de budget à chaque fin de phase avec captures `ProfileGPU`.
- **Règle d'or** : toute feature qui dépasse son budget est soit optimisée, soit dégradée en LOD, soit repoussée — jamais « on verra plus tard ».

## 4. Risques non techniques (à arbitrer par la production)

- **Assets** : une ville AAA = des milliers d'assets ; la réponse est la modularité (bibliothèques par quartier + PCG) et l'achat/licence éventuel de packs (Fab/Megascans) pour le mobilier secondaire.
- **Licences véhicules réels** : marques fictives obligatoires sans licences — prévu dès la conception (noms génériques : Citadine, Berline…).
- **Contenu sensible** (renverser des piétons) : ton non gore assumé (les PNJ esquivent/tombent et se relèvent) — à faire valider par la direction de jeu pour le rating visé.
