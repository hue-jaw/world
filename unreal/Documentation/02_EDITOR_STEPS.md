# 02 — Étapes qui EXIGENT l'éditeur Unreal

Chaque étape ci-dessous produit un fichier binaire (`.uasset`, `.umap`) qui ne
peut pas être écrit hors éditeur. Elles sont ordonnées : respecter la séquence,
sinon les références manquent.

## 1. Carte de démonstration

1. `File → New Level → Empty Level`.
2. Enregistrer sous `Content/Maps/L_DemoDistrict`.
3. `World Settings → World Partition → Enable World Partition` (cellules 25 600 cm).
4. Placer un `PlayerStart` et, dans `Project Settings → Maps & Modes`, vérifier
   `GameDefaultMap = L_DemoDistrict` et `Default GameMode = MetropolisGameMode`.

## 2. Matériau maître PBR

1. `Content/PolyHaven/Materials` → clic droit → `Material` → `M_Master_PBR`.
2. Paramètres à créer (noms exacts, lus par `polyhaven_import_ue.py` et
   `AWeatherVisualController`) :
   - `BaseColor` (Texture), `Normal` (Texture), `Roughness` (Texture),
     `AmbientOcclusion` (Texture), `ORM` (Texture) ;
   - Collection `MPC_Weather` → scalaires `Wetness`, `RainIntensity`,
     `NightFactor`, `WindStrength`.
3. Brancher : `Wetness` → interpolation de `Roughness` (0,85 sec → 0,12 mouillé)
   et de `Specular` ; ajouter une normal map de flaques mixée par `Wetness`.
4. Créer `MPC_Weather` (Content/PolyHaven/Materials/MPC_Weather) et le
   référencer dans le Blueprint météo.

## 3. Entrées (Enhanced Input)

Créer dans `Content/Input/` :

| Asset | Type | Touches |
|---|---|---|
| `IA_Move` | Axis2D | ZQSD / stick gauche |
| `IA_Look` | Axis2D | souris / stick droit |
| `IA_Jump` | Digital | A / croix bas |
| `IA_Sprint` | Digital | Maj / L3 |
| `IA_Interact` | Digital | E |
| `IA_Recenter` | Digital | R3 |
| `IA_View` | Digital | V |
| `IA_Throttle` | Axis1D | Z / gâchette droite |
| `IA_Steer` | Axis1D | Q,D / stick gauche |
| `IA_Brake` | Axis1D | S / gâchette gauche |
| `IA_Handbrake` | Digital | Espace |
| `IA_Camera` | Digital | C |
| `IA_ExitVehicle` | Digital | F |
| `IA_Save`, `IA_Load`, `IA_Pause`, `IA_HUD`, `IA_Time` | Digital | F5, F9, Échap, H, T |

Puis `IMC_Default` (piéton) et `IMC_Driving` (véhicule), et renseigner les
propriétés `*Action` / `*Context` des Blueprints enfants de
`AMetropolisCharacter`, `AMetropolisVehicle`, `AMetropolisPlayerController`.

## 4. Blueprints dérivés

| Blueprint | Parent C++ | Réglages clés |
|---|---|---|
| `BP_MetropolisCharacter` | `MetropolisCharacter` | mesh + anims, `DefaultContext = IMC_Default` |
| `BP_MetropolisVehicle` | `MetropolisVehicle` | mesh Chaos, roues, boîte, courbe de couple |
| `BP_MetropolisPC` | `MetropolisPlayerController` | les 6 actions globales |
| `BP_MetropolisGameMode` | `MetropolisGameMode` | `CharacterClass`, `DefaultVehicleClass` |
| `BP_MetropolisHUD` | `MetropolisHUD` | optionnel : version UMG |

### Véhicule Chaos — réglages qui comptent

- **Roues** : `WheelSetups` avec bones `Wheel_FL`, `Wheel_FR`, `Wheel_RL`, `Wheel_RR`,
  rayon **34 cm**, largeur 22 cm, `WheelClass = ChaosWheeledVehicleMovement_Wheel`.
- **Suspension** : course 12 cm, raideur 45 000, amortissement 3 200, hauteur de
  repos 22 cm (`SpringHeight` de la classe C++).
- **Masse** : 1 450 kg ; centre de gravité `Z = -18 cm` ; répartition 52/48.
- **Boîte** : 6 rapports, pont 3,7, régime max 6 500 tr/min.
- **Pneu** : `FChaosTireConfig` — c'est ici que `OnGripUpdated(GripFactor)` du
  Blueprint ajuste la courbe de frottement latéral quand il pleut
  (le C++ fournit la donnée, le pneu la consomme — voir commentaire dans
  `MetropolisVehicle.h`).

## 5. Météo Niagara

1. `Content/VFX/NS_Rain` : GPU emitter, 1 200 particules, spawn box 4 000 cm,
   vélocité -1 800 cm/s, taille 0,6 cm, matériau `M_RainStreak`.
   Paramètres utilisateur : `RainIntensity` (0-1), `WindStrength` (0-1).
2. `Content/VFX/NS_Splashes` : particules au sol, paramètre `SplashIntensity`.
3. `Content/VFX/NS_Exhaust` : fumée d'échappement (bonus).
4. `BP_WeatherRig` (parent `WeatherVisualController`) : assigner `RainEffect`
   et `SplashEffect`, `WeatherParameters = MPC_Weather`.
5. Placer `BP_WeatherRig` dans la carte.

## 6. Voirie du quartier

1. Placer des `StreetSurfaceActor` le long des routes (ou les générer en
   Blueprint depuis `URoadNetworkSubsystem::GetEdgePoint`).
2. Trottoir : `SurfaceType = Sidewalk`, hauteur 15 cm, biseau 14 cm.
3. Terre-plein : `Median` (16 cm) ou `Island` (18 cm).
4. Pour chaque surface : assigner `SurfacePhysicalMaterial = PM_Concrete` /
   `PM_Grass` (créés par `polyhaven_import_ue.py`).
5. **Ne jamais** remplacer le maillage par un cube : la géométrie chanfreinée
   est ce qui permet à la voiture de monter (exigence §11).

## 7. Navigation et PNJ

1. `Nav Mesh Bounds Volume` couvrant le quartier, recast à 2 cm d'inclinaison.
2. `BP_Pedestrian` (parent `Pedestrian`), mesh + anims marche/course,
   `UmbrellaMesh` = mesh de parapluie attaché à `hand_r`.
3. Un `BP_PedestrianSpawner` qui appelle `SetPatrolPoints` avec des points de
   trottoir (les arbres sont des obstacles physiques : les PNJ les contournent).

## 8. Poly Haven

Voir `05_POLYHAVEN.md` : télécharger hors éditeur, puis importer avec
`Scripts/polyhaven_import_ue.py` exécuté dans l'éditeur.

## 9. Cook

`Platforms → Windows → Package Project`. Vérifier dans le log que
`/Game/Maps/L_DemoDistrict` et `/Game/PolyHaven` sont cuits (déjà dans
`DefaultGame.ini`).
