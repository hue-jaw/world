# 🌆 METROPOLIS — Open-world vivant

Un jeu open-world 3D en construction : une métropole fictive où le trafic, les piétons, la météo et l'heure forment un écosystème — pas un décor. Production par phases strictes : **vertical slice jouable d'abord**, extension ensuite.

## 🎮 Jouer tout de suite à la vertical slice

La vertical slice v0.1 tourne dans un navigateur (Three.js), sans rien installer côté joueur :

```bash
cd web
npm install            # une seule fois (dépendance : three)
python3 -m http.server 8000 --bind 0.0.0.0
# puis ouvrir http://localhost:8000
```

**Contenu jouable :** personnage 3e personne · 7 types de véhicules conduisibles · trafic IA qui respecte feux et voies · 44 PNJ avec routines quotidiennes · cycle jour/nuit complet · météo dynamique (pluie, orage, brouillard) aux effets gameplay réels · police avec poursuites et arrestations · missions de livraison chronométrées · minimap/boussole · sauvegarde automatique · audio 100 % procédural.

| Touche | Action |
|---|---|
| `Z Q S D` / flèches | Se déplacer · conduire |
| Souris (glisser) · molette | Caméra · zoom |
| `F` | Entrer / sortir d'un véhicule |
| `Maj` · `Espace` | Sprint · saut / frein à main |
| `H` · `L` · `M` | Klaxon · phares · son |
| `T` · `G` · `F1` | +3 h · météo suivante · panneau debug |

## 🧪 Tests

```bash
node tools/smoke_test.mjs
# -> 17 vérifications : génération de ville, graphes de navigation,
#    900 frames de simulation trafic/PNJ, mission de bout en bout,
#    conduite, police, météo, jour/nuit, sauvegarde.
```

## 🏗️ Produit cible : Unreal Engine 5.5

`unreal/` contient le projet UE5.5 portant **la même architecture** (C++ : personnage TPS Enhanced Input, véhicule Chaos possédable, subsystems Trafic/Météo/Missions, interface d'interaction, sauvegarde versionnée, configs Lumen/Nanite). Guide de démarrage et checklist de validation : [`unreal/README.md`](unreal/README.md). ⚠️ À compiler sur un poste UE5.5 — voir l'avertissement en tête de ce guide.

## 📚 Documentation

| Document | Contenu |
|---|---|
| [`docs/00_DECISION_MOTEUR_ET_VISION.md`](docs/00_DECISION_MOTEUR_ET_VISION.md) | Choix UE5 vs Unity 6 (motivé critère par critère), vision, rôle du prototype web |
| [`docs/01_ARCHITECTURE.md`](docs/01_ARCHITECTURE.md) | Systèmes, dépendances, bus d'événements, LOD de simulation, data-driven, mapping web ↔ UE5 |
| [`docs/02_PLAN_DE_PRODUCTION.md`](docs/02_PLAN_DE_PRODUCTION.md) | Phases 1→5, critères de sortie, backlog immédiat |
| [`docs/03_RISQUES_ET_PERFORMANCE.md`](docs/03_RISQUES_ET_PERFORMANCE.md) | Budgets chiffrés par plateforme et par système, 10 risques majeurs et mitigations |

## 📁 Structure

```
/web      Vertical slice jouable (validation des systèmes, itération rapide)
/unreal   Projet Unreal Engine 5.5 (produit AAA)
/docs     Décisions · architecture · plan · risques & performance
/tools    Tests automatisés headless
```

**Philosophie (non négociable) :** prototype fonctionnel > système complexe cassé · immersion > taille artificielle de carte · aucun système sans budget de performance ni test.
