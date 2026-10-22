// ============================================================================
// METROPOLIS — postfx.js
// Chaîne de post-traitement (v0.9).
//
// POURQUOI : jusqu'ici le rendu était « propre mais plat » — pas d'occlusion
// ambiante, pas de halo sur les sources lumineuses, pas de vraie profondeur
// atmosphérique. C'est précisément ce qui sépare une scène three.js correcte
// d'une image « Unity/Unreal » : les micro-ombres de contact (GTAO), le bloom
// des phares et enseignes, et l'étalonnage final.
//
// ARCHITECTURE : une seule classe, branchée ou non. Si le moindre étage échoue
// (pilote, extension absente, contexte perdu), on repasse au rendu direct sans
// jamais casser le jeu — c'est la règle du projet (§29) : jamais déclarer
// qu'une fonctionne est active si elle ne l'est pas.
//
// Équivalent UE5 : PostProcessVolume (GTAO + Bloom + Color Grading).
// ============================================================================
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/** Réglages par palier. `off` = rendu direct, exactement comme avant. */
export const POSTFX_LEVELS = {
  off:   { label: 'Désactivé',  ao: false, aoSamples: 0,  bloom: 0,    bloomRadius: 0 },
  low:   { label: 'Bas',        ao: false, aoSamples: 0,  bloom: 0.16, bloomRadius: 0.40 },
  medium:{ label: 'Moyen',      ao: true,  aoSamples: 8,  bloom: 0.20, bloomRadius: 0.50 },
  high:  { label: 'Haut',       ao: true,  aoSamples: 12, bloom: 0.24, bloomRadius: 0.60 },
  ultra: { label: 'Ultra',      ao: true,  aoSamples: 20, bloom: 0.30, bloomRadius: 0.70 },
};

export class PostFX {
  /**
   * @param {object} o { renderer, scene, camera, level }
   */
  constructor({ renderer, scene, camera, level = 'high' }) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.composer = null;
    this.gtao = null;
    this.bloom = null;
    this.enabled = false;
    this.failed = null;
    this.level = 'off';
    this._w = 1; this._h = 1;
    try {
      this.setLevel(level);
    } catch (e) {
      this._fail(e);
    }
  }

  _fail(e) {
    this.failed = e?.message || String(e);
    this.enabled = false;
    this.composer = null;
    this.gtao = null;
    this.bloom = null;
    // Un seul avertissement : inonder la console n'aide personne.
    if (typeof console !== 'undefined') console.warn('[postfx] repli rendu direct :', this.failed);
  }

  get active() { return !!this.enabled && !!this.composer; }

  /** (Re)construit la chaîne pour un palier donné. */
  setLevel(level) {
    const L = POSTFX_LEVELS[level] || POSTFX_LEVELS.high;
    this.level = POSTFX_LEVELS[level] ? level : 'high';
    if (!POSTFX_LEVELS[this.level] || L === POSTFX_LEVELS.off) {
      this.enabled = false;
      this.composer = null;
      return;
    }
    const { renderer, scene, camera } = this;
    if (!renderer || !scene || !camera) { this.enabled = false; return; }
    // Un objet qui « ressemble » à un renderer sans en être un (test, contexte
    // perdu, moteur alternatif) doit être refusé AVANT de construire des
    // cibles de rendu : sinon on obtient des erreurs différées au premier draw.
    const required = ['setRenderTarget', 'getRenderTarget', 'getDrawingBufferSize', 'render'];
    for (const k of required) {
      if (typeof renderer[k] !== 'function') {
        this._fail(new Error(`renderer sans ${k}()`));
        return;
      }
    }

    // Cible half-float + MSAA 4 : sans elle, le composer perd l'anti-aliasing
    // matériel et les reflets spéculaires crèvent au-dessus de 1,0 (clipping).
    const size = renderer.getDrawingBufferSize
      ? renderer.getDrawingBufferSize(new THREE.Vector2())
      : new THREE.Vector2(1280, 720);
    const w = Math.max(2, Math.floor(size.x)), h = Math.max(2, Math.floor(size.y));
    const rt = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      samples: 4,
      colorSpace: THREE.LinearSRGBColorSpace,
      depthBuffer: true,
      stencilBuffer: false,
    });

    const composer = new EffectComposer(renderer, rt);
    composer.setPixelRatio(renderer.getPixelRatio ? renderer.getPixelRatio() : 1);

    composer.addPass(new RenderPass(scene, camera));

    if (L.ao) {
      try {
        const gtao = new GTAOPass(scene, camera, w, h);
        gtao.output = GTAOPass.OUTPUT.Default;
        gtao.updateGtaoMaterial({
          radius: 0.42,          // rayon en mètres : contact net, pas de halo
          distanceExponent: 1.6,
          thickness: 1.2,
          scale: 1.0,
          samples: L.aoSamples,
          distanceFallOff: 1.0,
          screenSpaceRadius: false,
        });
        gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4, rings: 2, samples: 8 });
        composer.addPass(gtao);
        this.gtao = gtao;
      } catch (e) {
        console.warn('[postfx] GTAO indisponible :', e?.message);
        this.gtao = null;
      }
    } else {
      this.gtao = null;
    }

    if (L.bloom > 0) {
      try {
        // Seuil 0,95 : seuls les VRAIS hauts (soleil, phares, enseignes, néons)
        // débordent. Un seuil plus bas faisait briller tout le ciel et donnait
        // une image laiteuse — l'inverse du rendu cinéma recherché.
        const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), L.bloom, L.bloomRadius, 0.95);
        composer.addPass(bloom);
        this.bloom = bloom;
      } catch (e) {
        console.warn('[postfx] Bloom indisponible :', e?.message);
        this.bloom = null;
      }
    } else {
      this.bloom = null;
    }

    // OutputPass : tonemapping (ACES) + sRGB + dithering. C'est lui qui doit
    // convertir, pas le renderer, sinon l'image est exposée deux fois.
    composer.addPass(new OutputPass());

    this.composer = composer;
    this.enabled = true;
    this._w = w; this._h = h;
    this.setSize(w, h);
  }

  setSize(w, h) {
    if (!this.composer) { this._w = w; this._h = h; return; }
    const W = Math.max(2, Math.floor(w)), H = Math.max(2, Math.floor(h));
    this.composer.setSize(W, H);
    // L'occlusion ambiante est FLOUE par nature : la calculer à mi-résolution
    // divise son coût par 4 sans différence visible à l'écran. Le compositeur,
    // lui, reste à pleine résolution.
    if (this.gtao) {
      try { this.gtao.setSize(Math.max(2, W >> 1), Math.max(2, H >> 1)); } catch { /* ignoré */ }
    }
    this._w = W; this._h = H;
  }

  setPixelRatio(pr) {
    if (!this.composer) return;
    this.composer.setPixelRatio(pr);
    // setPixelRatio ne redimensionne pas les passes créées à la main.
    this.composer.setSize(this._w, this._h);
  }

  /** Rend une image. Retourne false si l'appel a échoué (repli direct). */
  render(dt = 1 / 60) {
    if (!this.active) return false;
    try {
      this.composer.render(dt);
      return true;
    } catch (e) {
      this._fail(e);
      return false;
    }
  }
}

export default PostFX;
