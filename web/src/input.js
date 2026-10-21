// ============================================================================
// METROPOLIS — input.js
// Couche d'entrée unifiée : clavier/souris + manettes (Xbox One/Series,
// DualShock 4, DualSense, Switch Pro, génériques « standard mapping »).
//
// Le clavier reste géré par Player (AZERTY/QWERTY via e.code) ; ce module
// ajoute les axes analogiques et les boutons de manette, avec :
//   - zone morte radiale (0.18) pour éviter les dérives de stick,
//   - détection des appuis (front montant) sans répétition,
//   - hot-plug (branchement/débranchement à chaud),
//   - retour haptique sur les chocs.
// ============================================================================
const DEAD = 0.18;

// Mapping « standard » du W3C : identique sur Xbox, PlayStation et Switch Pro.
const BTN = {
  A: 0, B: 1, X: 2, Y: 3,
  LB: 4, RB: 5, LT: 6, RT: 7,
  BACK: 8, START: 9, L3: 10, R3: 11,
  UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15,
  HOME: 16,
};

/** Zone morte radiale, réglable via le menu Manette (this.deadzone). */
const applyDead = (v, dead) => (Math.abs(v) < dead ? 0 : (v - Math.sign(v) * dead) / (1 - dead));

export class GamepadInput {
  constructor() {
    this.index = null;
    this.name = '';
    this.axes = [0, 0, 0, 0];
    this.buttons = new Array(17).fill(0);
    this._prev = new Array(17).fill(0);
    this._pressed = new Set();
    this.connected = false;
    this._listen();
  }

  _listen() {
    if (typeof window === 'undefined') return;
    window.addEventListener('gamepadconnected', (e) => {
      this.index = e.gamepad.index;
      this.name = e.gamepad.id;
      this.connected = true;
    });
    window.addEventListener('gamepaddisconnected', (e) => {
      if (e.gamepad.index === this.index) { this.connected = false; this.name = ''; this.index = null; }
    });
  }

  /** À appeler une fois par frame. */
  poll() {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return;
    const pads = navigator.getGamepads();
    let pad = this.index != null ? pads[this.index] : null;
    if (!pad) {
      // hot-plug : premier pad disponible
      for (const p of pads) if (p && p.connected) { pad = p; this.index = p.index; this.name = p.id; break; }
      if (!pad) {
        this.connected = false;
        this.axes = [0, 0, 0, 0];
        this.buttons.fill(0);
        return;
      }
    }
    this.connected = true; this.name = pad.id;
    const dz = this.deadzone ?? DEAD;
    this.axes[0] = applyDead(pad.axes[0] ?? 0, dz);
    this.axes[1] = applyDead(pad.axes[1] ?? 0, dz);
    this.axes[2] = applyDead(pad.axes[2] ?? 0, dz);
    this.axes[3] = applyDead(pad.axes[3] ?? 0, dz);
    this._pressed.clear();
    for (let i = 0; i < 17; i++) {
      const b = pad.buttons[i];
      const v = b ? (typeof b === 'number' ? b : (b.value ?? (b.pressed ? 1 : 0))) : 0;
      this.buttons[i] = v;
      if (v > 0.5 && this._prev[i] <= 0.5) this._pressed.add(i);
      this._prev[i] = v;
    }
  }

  down(btn) { return this.buttons[BTN[btn]] > 0.5; }
  value(btn) { return this.buttons[BTN[btn]] || 0; }
  pressed(btn) { return this._pressed.has(BTN[btn]); }

  /** Axe de déplacement (−1..1) : stick gauche, Y inversé (haut = avant). */
  get moveX() { return this.axes[0]; }
  get moveY() { return -this.axes[1]; }
  get lookX() { return this.axes[2]; }
  get lookY() { return -this.axes[3]; }

  /** Libellé court pour l'UI (console attendue / connectée). */
  label() {
    if (!this.connected) return 'Manette : non détectée';
    const n = this.name.toLowerCase();
    const fam = /dualsense|dualshock|playstation|sony/.test(n) ? 'PlayStation'
      : /xbox|xinput/.test(n) ? 'Xbox'
        : /switch|nintendo|pro controller/.test(n) ? 'Switch'
          : 'Manette';
    return `${fam} connectée`;
  }

  rumble(strength = 0.6, ms = 180) {
    if (this.index == null) return;
    const pad = navigator.getGamepads?.()[this.index];
    const act = pad?.vibrationActuator;
    if (!act?.playEffect) return;
    try {
      act.playEffect('dual-rumble', { duration: ms, strongMagnitude: strength, weakMagnitude: strength * 0.6 });
    } catch { /* actuateur non supporté : silencieux */ }
  }
}

export { BTN };
export default GamepadInput;
