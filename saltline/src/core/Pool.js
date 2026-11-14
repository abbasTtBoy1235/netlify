/**
 * Pool — object pooling for frequently spawned transient objects
 * (tracers, casings, particles, decals). Mirrors Unity ObjectPool usage.
 */
export class Pool {
  /**
   * @param {Function} factory  creates a fresh item
   * @param {Function} [reset]  called with the item on release (hide / reinit)
   * @param {number} [initial]  warm count
   */
  constructor(factory, reset, initial = 8) {
    this.factory = factory;
    this.reset = reset || (() => {});
    this.free = [];
    this.alive = [];
    for (let i = 0; i < initial; i++) this.free.push(factory());
  }

  get() {
    const item = this.free.length ? this.free.pop() : this.factory();
    this.alive.push(item);
    return item;
  }

  release(item) {
    const i = this.alive.indexOf(item);
    if (i >= 0) this.alive.splice(i, 1);
    this.reset(item);
    this.free.push(item);
  }

  releaseAll() {
    while (this.alive.length) this.release(this.alive[0]);
  }

  get count() { return this.alive.length; }

  dispose() {
    this.releaseAll();
    this.free.length = 0;
  }
}
