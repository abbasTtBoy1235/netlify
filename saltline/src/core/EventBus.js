/**
 * EventBus — lightweight typed event communication between systems.
 * Mirrors the Unity Event/Action pattern: systems emit, UI/HUD subscribe,
 * so gameplay code never imports UI code.
 */
export class EventBus {
  constructor() {
    this.map = new Map();
  }

  /** Subscribe. Returns an unsubscribe function. */
  on(evt, fn) {
    if (!this.map.has(evt)) this.map.set(evt, new Set());
    this.map.get(evt).add(fn);
    return () => this.off(evt, fn);
  }

  off(evt, fn) {
    const set = this.map.get(evt);
    if (set) set.delete(fn);
  }

  emit(evt, data) {
    const set = this.map.get(evt);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(data);
      } catch (e) {
        console.error(`[EventBus] handler error for "${evt}"`, e);
      }
    }
  }

  clear() {
    this.map.clear();
  }
}
