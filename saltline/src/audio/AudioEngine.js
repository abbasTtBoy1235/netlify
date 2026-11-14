/**
 * AudioEngine — 100% procedural WebAudio synthesis.
 * No audio files are shipped: gunshots, impacts, explosions, footsteps,
 * ambience (wind, industrial hum, gulls, distant ship horn) and the
 * dynamic tension score are all synthesized in code.
 *
 * Buses: sfx / music / voice → compressor → master → destination.
 * 3D positioning via PannerNode for world-anchored events.
 */

const W = {
  ar:     { noiseHz: 1900, noiseDecay: 0.10, thump: 85,  level: 0.9,  crack: 0.35 },
  smg:    { noiseHz: 1500, noiseDecay: 0.06, thump: 110, level: 0.6,  crack: 0.15 },
  pistol: { noiseHz: 1150, noiseDecay: 0.09, thump: 70,  level: 0.55, crack: 0.1 },
  sniper: { noiseHz: 800,  noiseDecay: 0.20, thump: 55,  level: 0.85, crack: 0.6 },
  enemy:  { noiseHz: 1300, noiseDecay: 0.09, thump: 95,  level: 0.5,  crack: 0.2 }
};

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.volumes = { master: 0.8, music: 0.55, sfx: 0.9, voice: 0.8 };
    this.musicOn = false;
    this.tension = 0;
    this._ambTimer = 0;
    this._hornTimer = 45;
    this._gullTimer = 12;
    this._musicTimer = 0;
  }

  /** Must be called from a user gesture (menu click). */
  unlock() {
    if (this.ready) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
    } catch (e) {
      console.warn('[Audio] WebAudio unavailable', e);
      return;
    }
    const c = this.ctx;
    this.master = c.createGain();
    this.compressor = c.createDynamicsCompressor();
    this.compressor.threshold.value = -14;
    this.compressor.ratio.value = 6;
    this.master.connect(this.compressor);
    this.compressor.connect(c.destination);
    this.sfx = c.createGain(); this.sfx.connect(this.master);
    this.music = c.createGain(); this.music.connect(this.master);
    this.voice = c.createGain(); this.voice.connect(this.master);
    this.setVolumes(this.volumes.master, this.volumes.music, this.volumes.sfx, this.volumes.voice);
    // 2s white-noise buffer (shared by every transient)
    const len = c.sampleRate * 2;
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    // 4s brown-noise loop for wind
    const blen = c.sampleRate * 4;
    const bbuf = c.createBuffer(1, blen, c.sampleRate);
    const bd = bbuf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < blen; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      bd[i] = last * 3.5;
    }
    this.windBuf = bbuf;
    this.ready = true;
    if (this._wantMusic) this.startMusic();
    if (this._wantAmbience) this.startAmbience();
  }

  setVolumes(m, mu, s, v) {
    this.volumes = { master: m, music: mu, sfx: s, voice: v };
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(m, t, 0.05);
    this.music.gain.setTargetAtTime(mu, t, 0.1);
    this.sfx.gain.setTargetAtTime(s, t, 0.05);
    this.voice.gain.setTargetAtTime(v, t, 0.05);
  }

  _ok() { return this.ready && this.ctx.state === 'running'; }

  /** Update the 3D listener from the camera. */
  updateListener(pos, quat) {
    if (!this._ok()) return;
    const l = this.ctx.listener;
    try {
      l.positionX.value = pos.x; l.positionY.value = pos.y; l.positionZ.value = pos.z;
      const fwd = { x: 0, y: 0, z: -1 };
      const e = quat.elements;
      fwd.x = e[8]; fwd.y = e[9]; fwd.z = e[10]; // camera looks down -Z
      l.forwardX.value = fwd.x; l.forwardY.value = fwd.y; l.forwardZ.value = fwd.z;
      l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
    } catch (e) { /* older listener API — positional SFX degrade gracefully */ }
  }

  /** Route a node to the sfx bus, optionally 3D-positioned. */
  _out(node, bus, pos3d) {
    if (pos3d) {
      const p = this.ctx.createPanner();
      p.panningModel = 'equalpower';
      p.distanceModel = 'inverse';
      p.refDistance = 1;
      p.maxDistance = 150;
      p.rolloffFactor = 1.1;
      p.positionX.value = pos3d.x; p.positionY.value = pos3d.y; p.positionZ.value = pos3d.z;
      node.connect(p); p.connect(bus || this.sfx);
    } else {
      node.connect(bus || this.sfx);
    }
  }

  _env(peak, attack, decay) {
    const c = this.ctx, g = c.createGain(), t = c.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    return g;
  }

  _noiseBurst(opts) {
    // opts: {freq, q, type, peak, attack, decay, pos, bus, sweepTo}
    if (!this._ok()) return;
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = opts.rate || 1;
    const f = c.createBiquadFilter();
    f.type = opts.type || 'bandpass';
    f.frequency.setValueAtTime(opts.freq, c.currentTime);
    if (opts.sweepTo) f.frequency.exponentialRampToValueAtTime(opts.sweepTo, c.currentTime + (opts.decay || 0.1));
    f.Q.value = opts.q || 1;
    const g = this._env(opts.peak || 0.5, opts.attack || 0.004, opts.decay || 0.1);
    src.connect(f); f.connect(g);
    this._out(g, opts.bus, opts.pos);
    src.start();
    src.stop(c.currentTime + (opts.attack || 0) + (opts.decay || 0.1) + 0.05);
  }

  _tone(opts) {
    // opts: {freq, type, peak, attack, decay, pos, bus, sweepTo, rate}
    if (!this._ok()) return;
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = opts.type || 'sine';
    o.frequency.setValueAtTime(opts.freq, c.currentTime);
    if (opts.sweepTo) o.frequency.exponentialRampToValueAtTime(opts.sweepTo, c.currentTime + (opts.decay || 0.1));
    const g = this._env(opts.peak || 0.4, opts.attack || 0.005, opts.decay || 0.1);
    o.connect(g);
    this._out(g, opts.bus, opts.pos);
    o.start();
    o.stop(c.currentTime + (opts.attack || 0) + (opts.decay || 0.1) + 0.05);
  }

  // ---------------------------- SFX ---------------------------------

  shot(weaponId, pos3d) {
    if (!this._ok()) return;
    const w = W[weaponId] || W.ar;
    this._noiseBurst({ freq: w.noiseHz, q: 0.9, type: 'bandpass', peak: w.level, decay: w.noiseDecay, pos: pos3d, rate: 0.9 + Math.random() * 0.2 });
    this._tone({ freq: w.thump, type: 'sine', peak: w.level * 0.9, decay: 0.09, pos: pos3d, sweepTo: w.thump * 0.5 });
    if (w.crack > 0.2) this._noiseBurst({ freq: 4200, q: 1.4, type: 'highpass', peak: w.crack * 0.4, decay: 0.045, pos: pos3d, rate: 1.1 });
  }

  dryFire() {
    this._tone({ freq: 2100, type: 'square', peak: 0.08, decay: 0.03 });
    this._tone({ freq: 900, type: 'square', peak: 0.06, decay: 0.04 });
  }

  uiClick() {
    this._tone({ freq: 220, type: 'square', peak: 0.05, decay: 0.035 });
    this._tone({ freq: 440, type: 'sine', peak: 0.03, decay: 0.05 });
  }

  reload(weaponId, stage) {
    if (!this._ok()) return;
    const t = this.ctx.currentTime;
    const click = (dt, f, p) => {
      const o = this.ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + dt);
      g.gain.linearRampToValueAtTime(p, t + dt + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.05);
      o.connect(g); g.connect(this.sfx);
      o.start(t + dt); o.stop(t + dt + 0.08);
    };
    if (stage === 'start') {
      click(0, 700, 0.16); click(0.09, 500, 0.14);
    } else {
      click(0, 900, 0.18); click(0.12, 1300, 0.16);
      if (weaponId === 'sniper') click(0.3, 1800, 0.2);
    }
  }

  impact(surface, pos3d) {
    if (!this._ok()) return;
    if (surface === 'metal') {
      this._noiseBurst({ freq: 3200, q: 4, type: 'bandpass', peak: 0.3, decay: 0.09, pos: pos3d });
      this._tone({ freq: 5200, type: 'sine', peak: 0.12, decay: 0.14, pos: pos3d, sweepTo: 2400 });
    } else if (surface === 'wood') {
      this._noiseBurst({ freq: 900, q: 1.2, type: 'bandpass', peak: 0.35, decay: 0.06, pos: pos3d, rate: 0.8 });
    } else if (surface === 'water') {
      this._noiseBurst({ freq: 500, q: 0.7, type: 'lowpass', peak: 0.25, decay: 0.12, pos: pos3d, rate: 0.6 });
    } else {
      this._noiseBurst({ freq: 420, q: 0.8, type: 'lowpass', peak: 0.32, decay: 0.06, pos: pos3d, rate: 0.85 });
    }
  }

  ricochet(pos3d) {
    this._tone({ freq: 2600, type: 'sine', peak: 0.1, decay: 0.11, pos: pos3d, sweepTo: 900 });
  }

  explosion(pos3d, big = true) {
    if (!this._ok()) return;
    this._noiseBurst({ freq: 900, q: 0.5, type: 'lowpass', peak: big ? 1.0 : 0.6, decay: big ? 0.9 : 0.5, pos: pos3d, sweepTo: 60, rate: 0.7 });
    this._tone({ freq: 52, type: 'sine', peak: big ? 0.9 : 0.5, decay: 0.55, pos: pos3d, sweepTo: 28 });
    this._noiseBurst({ freq: 2500, q: 1, type: 'highpass', peak: big ? 0.5 : 0.25, decay: 0.15, pos: pos3d });
  }

  step(surface, speed, pos3d) {
    if (!this._ok()) return;
    const rate = 0.8 + speed * 0.12 + Math.random() * 0.25;
    this._noiseBurst({ freq: surface === 'metal' ? 600 : 320, q: 0.9, type: 'lowpass', peak: 0.16 * (0.7 + speed * 0.15), decay: 0.055, pos: pos3d, rate });
    if (surface === 'metal') this._noiseBurst({ freq: 2400, q: 3, type: 'bandpass', peak: 0.05, decay: 0.05, pos: pos3d });
  }

  landing(pos3d) {
    this._noiseBurst({ freq: 260, q: 0.8, type: 'lowpass', peak: 0.4, decay: 0.12, pos: pos3d, rate: 0.7 });
  }

  hitMarker(kill = false) {
    this._tone({ freq: kill ? 1400 : 2300, type: 'square', peak: kill ? 0.14 : 0.09, decay: kill ? 0.06 : 0.03 });
  }

  pickup() {
    this._tone({ freq: 660, type: 'sine', peak: 0.12, decay: 0.08, sweepTo: 990 });
  }

  radioBeep() {
    this._tone({ freq: 1050, type: 'sine', peak: 0.1, decay: 0.09, bus: this.voice });
    setTimeout(() => this._ok() && this._tone({ freq: 1050, type: 'sine', peak: 0.08, decay: 0.07, bus: this.voice }), 130);
  }

  notification() {
    if (!this._ok()) return;
    this._tone({ freq: 880, type: 'sine', peak: 0.09, decay: 0.09, bus: this.voice });
    setTimeout(() => this._ok() && this._tone({ freq: 1318, type: 'sine', peak: 0.1, decay: 0.14, bus: this.voice }), 110);
  }

  flashbang(pos3d) {
    if (!this._ok()) return;
    this._noiseBurst({ freq: 5000, q: 0.7, type: 'highpass', peak: 0.7, decay: 0.5, pos: pos3d });
    this._tone({ freq: 6400, type: 'sine', peak: 0.2, decay: 0.8, pos: pos3d });
  }

  grenadeThrow() {
    this._noiseBurst({ freq: 1400, q: 0.7, type: 'bandpass', peak: 0.12, decay: 0.25, sweepTo: 500 });
  }

  victory() {
    if (!this._ok()) return;
    const t = this.ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      const o = this.ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + i * 0.16);
      g.gain.linearRampToValueAtTime(0.12, t + i * 0.16 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.16 + 0.5);
      o.connect(g); g.connect(this.music);
      o.start(t + i * 0.16); o.stop(t + i * 0.16 + 0.6);
    });
  }

  defeat() {
    if (!this._ok()) return;
    const t = this.ctx.currentTime;
    [392, 349.23, 261.63].forEach((f, i) => {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      const flt = this.ctx.createBiquadFilter();
      flt.type = 'lowpass'; flt.frequency.value = 900;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + i * 0.35);
      g.gain.linearRampToValueAtTime(0.08, t + i * 0.35 + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.35 + 0.7);
      o.connect(flt); flt.connect(g); g.connect(this.music);
      o.start(t + i * 0.35); o.stop(t + i * 0.35 + 0.8);
    });
  }

  // -------------------------- ambience -------------------------------

  startAmbience() {
    if (!this._ok() || this._ambienceOn) return;
    this._ambienceOn = true;
    const c = this.ctx;
    // wind (brown noise loop)
    const src = c.createBufferSource();
    src.buffer = this.windBuf; src.loop = true;
    const f = c.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 420;
    const g = c.createGain(); g.gain.value = 0.05;
    src.connect(f); f.connect(g); g.connect(this.sfx);
    src.start();
    // industrial hum
    const hum = c.createOscillator();
    hum.type = 'sawtooth'; hum.frequency.value = 50;
    const hf = c.createBiquadFilter();
    hf.type = 'lowpass'; hf.frequency.value = 140;
    const hg = c.createGain(); hg.gain.value = 0.014;
    hum.connect(hf); hf.connect(hg); hg.connect(this.sfx);
    hum.start();
  }

  /** Called each frame; drives scheduled ambience events. */
  update(dt, playing) {
    if (!this._ok() || !playing) return;
    this._musicTimer = Math.max(0, this._musicTimer - dt);
    if (this._musicTimer <= 0) {
      this._musicTimer = 12;
      this._advanceChord();
    }
    this._hornTimer -= dt;
    if (this._hornTimer <= 0) {
      this._hornTimer = 50 + Math.random() * 70;
      this._shipHorn();
    }
    this._gullTimer -= dt;
    if (this._gullTimer <= 0) {
      this._gullTimer = 15 + Math.random() * 35;
      this._gulls();
    }
    // smooth the tension parameter
    this.tension += (this._tensionTarget - this.tension) * Math.min(1, dt * 1.2);
    if (this._musicGains) {
      const t = this.ctx.currentTime;
      this._musicGains.filter.frequency.setTargetAtTime(240 + this.tension * 950, t, 0.3);
      this._musicGains.gain.gain.setTargetAtTime(0.09 + this.tension * 0.1, t, 0.3);
    }
  }

  setTension(v) { this._tensionTarget = Math.max(0, Math.min(1, v)); }

  _shipHorn() {
    if (!this._ok()) return;
    const c = this.ctx, t = c.currentTime;
    [65, 65.6, 97.5].forEach((f) => {
      const o = c.createOscillator();
      o.type = 'sawtooth'; o.frequency.value = f;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.035, t + 0.7);
      g.gain.setValueAtTime(0.035, t + 1.4);
      g.gain.linearRampToValueAtTime(0.0001, t + 2.2);
      o.connect(g); g.connect(this.sfx);
      o.start(t); o.stop(t + 2.3);
    });
  }

  _gulls() {
    if (!this._ok()) return;
    const c = this.ctx, t = c.currentTime;
    const n = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++) {
      const o = c.createOscillator();
      o.type = 'sine';
      const f0 = 1900 + Math.random() * 500;
      o.frequency.setValueAtTime(f0, t + i * 0.5);
      o.frequency.linearRampToValueAtTime(f0 * 0.8, t + i * 0.5 + 0.3);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t + i * 0.5);
      g.gain.linearRampToValueAtTime(0.02, t + i * 0.5 + 0.08);
      g.gain.linearRampToValueAtTime(0.0001, t + i * 0.5 + 0.4);
      o.connect(g); g.connect(this.sfx);
      o.start(t + i * 0.5); o.stop(t + i * 0.5 + 0.45);
    }
  }

  // --------------------------- music --------------------------------

  startMusic() {
    this._wantMusic = true;
    if (!this._ok() || this.musicOn) return;
    this.musicOn = true;
    const c = this.ctx;
    const o1 = c.createOscillator(); o1.type = 'sawtooth';
    const o2 = c.createOscillator(); o2.type = 'sawtooth'; o2.detune.value = 7;
    const o3 = c.createOscillator(); o3.type = 'triangle';
    const flt = c.createBiquadFilter();
    flt.type = 'lowpass'; flt.frequency.value = 260; flt.Q.value = 0.8;
    const g = c.createGain(); g.gain.value = 0.1;
    o1.connect(flt); o2.connect(flt); o3.connect(flt);
    flt.connect(g); g.connect(this.music);
    // slow filter LFO for movement
    const lfo = c.createOscillator(); lfo.frequency.value = 0.05;
    const lfoG = c.createGain(); lfoG.gain.value = 90;
    lfo.connect(lfoG); lfoG.connect(flt.frequency);
    o1.start(); o2.start(); o3.start(); lfo.start();
    this._music = { o1, o2, o3 };
    this._musicGains = { filter: flt, gain: g };
    this._chordIdx = 0;
    this._applyChord();
  }

  stopMusic() {
    this.musicOn = false;
    if (this._music) {
      const c = this.ctx, t = c.currentTime;
      const { o1, o2, o3 } = this._music;
      [o1, o2, o3].forEach((o) => { try { o.stop(t + 0.5); } catch (e) { /* already stopped */ } });
      this._music = null;
      this._musicGains = null;
    }
  }

  _advanceChord() { this._chordIdx = (this._chordIdx + 1) % 4; this._applyChord(); }

  _applyChord() {
    if (!this._music) return;
    // Dm / Bb / F / C  (dark, patient, industrial)
    const chords = [[73.42, 87.31, 110.0], [61.74, 73.42, 87.31], [43.65, 55.0, 65.41], [49.0, 61.74, 73.42]];
    const ch = chords[this._chordIdx];
    const t = this.ctx.currentTime;
    this._music.o1.frequency.setTargetAtTime(ch[0] * 2, t, 1.2);
    this._music.o2.frequency.setTargetAtTime(ch[1] * 2, t, 1.2);
    this._music.o3.frequency.setTargetAtTime(ch[2], t, 1.2);
  }
}
