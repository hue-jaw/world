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
  querySelector() { return null; }
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
