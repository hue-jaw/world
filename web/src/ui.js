// ============================================================================
// METROPOLIS — ui.js
// HUD minimaliste : horloge/météo, boussole, statut, objectif, minimap
// temps réel, compteur, prompts, notifications, debug. (UE5 : UMG + CommonUI)
// ============================================================================
import { Bus, clamp, WEATHER_STATES, ECONOMY } from './core.js';
import { WORLD_HALF } from './city.js';
import { fmtDistance } from './gps.js';

const $ = (id) => document.getElementById(id);

export class UI {
  constructor(callbacks) {
    this.cb = callbacks;
    this.els = {
      hud: $('hud'), clock: $('clock-time'), weather: $('clock-weather'), street: $('clock-street'),
      money: $('hud-money'), wanted: $('hud-wanted'), deliveries: $('hud-deliveries'),
      objective: $('objective'), objTitle: $('objective-title'), objDist: $('objective-dist'), objTimer: $('objective-timer'),
      speedo: $('speedo'), speedVal: $('speedo-value'), gear: $('speedo-gear'),
      prompt: $('prompt'), promptText: $('prompt-text'),
      toasts: $('toasts'), debug: $('debug-panel'),
      compass: $('compass-inner'), busted: $('busted'), bustedSub: $('busted-sub'),
      health: $('health-bar'), gamepad: $('hud-gamepad'),
      shop: $('shop'), shopBody: $('shop-body'), shopBalance: $('shop-balance'),
      downed: $('downed'), downedSub: $('downed-sub'), gpsHint: $('gps-hint'),
      gpsPanel: $('gps-panel'), gpsIcon: $('gps-icon'), gpsTurn: $('gps-turn'),
      gpsDist: $('gps-dist'), gpsEta: $('gps-eta'), gpsLeft: $('gps-left'),
    };
    this.mini = $('minimap').getContext('2d');
    // Clic sur la mini-carte = poser une destination (mode Libre). En mode
    // Histoire, le clic ne fait rien : l'objectif reste celui de la mission.
    $('minimap')?.addEventListener('click', (e) => {
      const ctx = this._lastCtx;
      if (!ctx || ctx.missions?.enabled) return;
      const r = e.currentTarget.getBoundingClientRect();
      const S = 190, C = S / 2, radius = 150, sc = S / (radius * 2);
      const pp = ctx.playerPos();
      const x = pp.x + ((e.clientX - r.left) - C) / sc;
      const z = pp.z + ((e.clientY - r.top) - C) / sc;
      ctx.missions.setFreeTarget(x, z);
      ctx.gps.locked = true;
      ctx.gps.setTarget(x, z);
      Bus.emit('toast', { text: '🗺️ Destination libre posée sur la carte', kind: '' });
    });
    this._lastClock = ''; this._miniT = 0; this._gpsT = 0; this._promptText = undefined;
    this.debugVisible = false;
    this.shopOpen = false; this.shopTab = 'houses';
    this._bindShop();

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
    // 3 toasts maximum : on retire le plus ancien (compatible DOM partiel)
    while (this.els.toasts.children.length > 3) {
      const old = this.els.toasts.firstChild || this.els.toasts.children[0];
      if (!old) break;
      old.remove();
      if (old.parentNode === this.els.toasts) this.els.toasts.children.shift();
      else this.els.toasts.children.shift();
    }
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
    this._lastCtx = ctx;
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

    // ---- bandeau GPS temps réel (10 Hz : inutile de faire plus) ----------
    this._gpsT -= dt;
    if (this._gpsT <= 0 && this.els.gpsPanel) {
      this._gpsT = 0.1;
      this._updateGpsPanel(ctx);
    }

    // compteur
    const pv = ctx.playerVehicle;
    if (pv) {
      this.els.speedo.classList.remove('hidden');
      this.els.speedVal.textContent = Math.round(pv.speedKmh());
      this.els.gear.textContent = pv.vf < -0.4 ? 'R' : 'D';
    } else this.els.speedo.classList.add('hidden');

    // ---- santé ----
    const hp = ctx.player?.health ?? 100, maxHp = ctx.player?.maxHealth ?? 100;
    if (this.els.health) {
      const pct = clamp((hp / maxHp) * 100, 0, 100);
      this.els.health.style.width = pct + '%';
      this.els.health.className = pct < 25 ? 'critical' : pct < 55 ? 'hurt' : '';
    }
    // ---- manette ----
    if (this.els.gamepad) {
      const gp = ctx.player?.gamepad;
      this.els.gamepad.textContent = gp?.connected ? '🎮 ' + gp.label() : '🎮 manette : appuyez sur un bouton';
      this.els.gamepad.classList.toggle('on', !!gp?.connected);
    }
    if (this.shopOpen) this._refreshShop(ctx);

    // --- nom de rue (change en roulant) -----------------------------------
    this._streetT = (this._streetT || 0) - dt;
    if (this._streetT <= 0 && this.els.street) {
      this._streetT = 0.25;
      const pp = ctx.playerPos();
      const info = ctx.city.streetAt?.(pp.x, pp.z);
      const label = info ? (info.both ? info.primary : info.primary + (info.secondary ? ' · ' + info.secondary : '')) : '';
      if (label !== this._streetLabel) {
        this._streetLabel = label;
        this.els.street.textContent = label || '—';
        this.els.street.classList.toggle('oneway', !!info?.secondary);
      }
    }

    this._updateCompass(ctx, obj);
    this._miniT -= dt;
    if (this._miniT <= 0) { this._miniT = 0.1; this._drawMinimap(ctx, obj); }
  }

  /**
   * Bandeau de guidage : prochaine manœuvre, distance jusqu'à celle-ci,
   * distance restante et temps estimé. Toutes les valeurs viennent du GPS
   * recalculé en temps réel — rien n'est figé au moment où l'on a posé
   * la destination.
   */
  _updateGpsPanel(ctx) {
    const g = ctx.gps?.guidance?.(ctx);
    const show = !!g && !!ctx.gps?.hasRoute?.();
    this.els.gpsPanel.classList.toggle('hidden', !show);
    if (!show) return;
    this.els.gpsIcon.textContent = g.icon;
    this.els.gpsIcon.classList.toggle('turn', g.side === 'left' || g.side === 'right');
    this.els.gpsTurn.textContent = g.text;
    this.els.gpsDist.textContent = g.dist > 0 ? fmtDistance(g.dist) : '';
    const mins = Math.max(0, Math.round(g.eta / 60));
    this.els.gpsEta.textContent = g.eta > 0 ? `· ${mins < 1 ? '< 1' : mins} min` : '';
    this.els.gpsLeft.textContent = g.remaining > 0 ? `· ${fmtDistance(g.remaining)} restants` : '';
    // état « recalcul… » : le GPS vient de repartir d'une nouvelle position
    const fresh = ctx.gps && ctx.gps._t - ctx.gps._lastRecalcAt < 0.9;
    this.els.gpsPanel.classList.toggle('rerouting', !!fresh);
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

  /**
   * Mini-carte CENTRÉE SUR LE JOUEUR (indispensable sur 8 km), avec le tracé
   * GPS, les flèches de direction et les objectifs ramenés sur le bord.
   */
  _drawMinimap(ctx, obj) {
    const g = this.mini, S = 190, C = S / 2;
    const pp = ctx.playerPos();
    const radius = 150;                       // 300 m visibles
    const sc = S / (radius * 2);
    const X = (x) => C + (x - pp.x) * sc, Z = (z) => C + (z - pp.z) * sc;

    g.fillStyle = '#1a2028'; g.fillRect(0, 0, S, S);
    // --- quadrillage routier de la métropole (tous les 64 m) ---
    const P = 64, first = Math.floor((pp.x - radius) / P) * P;
    g.strokeStyle = '#2f3946'; g.lineWidth = 3;
    for (let x = first; x <= pp.x + radius; x += P) {
      g.beginPath(); g.moveTo(X(x), 0); g.lineTo(X(x), S); g.stroke();
    }
    const firstZ = Math.floor((pp.z - radius) / P) * P;
    for (let z = firstZ; z <= pp.z + radius; z += P) {
      g.beginPath(); g.moveTo(0, Z(z)); g.lineTo(S, Z(z)); g.stroke();
    }
    // --- bâtiments du cœur détaillé ---
    for (const b of ctx.city.buildings) {
      if (Math.abs(b.x - pp.x) > radius + 40 || Math.abs(b.z - pp.z) > radius + 40) continue;
      g.fillStyle = b.kind === 'shop' ? '#4a5a6e' : (b.h > 25 ? '#4d5c70' : '#3d4a5a');
      g.fillRect(X(b.x - b.w / 2), Z(b.z - b.d / 2), Math.max(1.5, b.w * sc), Math.max(1.5, b.d * sc));
    }
    // --- tracé GPS : style Google Maps (liseré sombre + bleu vif) ---------
    const route = ctx.gps?.routePoints?.() || [];
    if (route.length > 1) {
      // On trace TOUT l'itinéraire, pas seulement le voisinage : même hors du
      // cadre, le segment est tronqué proprement par le canvas. C'est ce qui
      // permet de suivre la route « de loin ».
      // On trace TOUT l'itinéraire (pas seulement le voisinage) : même hors
      // cadre, le segment est tronqué par le canvas. C'est ce qui permet de
      // suivre la route « de loin », comme sur Google Maps.
      const tracePath = () => {
        g.beginPath();
        let started = false;
        for (const n of route) {
          const sx = C + (n.x - pp.x) * sc, sz = C + (n.z - pp.z) * sc;
          // marge généreuse : on garde les points hors cadre pour que la ligne
          // sorte proprement de l'écran au lieu de s'arrêter net
          if (sx < -S || sz < -S || sx > S * 2 || sz > S * 2) { started = false; continue; }
          if (!started) { g.moveTo(sx, sz); started = true; } else g.lineTo(sx, sz);
        }
      };
      g.lineJoin = 'round'; g.lineCap = 'round';
      tracePath(); g.strokeStyle = 'rgba(6,32,64,0.95)'; g.lineWidth = 7.5; g.stroke();
      tracePath(); g.strokeStyle = '#2f8bff'; g.lineWidth = 4.6; g.stroke();
      tracePath(); g.strokeStyle = 'rgba(160,214,255,0.75)'; g.lineWidth = 1.4; g.stroke();
      // flèches directionnelles bleues sur le tracé (toutes les 3 nodes)
      for (let k = 1; k < route.length - 1; k += 3) {
        const a = route[k], b = route[k + 1];
        const mx = C + (a.x - pp.x) * sc, mz = C + (a.z - pp.z) * sc;
        if (mx < 5 || mz < 5 || mx > S - 5 || mz > S - 5) continue;
        const ang = Math.atan2(b.x - a.x, b.z - a.z);
        g.save(); g.translate(mx, mz); g.rotate(Math.PI - ang);
        g.fillStyle = '#eaf6ff';
        g.beginPath(); g.moveTo(0, -4.6); g.lineTo(3.1, 3.2); g.lineTo(-3.1, 3.2); g.closePath(); g.fill();
        g.restore();
      }
    }
    // --- trafic proche ---
    g.fillStyle = 'rgba(210,220,235,0.72)';
    for (const v of ctx.traffic.vehicles) {
      if (!v.active || v === ctx.playerVehicle || v.spec.police) continue;
      if (Math.abs(v.pos.x - pp.x) > radius || Math.abs(v.pos.z - pp.z) > radius) continue;
      g.fillRect(X(v.pos.x) - 1, Z(v.pos.z) - 1, 2.4, 2.4);
    }
    // --- police ---
    const blink = Math.floor(performance.now() / 250) % 2 === 0;
    for (const v of ctx.traffic.police) {
      if (Math.abs(v.pos.x - pp.x) > radius || Math.abs(v.pos.z - pp.z) > radius) continue;
      g.fillStyle = blink ? '#3d7bff' : '#ff4040';
      g.beginPath(); g.arc(X(v.pos.x), Z(v.pos.z), 3.2, 0, 6.29); g.fill();
    }
    // --- objectif : sur la carte ou ramené sur le bord avec flèche ---
    if (obj) {
      const pulse = 3.5 + Math.sin(performance.now() / 220) * 1.4;
      let ox = X(obj.pos.x), oz = Z(obj.pos.z);
      const margin = 10, inside = ox > margin && oz > margin && ox < S - margin && oz < S - margin;
      if (!inside) {
        const ang = Math.atan2(obj.pos.z - pp.z, obj.pos.x - pp.x);
        ox = clamp(C + Math.cos(ang) * (C - margin), margin, S - margin);
        oz = clamp(C + Math.sin(ang) * (C - margin), margin, S - margin);
      }
      g.fillStyle = obj.phase === 'deliver' ? '#5ee1ff' : '#ffd75e';
      g.beginPath(); g.arc(ox, oz, pulse, 0, 6.29); g.fill();
      g.strokeStyle = g.fillStyle; g.globalAlpha = 0.5;
      g.beginPath(); g.arc(ox, oz, pulse + 4, 0, 6.29); g.stroke();
      g.globalAlpha = 1;
    }
    // --- joueur (triangle orienté, au centre) ---
    const h = ctx.player.getHeading();
    g.save();
    g.translate(C, C);
    g.rotate(Math.atan2(Math.sin(h), -Math.cos(h)));
    g.fillStyle = '#ffffff';
    g.beginPath(); g.moveTo(0, -6); g.lineTo(4.2, 4.5); g.lineTo(-4.2, 4.5); g.closePath(); g.fill();
    g.restore();
    // --- flèche Nord ---
    g.fillStyle = '#8fb6e0'; g.font = 'bold 10px sans-serif'; g.textAlign = 'center';
    g.fillText('N', C, 11);
  }

  // ============================ HUB COMMERCIAL =============================
  _bindShop() {
    const close = () => this.closeShop();
    this.els.shop?.querySelector('#shop-close')?.addEventListener('click', close);
    document.querySelectorAll('#shop .shop-tabs button').forEach((b) => {
      b.addEventListener('click', () => {
        this.shopTab = b.dataset.tab;
        document.querySelectorAll('#shop .shop-tabs button').forEach((x) => x.classList.toggle('active', x === b));
        this._renderedTab = null; this._refreshShop(this._lastCtx);
      });
    });
    document.getElementById('tb-shop')?.addEventListener('click', () => this.toggleShop(this._lastCtx));
    this.els.shop?.addEventListener('click', (e) => { if (e.target === this.els.shop) close(); });
  }

  toggleShop(ctx) { this.shopOpen ? this.closeShop() : this.openShop(ctx); }
  openShop(ctx) {
    if (!ctx?.economy) return;
    this.shopOpen = true; this.els.shop.classList.remove('hidden');
    this._renderedTab = null; this._refreshShop(ctx);
    this.cb.onShopOpen?.(true);
  }
  closeShop() {
    this.shopOpen = false; this.els.shop?.classList.add('hidden');
    this.cb.onShopOpen?.(false);
  }

  _refreshShop(ctx) {
    if (!ctx?.economy || !this.els.shopBody) return;
    this._lastCtx = ctx;
    const eco = ctx.economy;
    if (this.els.shopBalance) this.els.shopBalance.textContent = '$ ' + Math.round(eco.money).toLocaleString('fr-FR');
    if (this._renderedTab === this.shopTab && this._lastMoney === Math.round(eco.money)) return;
    this._renderedTab = this.shopTab; this._lastMoney = Math.round(eco.money);
    const body = this.els.shopBody;
    body.innerHTML = '';
    const row = (title, sub, price, owned, action) => {
      const el = document.createElement('div');
      el.className = 'shop-item' + (owned ? ' owned' : '');
      const main = document.createElement('div'); main.className = 'si-main';
      const t = document.createElement('div'); t.className = 'si-title'; t.textContent = title;
      const s2 = document.createElement('div'); s2.className = 'si-sub'; s2.textContent = sub;
      main.append(t, s2); el.append(main);
      if (owned) {
        const o = document.createElement('div'); o.className = 'si-owned'; o.textContent = '✓ possédé'; el.append(o);
      } else {
        const p = document.createElement('div'); p.className = 'si-price'; p.textContent = '$ ' + price.toLocaleString('fr-FR'); el.append(p);
        const b = document.createElement('button'); b.textContent = 'Acheter';
        b.disabled = eco.money < price;
        b.addEventListener('click', action);
        el.append(b);
      }
      body.append(el);
    };

    if (this.shopTab === 'houses') {
      for (const h of eco.houses) {
        const owned = eco.ownedHouses.includes(h.id);
        row(`${h.label} — ${h.floor}e étage`, `${h.building.h.toFixed(0)} m de haut · accès toit ${owned ? 'débloqué' : 'inclus'}`, h.price, owned,
          () => { const r = eco.buyHouse(h.id); if (!r.ok) this._shopError(r.reason, ctx); });
      }
    } else if (this.shopTab === 'cars') {
      for (const c of ECONOMY.cars) {
        const ownedCount = eco.ownedCars.filter((x) => x.type === c.type).length;
        row(`${c.label}`, `${ownedCount ? ownedCount + ' au garage · ' : ''}livré au garage`, c.price, false,
          () => { const r = eco.buyCar(c.type); if (!r.ok) this._shopError(r.reason, ctx); });
      }
    } else if (this.shopTab === 'garage') {
      const lvl = eco.garageLevelData;
      row(`Niveau actuel : ${lvl.label}`, `${lvl.slots} emplacements utilisés par ${eco.ownedCars.length} véhicule(s)`, 0, true, () => {});
      const next = ECONOMY.garage.levels[eco.garageLevel + 1];
      if (next) row(`Agrandir : ${next.label}`, `${next.slots} emplacements`, next.cost, false,
        () => { const r = eco.upgradeGarage(); if (!r.ok) this._shopError(r.reason, ctx); });
      else row('Garage au niveau maximal', 'Atelier 6 places', 0, true, () => {});
    } else if (this.shopTab === 'upgrades') {
      if (!eco.ownedCars.length) {
        const p = document.createElement('div'); p.className = 'shop-empty';
        p.textContent = "Aucun véhicule au garage. Achetez-en un dans l'onglet Véhicules.";
        body.append(p);
      }
      for (const car of eco.ownedCars) {
        for (const [k, def] of Object.entries(ECONOMY.upgrades)) {
          const lvl = car.upgrades[k] || 0;
          const maxed = lvl >= def.costs.length;
          const price = maxed ? 0 : def.costs[lvl];
          row(`${car.type} — ${def.label}`, maxed ? `Niveau ${lvl} (max)` : `Niveau ${lvl} → ${lvl + 1}`, price, maxed,
            () => { const r = eco.upgradeCar(car.id, k); if (!r.ok) this._shopError(r.reason, ctx); });
        }
      }
    }
  }

  _shopError(reason, ctx) {
    Bus.emit('toast', { text: '⛔ ' + reason, kind: 'bad' });
    this._lastMoney = -1; this._refreshShop(ctx);
  }

  showDowned(on, text) {
    if (!this.els.downed) return;
    this.els.downed.classList.toggle('hidden', !on);
    if (text && this.els.downedSub) this.els.downedSub.textContent = text;
  }
}
