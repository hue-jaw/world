// ============================================================================
// METROPOLIS — jobs.js
// Emploi et petites annonces (v0.8).
//
// Problème corrigé : le joueur était livreur dès la première seconde, sans
// justification narrative ni progression. Désormais :
//
//   Chapitre I  — SANS EMPLOI. Seules les « petites annonces » existent :
//                 des courses payées à la tâche (45–75 $).
//   Chapitre II — Un vrai emploi se MÉRITE : 3 annonces faites + 150 $ de
//                 caution (uniforme + licence) pour postuler au dépôt.
//                 Une fois embauché : salaire quotidien, courses mieux payées,
//                 van de société stationné au dépôt.
//   Chapitre III— Le logement s'achète avec l'argent gagné (boutique).
//
// Tout est data-driven et sérialisable. Aucun couplage à l'UI : le module
// émet des événements Bus et expose `snapshot()` pour l'affichage.
// Équivalent UE5 : JobSubsystem + DataAssets + UMG emploi.
// ============================================================================
import { Bus, ECONOMY } from './core.js';

/** Définition du vrai emploi. Les valeurs sont ici, pas dans l'UI. */
export const JOB = {
  id: 'courier',
  title: 'Coursier — Metropolis Express',
  fee: 150,               // caution : uniforme + licence
  requiresGigs: 3,        // il faut avoir fait ses preuves
  salary: 140,            // versé chaque jour à 08:00
  payMult: 1.6,           // les courses du contrat payent 60 % de plus
  depot: { x: 32, z: -150 },   // même adresse que le garage (quartier centre)
};

export const GIG = {
  min: 45, max: 75,
  label: 'Petite annonce — course à la tâche',
};

export class JobSystem {
  constructor(city, economy) {
    this.city = city;
    this.economy = economy;
    this.jobId = null;
    this.gigsDone = 0;
    this._paidDay = -1;
    this._van = null;
    this.started = false;
  }

  get hasJob() { return !!this.jobId; }

  /** Multiplicateur de paie des courses : un contrat paie mieux (v0.8). */
  get payMult() { return this.hasJob ? JOB.payMult : 1; }
  get employedLabel() { return this.hasJob ? JOB.title : 'Sans emploi'; }

  /** Peut-on postuler ? Toujours une raison lisible, jamais un simple « non ». */
  canApply(ctx) {
    if (this.hasJob) return { ok: false, reason: 'Vous avez déjà un emploi.' };
    if (this.gigsDone < JOB.requiresGigs) {
      return { ok: false, reason: `Il manque ${JOB.requiresGigs - this.gigsDone} petite(s) annonce(s).` };
    }
    if (this.economy.money < JOB.fee) {
      return { ok: false, reason: `Caution : ${JOB.fee} $ (vous avez ${Math.round(this.economy.money)} $).` };
    }
    return { ok: true, reason: '' };
  }

  /** Postule au dépôt : débite la caution, signe le contrat, livre le van. */
  apply(ctx) {
    const verdict = this.canApply(ctx);
    if (!verdict.ok) {
      Bus.emit('toast', { text: `🚫 ${verdict.reason}`, kind: 'bad' });
      return { ok: false, reason: verdict.reason };
    }
    this.economy.money -= JOB.fee;
    this.jobId = JOB.id;
    this.economy.money += 0;                     // (lisibilité : rien d'autre)
    if (ctx.missions) {
      ctx.missions.mode = 'job';
      ctx.missions._nextT = 2.0;                 // première course peu après
    }
    ctx.story?.onHired?.();
    this.spawnVan(ctx);
    Bus.emit('jobChanged', { jobId: this.jobId });
    Bus.emit('economyChanged', {});
    Bus.emit('toast', { text: `🧾 Embauché : ${JOB.title} — ${JOB.salary} $/jour, courses +60 %`, kind: 'good' });
    Bus.emit('toast', { text: '🚐 Un van de société vous attend au dépôt (garage).', kind: '' });
    ctx.saveNow?.();
    return { ok: true };
  }

  /** Van de société garé au dépôt (une seule fois). */
  spawnVan(ctx) {
    if (this._van && this._van.active) return this._van;
    const t = ctx.traffic;
    if (!t || typeof t.spawnCompany !== 'function') return null;
    this._van = t.spawnCompany('Utilitaire', JOB.depot.x + 4, JOB.depot.z - 6, 0);
    return this._van;
  }

  /**
   * Accepte une petite annonce. Sans emploi uniquement : avec un contrat, ce
   * sont les missions normales qui tournent, mieux payées.
   */
  acceptGig(ctx) {
    if (this.hasJob) {
      Bus.emit('toast', { text: 'Vous avez un contrat : les courses partent toutes seules.', kind: '' });
      return { ok: false, reason: 'Déjà employé' };
    }
    if (ctx.missions?.phase && ctx.missions.phase !== 'none') {
      return { ok: false, reason: 'Une course est déjà en cours' };
    }
    ctx.missions.mode = 'gig';
    ctx.missions.newDelivery(ctx);
    return { ok: true };
  }

  /** Appelé par MissionSystem à la fin d'une course (réussie ou non). */
  onRunDone(ctx, kind, success) {
    if (kind === 'gig' && success) {
      this.gigsDone++;
      Bus.emit('jobChanged', {});
      if (this.gigsDone === JOB.requiresGigs && !this.hasJob) {
        Bus.emit('toast', { text: '📄 Vous pouvez postuler au dépôt (J) — caution 150 $', kind: 'good' });
      }
    }
    if (kind === 'job' && success) {
      // petite prime de régularité, sans compteur caché : 10 $ par course
      this.economy.money += 10;
    }
    void ctx;
  }

  /** Salaire quotidien : versé une fois par jour de jeu, à 08:00 ou après. */
  update(dt, ctx) {
    if (!this.hasJob) return;
    const day = Math.floor(ctx.env?.day ?? 0);
    const hour = ctx.env?.hour ?? 0;
    if (day !== this._paidDay && hour >= 8) {
      this._paidDay = day;
      this.economy.money += JOB.salary;
      Bus.emit('economyChanged', {});
      Bus.emit('toast', { text: `💵 Salaire : +${JOB.salary} $ (${JOB.title})`, kind: 'good' });
      ctx.saveNow?.();
    }
    void dt;
  }

  snapshot(ctx) {
    const st = this.canApply(ctx);
    return {
      employed: this.hasJob,
      label: this.employedLabel,
      gigsDone: this.gigsDone,
      gigsRequired: JOB.requiresGigs,
      fee: JOB.fee,
      salary: JOB.salary,
      canApply: st.ok,
      reason: st.reason,
      chapter: ctx.story?.chapter ?? 0,
    };
  }

  serialize() {
    return { jobId: this.jobId, gigsDone: this.gigsDone, paidDay: this._paidDay };
  }
  restore(d) {
    if (!d) return;
    this.jobId = d.jobId || null;
    this.gigsDone = Number.isFinite(d.gigsDone) ? d.gigsDone : 0;
    this._paidDay = Number.isFinite(d.paidDay) ? d.paidDay : -1;
  }
}

export default JobSystem;
