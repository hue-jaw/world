# v0.7 — GPS temps réel : l'itinéraire et les flèches suivent le joueur

## Le défaut

L'itinéraire était calculé **une seule fois**, au moment où la destination
changeait :

```js
if (this._dirty && this._timer <= 0) {   // _dirty = « la cible a changé »
  this.route = this._findPath(from, to);
}
```

Conséquences visibles :

1. Les chevrons et le ruban étaient posés sur les **nœuds de l'ancien tracé**.
   Ils ne bougeaient plus, même après un demi-tour ou une rue manquée.
2. Le tracé partait du nœud le plus proche **au moment du calcul** : en roulant,
   les flèches restaient loin derrière.
3. Rien n'indiquait la prochaine manœuvre ni le temps restant.

## Ce qui a changé

### 1. Une polyligne de guidage qui part du joueur

`gps.path` est reconstruite à chaque fois que le joueur s'est déplacé de 1,5 m :

```
joueur (position réelle) → raccord sur la route → nœuds restants → destination exacte
```

Les flèches, le ruban et la mini-carte lisent **tous** cette polyligne. Le
guidage ne peut donc plus être « ailleurs » que le joueur.

### 2. Détection de sortie de route et recalcul

Chaque frame, la position du joueur est projetée sur l'itinéraire
(`_project`, segments bornés). Trois déclencheurs de recalcul :

| Déclencheur | Condition | Effet |
|---|---|---|
| `target` | la destination change | immédiat (0 s) |
| `offroute` | écart > **20 m** depuis le dernier recalcul, et déplacement > 12 m | dans les 0,35 s |
| `heartbeat` | 2,5 s écoulées **et** 25 m parcourus | rafraîchissement |
| `empty` | itinéraire vide alors qu'une cible existe | dans les 0,35 s |

Deux garde-fous évitent les rafales : délai minimal de 0,35 s entre deux
recalculs, et **déplacement obligatoire de 12 m** (sans quoi un joueur arrêté
dans un parc, à 30 m de la route, recalculait indéfiniment le même trajet).

### 3. A* assez rapide pour du temps réel

Mesuré sur 129 × 129 nœuds : **0,62 ms** en moyenne pour un trajet de 2,3 km.
Le recalcul est donc synchrone, sans worker ni découpage par frame.

### 4. Guidage « prochaine manœuvre »

`_computeTurn()` parcourt l'itinéraire à partir de la projection et retourne le
premier virage de plus de 25° : distance, côté (gauche/droite/demi-tour) et nom
de la rue empruntée ensuite. S'y ajoutent la distance restante et un temps
estimé à partir de la vitesse réelle (plancher 1,4 m/s à pied).

### 5. HUD

Nouveau bandeau, mis à jour à 10 Hz :

```
⬅  Tournez à gauche · Rue des Tanneurs
   180 m   · 4 min   · 1,9 km restants
```

Il affiche `recalcul…` pendant 0,9 s après un recalcul, et `📍 Vous êtes arrivé`
à moins de 14 m de la destination (les flèches et le ruban s'éteignent alors).

### 6. Mini-carte

`routePoints()` renvoie désormais la polyligne **depuis la position du joueur** :
la ligne bleue sort du triangle blanc (le joueur), au lieu de passer à côté.

## Mesures (tools/test_v07.mjs — 19 contrôles)

```
— 1. Itinéraire —
  ✓ une destination produit un itinéraire et un tracé
  ✓ le tracé démarre sous les pieds du joueur
  ✓ le tracé se termine sur la destination exacte
— 2. Coût du recalcul —
  · A* moyen : 0,62 ms pour 129×129 nœuds
  ✓ A* tient dans un budget temps réel
— 3. Guidage solidaire du joueur —
  ✓ avancer sur l'itinéraire raccourcit la distance restante
  ✓ le joueur est toujours à moins de 3 m du tracé quand il le suit
— 4. Recalcul temps réel —
  ✓ sortir de l'itinéraire déclenche un recalcul
  ✓ le recalcul est limité en fréquence (pas de rafale)
  ✓ aucune valeur NaN dans le tracé ni dans les flèches
— 5. Flèches au sol —
  ✓ des flèches sont posées devant le joueur
  ✓ aucune flèche derrière le joueur
  ✓ toutes les flèches restent dans la portée de 900 m
  ✓ le ruban bleu est construit et commence au joueur
— 6. Guidage et HUD —
  ✓ le guidage donne une manœuvre, une distance et un temps
  ✓ la mini-carte part de la position du joueur
  ✓ le bandeau HUD affiche la manœuvre et la distance
— 7. Arrivée —
  ✓ arriver stoppe le guidage et l'annonce
  ✓ clear() efface tout
  ✓ changer de destination recalcule immédiatement
```

### Simulation de conduite (90 s, 2,3 km)

```
t(s)  reste   flèches  recalc  écart   manœuvre
   5   3147 m     74      5    0.0   ⬅ Tournez à gauche · Rue des Tanneurs
  23   2752 m     79     19    1.3   ⬅ Tournez à gauche · Boulevard de Clichy
  47   2197 m     75     38    1.3   ➡ Tournez à droite · Avenue de la Forêt
  89   1213 m     78     70    0.7   ➡ Tournez à droite · Avenue Charles-de-Gaulle
```

Écart au tracé toujours ≤ 1,3 m en suivant les flèches, distance restante
strictement décroissante. (Les 70 recalculs viennent du harnais, qui appelle
`update()` deux fois par frame ; en jeu c'est un toutes les 2,5 s.)

### Route manquée

```
hors-route 260 m : recalculs = 1 · écart au tracé = 0,0 m · reste 971 m
```

## Deux bugs trouvés par les tests pendant l'écriture

1. **Segments de longueur nulle.** Quand le joueur est pile sur un nœud, la
   projection donne `t = 1` sur le segment précédent : le premier point du
   tracé et le nœud suivant étaient identiques → direction `NaN` dans les
   flèches. Corrigé par une déduplication (< 1 m) dans `_buildPath()`.
2. **Arrivée jamais détectée.** À moins de 45 m de la cible, le tracé
   « repartait » vers l'intersection la plus proche puis revenait : 74 m
   restants alors que le joueur était sur place. Corrigé : sous 80 m de la
   destination, le tracé va directement au point visé.

## Limites

- Le recalcul suit le **réseau routier** ; un joueur à pied dans un parc est
  guidé vers la rue la plus proche, ce qui est le comportement attendu d'un GPS.
- Pas de reroutage « temps réel » lié au trafic (embouteillages dynamiques) :
  l'IA ne bloque pas la route assez longtemps pour que ce soit utile.
- Aucun GPU ici : la géométrie et les valeurs sont testées, pas l'aspect final.
