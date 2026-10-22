# v0.9 — Rendu cinématique, ciel, matière, foule

> **Version** : 0.9.0 · **Branche** : `arena/ee922d41-world`
> Format : Décision → Raison → Implémentation → Test.

---

## 0. La demande

> « mets des graphismes, textures, formes d'objets, personnes etc. au max […]
> je veux que le jeu soit beau, on dirait un jeu Unity. Fais-le sur Unreal
> Engine s'il te plaît. »

Deux choses différentes sont demandées :

1. **que ce soit beau** — c'est un travail de rendu, et c'est faisable ;
2. **sur Unreal Engine** — c'est impossible *ici*, et je le redémontre en §1.

La v0.9 attaque donc le point 1 avec les quatre leviers qui font réellement la
différence à l'écran, dans cet ordre d'impact :
**post-traitement → ciel → matière/props → vie (foule, ombres)**.

---

## 1. Unreal : non, et ce n'est pas de la mauvaise volonté

| Contrainte | Conséquence |
|---|---|
| Aucun éditeur UE5 dans l'environnement | impossible de compiler, et surtout de **tester** ce qui serait livré |
| Assets Epic / Quixel / Meshy / Sketchfab inaccessibles (egress limité à GitHub + npm) | aucun modèle à importer : la scène serait vide |
| Build packagé UE = 3 à 8 Go, DX12 obligatoire | fin du « double-clic, 75 Mo, n'importe quel PC » |
| Règle §29 du projet | je ne déclare pas livré ce que je n'ai pas exécuté |

Ce n'est donc pas « WebGL ne peut pas être beau ». C'est : **je ne peux pas
vous donner un build UE que je n'aurais pas lancé une seule fois.**

La bonne nouvelle : les quatre défauts qui faisaient « amateur » n'étaient pas
le moteur. C'étaient l'absence d'occlusion ambiante, un ciel en aplat de
couleur, des rues vides de mobilier et des foules clonées. **Les quatre sont
corrigés ci-dessous.**

---

## 2. Post-traitement : GTAO + bloom + ACES

**Décision.** Chaîne de post-traitement `EffectComposer` activée par défaut
(palier « Haut »), désactivable dans *Réglages → Graphismes*.

**Raison.** Sans elle, un rendu three.js « propre » reste plat :

- aucune **occlusion ambiante** : les voitures et les personnages ne touchent
  pas le sol, les angles des façades ne sont jamais assombris ;
- aucun **bloom** : les phares, les enseignes et les lampadaires la nuit sont
  des taches pastel au lieu de sources lumineuses ;
- l'**ACES** n'était appliqué qu'en sortie directe, sans étalonnage cohérent.

**Implémentation** (`web/src/postfx.js`, 220 lignes) :

```
RenderPass ──► GTAOPass (mi-résolution) ──► UnrealBloomPass ──► OutputPass
               occlusion ambiante            seuil 0,95           ACES + sRGB
```

- **GTAO mi-résolution** : l'occlusion est floue par nature ; la calculer à
  50 % divise son coût par 4 sans différence visible.
- **Bloom à seuil 0,95** : seuls les vrais hauts débordent. Un seuil plus bas
  faisait briller tout le ciel et donnait une image laiteuse.
- **Cible half-float + MSAA 4** : sans elle, le compositeur perdait
  l'anti-aliasing matériel et les reflets spéculaires clippaient au-dessus de 1.
- **Repli garanti** : si un étage échoue (pilote, extension, contexte perdu),
  la chaîne se désactive, un message le dit au joueur, et le jeu repasse au
  rendu direct — **jamais d'écran noir**.

**Paliers** (menu *Graphismes → Post-traitement*) :

| Palier | GTAO | Bloom | Usage |
|---|---|---|---|
| Ultra | 20 échantillons | 0,30 | machine récente |
| Haut *(défaut)* | 12 | 0,24 | bon compromis |
| Moyen | 8 | 0,20 | portable |
| Bas | — | 0,16 | intégré graphique |
| Désactivé | — | — | 4K ou GPU faible |

**Test** : 7 vérifications (chaîne construite, passes présentes dans le bon
ordre, rendu sans exception, repli sur renderer invalide, pilotage par les
réglages).

---

## 3. Ciel : le plus gros « ça fait amateur » qui restait

**Avant.** `scene.background = new THREE.Color(0x6fb1e8)` : un mur bleu uni
derrière les immeubles. Plus 42 **boîtes** grises pour les nuages, visibles
comme des parallélépipèdes.

**Après.**

| Élément | v0.8 | v0.9 |
|---|---|---|
| Fond | couleur unie | **dôme shader** (dégradé zénith/horizon + bande de brume) |
| Soleil | disque plat | disque + **deux lobes de halo** (diffusion + cœur) |
| Nuages | 42 boîtes | **64 sprites** à texture douce, dérive lente, teinte selon la météo |
| Nuit | couleur sombre | dégradé propre + étoiles + lune conservées |

Le dôme suit le joueur (1 draw call, `depthWrite: false`, rendu en premier) et
reçoit l'heure, la météo et la couleur du soleil à chaque frame. Il inclut
`tonemapping_fragment` et `colorspace_fragment` : il est donc correct dans les
**deux** chemins (rendu direct et post-traitement), sans double exposition.

**Test** : 4 vérifications — le dôme existe (face arrière, pas d'écriture de
profondeur), les nuages sont des sprites texturés, le halo est additif, et
surtout : **la couleur du ciel et la direction du soleil changent avec l'heure**.

---

## 4. Matière et vie de la rue

### 4.1 Mobilier de trottoir (nouveau)

Ce qui manquait le plus à hauteur d'homme : la rue était un trottoir vide entre
deux bâtiments.

| Objet | Nombre généré | Collider |
|---|---|---|
| Poubelles | ~515 | oui (1,0 m) |
| Bornes d'incendie | ~193 | oui (0,9 m) |
| Bacs à fleurs | ~342 | oui (0,7 m) |
| Abribus (toit + paroi vitrée) | ~54 | oui (2,6 m) |

Tout est **instancié** : 8 `InstancedMesh` au total, pas 1 100 objets séparés.
Coût mesuré de la génération : **+23 ms** au chargement (327 → 350 ms).

Les bacs à fleurs à 0,70 m sont **franchissables** grâce à la marche de 0,36 m ?
Non — et c'est volontaire : 0,70 m est au-dessus de la marche. Ils bloquent,
comme un banc. Les terre-pleins (0,16 m) restent, eux, franchissables.

### 4.2 Toiture

Châteaux d'eau (11) et antennes (14) instanciés sur les immeubles de plus de
11 m. Deux volumes suffisent à donner une silhouette de skyline au lieu d'une
forêt de boîtes plates. Les balises d'antenne s'allument la nuit (matériau
émissif piloté par `setNightFactor`).

### 4.3 Habitacles

Les vitres sont translucides depuis la v0.8 : un habitacle vide se voyait **à
travers la carrosserie**, et la vue 1ʳᵉ personne donnait l'impression de flotter
devant un pare-brise.

Ajout par véhicule (≈150 triangles) : planche de bord, casquette de compteur,
console centrale, **volant** et colonne, deux sièges (assise + dossier +
appuie-tête), rétroviseur intérieur, levier de vitesses.

### 4.4 Ombres de contact

Une ombre projetée ne dit rien de la hauteur d'un objet quand le soleil est
haut. Une tache dégradée sous les pieds / sous la caisse « colle » l'objet au
sol. Module partagé `web/src/contact.js` (une texture 128², un matériau) :

- véhicules **et** moto,
- **44 PNJ**,
- **joueur**,
- compensation du rebond de marche pour que la tache reste au sol.

### 4.5 Foule

Les modèles CC0 partagent **une seule palette** : les 44 PNJ étaient des clones
exacts. `citizenTint(seq)` (fonction pure, exportée, testée) applique à chaque
copie une teinte proche du blanc (décalage chromatique doux) et une échelle de
±5 %. Les matériaux sont **clonés** par citoyen : aucune contamination croisée.

Garde-fou testé : sur 200 tirages, chaque canal reste entre 0,72 et 1,12 —
aucun PNJ vert fluo.

---

## 5. Ce qui reste reporté (et pourquoi)

| Report | Raison |
|---|---|
| Unreal Engine 5 | voir §1 |
| Nanite / Lumen / ray tracing matériel | hors de portée d'un WebGL2 ; le mode « RTX » reste une approximation PBR honnête |
| Modèles 3D achetés (Meshy, Sketchfab, Quixel) | hôtes inaccessibles depuis l'environnement de build |
| Textures 4K par asset | les textures procédurales sont déjà en 1024²/2048² ; monter à 4K coûterait 4× la mémoire pour un gain invisible à 2 m |
| Réflexions écran (SSR) | coût élevé, gain limité tant que la chaussée mouillée utilise déjà l'envMap |

---

## 6. Porte qualité

```
SMOKE 19 · FEATURES 42 · INTÉGRATION 15 · V0.4 25 · V0.5 20 · V0.6 20
V0.7 19 · V0.8 32 · V0.9 25 · ASSETS 112 · RENDU 7 · BUNDLE 5
────────────────────────────────────────────────────────────
341 vérifications · 0 échec
```

---

## 7. Où regarder en premier

1. **Lever du jour / coucher** (`T` pour avancer le temps) : le dégradé de ciel,
   le halo solaire et l'occlusion dans les angles des immeubles.
2. **La nuit** : phares, lampadaires et enseignes doivent **rayonner** (bloom),
   pas dessiner des taches.
3. **Sous une voiture** : l'ombre de contact — sans elle, elle flotte.
4. **Un trottoir d'avenue** : poubelles, bornes, bacs, abribus. C'est ce qui
   donne l'échelle.
5. **La foule** : deux passants ne doivent plus être des jumeaux.
