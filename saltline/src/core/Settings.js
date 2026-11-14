/**
 * Settings — player-configurable options, auto-saved to localStorage.
 * Video presets drive render scale, shadows, particle density and fog.
 */
import { clamp } from './Utils.js';

export const PRESETS = {
  LOW:    { pixelRatio: 1.0,  shadows: false,  shadowSize: 0,    particles: 0.4,  fog: 0.011,  rain: 300,  detail: 'low' },
  MEDIUM: { pixelRatio: 1.25, shadows: true,   shadowSize: 1024, particles: 0.7,  fog: 0.008,  rain: 600,  detail: 'low' },
  HIGH:   { pixelRatio: 1.5,  shadows: true,   shadowSize: 2048, particles: 1.0,  fog: 0.006,  rain: 900,  detail: 'full' },
  ULTRA:  { pixelRatio: 0,    shadows: true,   shadowSize: 2048, particles: 1.6,  fog: 0.005,  rain: 1200, detail: 'full' } // 0 = native dpr
};

const DEFAULTS = {
  // gameplay
  sensitivity: 1.0,      // 0.2 .. 3
  adsSensScale: 0.5,     // multiplier while aiming
  fov: 75,               // 60 .. 110
  crosshairSize: 1.0,    // 0.5 .. 2
  crosshairColor: '#9fd6ff',
  cameraShake: 1.0,      // 0 .. 1
  // video
  preset: 'HIGH',
  rain: false,
  // audio
  masterVol: 0.8,
  musicVol: 0.55,
  sfxVol: 0.9,
  voiceVol: 0.8
};

const KEY = 'saltline.settings.v1';

export class Settings {
  constructor() {
    this.data = { ...DEFAULTS };
    this.load();
  }

  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const obj = JSON.parse(raw);
        for (const k of Object.keys(DEFAULTS)) {
          if (typeof obj[k] === typeof DEFAULTS[k]) this.data[k] = obj[k];
        }
      }
    } catch (e) { console.warn('[Settings] load failed', e); }
    this.sanitize();
  }

  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); }
    catch (e) { console.warn('[Settings] save failed', e); }
  }

  sanitize() {
    const d = this.data;
    d.sensitivity = clamp(d.sensitivity, 0.2, 3);
    d.adsSensScale = clamp(d.adsSensScale, 0.2, 1);
    d.fov = clamp(d.fov, 60, 110);
    d.crosshairSize = clamp(d.crosshairSize, 0.5, 2);
    d.cameraShake = clamp(d.cameraShake, 0, 1);
    for (const k of ['masterVol', 'musicVol', 'sfxVol', 'voiceVol']) d[k] = clamp(d[k], 0, 1);
    if (!PRESETS[d.preset]) d.preset = 'HIGH';
  }

  set(key, value) {
    this.data[key] = value;
    this.sanitize();
    this.save();
  }

  get presetCfg() {
    return PRESETS[this.data.preset];
  }

  /** Live-apply the values that can change without a rebuild. */
  applyLive(app) {
    if (!app) return;
    const d = this.data;
    if (app.camera) {
      app.camera.fov = d.fov;
      app.camera.updateProjectionMatrix();
    }
    if (app.audio) app.audio.setVolumes(d.masterVol, d.musicVol, d.sfxVol, d.voiceVol);
    if (app.input) app.input.refresh();
    if (app.hud) app.hud.applySettings(d);
    if (app.fogRef) {
      app.fogRef.density = this.presetCfg.fog;
    }
  }

  /** Full graphics rebuild (renderer pixel ratio, shadows, fog, rain density). */
  applyGraphics(app) {
    const cfg = this.presetCfg;
    const pr = cfg.pixelRatio === 0 ? window.devicePixelRatio : cfg.pixelRatio;
    app.renderer.setPixelRatio(Math.min(pr, 2));
    app.renderer.shadowMap.enabled = cfg.shadows;
    if (cfg.shadows && app.sun) {
      app.sun.castShadow = true;
      app.sun.shadow.mapSize.set(cfg.shadowSize, cfg.shadowSize);
      if (app.sun.shadow.map) { app.sun.shadow.map.dispose(); app.sun.shadow.map = null; }
    } else if (app.sun) {
      app.sun.castShadow = false;
    }
    if (app.fogRef) app.fogRef.density = cfg.fog;
    if (app.world) app.world.setRainEnabled(!!this.data.rain, cfg.rain);
    if (app.hud) app.hud.applySettings(this.data);
    app.resize();
  }
}
