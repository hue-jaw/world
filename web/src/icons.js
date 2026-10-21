// ============================================================================
// METROPOLIS — icons.js
// Pont entre la bibliothèque Reicon (npm, hors-ligne) et le HUD/menus.
//
// Décision : on n'inline PAS les 2676 icônes. On importe uniquement celles
// utilisées (~20) et on les rend via `toSvg()` : la chaîne SVG est injectable
// dans n'importe quel innerHTML, sans dépendre du DOM au moment de l'import
// (donc testable sous Node). Le bundle final reste léger (~15 Ko d'icônes).
//
// Reicon est installé dans web/node_modules : aucune requête réseau, donc
// fonctionne hors-ligne et dans le fichier HTML autonome.
// ============================================================================
import { Settings } from '../node_modules/reicon/icons/Settings.js';
import { Sun } from '../node_modules/reicon/icons/Sun.js';
import { Moon } from '../node_modules/reicon/icons/Moon.js';
import { Cloud } from '../node_modules/reicon/icons/Cloud.js';
import { CloudRain } from '../node_modules/reicon/icons/CloudRain.js';
import { CloudStorm } from '../node_modules/reicon/icons/CloudStorm.js';
import { CloudFog } from '../node_modules/reicon/icons/CloudFog.js';
import { Gamepad2 } from '../node_modules/reicon/icons/Gamepad2.js';
import { Keyboard } from '../node_modules/reicon/icons/Keyboard.js';
import { Sliders } from '../node_modules/reicon/icons/Sliders.js';
import { Monitor } from '../node_modules/reicon/icons/Monitor.js';
import { Sparkles } from '../node_modules/reicon/icons/Sparkles.js';
import { Trophy } from '../node_modules/reicon/icons/Trophy.js';
import { Map } from '../node_modules/reicon/icons/Map.js';
import { Route } from '../node_modules/reicon/icons/Route.js';
import { Car } from '../node_modules/reicon/icons/Car.js';
import { Gauge } from '../node_modules/reicon/icons/Gauge.js';
import { VolumeHigh } from '../node_modules/reicon/icons/VolumeHigh.js';
import { VolumeX } from '../node_modules/reicon/icons/VolumeX.js';
import { Camera } from '../node_modules/reicon/icons/Camera.js';
import { Key } from '../node_modules/reicon/icons/Key.js';
import { Eye } from '../node_modules/reicon/icons/Eye.js';
import { Bug } from '../node_modules/reicon/icons/Bug.js';
import { X } from '../node_modules/reicon/icons/X.js';
import { Check } from '../node_modules/reicon/icons/Check.js';
import { Warning } from '../node_modules/reicon/icons/Warning.js';

const REG = {
  settings: Settings, sun: Sun, moon: Moon, cloud: Cloud, rain: CloudRain,
  storm: CloudStorm, fog: CloudFog, gamepad: Gamepad2, keyboard: Keyboard,
  sliders: Sliders, monitor: Monitor, sparkles: Sparkles, trophy: Trophy,
  map: Map, route: Route, car: Car, gauge: Gauge, volume: VolumeHigh,
  mute: VolumeX, camera: Camera, key: Key, eye: Eye, bug: Bug, close: X,
  check: Check, warning: Warning,
};

/**
 * Rend une icône Reicon en chaîne SVG inline.
 * @param {string} name clé du registre ci-dessus
 * @param {{size?:number, color?:string, weight?:'Outline'|'Filled'}} [opts]
 * @returns {string} balise <svg>…</svg> (chaîne vide si inconnue)
 */
export function icon(name, opts = {}) {
  const comp = REG[name];
  if (!comp) return '';
  try {
    const svg = comp.toSvg({ size: opts.size || 18, color: opts.color || 'currentColor', weight: opts.weight || 'Outline' });
    // toSvg renvoie une chaîne ; on la nettoie pour l'insertion
    return String(svg).replace(/\n\s*/g, '');
  } catch { return ''; }
}

export const iconNames = Object.keys(REG);
export default { icon, iconNames };
