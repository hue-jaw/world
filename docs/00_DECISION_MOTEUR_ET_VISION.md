# METROPOLIS — Décision moteur & vision

> Statut : **décision prise** · Version du doc : 0.1 (vertical slice)
> Règle appliquée (brief §28) : **Décision → raison → implémentation → test.**

---

## 1. Décision définitive : **Unreal Engine 5.5** pour le produit AAA

| Critère | Unreal Engine 5.5 | Unity 6 | Impact pour METROPOLIS |
|---|---|---|---|
| Rendu réaliste (ville de nuit, pluie, reflets) | **Lumen** (GI dynamique) + Nanite + VSM | HDRP correct mais GI temps réel plus limitée | UE gagne : la ville nocturne/pluie est notre signature visuelle |
| Gros monde sans chargement | **World Partition** + HLOD + Data Layers natifs | Addressables + scènes additives (plus de travail maison) | UE gagne pour une métropole continue |
| Foule / trafic à grande échelle | **Mass Entity + ZoneGraph + Mass Traffic** conçus pour ça (Matrix Awakens) | DOTS puissant mais écosystème trafic à construire | UE gagne : notre cœur de simulation existe déjà |
| Véhicules | **Chaos Vehicles** intégré (suspensions, transmission) | PhysX + solutions tierces | UE gagne |
| Physique/destruction | Chaos (destruction, cloth, véhicules) | PhysX solide, destruction limitée | UE gagne |
| Audio procédural | MetaSounds | Audio Mixer + middleware | Égalité tendance UE |
| Courbe d'apprentissage / itération | C++ + Blueprints, builds plus lourds | C# plus accessible, itération rapide | Unity gagne pour petite équipe généraliste |
| Coût | 5 % au-delà de 1 M$ de revenus | Reedevance par siège (Runtime Fee abandonnée) | Comparable à notre échelle |
| Recrutement AAA open-world | Standard de l'industrie OW AAA | Plus mobile/indé | UE gagne |

**Décision →** Unreal Engine 5.5, C++ pour les systèmes, Blueprints pour le contenu/missions.
**Raison →** Les quatre piliers techniques du jeu (streaming de ville, foule/trafic Mass, véhicules Chaos, éclairage Lumen) sont des systèmes natifs UE5 éprouvés en production, là où Unity exigerait de les construire.
**Implémentation →** squelette de projet dans `unreal/` (voir `unreal/README.md`).
**Test →** à valider sur machine de dev : génération des fichiers projet, compilation du module, ouverture de la map de test (checklist dans `unreal/README.md`). ⚠️ **Non compilé dans l'environnement de l'agent** (pas d'UE5 ici) — aucun résultat de test n'est prétendu pour cette partie (brief §29).

## 2. Le rôle du prototype web (livré et testé aujourd'hui)

L'environnement de travail de l'agent ne contient ni UE5 ni Unity : impossible d'y compiler ou d'y exécuter le moindre binaire moteur. Plutôt que de livrer du code moteur non testé en prétendant le contraire, la production suit deux pistes **avec une seule architecture** :

| Piste | Contenu | État |
|---|---|---|
| `web/` — vertical slice Three.js | Tous les systèmes §5→§24 du brief implémentés à échelle réduite, **jouables dans un navigateur** | ✅ Écrit, testé automatiquement (`tools/smoke_test.mjs` : 17 vérifications), servi en Live Preview |
| `unreal/` — projet UE5.5 | Migration V3 complète : 21 classes C++ (graphe routier + A*, météo, profils graphiques, voirie physique, Chaos, trafic, PNJ, missions, sauvegarde), scripts Poly Haven, vérificateur | ✅ Écrit et vérifié statiquement (251 contrôles) · ⏳ **à compiler et compléter dans l'éditeur** |

Le prototype web sert de **bac à sable de game design** permanent : équilibrer le trafic, les routines PNJ, les missions et l'économie en 10 secondes d'itération, puis porter les paramètres et algorithmes validés dans UE5 (les algorithmes — graph de routes, BFS piétons, LOD de simulation, machine météo — sont indépendants du moteur).

## 3. Vision (rappel normatif)

- **METROPOLIS** : métropole fictive vécue comme un écosystème, pas un décor (brief §2).
- Piliers : **ville vivante** (routines, trafic, événements), **conduite libre** (véhicules variés, police), **monde réactif** (météo/heure qui changent le gameplay), **performance d'abord** (§21).
- Priorité §3 : *immersion > taille artificielle*. La carte grandit uniquement quand la densité de vie suit.
- La vertical slice actuelle couvre **un quartier** (≈450 m × 450 m, 7×7 blocs, 6 types de quartiers) avec la boucle complète : marcher → conduire → travailler (livraisons) → fuir la police, sous un ciel et une météo vivants.

## 4. Ce qui est délibérément hors scope de la slice v0.1

Intérieurs visitables, métro/trains/avions, multijoueur, économie complète, missions scénarisées à dialogues, véhicules à dégâts déformants. Chacun a sa phase dans `02_PLAN_DE_PRODUCTION.md` — rien n'est « oublié », tout est **séquencé** (brief §25).
