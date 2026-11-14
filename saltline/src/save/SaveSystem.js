/**
 * SaveSystem — persistent save state (checkpoint + settings live in
 * localStorage). Mirrors the Unity SaveSystem/ScriptableObject intent:
 * serializable, versioned, crash-safe.
 */
const SAVE_KEY = 'saltline.save.v1';

export class SaveSystem {
  static hasSave() {
    try { return !!localStorage.getItem(SAVE_KEY); }
    catch (e) { return false; }
  }

  static load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.warn('[Save] load failed', e);
      return null;
    }
  }

  static save(data) {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); return true; }
    catch (e) { console.warn('[Save] save failed', e); return false; }
  }

  static clear() {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* noop */ }
  }
}
