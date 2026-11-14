/**
 * SALTLINE — entry point.
 * Boots the App (renderer, scene, camera, UI shell) and hands control
 * to the main menu. All gameplay systems are constructed per-mission
 * by App.startMission() and disposed on exit.
 */
import { App } from './core/App.js';
import { startAutoplay } from './debug/autoplay.js';

const container = document.getElementById('gl');
let app;
try {
  app = new App(container);
  window.__saltline_app = app; // debug / test hook
  app.start();
} catch (err) {
  // surface boot failures on the boot screen instead of freezing silently
  const boot = document.getElementById('boot');
  if (boot) {
    const t = boot.querySelector('.boot-text');
    if (t) {
      t.textContent = 'BOOT FAILED — ' + (err && err.message ? err.message : err) +
        '  (check the console: F12)';
      t.style.color = '#ff6b57';
      t.style.letterSpacing = '0.06em';
    }
    const bar = boot.querySelector('.boot-bar');
    if (bar) bar.style.display = 'none';
  }
  console.error('[SALTLINE] boot failed', err);
}

// ?autoplay=1 — headless mission test driver (see debug/autoplay.js)
if (new URLSearchParams(location.search).has('autoplay')) {
  startAutoplay(app);
}
