// ============================================================================
// METROPOLIS — ui.js
// HUD minimaliste : horloge/météo, boussole, statut, objectif, minimap
// temps réel, compteur, prompts, notifications, debug. (UE5 : UMG + CommonUI)
// ============================================================================
import { Bus, clamp, WEATHER_STATES } from './core.js';
import { WORLD_HALF } from './city.js';

const $ = (id) => document.getElementById(id);

export class UI {
  constructor(callbacks) {
    this.cb = callbacks;
    this.els = {
      hud: $('hud'), clock: $('clock-time'), weather: $('clock-weather'),
      money: $('hud-money'), wanted: $('hud-wanted'), deliveries: $('hud-deliveries'),
      objective: $('objective'), objTitle: $('objective-title'), objDist: $('objective-dist'), objTimer: $('objective-timer'),
      speedo: $('speedo'), speedVal: $('speedo-value'), gear: $('speedo-gear'),
      prompt: $('prompt'), promptText: $('prompt-text'),
      toasts: $('toasts'), debug: $('debug-panel'),
      compass: $('compass-inner'), busted: $('busted'), bustedSub: $('busted-sub'),
    };
    this.mini = $('minimap').getContext('2d');
    this._lastClock = ''; this._miniT = 0; this._promptText = undefined;
    this.debugVisible = false;

    // boussole : repères cardinaux + marqueur objectif
    this.compassItems = [];
    const names = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SO', 270: 'O', 315: 'NO' };
    for (let d = 0; d < 360; d += 15) {
      const s = document.createElement('span');
      s.textContent = names[d] || '·';
      if (names[d]) s.style.fontWeight = '800';
      this.els.compass.appendChild(s);
      this.compassItems.push({ el: s, deg: d });
    }
    this.objMark = document.createElement('span');
    this.objMark.textContent = '◆'; this.objMark.className = 'obj';
    this.els.compass.appendChild(this.objMark);

    Bus.on('toast', ({ text, kind }) => this.toast(text, kind));

    // barre d'outils
    document.querySelectorAll('#toolbar [data-weather]').forEach((b) =>
      b.addEventListener('click', () => this.cb.onWeather(b.dataset.weather)));
    $('tb-time').addEventListener('click', () => this.cb.onTimeSkip());
    $('tb-speed').addEventListener('click', (e) => { e.target.textContent = '⏩ ×' + this.cb.onTimeScale(); });
    $('tb-sound').addEventListener('click', (e) => { e.target.textContent = this.cb.onSound() ? '🔇' : '🔊'; });
    $('tb-debug').addEventListener('click', () => this.toggleDebug());
  }

  toast(text, kind = '') {
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.textContent = text;
    this.els.toasts.appendChild(el);
    while (this.els.toasts.children.length > 3) this.els.toasts.firstChild.remove();
    setTimeout(() => el.classList.add('out'), 3000);
    setTimeout(() => el.remove(), 3450);
  }
  setPrompt(text) {
    if (text === this._promptText) return;
    this._promptText = text;
    if (text) { this.els.promptText.textContent = text; this.els.prompt.classList.remove('hidden'); }
    else this.els.prompt.classList.add('hidden');
  }
  toggleDebug() {
    this.debugVisible = !this.debugVisible;
    this.els.debug.classList.toggle('hidden', !this.debugVisible);
  }
  setDebug(text) { if (this.debugVisible) this.els.debug.textContent = text; }
  showBusted(fine) {
    this.els.bustedSub.textContent = fine > 0 ? `Amende : $${fine}` : 'Vous repartez libre… cette fois.';
    this.els.busted.classList.remove('hidden');
    setTimeout(() => this.els.busted.classList.add('hidden'), 2300);
  }

  update(dt, ctx) {
    const env = ctx.env;
    // horloge (ne touche le DOM que si la minute change)
    const t = env.formatHour();
    if (t !== this._lastClock) {
      this._lastClock = t;
      this.els.clock.textContent = t;
      this.els.weather.textContent = WEATHER_STATES[env.weatherName].label;
      document.querySelectorAll('#toolbar [data-weather]').forEach((b) =>
        b.classList.toggle('active', b.dataset.weather === env.weatherName));
    }
    this.els.money.textContent = '$ ' + Math.round(ctx.money).toLocaleString('fr-FR');
    const w = ctx.traffic.wanted;
    this.els.wanted.textContent = '★★★'.slice(0, w) + '☆☆☆'.slice(0, 3 - w);
    this.els.deliveries.textContent = `📦 ${ctx.missions.deliveries} livraison${ctx.missions.deliveries > 1 ? 's' : ''}`;

    // objectif
    const obj = ctx.missions.objectiveInfo(ctx);
    if (obj) {
      this.els.objective.classList.remove('hidden');
      this.els.objTitle.textContent = obj.title;
      this.els.objDist.textContent = obj.dist >= 1000 ? (obj.dist / 1000).toFixed(2) + ' km' : Math.round(obj.dist) + ' m';
      this.els.objTimer.textContent = obj.timeLeft !== null ? `⏱ ${Math.max(0, Math.ceil(obj.timeLeft))} s` : '';
      this.els.objTimer.classList.toggle('urgent', !!obj.urgent);
    } else this.els.objective.classList.add('hidden');

    // compteur
    const pv = ctx.playerVehicle;
    if (pv) {
      this.els.speedo.classList.remove('hidden');
      this.els.speedVal.textContent = Math.round(pv.speedKmh());
      this.els.gear.textContent = pv.vf < -0.4 ? 'R' : 'D';
    } else this.els.speedo.classList.add('hidden');

    this._updateCompass(ctx, obj);
    this._miniT -= dt;
    if (this._miniT <= 0) { this._miniT = 0.1; this._drawMinimap(ctx, obj); }
  }

  _bearing(vx, vz) { return ((Math.atan2(vx, -vz) * 180 / Math.PI) + 360) % 360; }
  _updateCompass(ctx, obj) {
    const camYaw = ctx.player.camYaw;
    const view = this._bearing(-Math.sin(camYaw), -Math.cos(camYaw));
    const pxPerDeg = 170 / 55;
    for (const it of this.compassItems) {
      let rel = it.deg - view;
      if (rel > 180) rel -= 360; if (rel < -180) rel += 360;
      if (Math.abs(rel) > 58) { it.el.style.display = 'none'; continue; }
      it.el.style.display = '';
      it.el.style.left = (170 + rel * pxPerDeg) + 'px';
      it.el.style.opacity = String(1 - Math.abs(rel) / 70);
    }
    if (obj) {
      const pp = ctx.playerPos();
      const b = this._bearing(obj.pos.x - pp.x, obj.pos.z - pp.z);
      let rel = b - view;
      if (rel > 180) rel -= 360; if (rel < -180) rel += 360;
      rel = clamp(rel, -56, 56);
      this.objMark.style.display = '';
      this.objMark.style.left = (170 + rel * pxPerDeg) + 'px';
      this.objMark.className = obj.phase === 'deliver' ? 'obj obj-drop' : 'obj';
    } else this.objMark.style.display = 'none';
  }

  _drawMinimap(ctx, obj) {
    const g = this.mini, S = 190, C = S / 2;
    const world = WORLD_HALF + 36;
    const sc = S / (world * 2);
    const X = (x) => C + x * sc, Z = (z) => C + z * sc;
    g.fillStyle = '#232a33'; g.fillRect(0, 0, S, S);                 // routes
    // blocs
    const N = 7, P = 64, PL = 46;
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const cx = (i - (N - 1) / 2) * P, cz = (j - (N - 1) / 2) * P;
      const isPark = (i === 2 && j === 4) || (i === 5 && j === 5);
      g.fillStyle = isPark ? '#2e5631' : '#39434f';
      g.fillRect(X(cx - PL / 2), Z(cz - PL / 2), PL * sc, PL * sc);
    }
    // véhicules du trafic proches
    const pp = ctx.playerPos();
    g.fillStyle = 'rgba(210,220,235,0.75)';
    for (const v of ctx.traffic.vehicles) {
      if (!v.active || v === ctx.playerVehicle || v.spec.police) continue;
      if (Math.abs(v.pos.x - pp.x) > 150 || Math.abs(v.pos.z - pp.z) > 150) continue;
      g.fillRect(X(v.pos.x) - 1, Z(v.pos.z) - 1, 2.4, 2.4);
    }
    // police (clignotant)
    const blink = Math.floor(performance.now() / 250) % 2 === 0;
    for (const v of ctx.traffic.police) {
      g.fillStyle = blink ? '#3d7bff' : '#ff4040';
      g.beginPath(); g.arc(X(v.pos.x), Z(v.pos.z), 3.2, 0, 6.29); g.fill();
    }
    // objectif
    if (obj) {
      const pulse = 3.5 + Math.sin(performance.now() / 220) * 1.4;
      g.fillStyle = obj.phase === 'deliver' ? '#5ee1ff' : '#ffd75e';
      g.beginPath(); g.arc(X(obj.pos.x), Z(obj.pos.z), pulse, 0, 6.29); g.fill();
      g.strokeStyle = g.fillStyle; g.globalAlpha = 0.5;
      g.beginPath(); g.arc(X(obj.pos.x), Z(obj.pos.z), pulse + 4, 0, 6.29); g.stroke();
      g.globalAlpha = 1;
    }
    // joueur (triangle orienté)
    const h = ctx.player.getHeading();
    g.save();
    g.translate(X(pp.x), Z(pp.z));
    g.rotate(Math.atan2(Math.sin(h), -Math.cos(h)));
    g.fillStyle = '#ffffff';
    g.beginPath(); g.moveTo(0, -6); g.lineTo(4.2, 4.5); g.lineTo(-4.2, 4.5); g.closePath(); g.fill();
    g.restore();
  }
}
