// ============================================================================
// METROPOLIS — economy.js
// Économie du joueur (brief §12) : argent gagné par les missions, dépensé en
//   - logements (spawn sûr, soins gratuits, accès au toit),
//   - véhicules (achetés et livrés au garage),
//   - améliorations moteur / pneus / freins,
//   - agrandissement du garage (emplacements).
//
// 100 % data-driven (ECONOMY dans core.js) et sérialisable tel quel.
// Aucun couplage direct à l'UI : le module émet des événements Bus.
// Équivalent UE5 : WalletComponent + SaveGame + DataAssets boutique.
// ============================================================================
import { Bus, ECONOMY, VEHICLE_TYPES, rand, clamp, pick } from './core.js';

let HOUSE_ID = 1;

export class Economy {
  constructor(city) {
    this.city = city;
    this.money = ECONOMY.startMoney;
    this.garageLevel = 0;
    this.ownedCars = [];        // {id, type, upgrades:{moteur,pneus,freins}}
    this.ownedHouses = [];      // ids
    this.primaryHouse = null;   // id du logement principal (spawn)
    this.upgrades = { moteur: 0, pneus: 0, freins: 0 };
    this.houses = this._generateHouses();
    this._carId = 1;
  }

  // ------------------------------- Logements --------------------------------
  _generateHouses() {
    const homes = this.city.buildings.filter((b) => b.kind === 'home' && b.h >= 6);
    homes.sort((a, b) => b.h - a.h);
    // échantillon réparti (du plus modeste au plus prestigieux)
    const picked = [];
    const step = Math.max(1, Math.floor(homes.length / ECONOMY.housing.count));
    for (let k = 0; k < ECONOMY.housing.count && k * step < homes.length; k++) {
      picked.push(homes[k * step]);
    }
    return picked.map((b, k) => {
      const price = clamp(
        Math.round(ECONOMY.housing.basePrice + b.h * ECONOMY.housing.pricePerMeter + k * 400),
        ECONOMY.housing.basePrice, ECONOMY.housing.maxPrice);
      return {
        id: HOUSE_ID++, building: b, price,
        label: b.h > 40 ? 'Penthouse' : b.h > 22 ? 'Appartement vue ville' : b.h > 12 ? 'Appartement' : 'Studio',
        floor: Math.max(1, Math.round(b.h / 3)),
      };
    });
  }

  houseById(id) { return this.houses.find((h) => h.id === id) || null; }
  get primaryHouseObj() { return this.houseById(this.primaryHouse); }

  buyHouse(id) {
    const h = this.houseById(id);
    if (!h) return { ok: false, reason: 'Logement inconnu' };
    if (this.ownedHouses.includes(id)) return { ok: false, reason: 'Déjà acheté' };
    if (this.money < h.price) return { ok: false, reason: 'Fonds insuffisants' };
    this.money -= h.price;
    this.ownedHouses.push(id);
    if (this.primaryHouse == null) this.primaryHouse = id;
    Bus.emit('toast', { text: `🏠 ${h.label} acheté (${h.floor}e étage) — accès au toit débloqué`, kind: 'good' });
    Bus.emit('economyChanged', {});
    return { ok: true, house: h };
  }

  setPrimaryHouse(id) {
    if (!this.ownedHouses.includes(id)) return { ok: false, reason: 'Non possédé' };
    this.primaryHouse = id;
    const h = this.houseById(id);
    Bus.emit('toast', { text: `🛏️ Logement principal : ${h.label}`, kind: '' });
    return { ok: true };
  }

  /** Position de réapparition (porte du logement principal, sinon spawn de jeu). */
  spawnPoint() {
    const h = this.primaryHouseObj;
    return h ? { x: h.building.door.x, z: h.building.door.z } : null;
  }

  /** Sommet du logement possédé le plus proche (accès toit / héliport futur). */
  nearestOwnedRoof(pos) {
    let best = null, bd = 28;
    for (const id of this.ownedHouses) {
      const h = this.houseById(id); if (!h) continue;
      const d = Math.hypot(h.building.x - pos.x, h.building.z - pos.z);
      if (d < bd) { bd = d; best = h; }
    }
    return best;
  }

  // -------------------------------- Garage ----------------------------------
  get garageSlots() { return ECONOMY.garage.levels[this.garageLevel].slots; }
  get garageLevelData() { return ECONOMY.garage.levels[this.garageLevel]; }

  upgradeGarage() {
    const next = ECONOMY.garage.levels[this.garageLevel + 1];
    if (!next) return { ok: false, reason: 'Garage au niveau maximal' };
    if (this.money < next.cost) return { ok: false, reason: 'Fonds insuffisants' };
    this.money -= next.cost;
    this.garageLevel++;
    Bus.emit('toast', { text: `🔧 ${next.label} — ${next.slots} emplacements`, kind: 'good' });
    Bus.emit('economyChanged', {});
    return { ok: true, level: this.garageLevel };
  }

  buyCar(type, color) {
    const def = ECONOMY.cars.find((c) => c.type === type);
    if (!def) return { ok: false, reason: 'Véhicule inconnu' };
    if (this.ownedCars.length >= this.garageSlots) return { ok: false, reason: 'Garage plein — agrandissez-le' };
    if (this.money < def.price) return { ok: false, reason: 'Fonds insuffisants' };
    this.money -= def.price;
    const car = { id: this._carId++, type, color: color ?? pick(VEHICLE_TYPES[type].colors), upgrades: { moteur: 0, pneus: 0, freins: 0 } };
    this.ownedCars.push(car);
    Bus.emit('toast', { text: `🚗 ${def.label} acheté — disponible au garage`, kind: 'good' });
    Bus.emit('economyChanged', {});
    return { ok: true, car };
  }

  /** Améliore d'un niveau une caractéristique (moteur / pneus / freins). */
  upgradeCar(carId, key) {
    const car = this.ownedCars.find((c) => c.id === carId);
    const def = ECONOMY.upgrades[key];
    if (!car || !def) return { ok: false, reason: 'Invalide' };
    const lvl = car.upgrades[key] || 0;
    if (lvl >= def.costs.length) return { ok: false, reason: 'Niveau maximal' };
    const cost = def.costs[lvl];
    if (this.money < cost) return { ok: false, reason: 'Fonds insuffisants' };
    this.money -= cost;
    car.upgrades[key] = lvl + 1;
    Bus.emit('toast', { text: `⚙️ ${def.label} niveau ${lvl + 1} installé`, kind: 'good' });
    Bus.emit('economyChanged', {});
    return { ok: true, level: lvl + 1 };
  }

  /**
   * Spécification effective d'un véhicule : les améliorations sont appliquées
   * à une COPIE (jamais à la table globale) — data-driven, sans effet de bord.
   */
  specFor(type, upgrades) {
    const base = { ...VEHICLE_TYPES[type] };
    if (!upgrades) return base;
    for (const [key, def] of Object.entries(ECONOMY.upgrades)) {
      const lvl = upgrades[key] || 0;
      if (!lvl) continue;
      const k = 1 + def.perLevel * lvl;
      if (def.stat === 'grip') base.grip = base.grip * k;
      else if (def.stat === 'topSpeed') base.topSpeed = base.topSpeed * k;
      else if (def.stat === 'accel') base.accel = base.accel * k;
    }
    return base;
  }

  // ------------------------------ Sérialisation ------------------------------
  serialize() {
    return {
      money: Math.round(this.money),
      garageLevel: this.garageLevel,
      ownedCars: this.ownedCars,
      ownedHouses: this.ownedHouses,
      primaryHouse: this.primaryHouse,
      upgrades: this.upgrades,
    };
  }

  restore(data) {
    if (!data) return;
    this.money = Number.isFinite(data.money) ? data.money : this.money;
    this.garageLevel = clamp(data.garageLevel ?? 0, 0, ECONOMY.garage.levels.length - 1);
    this.ownedCars = Array.isArray(data.ownedCars) ? data.ownedCars.filter((c) => VEHICLE_TYPES[c?.type]) : [];
    this.ownedHouses = Array.isArray(data.ownedHouses) ? data.ownedHouses.filter((id) => this.houseById(id)) : [];
    this.primaryHouse = this.ownedHouses.includes(data.primaryHouse) ? data.primaryHouse : (this.ownedHouses[0] ?? null);
    this.upgrades = data.upgrades || { moteur: 0, pneus: 0, freins: 0 };
    this._carId = 1 + this.ownedCars.reduce((m, c) => Math.max(m, c.id || 0), 0);
  }

  /** Achat « d'impulsion » aléatoire pour les PNJ/tests (jamais utilisé en jeu). */
  randomCar() { return { type: pick(ECONOMY.cars).type, variant: Math.floor(rand() * 5) }; }
}

export default Economy;
