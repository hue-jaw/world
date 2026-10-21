// ============================================================================
// METROPOLIS — settings.js
// Réglages persistants (localStorage) et application CONCRÈTE au moteur :
//   - qualité des ombres (taille de shadow map + filtrage + distance)
//   - qualité de la lumière (intensité hémisphérique, portée, exposition)
//   - bonus (densité de trafic, de piétons, météo automatique, GPS)
//   - « mode RTX » : approximation assumée (PBR renforcé, reflets, ombres
//     douces). Ce n'est PAS du ray tracing matériel — voir docs/06.
//   - météo forcée, mode histoire / libre, sensibilités.
//
// Décision d'architecture : ce module ne touche jamais au DOM. Il expose un
// état et des fonctions `apply*()` que main.js/menu.js appellent. Cela le rend
// testable sous Node (aucun navigateur requis) et évite les dépendances
// circulaires.
// Équivalent UE5 : UGameUserSettings + Device Profiles + Scalability groups.
// ============================================================================
import * as THREE from 'three';
import { Bus, clamp } from './core.js';
import { setVehicleMaterialBoost } from './vehicles.js';

const KEY = 'metropolis_settings';
const VERSION = 1;

/** Presets de qualité : chaque niveau a un coût GPU identifiable. */
export const SHADOW_LEVELS = {
  off:    { label: 'Désactivées', mapSize: 0,    type: 'BasicShadowMap',   radius: 1, bias: -0.0006 },
  low:    { label: 'Basse',       mapSize: 512,  type: 'BasicShadowMap',   radius: 1, bias: -0.0012 },
  medium: { label: 'Moyenne',     mapSize: 1024, type: 'PCFShadowMap',     radius: 2, bias: -0.0009 },
  high:   { label: 'Haute',       mapSize: 1536, type: 'PCFSoftShadowMap', radius: 3, bias: -0.0006 },
  ultra:  { label: 'Ultra',       mapSize: 2048, type: 'PCFSoftShadowMap', radius: 4, bias: -0.0004 },
};

export const LIGHT_LEVELS = {
  low:    { label: 'Basse',   hemi: 0.55, sun: 2.0, exposure: 1.00, envInt: 0.55 },
  medium: { label: 'Moyenne', hemi: 0.70, sun: 2.2, exposure: 1.03, envInt: 0.80 },
  high:   { label: 'Haute',   hemi: 0.80, sun: 2.4, exposure: 1.06, envInt: 1.00 },
  ultra:  { label: 'Ultra',   hemi: 0.92, sun: 2.6, exposure: 1.09, envInt: 1.25 },
};

const DEFAULTS = {
  version: VERSION,
  mode: 'story',          // 'story' | 'free'
  shadows: 'high',
  lights: 'high',
  rtx: false,
  cinema: true,          // étalonnage + vignette (filtre CSS, coût nul)
  traffic: 1,             // multiplicateur de densité (0.5 → 1.6)
  peds: 1,
  autoWeather: true,
  weather: 'Clear',       // météo forcée quand autoWeather = false
  gpsArrows: true,
  camView: 'third',
  autoCam: true,
  mouseSens: 1,
  padSens: 1,
  deadzone: 0.18,
  rumble: true,
  showFps: false,
  invertY: false,
};

export class Settings {
  constructor() {
    this.state = { ...DEFAULTS };
    this.load();
  }

  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data?.version !== VERSION) return;
      // on ne copie que les clés connues : un fichier corrompu ne casse rien
      for (const k of Object.keys(DEFAULTS)) {
        if (data[k] !== undefined) this.state[k] = data[k];
      }
    } catch { /* stockage indisponible : réglages par défaut */ }
  }

  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.state)); } catch { /* noop */ }
  }

  get(key) { return this.state[key]; }

  /** Change un réglage, persiste et notifie (l'UI et le moteur écoutent). */
  set(key, value) {
    if (this.state[key] === value) return;
    this.state[key] = value;
    this.save();
    Bus.emit('settingsChanged', { key, value });
  }

  reset() {
    this.state = { ...DEFAULTS };
    this.save();
    Bus.emit('settingsChanged', { key: '*', value: null });
  }

  // ------------------------------------------------------------------------
  //                         APPLICATION AU MOTEUR
  // ------------------------------------------------------------------------
  /**
   * Applique les réglages graphiques réels au renderer et à l'environnement.
   * @param {object} ctx contexte du jeu (renderer, env, city, scene)
   */
  apply(ctx) {
    const { renderer, env, scene } = ctx;
    // Étalonnage : simple classe CSS, aucun shader à compiler.
    if (typeof document !== 'undefined' && document.body) {
      const app = document.getElementById('app');
      if (app) app.classList.toggle('cinema', this.state.cinema !== false);
    }
    const sh = SHADOW_LEVELS[this.state.shadows] || SHADOW_LEVELS.high;
    const li = LIGHT_LEVELS[this.state.lights] || LIGHT_LEVELS.high;

    if (renderer) {
      // -- ombres : taille de la shadow map + filtrage + portée de la caméra
      renderer.shadowMap.enabled = sh.mapSize > 0;
      // types THREE : 0 = Basic, 1 = PCF, 2 = PCFSoft, 3 = VSM
      const nextType = { BasicShadowMap: 0, PCFShadowMap: 1, PCFSoftShadowMap: 2 }[sh.type] ?? 2;
      const typeChanged = renderer.shadowMap.type !== nextType;
      renderer.shadowMap.type = nextType;
      // Changer le filtrage d'ombres invalide les programmes : sans ce
      // needsUpdate, three garde l'ancien shader et le réglage semble sans
      // effet (bug classique, invisible en test unitaire).
      if (typeChanged && scene) {
        scene.traverse((o) => {
          const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
          for (const m of mats) if (m) m.needsUpdate = true;
        });
      }
      if (env?.sun) {
        const s = env.sun;
        s.castShadow = sh.mapSize > 0;
        if (sh.mapSize > 0 && s.shadow.mapSize.x !== sh.mapSize) {
          s.shadow.mapSize.set(sh.mapSize, sh.mapSize);
          if (s.shadow.map) { s.shadow.map.dispose(); s.shadow.map = null; }
          s.shadow.radius = sh.radius;
          s.shadow.bias = sh.bias;
        }
        // portée : au-delà de 100 m les ombres ne sont pas perçues, autant
        // les payer moins cher (gain mesurable sur les scènes denses)
        const reach = this.state.shadows === 'ultra' ? 120 : 100;
        const sc = s.shadow.camera;
        if (sc.right !== reach) { sc.left = -reach; sc.right = reach; sc.top = reach; sc.bottom = -reach; sc.updateProjectionMatrix(); }
      }
      // -- lumière : intensités + exposition
      if (env?.hemi) env.hemi.intensity = li.hemi;
      if (env?.sun && !env._sunBase) env._sunBase = env.sun.intensity;
      if (env?.sun) env.sun.intensity = (env._sunBase || 2.4) * (li.sun / 2.4);
      if (renderer) renderer.toneMappingExposure = li.exposure;

      // -- mode RTX (approximation) : reflets + PBR renforcés, ombres douces
      const rtx = !!this.state.rtx;
      // les véhicules créés APRÈS le réglage doivent être cohérents
      setVehicleMaterialBoost((rtx ? 1.75 : 1) * li.envInt);
      if (scene) {
        scene.traverse((o) => {
          const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
          for (const m of mats) {
            if (!m || m.userData?._baseEnvInt !== undefined) {
              if (m && m.userData._baseEnvInt !== undefined) {
                m.envMapIntensity = m.userData._baseEnvInt * (rtx ? 1.75 : 1) * li.envInt;
              }
              continue;
            }
            m.userData._baseEnvInt = m.envMapIntensity ?? 1;
            m.envMapIntensity = m.userData._baseEnvInt * (rtx ? 1.75 : 1) * li.envInt;
            if (rtx && 'roughness' in m && m.roughness > 0.05) {
              // un rien plus lisse : les reflets du ciel deviennent lisibles
              m.userData._baseRough = m.roughness;
              m.roughness = Math.max(0.05, m.roughness * 0.9);
            } else if (!rtx && m.userData._baseRough !== undefined) {
              m.roughness = m.userData._baseRough;
            }
          }
        });
      }
    }
    Bus.emit('settingsApplied', this.state);
  }

  /** Applique météo + bonus de densité (appelé au démarrage et au changement). */
  applyWorld(ctx) {
    const { env, traffic, peds } = ctx;
    if (env) {
      env.autoWeather = !!this.state.autoWeather;
      if (!this.state.autoWeather && env.weatherName !== this.state.weather) {
        env.setWeather(this.state.weather, true);
      }
    }
    if (traffic) traffic.densityScale = clamp(this.state.traffic, 0.4, 1.8);
    if (peds) peds.densityScale = clamp(this.state.peds, 0, 1.8);
  }
}

export const DEFAULTS_SETTINGS = DEFAULTS;
export default Settings;
