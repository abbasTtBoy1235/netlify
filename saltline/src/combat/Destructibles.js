/**
 * Destructibles — explosive barrels, ammo crates, breakable wooden
 * crates and the large fuel tank. Take bullet + splash damage, chain
 * react, and drop occasional loot.
 */
import * as THREE from '../../vendor/three.module.js';
import { rand } from '../core/Utils.js';

const HP = { fuel: 40, ammo: 30, crate: 25, tank: 90 };
const BOOM = {
  fuel:  { radius: 6, damage: 80 },
  ammo:  { radius: 4, damage: 55 },
  tank:  { radius: 8, damage: 100 }
};

export class Destructibles {
  constructor(app) {
    this.app = app;
    this.items = [];
    app.world.dprops.forEach((dp, i) => {
      this.items.push({ ...dp, id: i, hp: HP[dp.type] || 25, alive: true });
      dp.mesh.userData.dpropId = i;
    });
  }

  get aliveCount() {
    return this.items.reduce((n, it) => n + (it.alive ? 1 : 0), 0);
  }

  /** Direct bullet damage. */
  damage(id, amount, point) {
    const it = this.items[id];
    if (!it || !it.alive) return;
    it.hp -= amount;
    // hit feedback
    this.app.fx.burst(point, {
      count: 5,
      color: it.type === 'crate' ? [0x8a6a3a] : [0x8a8a82],
      speed: 2.5, size: 0.05, life: 0.3, gravity: 6
    });
    if (it.hp <= 0) this.destroy(it);
  }

  /** Splash damage from an explosion at pos. */
  splash(pos, radius) {
    for (const it of this.items) {
      if (!it.alive) continue;
      const dx = it.x - pos.x, dz = it.z - pos.z;
      const d = Math.hypot(dx, dz);
      if (d < radius) this.destroy(it);
    }
  }

  destroy(it) {
    if (!it.alive) return;
    const app = this.app;
    it.alive = false;
    it.mesh.visible = false;
    const p = new THREE.Vector3(it.x, it.type === 'tank' ? 3 : 0.7, it.z);
    if (it.type === 'crate') {
      app.fx.burst(p, { count: 16, color: [0x8a6a3a, 0x5d4a30, 0x3a2e1c], speed: 5, size: 0.12, life: 0.9, gravity: 9, up: 2 });
      app.audio.impact('wood', p);
      if (Math.random() < 0.25) app.pickups.drop(it.x, it.z, Math.random() < 0.5 ? 'ammo' : 'health');
    } else {
      const boom = BOOM[it.type];
      app.explode(p, { radius: boom.radius, damage: boom.damage, label: it.type });
    }
  }
}
