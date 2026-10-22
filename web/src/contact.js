// ============================================================================
// METROPOLIS — contact.js
// Ombre de contact (blob shadow) partagée par tous les personnages et véhicules.
//
// POURQUOI : une ombre projetée par le soleil est directionnelle ; elle ne dit
// rien de la hauteur réelle d'un objet quand le soleil est haut. Une petite
// tache dégradée sous les pieds / sous la caisse « colle » l'objet au sol et
// donne immédiatement l'échelle. C'est l'un des détails les plus rentables
// d'un rendu réaliste (tous les jeux le font, souvent en shader).
//
// COÛT : une texture 128² générée une fois, un matériau partagé, un quad par
// objet. Aucune lumière, aucun shader personnalisé.
// ============================================================================
import * as THREE from 'three';

let _tex = null;
let _mat = null;

function ensure() {
  if (_mat) return true;
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return false;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext && c.getContext('2d');
  if (!g || typeof g.createRadialGradient !== 'function') return false;
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, 'rgba(0,0,0,0.62)');
  grad.addColorStop(0.5, 'rgba(0,0,0,0.30)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  _tex = new THREE.CanvasTexture(c);
  _mat = new THREE.MeshBasicMaterial({
    map: _tex, transparent: true, depthWrite: false,
    opacity: 0.85, toneMapped: false,
  });
  return true;
}

/**
 * Crée un quad horizontal dégradé, centré, posé 3,5 cm au-dessus du sol.
 * @param {number} w largeur (m)
 * @param {number} d profondeur (m)
 * @returns {THREE.Mesh|null} null hors navigateur (tests headless)
 */
export function contactShadow(w, d = w) {
  if (!ensure()) return null;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), _mat);
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.035;
  m.renderOrder = 1;
  return m;
}

/** Pour les tests : indique si la texture partagée a pu être créée. */
export function contactReady() { return !!_mat; }
