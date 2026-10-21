// ============================================================================
// METROPOLIS — audio.js
// Audio 100 % synthétisé (WebAudio) : moteur, pluie, vent de ville, sirène,
// klaxon, impacts, jingles d'UI, tonnerre. Aucun asset externe.
// Équivalent UE5 : MetaSounds (synthèse procédurale paramétrique).
// ============================================================================
export class AudioSys {
  constructor() { this.ok = false; this.muted = false; }
  init() {
    if (this.ok) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.8;
      this.master.connect(this.ctx.destination);
      // ---- bruit de fond partagé (pluie / vent / ville) ----
      const len = this.ctx.sampleRate * 2;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      const noise = (freq, type, gain) => {
        const src = this.ctx.createBufferSource(); src.buffer = buf; src.loop = true;
        const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
        const g = this.ctx.createGain(); g.gain.value = gain;
        src.connect(f); f.connect(g); g.connect(this.master); src.start();
        return g;
      };
      this.rainGain = noise(1400, 'bandpass', 0);
      this.cityGain = noise(320, 'lowpass', 0.035);           // rumeur urbaine
      this._noiseBuf = buf;
      // ---- moteur : scie + sous-oscillateur dans un passe-bas ----
      this.engOsc = this.ctx.createOscillator(); this.engOsc.type = 'sawtooth';
      this.engSub = this.ctx.createOscillator(); this.engSub.type = 'square';
      this.engFilter = this.ctx.createBiquadFilter(); this.engFilter.type = 'lowpass'; this.engFilter.frequency.value = 420;
      this.engGain = this.ctx.createGain(); this.engGain.gain.value = 0;
      this.engOsc.connect(this.engFilter); this.engSub.connect(this.engFilter);
      this.engFilter.connect(this.engGain); this.engGain.connect(this.master);
      this.engOsc.start(); this.engSub.start();
      // ---- sirène police (LFO sur fréquence) ----
      this.sirOsc = this.ctx.createOscillator(); this.sirOsc.type = 'triangle'; this.sirOsc.frequency.value = 840;
      const lfo = this.ctx.createOscillator(); lfo.frequency.value = 0.6;
      const lfoGain = this.ctx.createGain(); lfoGain.gain.value = 130;
      lfo.connect(lfoGain); lfoGain.connect(this.sirOsc.frequency); lfo.start();
      this.sirGain = this.ctx.createGain(); this.sirGain.gain.value = 0;
      this.sirOsc.connect(this.sirGain); this.sirGain.connect(this.master);
      this.sirOsc.start();
      this.ok = true;
    } catch (e) { console.warn('[Audio] indisponible', e); }
  }
  _set(param, v, t = 0.09) { if (this.ok) param.setTargetAtTime(v, this.ctx.currentTime, t); }
  setEngine(rpm01, active) {
    if (!this.ok) return;
    const rpm = Math.min(Math.max(rpm01, 0), 1);
    this._set(this.engGain.gain, active ? 0.05 + rpm * 0.055 : 0, 0.08);
    this._set(this.engOsc.frequency, 52 + rpm * 185, 0.05);
    this._set(this.engSub.frequency, 26 + rpm * 92, 0.05);
    this._set(this.engFilter.frequency, 380 + rpm * 1150, 0.06);
  }
  engineOff() { if (this.ok) this._set(this.engGain.gain, 0, 0.1); }
  setRain(intensity) { if (this.ok) this._set(this.rainGain.gain, intensity * 0.16, 0.4); }
  setSiren(intensity) { if (this.ok) this._set(this.sirGain.gain, Math.min(intensity, 1) * 0.075, 0.2); }
  toggleMute() {
    this.muted = !this.muted;
    if (this.ok) this.master.gain.value = this.muted ? 0 : 0.8;
    return this.muted;
  }
  _burst(dur, filterFreq, gain, type = 'lowpass') {
    if (!this.ok) return;
    const src = this.ctx.createBufferSource(); src.buffer = this._noiseBuf;
    src.playbackRate.value = 0.7 + Math.random() * 0.5;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = filterFreq;
    const g = this.ctx.createGain();
    const t = this.ctx.currentTime;
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(); src.stop(t + dur + 0.05);
  }
  crash(intensity = 0.5) { this._burst(0.28, 900, Math.min(0.25 + intensity * 0.3, 0.6)); }
  thunder() { this._burst(1.6, 160, 0.5); }
  honk() {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    for (const fr of [392, 494]) {
      const o = this.ctx.createOscillator(); o.type = 'square'; o.frequency.value = fr;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.06, t + 0.02);
      g.gain.setValueAtTime(0.06, t + 0.22);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
      o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.35);
    }
  }
  _notes(freqs, dur = 0.11, gain = 0.07, type = 'sine') {
    if (!this.ok) return;
    freqs.forEach((fr, i) => {
      const t = this.ctx.currentTime + i * dur;
      const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = fr;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur * 1.6);
      o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur * 1.7);
    });
  }
  pickup() { this._notes([831, 1245]); }
  cash() { this._notes([988, 1319, 1568], 0.09, 0.08); }
  fail() { this._notes([392, 330, 262], 0.14, 0.07); }
  busted() { this._notes([659, 659, 523, 392], 0.16, 0.08, 'triangle'); }
  click() { this._notes([1175], 0.05, 0.04); }
}
