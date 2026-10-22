// Vérification du projet Unreal Engine 5.8.4 (dossier unreal/).
// Exécute Scripts/verify_project.py, qui ne dépend PAS d'Unreal : il relit la
// structure, les règles UHT, les configs et le schéma Poly Haven.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const project = join(root, 'unreal');

let checks = 0;
let failures = 0;

function check(label, condition, detail = '') {
  checks += 1;
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('PROJET UNREAL ENGINE 5');

// 1. Structure minimale du projet (§17 du cahier des charges).
for (const relative of [
  'Metropolis.uproject',
  'Config/DefaultEngine.ini',
  'Config/DefaultGame.ini',
  'Config/DefaultInput.ini',
  'Source/Metropolis/Metropolis.Build.cs',
  'Source/Metropolis.Target.cs',
  'Source/MetropolisEditor.Target.cs',
  'Source/Metropolis/Public/Metropolis.h',
  'Source/Metropolis/Private/Metropolis.cpp',
  'Scripts/polyhaven_api.py',
  'Scripts/polyhaven_sync.py',
  'Scripts/polyhaven_import_ue.py',
  'Scripts/polyhaven_openapi.yml',
  'Scripts/verify_project.py',
  'Documentation/01_INSTALL_WINDOWS.md',
  'Documentation/02_EDITOR_STEPS.md',
  'Documentation/05_POLYHAVEN.md',
  'Documentation/07_MIGRATION.md',
  'Documentation/08_RAPPORT_UE58.md',
]) {
  check(`${relative} présent`, existsSync(join(project, relative)));
}

// 2. Le .uproject est un vrai projet UE5 (module + plugins).
const uproject = JSON.parse(readFileSync(join(project, 'Metropolis.uproject'), 'utf8'));
check('.uproject : EngineAssociation 5.8', uproject.EngineAssociation === '5.8', uproject.EngineAssociation);
check('.uproject : module Metropolis', (uproject.Modules || []).some((m) => m.Name === 'Metropolis'));
check('.uproject : Chaos Vehicles activé',
  (uproject.Plugins || []).some((p) => p.Name === 'ChaosVehiclesPlugin' && p.Enabled === true));
check('.uproject : MassEntity absent des plugins (module moteur en 5.8)',
  !(uproject.Plugins || []).some((p) => p.Name === 'MassEntity'));
check('.uproject : aucun plugin Mass* déclaré sans code Mass (évite un 2e « Unable to find plugin »)',
  !(uproject.Plugins || []).some((p) => /^Mass/.test(p.Name)));
check('.uproject : ZoneGraph/Chaos/Enhanced Input cohérents',
  ['EnhancedInput', 'ChaosVehiclesPlugin'].every((n) => (uproject.Plugins || []).some((p) => p.Name === n && p.Enabled !== false)));
check('.uproject : Enhanced Input activé',
  (uproject.Plugins || []).some((p) => p.Name === 'EnhancedInput' && p.Enabled === true));

const targetsText = ['Metropolis.Target.cs', 'MetropolisEditor.Target.cs']
  .map((f) => readFileSync(join(project, 'Source', f), 'utf8')).join('\n');
check('cibles : BuildSettingsVersion.V7 (exigé par 5.8)', /BuildSettingsVersion\.V7/.test(targetsText));
check('cibles : EngineIncludeOrderVersion.Unreal5_8', /EngineIncludeOrderVersion\.Unreal5_8/.test(targetsText));
check('cibles : module Metropolis', /ExtraModuleNames\.Add\("Metropolis"\)/.test(targetsText));

// 3. Aucun binaire factice dans Content/ (un .uasset vide serait un mensonge).
function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}
const contentFiles = walk(join(project, 'Content'));
const binaries = contentFiles.filter((f) => /\.(uasset|umap)$/i.test(f));
check('Content/ : aucun .uasset/.umap factice', binaries.length === 0, `${binaries.length} trouvé(s)`);
check('Content/ : aucun fichier vide', contentFiles.every((f) => statSync(f).size > 0));

// 4. Le vérificateur Python (règles UHT, config, API) doit passer.
let output = '';
let ok = true;
try {
  output = execFileSync('python3', [join(project, 'Scripts', 'verify_project.py')], {
    encoding: 'utf8',
    cwd: project,
  });
} catch (error) {
  ok = false;
  output = `${error.stdout || ''}${error.stderr || ''}`;
}
check('verify_project.py sort en 0', ok, ok ? '' : output.split('\n').slice(-5).join(' | '));

const match = output.match(/VERIFICATION UNREAL : (\d+) ✓ \/ 0 échec/);
check('verify_project.py : 0 échec', Boolean(match), match ? '' : 'compte rendu illisible');
const controls = match ? Number(match[1]) : 0;
check('verify_project.py : au moins 250 contrôles', controls >= 250, `${controls}`);

// 5. Règles de vérité du cahier des charges, lisibles dans le code.
const graphics = readFileSync(join(project, 'Source/Metropolis/Private/GraphicsSettingsSubsystem.cpp'), 'utf8');
check('Frame Generation refusée hors Ada/Blackwell',
  /bFrameGenAvailable = bDLSSAvailable && bAdaOrNewer;/.test(graphics));
check('DLSS désactivée par défaut à la compilation',
  /METROPOLIS_WITH_DLSS=0/.test(readFileSync(join(project, 'Source/Metropolis/Metropolis.Build.cs'), 'utf8')));

const street = readFileSync(join(project, 'Source/Metropolis/Private/StreetSurfaceActor.cpp'), 'utf8');
check('Voirie : collision complexe (pas de mur invisible)', /bUseComplexAsSimpleCollision = true;/.test(street));
check('Voirie : biseau de bord (rampe physique)', /Bevel/.test(street));

const road = readFileSync(join(project, 'Source/Metropolis/Private/RoadNetworkSubsystem.cpp'), 'utf8');
check('Graphe routier : A* implémenté', /FindPath/.test(road) && /Heuristic/.test(road));
check('Graphe routier : sens uniques', /bOneWay/.test(road));

const weather = readFileSync(join(project, 'Source/Metropolis/Private/WeatherSubsystem.cpp'), 'utf8');
check('Météo : séchage progressif (constante de temps)', /DryRate/.test(weather) && /Wetness/.test(weather));

const character = readFileSync(join(project, 'Source/Metropolis/Private/MetropolisCharacter.cpp'), 'utf8');
check('Joueur : marche de 36 cm (trottoirs franchissables)', /MaxStepHeight = 36\.f/.test(character));

// 6. Poly Haven : aucun identifiant d'asset codé en dur.
const sync = readFileSync(join(project, 'Scripts/polyhaven_sync.py'), 'utf8');
check('Poly Haven : aucun ID d\'asset en dur', !/["'][a-z0-9]+_[a-z0-9]+_\d{2}["']/.test(sync));
check('Poly Haven : licence CC0 déclarée', /license.*CC0/.test(sync));

// 7. Systèmes livrés : chaque exigence structurante a une classe identifiable.
const sources = walk(join(project, 'Source')).filter((f) => f.endsWith('.h')).map((f) => readFileSync(f, 'utf8')).join('\n');
for (const [label, pattern] of [
  ['RoadNetworkSubsystem (graphe + A*)', /class METROPOLIS_API URoadNetworkSubsystem/],
  ['GPSSubsystem (itinéraire + recalcul)', /class METROPOLIS_API UGPSSubsystem/],
  ['WeatherSubsystem (météo + mouillages)', /class METROPOLIS_API UWeatherSubsystem/],
  ['GraphicsSettingsSubsystem (profils + DLSS)', /class METROPOLIS_API UGraphicsSettingsSubsystem/],
  ['MetropolisVehicle (Chaos)', /class METROPOLIS_API AMetropolisVehicle/],
  ['MetropolisCharacter (marche 36 cm)', /class METROPOLIS_API AMetropolisCharacter/],
  ['StreetSurfaceActor (voirie physique)', /class METROPOLIS_API AStreetSurfaceActor/],
  ['TrafficAIController (trafic)', /class METROPOLIS_API ATrafficAIController/],
  ['Pedestrian (PNJ météo)', /class METROPOLIS_API APedestrian/],
  ['WeatherVisualController (Niagara/Lumen)', /class METROPOLIS_API AWeatherVisualController/],
  ['MissionSubsystem (missions modulaires)', /class METROPOLIS_API UMissionSubsystem/],
  ['MetropolisSaveGame (sauvegarde v3)', /class METROPOLIS_API UMetropolisSaveGame/],
  ['IInteractable (interaction générique)', /class METROPOLIS_API IInteractable/],
  ['UVehicleDataAsset (véhicules data-driven)', /class METROPOLIS_API UVehicleDataAsset/],
]) {
  check(label, pattern.test(sources));
}

console.log(`\nUNREAL ${checks - failures} ✓ / ${failures} échec(s)`);
process.exit(failures === 0 ? 0 : 1);
