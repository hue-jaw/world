// ============================================================================
// METROPOLIS — menu.js
// Menu pause complet : Graphismes · Contrôles · Manette · Spécial (debug),
// plus le choix Histoire / Libre et la météo.
//
// Décision d'architecture : le menu ne contient AUCUNE logique de jeu. Il lit
// `settings` et `ctx`, écrit via `settings.set()`, et émet des intentions
// (`Bus`). Le moteur écoute. Cela évite le module « fourre-tout » et permet
// de tester les réglages sans DOM.
// Équivalent UE5 : UCommonUI + UGameUserSettings + Data Registry.
// ============================================================================
import { Bus } from './core.js';
import { icon } from './icons.js';
import { SHADOW_LEVELS, LIGHT_LEVELS } from './settings.js';

const WEATHERS = [
  { key: 'Clear', label: 'Dégagé', icon: 'sun' },
  { key: 'Cloudy', label: 'Nuageux', icon: 'cloud' },
  { key: 'Rain', label: 'Pluie', icon: 'rain' },
  { key: 'Storm', label: 'Orage', icon: 'storm' },
  { key: 'Fog', label: 'Brouillard', icon: 'fog' },
];

const TABS = [
  { id: 'graphics', label: 'Graphismes', icon: 'monitor' },
  { id: 'controls', label: 'Contrôles', icon: 'keyboard' },
  { id: 'gamepad', label: 'Manette', icon: 'gamepad' },
  { id: 'special', label: 'Spécial', icon: 'bug' },
];

export class MenuSystem {
  constructor(ctx, settings) {
    this.ctx = ctx;
    this.settings = settings;
    this.open = false;
    this.tab = 'graphics';
    this.root = null;
    this._build();
    Bus.on('settingsChanged', () => { if (this.open) this.render(); });
    Bus.on('settingsApplied', () => { if (this.open) this._syncRowStates(); });
  }

  // ------------------------------------------------------------------------
  _build() {
    const root = document.createElement('div');
    root.id = 'pause-menu';
    root.className = 'hidden';
    root.innerHTML = `
      <div class="pm-box" role="dialog" aria-label="Menu">
        <div class="pm-head">
          <span class="pm-logo">${icon('settings', { size: 20 })}<b>METROPOLIS</b><i>Réglages</i></span>
          <span class="pm-mode" id="pm-mode"></span>
          <button class="pm-close" id="pm-close" title="Reprendre (Échap)">${icon('close', { size: 16 })}</button>
        </div>
        <div class="pm-tabs" id="pm-tabs">
          ${TABS.map((t) => `<button data-tab="${t.id}">${icon(t.icon, { size: 15 })}<span>${t.label}</span></button>`).join('')}
        </div>
        <div class="pm-body" id="pm-body"></div>
        <div class="pm-foot">
          <span>${icon('check', { size: 13 })} Réglages sauvegardés automatiquement</span>
          <span><kbd>Échap</kbd> reprendre · <kbd>F1</kbd> debug</span>
        </div>
      </div>`;
    // ajouté au body (et non au HUD) pour rester au-dessus de tout
    document.body.appendChild(root);
    this.root = root;
    this.body = root.querySelector('#pm-body') || document.createElement('div');
    this.tabsEl = root.querySelector('#pm-tabs') || document.createElement('div');
    this.modeEl = root.querySelector('#pm-mode') || document.createElement('div');

    // NB : on tolère l'absence d'éléments (DOM partiel des tests headless) —
    // le menu ne doit jamais être la cause d'un crash au démarrage.
    root.querySelector('#pm-close')?.addEventListener('click', () => this.close());
    this.tabsEl.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-tab]');
      if (!b) return;
      this.tab = b.dataset.tab;
      this.render();
    });
    // clic sur une ligne « cycle » : on fait tourner la valeur
    this.body.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      this._act(btn.dataset.act, btn.dataset.value, btn);
    });
    // clavier : Échap ferme, flèches changent d'onglet
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') {
        if (this.open) { e.preventDefault(); this.close(); }
        else if (!this.ctx.ui?.shopOpen) { e.preventDefault(); this.show(); }
      }
      if (!this.open) return;
      if (e.code === 'ArrowRight' || e.code === 'ArrowLeft') {
        const i = TABS.findIndex((t) => t.id === this.tab);
        const d = e.code === 'ArrowRight' ? 1 : -1;
        this.tab = TABS[(i + d + TABS.length) % TABS.length].id;
        this.render();
      }
    });
  }

  // ------------------------------------------------------------------------
  show() {
    this.open = true;
    this.root.classList.remove('hidden');
    this.ctx.paused = true;
    this.render();
    this.ctx.audio?.click?.();
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.root.classList.add('hidden');
    this.ctx.paused = false;
    this.ctx.audio?.click?.();
  }

  toggle() { this.open ? this.close() : this.show(); }

  /** Reflète les états dans les boutons sans reconstruire le DOM. */
  _syncRowStates() {
    const s = this.settings.state;
    const modeEl = document.getElementById('pm-mode');
    if (modeEl) modeEl.innerHTML = s.mode === 'story'
      ? `${icon('trophy', { size: 14 })} Mode Histoire`
      : `${icon('map', { size: 14 })} Mode Libre`;
  }

  _act(act, value, btn) {
    const S = this.settings;
    const ctx = this.ctx;
    switch (act) {
      case 'mode':
        S.set('mode', value);
        this._applyMode();
        Bus.emit('toast', { text: value === 'story' ? '📖 Mode Histoire — missions et livraisons actives' : '🗺️ Mode Libre — explorez sans objectif imposé', kind: 'good' });
        break;
      case 'shadows': S.set('shadows', value); S.apply(ctx); break;
      case 'lights': S.set('lights', value); S.apply(ctx); break;
      case 'rtx': S.set('rtx', value === 'on'); S.apply(ctx); break;
      case 'traffic': S.set('traffic', Number(value)); S.applyWorld(ctx); break;
      case 'peds': S.set('peds', Number(value)); S.applyWorld(ctx); break;
      case 'autoWeather':
        S.set('autoWeather', value === 'on');
        S.set('weather', ctx.env.weatherName);
        S.applyWorld(ctx);
        if (value !== 'on') ctx.env.setWeather(ctx.env.weatherName, true);
        break;
      case 'weather':
        S.set('autoWeather', false);
        S.set('weather', value);
        ctx.env.autoWeather = false;
        ctx.env.setWeather(value, false);
        break;
      case 'gpsArrows': S.set('gpsArrows', value === 'on'); break;
      case 'autoCam': ctx.player.autoCam = value === 'on'; S.set('autoCam', value === 'on'); break;
      case 'camView':
        ctx.player.camMode = value;
        S.set('camView', value);
        break;
      case 'mouseSens': S.set('mouseSens', Number(value)); break;
      case 'invertY': S.set('invertY', value === 'on'); break;
      case 'deadzone': S.set('deadzone', Number(value)); ctx.player.gamepad.deadzone = Number(value); break;
      case 'padSens': S.set('padSens', Number(value)); break;
      case 'rumble': S.set('rumble', value === 'on'); break;
      case 'fps': S.set('showFps', value === 'on'); break;
      case 'reset': S.reset(); S.apply(ctx); S.applyWorld(ctx); break;
      // ---- Spécial ----
      case 'debug': ctx.ui?.toggleDebug?.(); break;
      case 'teleport':
        ctx.player.vehicle && ctx.traffic.playerLeaveVehicle(ctx.player.vehicle);
        ctx.player.vehicle = null; ctx.playerVehicle = null;
        ctx.player.pos.set(39.4, ctx.city.groundY(39.4, -104), -104);
        ctx.player._camPos.set(39.4, 6, -95);
        Bus.emit('toast', { text: '📍 Téléporté au garage', kind: '' });
        this.close();
        break;
      case 'money': ctx.economy.money += 10000; Bus.emit('toast', { text: '+10 000 $ (debug)', kind: 'good' }); break;
      case 'clearwanted': ctx.traffic.clearWanted(); ctx.audio.setSiren(0); break;
      case 'spawncar': {
        // une voiture d'essai réellement garée à côté du joueur (debug)
        const px = ctx.player.pos.x + 7, pz = ctx.player.pos.z;
        const c = ctx.city.collide(px, pz, 1.2);
        const v = ctx.traffic.spawnOwned({ type: 'Sportive', id: 'debug' }, c.x, c.z, ctx.player.heading, null);
        Bus.emit('toast', { text: '🏎️ Sportive d’essai garée à côté de vous', kind: 'good' });
        v && this.close();
        break;
      }
      case 'resetSave':
        try { localStorage.removeItem('metropolis_save'); } catch { /* noop */ }
        Bus.emit('toast', { text: '🗑️ Sauvegarde de partie effacée (rechargez pour repartir de zéro)', kind: 'bad' });
        break;
      case 'unlock':
        ctx.economy.money += 250000;
        Bus.emit('toast', { text: '💰 +250 000 $ — tout est achetable', kind: 'good' });
        break;
      case 'skipTime': ctx.env.advanceTime(3); break;
      default: break;
    }
    this.settings.save();
    this.render();
    if (btn) this.ctx.audio?.click?.();
  }

  /** Applique le mode Histoire / Libre aux systèmes. */
  _applyMode() {
    const free = this.settings.get('mode') === 'free';
    this.ctx.missions.enabled = !free;
    if (this.ctx.gps) {
      this.ctx.gps.locked = free;
      if (free) this.ctx.gps.route = [];
    }
  }

  // ------------------------------------------------------------------------
  //                              RENDU DES ONGLETS
  // ------------------------------------------------------------------------
  render() {
    if (!this.open) return;
    this._syncRowStates();
    for (const b of this.tabsEl.querySelectorAll('button')) {
      b.classList.toggle('active', b.dataset.tab === this.tab);
    }
    const s = this.settings.state;
    const row = (label, sub, control, hint) => `
      <div class="pm-row">
        <div class="pm-label"><b>${label}</b>${sub ? `<i>${sub}</i>` : ''}</div>
        <div class="pm-ctl">${control}</div>
      </div>${hint ? `<div class="pm-hint">${hint}</div>` : ''}`;
    const seg = (act, options, current) => `
      <div class="pm-seg">${options.map((o) => `
        <button data-act="${act}" data-value="${o.v}" class="${String(current) === String(o.v) ? 'on' : ''}">${o.t}</button>`).join('')}</div>`;

    if (this.tab === 'graphics') {
      this.body.innerHTML = `
        <div class="pm-section">${icon('trophy', { size: 15 })} Mode de jeu
          ${seg('mode', [{ v: 'story', t: 'Histoire' }, { v: 'free', t: 'Libre' }], s.mode)}
        </div>
        <div class="pm-hint">Histoire : livraisons, objectifs, progression. Libre : aucune contrainte, météo et heure à volonté.</div>

        <div class="pm-section">${icon('monitor', { size: 15 })} Qualité des ombres
          ${seg('shadows', Object.entries(SHADOW_LEVELS).map(([k, v]) => ({ v: k, t: v.label })), s.shadows)}
        </div>
        <div class="pm-hint">Ultra = shadow map 2048² + PCF doux. « Désactivées » supprime le coût des ombres (utile en 4K).</div>

        <div class="pm-section">${icon('sun', { size: 15 })} Qualité de la lumière
          ${seg('lights', Object.entries(LIGHT_LEVELS).map(([k, v]) => ({ v: k, t: v.label })), s.lights)}
        </div>
        <div class="pm-hint">Intensité du soleil et du ciel, exposition de la caméra et force des reflets d'environnement.</div>

        <div class="pm-section">${icon('sparkles', { size: 15 })} Mode RTX
          ${seg('rtx', [{ v: 'off', t: 'Désactivé' }, { v: 'on', t: 'Activé' }], s.rtx ? 'on' : 'off')}
        </div>
        <div class="pm-hint"><b>Honnêteté technique :</b> ce n'est pas du ray tracing matériel (impossible en WebGL sans extension).
        Le mode RTX renforce les reflets PBR du ciel sur les carrosseries et la chaussée, adoucit les ombres et relève l'exposition — un rendu plus « cinéma », pas de vrais rayons.</div>

        <div class="pm-section">${icon('cloud', { size: 15 })} Météo
          ${seg('autoWeather', [{ v: 'on', t: 'Automatique' }, { v: 'off', t: 'Forcée' }], s.autoWeather ? 'on' : 'off')}
        </div>
        <div class="pm-weather">${WEATHERS.map((w) => `
          <button data-act="weather" data-value="${w.key}" class="${!s.autoWeather && s.weather === w.key ? 'on' : ''}" title="${w.label}">
            ${icon(w.icon, { size: 18 })}<span>${w.label}</span></button>`).join('')}</div>
        <div class="pm-hint">Choisir une météo désactive l'automatique. La pluie réduit l'adhérence (×0,78) et change le comportement du trafic.</div>

        <div class="pm-section">${icon('sliders', { size: 15 })} Bonus de monde
          ${row('Densité de trafic', `${Math.round(s.traffic * 100)} %`, seg('traffic', [{ v: '0.6', t: 'Basse' }, { v: '1', t: 'Normale' }, { v: '1.5', t: 'Haute' }], String(s.traffic)))}
          ${row('Piétons', `${Math.round(s.peds * 100)} %`, seg('peds', [{ v: '0', t: 'Aucun' }, { v: '1', t: 'Normal' }, { v: '1.6', t: 'Dense' }], String(s.peds)))}
          ${row('Flèches GPS au sol', s.gpsArrows ? 'Activées' : 'Masquées', seg('gpsArrows', [{ v: 'on', t: 'Oui' }, { v: 'off', t: 'Non' }], s.gpsArrows ? 'on' : 'off'))}
        </div>`;
    } else if (this.tab === 'controls') {
      this.body.innerHTML = `
        <div class="pm-section">${icon('keyboard', { size: 15 })} Clavier / souris</div>
        <div class="pm-keys">
          <div><kbd>Z Q S D</kbd><span>Conduire · se déplacer</span></div>
          <div><kbd>Espace</kbd><span>Frein à main — drift</span></div>
          <div><kbd>Maj</kbd><span>Sprint à pied</span></div>
          <div><kbd>F</kbd><span>Entrer / sortir d'un véhicule</span></div>
          <div><kbd>V</kbd><span>Vue habitacle ↔ 3e personne</span></div>
          <div><kbd>C</kbd><span>Caméra automatique on/off</span></div>
          <div><kbd>R</kbd><span>Recentrer la caméra</span></div>
          <div><kbd>H</kbd><span>Klaxon</span></div>
          <div><kbd>B</kbd><span>Boutique / garage</span></div>
          <div><kbd>E</kbd><span>Toit des logements possédés</span></div>
          <div><kbd>T / G / L / M</kbd><span>Heure · météo · phares · son</span></div>
          <div><kbd>F1</kbd><span>Panneau de debug</span></div>
          <div><kbd>Échap</kbd><span>Ce menu</span></div>
        </div>
        <div class="pm-section">${icon('camera', { size: 15 })} Caméra</div>
        ${row('Vue en voiture', this.ctx.player.camMode === 'first' ? 'Habitacle' : '3e personne',
          seg('camView', [{ v: 'third', t: '3e personne' }, { v: 'first', t: 'Habitacle' }], this.ctx.player.camMode))}
        ${row('Caméra automatique', this.ctx.player.autoCam ? 'Activée' : 'Libre',
          seg('autoCam', [{ v: 'on', t: 'Oui' }, { v: 'off', t: 'Non' }], this.ctx.player.autoCam ? 'on' : 'off'))}
        ${row('Sensibilité souris', `×${(s.mouseSens ?? 1).toFixed(1)}`,
          seg('mouseSens', [{ v: '0.6', t: 'Basse' }, { v: '1', t: 'Normale' }, { v: '1.6', t: 'Haute' }], String(s.mouseSens ?? 1)))}
        ${row('Axe vertical', s.invertY ? 'Inversé' : 'Normal',
          seg('invertY', [{ v: 'off', t: 'Normal' }, { v: 'on', t: 'Inversé' }], s.invertY ? 'on' : 'off'))}`;
    } else if (this.tab === 'gamepad') {
      const gp = this.ctx.player?.gamepad;
      const connected = !!gp?.connected;
      this.body.innerHTML = `
        <div class="pm-section">${icon('gamepad', { size: 15 })} Manette ${connected ? '<em class="pm-ok">connectée</em>' : '<em class="pm-ko">non détectée</em>'}</div>
        <div class="pm-hint">${connected ? `Manette reconnue : <b>${gp.label()}</b>. Appuyez sur un bouton pour la réveiller après une mise en veille.` : 'Branchez une manette (Xbox / DualShock / DualSense) puis appuyez sur un bouton. Le jeu la détecte à chaud, sans rechargement.'}</div>
        <div class="pm-keys">
          <div><kbd>Stick G</kbd><span>Se déplacer · diriger</span></div>
          <div><kbd>Stick D</kbd><span>Caméra libre</span></div>
          <div><kbd>RT / LT</kbd><span>Accélérateur / frein</span></div>
          <div><kbd>A</kbd><span>Frein à main · saut</span></div>
          <div><kbd>X</kbd><span>Entrer / sortir du véhicule</span></div>
          <div><kbd>Y</kbd><span>Klaxon</span></div>
          <div><kbd>L3</kbd><span>Sprint (verrou, remplace RB)</span></div>
          <div><kbd>R3</kbd><span>Recentrer la caméra sur la voiture</span></div>
          <div><kbd>BACK</kbd><span>Vue habitacle ↔ 3e personne</span></div>
          <div><kbd>START</kbd><span>Panneau de debug</span></div>
          <div><kbd>D-Pad ↑</kbd><span>Ce menu</span></div>
        </div>
        ${row('Zone morte', `${Math.round((s.deadzone ?? 0.18) * 100)} %`,
          seg('deadzone', [{ v: '0.12', t: 'Basse' }, { v: '0.18', t: 'Normale' }, { v: '0.26', t: 'Haute' }], String(s.deadzone ?? 0.18)))}
        ${row('Sensibilité', `×${(s.padSens ?? 1).toFixed(1)}`,
          seg('padSens', [{ v: '0.7', t: 'Basse' }, { v: '1', t: 'Normale' }, { v: '1.5', t: 'Haute' }], String(s.padSens ?? 1)))}
        ${row('Vibrations', s.rumble ? 'Activées' : 'Coupées',
          seg('rumble', [{ v: 'on', t: 'Oui' }, { v: 'off', t: 'Non' }], s.rumble ? 'on' : 'off'))}`;
    } else {
      this.body.innerHTML = `
        <div class="pm-section">${icon('bug', { size: 15 })} Menu spécial (debug)</div>
        <div class="pm-hint">Outils de test. Ils n'affectent pas la sauvegarde sauf mention explicite.</div>
        <div class="pm-actions">
          <button data-act="debug">${icon('bug', { size: 14 })} Panneau de debug (F1)</button>
          <button data-act="fps">${icon('gauge', { size: 14 })} Compteur FPS ${s.showFps ? '· actif' : ''}</button>
          <button data-act="teleport">${icon('route', { size: 14 })} Aller au garage</button>
          <button data-act="spawncar">${icon('car', { size: 14 })} Sportive d'essai</button>
          <button data-act="clearwanted">${icon('eye', { size: 14 })} Effacer la recherche</button>
          <button data-act="skipTime">${icon('sun', { size: 14 })} +3 heures</button>
          <button data-act="money">${icon('trophy', { size: 14 })} +10 000 $</button>
          <button data-act="unlock">${icon('key', { size: 14 })} +250 000 $</button>
          <button data-act="resetSave" class="pm-danger">${icon('warning', { size: 14 })} Effacer la sauvegarde</button>
          <button data-act="reset">${icon('sliders', { size: 14 })} Réinitialiser les réglages</button>
        </div>
        <div class="pm-section">${icon('gauge', { size: 15 })} Diagnostic</div>
        <div class="pm-diag" id="pm-diag">—</div>
        <div class="pm-hint">Les valeurs sont rafraîchies à l'ouverture. Le nombre de chunks et de véhicules est la vraie mesure du moteur, pas une estimation.</div>`;
      this._fillDiag();
    }
  }

  _fillDiag() {
    const el = document.getElementById('pm-diag');
    if (!el) return;
    const { traffic, peds, city, gps } = this.ctx;
    const ts = traffic.stats();
    const ps = peds.stats ? peds.stats() : { total: 0, visible: 0 };
    el.innerHTML = `
      <div><span>Véhicules</span><b>${ts.total}</b></div>
      <div><span>dont IA</span><b>${ts.ai}</b></div>
      <div><span>Police</span><b>${ts.police}</b></div>
      <div><span>Recherche</span><b>${'★'.repeat(ts.wanted) || '—'}</b></div>
      <div><span>Piétons</span><b>${ps.visible}/${ps.total}</b></div>
      <div><span>Chunks ville</span><b>${city.chunks?.size ?? '—'}</b></div>
      <div><span>Nœuds GPS</span><b>${gps?.route?.length ?? 0}</b></div>`;
  }

  /** Appelé chaque frame par main.js : gère D-Pad ↑ et rafraîchit le diag. */
  update(dt, ctx) {
    const pad = ctx.player?.gamepad;
    // le joueur n'est pas mis à jour quand le menu est ouvert : c'est donc ici
    // qu'on lit la manette (sinon START ne pourrait jamais refermer le menu).
    pad?.poll?.();
    if (pad?.connected && (pad.pressed('UP') || pad.pressed('START')) && !this.ctx.ui?.shopOpen) this.toggle();
    if (this.open && this.tab === 'special') {
      this._diagT = (this._diagT || 0) + dt;
      if (this._diagT > 0.5) { this._diagT = 0; this._fillDiag(); }
    }
  }
}

export default MenuSystem;
