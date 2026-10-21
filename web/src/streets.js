// ============================================================================
// METROPOLIS — streets.js
// Identité du réseau viaire : noms, classes (avenue / boulevard / rue),
// sens uniques, rues piétonnes. 100 % déterministe (hachage sur l'indice de
// la voie) : aucun appel au RNG global, donc la ville ne se décale pas quand
// on ajoute un bâtiment ailleurs.
//
// Décision : on ne stocke pas 258 objets « rue » avec tous leurs champs ; on
// génère à la demande à partir d'un hachage. Mémoire constante, et surtout
// aucune dépendance à l'ordre d'appel (source classique de bugs de
// reproductibilité dans une vraie prod procédurale).
// ============================================================================

/** Hachage entier déterministe (xorshift), indépendant de la plateforme. */
export function hash2(a, b = 0, salt = 0) {
  let h = (a | 0) * 374761393 + (b | 0) * 668265263 + (salt | 0) * 2147483647;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return (h >>> 0);
}

const AVENUES = [
  'Avenue Victor-Hugo', 'Avenue de la République', 'Avenue Jean-Jaurès',
  'Avenue des Champs', 'Avenue du Général-Leclerc', 'Avenue de Verdun',
  'Avenue de la Libération', 'Avenue du 8-Mai', 'Avenue Alsace-Lorraine',
  'Avenue du Maréchal-Foch', 'Avenue Pasteur', 'Avenue Gambetta',
  'Avenue de la Gare', 'Avenue Charles-de-Gaulle', 'Avenue de l’Europe',
  'Avenue des Tilleuls', 'Avenue du Parc', 'Avenue de la Forêt',
];
const BOULEVARDS = [
  'Boulevard Saint-Michel', 'Boulevard de la Villette', 'Boulevard Voltaire',
  'Boulevard Diderot', 'Boulevard Haussmann', 'Boulevard Beaumarchais',
  'Boulevard Richard-Lenoir', 'Boulevard Malesherbes', 'Boulevard Arago',
  'Boulevard de Belleville', 'Boulevard de Clichy', 'Boulevard Jourdan',
];
const RUES = [
  'Rue des Lilas', 'Rue du Marché', 'Rue de l’Église', 'Rue des Écoles',
  'Rue du Moulin', 'Rue de la Fontaine', 'Rue des Roses', 'Rue du Four',
  'Rue de la Paix', 'Rue du Commerce', 'Rue des Ateliers', 'Rue du Port',
  'Rue de la Poste', 'Rue des Vignes', 'Rue du Château', 'Rue des Tanneurs',
  'Rue de la Gare', 'Rue des Charpentiers', 'Rue du Puits', 'Rue des Halles',
  'Rue de la Croix', 'Rue Saint-Jean', 'Rue des Tanneurs', 'Rue du Théâtre',
  'Rue de la Bibliothèque', 'Rue des Jardins', 'Rue du Canal', 'Rue des Forges',
  'Rue de l’Horloge', 'Rue des Cordonniers', 'Rue du Bac', 'Rue de Seine',
  'Rue des Peupliers', 'Rue du Stade', 'Rue des Marronniers', 'Rue du Presbytère',
  'Rue de la Mairie', 'Rue des Carrières', 'Rue du Stade', 'Rue de Bretagne',
];

export const STREET_CLASSES = {
  avenue:    { label: 'Avenue',    halfWidth: 9.0, lanes: 4, median: true,  treeRows: true },
  boulevard: { label: 'Boulevard', halfWidth: 8.0, lanes: 4, median: true,  treeRows: true },
  rue:       { label: 'Rue',       halfWidth: 6.0, lanes: 2, median: false, treeRows: false },
  passage:   { label: 'Passage',   halfWidth: 4.0, lanes: 0, median: false, treeRows: false },
};

/**
 * Décrit une voie à partir de son indice.
 * @param {number} k      indice de ligne (0..MN)
 * @param {number} salt   sel (0 = axe X/E-O, 1 = axe Z/N-S)
 */
export function describeStreet(k, salt) {
  const hClass = hash2(k, 0, 11 + salt);
  const hName = hash2(k, 7, 23 + salt);
  const hOne = hash2(k, 3, 37 + salt);
  const hFlag = hash2(k, 5, 53 + salt);

  let klass;
  // Toutes les 8 voies = avenue structurante ; 1 sur 5 = boulevard.
  if (k % 8 === 0) klass = 'avenue';
  else if (hClass % 5 === 0) klass = 'boulevard';
  else klass = 'rue';

  // Rues piétonnes : rares, uniquement des rues simples (2 %).
  if (klass === 'rue' && hFlag % 100 < 2) klass = 'passage';

  const pool = klass === 'avenue' ? AVENUES : klass === 'boulevard' ? BOULEVARDS : RUES;
  const name = pool[hName % pool.length];

  // Sens unique : uniquement sur les rues simples (jamais sur un axe structurant).
  let oneWay = 0;
  if (klass === 'rue' && hOne % 100 < 38) oneWay = (hOne >> 8) & 1 ? 1 : -1;

  return { k, klass, name, oneWay, salt };
}

/**
 * Grille viaire complète : décrit les voies Est-Ouest (axe X, indexées par j)
 * et Nord-Sud (axe Z, indexées par i). `nameOf` accepte un indice et un axe.
 */
export class StreetGrid {
  constructor(MN, worldHalf, pitch) {
    this.MN = MN;
    this.half = worldHalf;
    this.pitch = pitch;
    this._cacheH = new Map();
    this._cacheV = new Map();
  }

  /** Voie Est-Ouest (le long de X) à l'indice j. */
  horizontal(j) {
    if (!this._cacheH.has(j)) this._cacheH.set(j, describeStreet(j, 0));
    return this._cacheH.get(j);
  }

  /** Voie Nord-Sud (le long de Z) à l'indice i. */
  vertical(i) {
    if (!this._cacheV.has(i)) this._cacheV.set(i, describeStreet(i, 1));
    return this._cacheV.get(i);
  }

  /** Indice de ligne le plus proche d'une coordonnée monde. */
  indexOf(coord) { return Math.round((coord + this.half) / this.pitch); }

  /**
   * Voie la plus proche d'un point, avec la distance perpendiculaire.
   * @returns {{street: object, axis: 'ew'|'ns', dist: number}}
   */
  nearest(x, z) {
    const i = this.indexOf(x), j = this.indexOf(z);
    const dx = Math.abs(x - (-this.half + i * this.pitch));
    const dz = Math.abs(z - (-this.half + j * this.pitch));
    if (dx <= dz) return { street: this.vertical(i), axis: 'ns', dist: dx, index: i };
    return { street: this.horizontal(j), axis: 'ew', dist: dz, index: j };
  }

  /** Nom affichable du lieu (rue la plus proche). */
  nameAt(x, z) {
    const n = this.nearest(x, z);
    const c = STREET_CLASSES[n.street.klass];
    return `${c.label} ${n.street.name.replace(/^(Avenue|Boulevard|Rue|Passage) /, '')}`;
  }

  /** Libellé court (pour le HUD quand les deux axes se croisent). */
  crossAt(x, z) {
    const i = this.indexOf(x), j = this.indexOf(z);
    const v = this.vertical(i), h = this.horizontal(j);
    const distX = Math.abs(x - (-this.half + i * this.pitch));
    const distZ = Math.abs(z - (-this.half + j * this.pitch));
    // sur une intersection : on affiche les deux
    if (distX < 12 && distZ < 12) {
      return { primary: `Croisement ${v.name} / ${h.name}`, secondary: '', both: true };
    }
    const s1 = distX < distZ ? v : h;
    const c = STREET_CLASSES[s1.klass];
    return { primary: `${{ avenue: 'Avenue', boulevard: 'Boulevard', rue: 'Rue', passage: 'Passage' }[s1.klass]} ${s1.name.replace(/^(Avenue|Boulevard|Rue|Passage) /, '')}`, secondary: s1.oneWay ? 'sens unique' : '', both: false };
  }
}

export default StreetGrid;
