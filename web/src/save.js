// ============================================================================
// METROPOLIS — save.js
// Sauvegarde versionnée (localStorage). Le numéro de version permet de faire
// évoluer le format sans casser les anciennes parties (brief §24).
// Équivalent UE5 : USaveGame sérialisé + migration par version.
// ============================================================================
const KEY = 'metropolis_save';
const VERSION = 1;

export const SaveSystem = {
  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (data.v !== VERSION) return null;   // format obsolète -> nouvelle partie
      return data;
    } catch { return null; }
  },
  save(state) {
    try {
      localStorage.setItem(KEY, JSON.stringify({ v: VERSION, savedAt: Date.now(), ...state }));
    } catch { /* stockage plein/refusé : on ignore silencieusement */ }
  },
  clear() { try { localStorage.removeItem(KEY); } catch { /* noop */ } },
};
