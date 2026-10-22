// ============================================================================
// METROPOLIS — story.js
// Mode Histoire : chapitres, cinématiques d'ouverture, progression.
//
// Décision de design (v0.8) : le jeu ne commence PLUS par « tu es livreur ».
// On arrive avec un sac et quelques dollars ; il faut d'abord survivre avec des
// petits boulots, PUIS postuler à un vrai emploi, PUIS se payer un logement.
// Chaque étape est un chapitre avec sa propre cinématique courte.
//
// Les cinématiques sont des listes de plans (position caméra, point visé,
// durée, texte) jouées par la boucle de jeu : aucun format vidéo, aucune
// dépendance — 4 Ko de données au lieu de 40 Mo de MP4.
//
// Équivalent UE5 : Level Sequence + UMG (lettrage) + GameInstanceSubsystem.
// ============================================================================
import * as THREE from 'three';
import { Bus } from './core.js';

// ---------------------------------------------------------------------------
//                                 CHAPITRES
// ---------------------------------------------------------------------------
export const CHAPTERS = [
  {
    id: 0, key: 'arrival',
    title: 'Chapitre I — L’arrivée',
    goal: 'Trouve de quoi tenir ce soir.',
    hint: 'Aucun emploi. Ouvre les petites annonces (J).',
  },
  {
    id: 1, key: 'work',
    title: 'Chapitre II — Un boulot',
    goal: 'Fais tes preuves, puis postule au dépôt.',
    hint: '3 petites annonces et 150 $ de caution ouvrent le vrai emploi (J).',
  },
  {
    id: 2, key: 'roof',
    title: 'Chapitre III — Un toit',
    goal: 'Achète un logement. Celui qui dort dehors ne tient pas longtemps.',
    hint: 'Boutique (B) → Logements. Un studio suffit pour commencer.',
  },
  {
    id: 3, key: 'rise',
    title: 'Chapitre IV — Faire sa place',
    goal: 'Tu as un travail et un toit. La ville t’a à peine remarqué.',
    hint: 'Missions, économie, garage : la suite t’appartient.',
  },
];

/** Plans de la cinématique d'ouverture (durées en secondes). */
export function introShots(city, playerPos) {
  const px = playerPos.x, pz = playerPos.z;
  return [
    {
      dur: 8.5, fade: 2.2,
      pos: [px + 210, 150, pz + 260], look: [0, 18, 0],
      title: 'METROPOLIS',
      subtitle: 'Chapitre I — L’arrivée',
      text: 'On dit que cette ville avale les gens. Huit millions d’habitants — pas un seul qui connaisse ton prénom.',
    },
    {
      dur: 7.5,
      pos: [px + 26, 42, pz + 46], look: [px, 6, pz],
      text: 'Tu es arrivé ce matin avec un sac, trente-cinq dollars et le numéro d’un type qui ne répond plus.',
    },
    {
      dur: 7.0,
      pos: [px + 9, 2.1, pz + 11], look: [px, 1.7, pz],
      text: 'Pas de travail. Pas de toit. Juste une ville qui ne t’a rien promis.',
    },
    {
      dur: 6.0,
      pos: [px + 3.2, 1.35, pz + 3.6], look: [px, 1.7, pz],
      text: 'Metropolis ne donne rien. Elle se paie.',
      chapter: true,
    },
    {
      dur: 6.0, fade: 2.6,
      pos: [px + 60, 70, pz + 80], look: [px, 10, pz],
      text: 'Ce soir, trouve de quoi manger. Demain, on verra.',
      end: true,
    },
  ];
}

/** Petite carte de chapitre (pas de caméra, juste du texte). */
export function chapterCard(chapter) {
  return [{
    dur: 5.0, fade: 1.6, cardOnly: true,
    title: chapter.title, text: chapter.goal,
  }];
}

// ---------------------------------------------------------------------------
//                                 SYSTÈME
// ---------------------------------------------------------------------------
export class StorySystem {
  /**
   * @param {object} opts { camera, scene, city, player }
   */
  constructor({ camera, scene, city, player }) {
    this.camera = camera; this.scene = scene; this.city = city; this.player = player;
    this.chapter = 0;
    this.introSeen = false;
    this.hired = false;

    this.cin = null;              // cinématique en cours
    this._t = 0;
    this._camA = new THREE.Vector3();
    this._camB = new THREE.Vector3();
    this._lookA = new THREE.Vector3();
    this._lookB = new THREE.Vector3();

    // DOM (lettrage + texte). Absent en test headless : tout est optionnel.
    this.el = {
      root: typeof document !== 'undefined' ? document.getElementById('cinema') : null,
      title: typeof document !== 'undefined' ? document.getElementById('cinema-title') : null,
      text: typeof document !== 'undefined' ? document.getElementById('cinema-text') : null,
      hint: typeof document !== 'undefined' ? document.getElementById('cinema-hint') : null,
    };
  }

  get playing() { return !!this.cin; }
  get chapterData() { return CHAPTERS[Math.min(this.chapter, CHAPTERS.length - 1)]; }

  // ------------------------------------------------------------- cinématiques
  /** Joue une liste de plans. `onEnd` est appelé à la fin (ou au skip). */
  play(shots, onEnd = null) {
    if (!shots || !shots.length) return;
    this.cin = { shots, i: 0, t: 0, onEnd, skipped: false };
    this._t = 0;
    this._showUI(true);
    this._applyShot(0, 0);
    Bus.emit('cinematicStart', {});
  }

  /** Passe la cinématique en cours. */
  skip() {
    if (!this.cin) return;
    const cb = this.cin.onEnd;
    this.cin = null;
    this._showUI(false);
    Bus.emit('cinematicEnd', {});
    if (cb) cb();
  }

  _showUI(on) {
    const r = this.el.root;
    if (typeof document !== 'undefined') {
      const hud = document.getElementById('hud');
      if (hud) hud.classList.toggle('cine', !!on);
    }
    if (!r) return;
    r.classList.toggle('on', !!on);
    if (!on) {
      if (this.el.title) this.el.title.textContent = '';
      if (this.el.text) this.el.text.textContent = '';
    }
  }

  /** Place la caméra sur le plan `i` avec un facteur d'avancement `k` (0..1). */
  _applyShot(i, k) {
    const sh = this.cin?.shots?.[i];
    if (!sh) return;
    if (!sh.cardOnly) {
      const [x, y, z] = sh.pos, [lx, ly, lz] = sh.look;
      // léger dolly : la caméra avance de 4 % pendant le plan (vie à l'image)
      this._camA.set(x, y, z);
      this._camB.set(x + (lx - x) * 0.04, y + (ly - y) * 0.04, z + (lz - z) * 0.04);
      this.camera.position.lerpVectors(this._camA, this._camB, k);
      this._lookA.set(lx, ly, lz);
      this.camera.lookAt(this._lookA);
      this.camera.fov = 58;
      this.camera.updateProjectionMatrix();
    }
    if (this.el.title) {
      this.el.title.textContent = sh.title || '';
      this.el.title.style.opacity = sh.title ? String(1 - Math.max(0, k - 0.72) / 0.28) : '0';
    }
    if (this.el.text) this.el.text.textContent = sh.text || '';
    if (!this._lastShot || this._lastShot !== i) {
      this._lastShot = i;
      if (this.el.text) {
        this.el.text.style.animation = 'none';
        // force le redémarrage de l'animation de fondu
        void this.el.text.offsetWidth;
        this.el.text.style.animation = '';
      }
    }
  }

  // ------------------------------------------------------------------- update
  update(dt, ctx) {
    this._t += dt;
    if (this.cin) {
      const c = this.cin;
      const sh = c.shots[c.i];
      c.t += dt;
      const k = Math.min(1, c.t / sh.dur);
      this._applyShot(c.i, k);
      if (c.t >= sh.dur || (sh.end && c.t >= sh.dur - 0.2)) {
        c.i++; c.t = 0; this._lastShot = -1;
        if (c.i >= c.shots.length) {
          const cb = c.onEnd;
          this.cin = null;
          this._showUI(false);
          Bus.emit('cinematicEnd', {});
          if (cb) cb();
        }
      }
      return;                       // pendant une cinématique, pas de gameplay
    }
    this._checkChapter(ctx);
  }

  /** Fait avancer l'histoire quand les conditions d'un chapitre sont remplies. */
  _checkChapter(ctx) {
    const jobs = ctx.jobs;
    let next = this.chapter;
    // II : la première petite annonce prouve que l'on peut travailler.
    if ((jobs?.gigsDone ?? 0) >= 1) next = Math.max(next, 1);
    if (this.hired) next = Math.max(next, 2);
    if (ctx.economy?.ownedHouses?.length) next = Math.max(next, 3);
    if (next > this.chapter) this._enterChapter(next, ctx);
    void jobs;
  }

  _enterChapter(id, ctx) {
    this.chapter = Math.min(id, CHAPTERS.length - 1);
    const ch = this.chapterData;
    Bus.emit('storyChapter', { chapter: this.chapter, data: ch });
    Bus.emit('toast', { text: `📖 ${ch.title}`, kind: 'good' });
    if (ctx?.ui) ctx.ui.setStoryGoal?.(ch);
  }

  /** Embauche : appelé par jobs.js quand le joueur postule. */
  onHired() {
    this.hired = true;
    this._enterChapter(2);
  }

  /** Intro complète (à lancer une seule fois). */
  startIntro(ctx) {
    this.introSeen = true;
    const shots = introShots(this.city, ctx.playerPos());
    this.play(shots, () => {
      this._enterChapter(0, ctx);
      Bus.emit('toast', {
        text: '🪧 Aucun emploi, aucun toit. Petites annonces : J — Boutique : B', kind: '',
      });
      ctx.saveNow?.();
    });
  }

  // ---------------------------------------------------------------- sauvegarde
  serialize() {
    return { chapter: this.chapter, introSeen: this.introSeen, hired: this.hired };
  }
  restore(data) {
    if (!data) return;
    this.chapter = Number.isFinite(data.chapter) ? data.chapter : 0;
    this.introSeen = !!data.introSeen;
    this.hired = !!data.hired;
  }
}

export default StorySystem;
