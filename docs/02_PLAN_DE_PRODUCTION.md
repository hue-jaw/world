# METROPOLIS — Plan de production par phases

> Règle de développement (brief §26) appliquée à chaque phase :
> analyser → architecturer → prototyper → **tester** → profiler → corriger → documenter.
> Aucune phase ne démarre avant que les critères de sortie de la précédente soient verts.

---

## PHASE 1 — Prototype / Vertical Slice ✅ **TERMINÉE (v0.1, piste web)**

Livré et testé automatiquement (17 vérifications, `tools/smoke_test.mjs`) :

- [x] Personnage TPS (marche, sprint, saut) + caméra contextuelle
- [x] Un quartier vivant : 7×7 blocs, 6 types de quartiers, 138 bâtiments, parc, station-service
- [x] 7 types de véhicules data-driven, physique arcade (bicyclette + grip), dégâts
- [x] Circulation IA : voies, feux tricolores respectés, suivi, arrêts piétons, heures de pointe
- [x] 44 PNJ à identité + routines journalières (domicile→travail→déjeuner→soir), réactions météo/accidents
- [x] Cycle jour/nuit complet (soleil, lune, étoiles, fenêtres et lampadaires la nuit)
- [x] Météo : dégagé/nuageux/pluie/orage+éclairs/brouillard, effets gameplay (grip, vitesses, parapluies)
- [x] Interaction générique : entrer/sortir de tout véhicule (dont vol = délit)
- [x] Police : wanted 3 niveaux, poursuites, interpellation, amendes
- [x] Mission data-driven : livraison chronométrée, récompenses, difficulté progressive
- [x] HUD + minimap + boussole + debug (FPS, draw calls, compteurs par système)
- [x] Sauvegarde versionnée avec reprise de partie
- [x] Audio procédural (moteur, pluie, sirène, ville, impacts)
- [x] Simulation 3 niveaux par distance + object pooling

**Critères de sortie :** jouable de bout en bout ✅ · 0 erreur console connue · tests auto verts ✅ · 60 fps visés sur machine moyenne (à confirmer par l'utilisateur dans le navigateur — le panneau debug F1 affiche FPS/draw calls en direct).

## PHASE 1 bis — **Portage UE5 de la slice** (prochaine étape, sur poste UE5.5)

Objectif : la même boucle de jeu dans Unreal, assets placeholder (cubes/capsules), avant tout contenu.

1. Ouvrir `unreal/Metropolis.uproject`, générer les fichiers, compiler le module (voir `unreal/README.md`).
2. Map `L_TestBlock` : 3×3 blocs en géométrie brosse + splines routières ZoneGraph.
3. `AMetropolisCharacter` (Enhanced Input) + possession d'`AMetropolisVehiclePawn` (Chaos).
4. `UTimeOfDayManager` + `UWeatherManager` pilotant SkyAtmosphere/Lumen.
5. 10 véhicules Mass Traffic + 20 piétons Mass sur le bloc test.
6. Rejouer **exactement** le scénario du smoke test web (mêmes assertions) en tests d'automatisation UE.

**Critères de sortie :** compilation propre, 60 fps sur le bloc test (GPU milieu de gamme), boucle marcher→conduire→livrer identique à la slice web.

## PHASE 2 — Ville

- World Partition : passer de 1 quartier à 9 districts streamés (center, commercial, résidentiel, banlieue, riche, défavorisé, industriel, port, rural) avec HLOD.
- Réseau routier complet : autoroutes surélevées, pont, tunnel ; parkings et véhicules garés persistants.
- Trafic Mass à l'échelle ville (≥ 300 véhicules simulés, représentation dégradée au loin).
- Bibliothèque de bâtiments modulaires par quartier (Nanite) + PCG pour mobilier urbain/végétation.
- **Sortie :** traversée complète de la carte sans chargement ni hitch > 50 ms ; budgets §03 respectés.

## PHASE 3 — Simulation

- Routines PNJ complètes (emplois du temps par métier, relations simples, besoins) sur Mass/StateTree.
- Services d'urgence complets : pompiers, ambulances, dépanneuses + **dispatch** d'événements (accidents, incendies simulés par zones).
- Événements dynamiques : travaux (fermetures de voies), pannes, manifestations, marchés — générés sous budget CPU strict.
- Météo saisonnière régionale + économie simple (prix carburant, salaires de missions).
- Intérieurs accessibles génériques (magasins, garage, commissariat, appartement joueur) en Data Layers.
- **Sortie :** 30 min de simulation autonome sans joueur = ville cohérente (pas de blocage de trafic permanent), mémoire stable.

## PHASE 4 — Gameplay

- Campagne de missions (livraison → taxi → courses → poursuites → interventions), progression et déblocages véhicules/propriétés.
- Activités : garages (customisation), stations-service (carburant), transports publics utilisables (bus/métro simplifiés), téléphone (missions à la demande).
- Véhicules étendus : motos (physique dédiée), bus articulés, camions-remorques ; dégâts déformants visuels.
- **Sortie :** boucle de progression complète testée par des joueurs externes ; télémétrie d'équilibrage branchée.

## PHASE 5 — Polish

- Animations (Motion Matching), audio MetaSounds spatialisés, VFX Niagara (pluie au sol, fumées, étincelles).
- Optimisation finale multi-plateforme (profils Scalability), accessibilité (remap, sous-titres), localisation.
- Certification consoles si visées. **Sortie :** budgets §03 tenus sur les 3 plateformes cibles, crash-free 99,5 % des sessions.

---

## Backlog immédiat (premières tâches concrètes, ordre strict)

| # | Tâche | Type | Validation |
|---|---|---|---|
| 1 | Tester la slice web dans le navigateur (FPS F1, conduite, mission, nuit, pluie) | QA manuelle | retour utilisateur |
| 2 | Équilibrer `VEHICLE_TYPES` / temps de mission d'après les retours | data | nouvelles valeurs dans `core.js` + smoke test vert |
| 3 | Sur poste UE5.5 : compiler `unreal/` et corriger les écarts d'API | portage | build `Development Editor` propre |
| 4 | `L_TestBlock` UE5 : ZoneGraph 3×3 + 1 Chaos Vehicle conduisible | portage | conduire un tour de bloc |
| 5 | Brancher les mêmes constantes d'équilibrage (depuis `core.js`) en Data Assets | data | parité de comportement web/UE5 |
| 6 | Décider de la cible matérielle min (GPU/CPU) → fige les budgets §03 | direction technique | doc §03 mis à jour |
