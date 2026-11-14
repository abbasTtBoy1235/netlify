/**
 * SALTLINE — entry point.
 * Boots the App (renderer, scene, camera, UI shell) and hands control
 * to the main menu. All gameplay systems are constructed per-mission
 * by App.startMission() and disposed on exit.
 */
import { App } from './core/App.js';
import { startAutoplay } from './debug/autoplay.js';

const container = document.getElementById('gl');
const app = new App(container);
window.__saltline_app = app; // debug / test hook
app.start();

// ?autoplay=1 — headless mission test driver (see debug/autoplay.js)
if (new URLSearchParams(location.search).has('autoplay')) {
  startAutoplay(app);
}
