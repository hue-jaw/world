// ============================================================================
// METROPOLIS — tools/dom_stub.mjs
// DOM minimal mais réaliste pour exécuter l'UI et les systèmes hors navigateur.
// Permet de tester l'INTÉGRATION (UI + économie + GPS + boucle) sans Chrome.
// ============================================================================
const gradStub = { addColorStop() {} };

export const ctx2dStub = new Proxy({}, {
  get: (_, p) => {
    if (p === 'createLinearGradient' || p === 'createRadialGradient' || p === 'createPattern') return () => gradStub;
    if (p === 'measureText') return () => ({ width: 10 });
    return () => undefined;
  },
  set: () => true,
});

class ClassList {
  constructor() { this.set = new Set(); }
  add(...c) { c.forEach((x) => this.set.add(x)); }
  remove(...c) { c.forEach((x) => this.set.delete(x)); }
  toggle(c, force) { const on = force ?? !this.set.has(c); on ? this.set.add(c) : this.set.delete(c); return on; }
  contains(c) { return this.set.has(c); }
}

export class FakeElement {
  constructor(tag = 'div', id = '') {
    this.tagName = tag.toUpperCase();
    this.id = id;
    this.children = [];
    this.style = {};
    this.classList = new ClassList();
    this.dataset = {};
    this.textContent = '';
    this.innerHTML = '';
    this.className = '';
    this.disabled = false;
    this.width = 190; this.height = 190;
    this._listeners = new Map();
  }
  appendChild(el) { this.children.push(el); return el; }
  remove() { this.removed = true; }
  append(...els) { els.forEach((e) => this.children.push(e)); }
  addEventListener(type, fn) { if (!this._listeners.has(type)) this._listeners.set(type, []); this._listeners.get(type).push(fn); }
  removeEventListener() {}
  getContext() { return ctx2dStub; }
  // Sélecteur minimal : "#id" renvoie un élément factice, ce qui suffit à
  // excercer la construction du menu headless (les vrais tests DOM restent
  // dans le navigateur). Les sélecteurs complexes renvoient null.
  querySelector(sel) {
    if (typeof sel === 'string' && sel.startsWith('#')) {
      if (!this._q || !this._q.has(sel)) {
        if (!this._q) this._q = new Map();
        this._q.set(sel, new FakeElement('div', sel.slice(1)));
      }
      return this._q.get(sel);
    }
    return null;
  }
  querySelectorAll() { return []; }
  setAttribute() {}
  getAttribute() { return null; }
  focus() {}
  click() { for (const fn of this._listeners.get('click') || []) fn({ target: this }); }
}

export function installDOM() {
  const byId = new Map();
  const doc = {
    createElement: (tag) => {
      const el = new FakeElement(tag);
      if (tag === 'canvas') { el.width = 256; el.height = 256; }
      return el;
    },
    getElementById: (id) => {
      if (!byId.has(id)) byId.set(id, new FakeElement('div', id));
      return byId.get(id);
    },
    // three.js (ImageLoader) crée ses <img> via createElementNS : sans cette
    // méthode, le chargement des GLB lève et le boot s'arrête. L'élément renvoyé
    // doit échouer comme `globalThis.Image` (asynchrone), sinon la promesse de
    // chargement de texture ne se résout jamais et le boot paraît figé.
    createElementNS: (ns, tag) => {
      const el = doc.createElement(tag);
      if (String(tag).toLowerCase() === 'img') {
        Object.defineProperty(el, 'src', {
          set() {
            // three.js utilise addEventListener('error'), pas seulement onerror :
            // si on n'appelle que la propriété, la promesse ne se règle jamais
            // et le chargement des modèles reste bloqué indéfiniment.
            setTimeout(() => {
              const ev = { type: 'error' };
              if (typeof el.onerror === 'function') el.onerror(ev);
              for (const fn of el._listeners.get('error') || []) fn(ev);
              for (const fn of el._listeners.get('load') || []) { /* pas de décodage */ }
            }, 0);
          },
          get() { return ''; },
        });
      }
      return el;
    },
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener() {},
    body: new FakeElement('body'),
  };
  globalThis.document = doc;
  globalThis.window = globalThis;
  globalThis.addEventListener = () => {};
  globalThis.removeEventListener = () => {};
  globalThis.innerWidth = 1280;
  globalThis.innerHeight = 720;
  globalThis.devicePixelRatio = 1;
  globalThis.self = globalThis;
  globalThis.Image = class { constructor() { this.onload = null; this.onerror = null; } set src(_v) { setTimeout(() => this.onerror && this.onerror(new Error('no image')), 0); } };
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  globalThis.performance = globalThis.performance || { now: () => Date.now() };
  return { byId, doc };
}
