# 🌆 METROPOLIS — Open-world vivant

Un jeu open-world 3D en construction : une métropole fictive où le trafic, les piétons, la météo et l'heure forment un écosystème — pas un décor. Production par phases strictes : **vertical slice jouable d'abord**, extension ensuite.

## 🎮 Jouer tout de suite à la vertical slice

### Option 1 — double-clic, zéro installation *(le plus simple)*
Téléchargez **`METROPOLIS.html`** et **double-cliquez dessus**. Le jeu complet s'ouvre dans votre navigateur, hors-ligne, sans serveur. `F11` = plein écran. La sauvegarde est automatique.

> Ce fichier regroupe le jeu, les styles et Three.js en un seul document (563 Ko). Pour le régénérer : `npm run build` à la racine.

### Option 2 — exécutable Windows `.exe`
**[⬇ Télécharger METROPOLIS.exe](https://github.com/hue-jaw/world/releases/latest)** — portable, sans installation, sans droits administrateur, 100 % hors-ligne. Construit automatiquement par GitHub Actions à chaque mise à jour.
Pour le compiler soi-même : `cd desktop && npm install && npm run dist:win`. Détails : [`desktop/README.md`](desktop/README.md).

### Option 3 — mode développement (serveur local, itération rapide)
```bash
cd web
npm install            # une seule fois (three + esbuild)
npm start              # http://localhost:8000
```

**Contenu jouable :** personnage 3e personne **modélisé et animé** · 7 types de véhicules **modélisés** (roues qui tournent et braquent) · trafic IA qui respecte feux et voies · 44 PNJ **modélisés** avec routines quotidiennes · cycle jour/nuit complet · météo dynamique (pluie, orage, brouillard) aux effets gameplay réels · police avec poursuites et arrestations · missions de livraison chronométrées · minimap/boussole · sauvegarde automatique · audio 100 % procédural.

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
npm test        # 17 vérifs simulation + 103 vérifs modèles 3D
npm run build   # régénère METROPOLIS.html (fichier unique, double-cliquable)
```

## 🎨 Modèles 3D (CC0, embarqués)

Les personnages, véhicules et l'avatar du joueur sont de **vrais modèles 3D** depuis la v0.2, embarqués dans le bundle (aucun téléchargement au lancement) :

| Contenu | Source | Licence | Traitement |
|---|---|---|---|
| 7 véhicules (citadine, berline, SUV, sportive, taxi, utilitaire, police) | Kenney « Car Kit » | **CC0** | quantification, textures PNG 256 px, roues indexées |
| 5 citoyens + joueur | Quaternius « Ultimate Modular Men » | **CC0** | quantification, palette fusionnée, **animation procédurale du squelette** |

- Détails et fichiers : [`web/assets/LICENSES.md`](web/assets/LICENSES.md)
- Les modèles sont **normalisés au mètre** à l'exécution : longueur = physique du véhicule, pieds au sol, avant vers +Z.
- Les animations de marche/idle sont **calculées sur les os** (les packs CC0 n'en fournissent pas) : hanches en opposition de phase, genoux fléchis, bras le long du corps.
- Si un modèle manque, chaque système **retombe automatiquement** sur ses primitives : le jeu ne casse jamais.
- Pour ajouter un modèle : déposer le `.glb` dans `web/assets/models/`, l'associer dans `web/src/assets.js`, puis `npm run build`.

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
  assets/models   Modèles 3D CC0 (.glb) + LICENSES.md
/desktop          Coquille Electron → METROPOLIS.exe portable
/unreal           Projet Unreal Engine 5.5 (produit AAA cible)
/docs             Décisions · architecture · plan · risques & performance
/tools            Build fichier unique + tests automatisés headless
```

**Philosophie (non négociable) :** prototype fonctionnel > système complexe cassé · immersion > taille artificielle de carte · aucun système sans budget de performance ni test.
