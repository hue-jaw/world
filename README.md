# 🌆 METROPOLIS — Open-world vivant

Un jeu open-world 3D en construction : une métropole fictive où le trafic, les piétons, la météo et l'heure forment un écosystème — pas un décor. Production par phases strictes : **vertical slice jouable d'abord**, extension ensuite.

## 🎮 Jouer tout de suite à la vertical slice

### Option 1 — double-clic, zéro installation *(le plus simple)*
Téléchargez **`METROPOLIS.html`** et **double-cliquez dessus**. Le jeu complet s'ouvre dans votre navigateur, hors-ligne, sans serveur. `F11` = plein écran. La sauvegarde est automatique.

> Ce fichier regroupe le jeu, les styles et Three.js en un seul document (563 Ko). Pour le régénérer : `npm run build` à la racine.

### Option 2 — exécutable Windows `.exe`
`METROPOLIS.exe` (portable, sans installation) est **construit automatiquement par GitHub Actions** : onglet **Actions** → workflow *Build Windows EXE* → dernier run → **Artifacts** → `METROPOLIS-windows-x64`.
Pour le compiler soi-même : `cd desktop && npm install && npm run dist:win`. Détails : [`desktop/README.md`](desktop/README.md).

### Option 3 — mode développement (serveur local, itération rapide)
```bash
cd web
npm install            # une seule fois (three + esbuild)
npm start              # http://localhost:8000
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

## 🧪 Tests & build

```bash
npm test        # 17 vérifications headless (ville, trafic, PNJ, mission,
                # conduite, police, météo, jour/nuit, sauvegarde)
npm run build   # régénère METROPOLIS.html (fichier unique, double-cliquable)
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
METROPOLIS.html   Le jeu entier en un fichier, double-cliquable (généré)
/web              Sources de la vertical slice (modules ES + serveur de dev)
/desktop          Coquille Electron → METROPOLIS.exe portable
/unreal           Projet Unreal Engine 5.5 (produit AAA cible)
/docs             Décisions · architecture · plan · risques & performance
/tools            Build fichier unique + tests automatisés headless
```

**Philosophie (non négociable) :** prototype fonctionnel > système complexe cassé · immersion > taille artificielle de carte · aucun système sans budget de performance ni test.
