/**
 * Grenades — fragmentation, smoke and flashbang with real projectile
 * physics, bouncing, fuses and effects.
 */
import * as THREE from '../../vendor/three.module.js';
import { rand } from '../core/Utils.js';

const GRENADE_TYPES = {
  frag:  { name: 'FRAG',  color: 0x3d4a35, fuse: 2.3 },
  smoke: { name: 'SMOKE', color: 0x777d85, fuse: -1 },   // -1 = impact
  flash: { name: 'FLASH', color: 0xcfd4da, fuse: -1 }
};

export class GrenadeSystem {
  constructor(app) {
    this.app = app;
    this.counts = { frag: 2, smoke: 1, flash: 1 };
    this.selected = 0; // index into ['frag','smoke','flash']
    this.active = [];
    this._keyOrder = ['frag', 'smoke', 'flash'];
    this._geo = new THREE.SphereGeometry(0.075, 8, 6);
  }

  get selectedType() { return this._keyOrder[this.selected]; }

  cycle() {
    this.selected = (this.selected + 1) % 3;
    this.markDirty();
  }

  add(type) {
    this.counts[type] = (this.counts[type] || 0) + 1;
    this.markDirty();
  }

  markDirty() {
    if (this.app.hud) this.app.hud.setGrenades(this.counts, this.selectedType);
  }

  throw() {
    const app = this.app;
    const player = app.player;
    if (player.dead) return;
    const type = this.selectedType;
    if ((this.counts[type] || 0) <= 0) return;
    this.counts[type]--;
    this.markDirty();

    const mat = new THREE.MeshStandardMaterial({ color: GRENADE_TYPES[type].color, roughness: 0.5, metalness: 0.6 });
    const mesh = new THREE.Mesh(this._geo, mat);
    const fwd = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
    const up = new THREE.Vector3(0, 1, 0);
    const meshPos = player.pos.clone().addScaledVector(fwd, 0.5).add(new THREE.Vector3(0, player.eyeHeight - 0.3, 0));
    mesh.position.copy(meshPos);
    app.scene.add(mesh);

    const vel = fwd.clone().multiplyScalar(13).addScaledVector(up, 2.6);
    this.active.push({
      type, mesh, vel,
      fuse: GRENADE_TYPES[type].fuse,
      bounced: false,
      impactDelay: 0
    });
    app.audio.grenadeThrow();
    app.emitter.emit('hearing', { x: meshPos.x, z: meshPos.z, radius: 20, strength: 0.4, type: 'throw' });
    app.emitter.emit('grenade-thrown');
    this._spin = rand(6, 12);
  }

  update(dt) {
    const app = this.app;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const g = this.active[i];
      // physics
      g.vel.y -= 20 * dt;
      g.mesh.position.addScaledVector(g.vel, dt);
      g.mesh.rotation.x += this._spin * dt;
      g.mesh.rotation.z += this._spin * 0.6 * dt;
      // ground
      if (g.mesh.position.y < 0.08) {
        g.mesh.position.y = 0.08;
        g.vel.y *= -0.38;
        g.vel.x *= 0.7;
        g.vel.z *= 0.7;
        if (!g.bounced) {
          g.bounced = true;
          this._onBounce(g);
        }
      }
      // walls (simple push-out against world colliders)
      for (const c of app.world.colliders) {
        const p = g.mesh.position;
        if (p.x > c.minx - 0.08 && p.x < c.maxx + 0.08 &&
            p.z > c.minz - 0.08 && p.z < c.maxz + 0.08 &&
            p.y > c.miny && p.y < c.maxy) {
          const dxl = p.x - (c.minx - 0.08), dxr = (c.maxx + 0.08) - p.x;
          const dzl = p.z - (c.minz - 0.08), dzr = (c.maxz + 0.08) - p.z;
          const m = Math.min(dxl, dxr, dzl, dzr);
          if (m === dxl) { p.x = c.minx - 0.08; g.vel.x = -Math.abs(g.vel.x) * 0.4; }
          else if (m === dxr) { p.x = c.maxx + 0.08; g.vel.x = Math.abs(g.vel.x) * 0.4; }
          else if (m === dzl) { p.z = c.minz - 0.08; g.vel.z = -Math.abs(g.vel.z) * 0.4; }
          else { p.z = c.maxz + 0.08; g.vel.z = Math.abs(g.vel.z) * 0.4; }
          if (!g.bounced) { g.bounced = true; this._onBounce(g); }
        }
      }
      // fuse
      if (g.fuse > 0) {
        g.fuse -= dt;
        if (g.fuse <= 0) {
          this._explodeFrag(g);
          this.active.splice(i, 1);
          app.scene.remove(g.mesh);
        }
      }
    }
  }

  _onBounce(g) {
    const app = this.app;
    const t = g.type;
    if (t === 'smoke') {
      app.fx.smokeColumn(g.mesh.position, 10);
      app.fx.addSmokeZone(g.mesh.position.x, g.mesh.position.y + 1, g.mesh.position.z, 2.6, 10);
      app.audio.impact('wood', g.mesh.position);
      app.scene.remove(g.mesh);
      this.active.splice(this.active.indexOf(g), 1);
    } else if (t === 'flash') {
      app.audio.flashbang(g.mesh.position);
      app.fx.burst(g.mesh.position, { count: 20, color: [0xffffff, 0xfff2c0], speed: 6, size: 0.06, life: 0.3, gravity: 0 });
      // blind enemies in radius + whiteout the player's screen briefly
      app.enemies.blindNear(g.mesh.position, 16);
      app.hud.flashWhite(0.9);
      app.emitter.emit('hearing', { x: g.mesh.position.x, z: g.mesh.position.z, radius: 40, strength: 0.9, type: 'flash' });
      app.scene.remove(g.mesh);
      this.active.splice(this.active.indexOf(g), 1);
    } else {
      app.audio.impact('metal', g.mesh.position);
    }
  }

  _explodeFrag(g) {
    const app = this.app;
    app.explode(g.mesh.position, { radius: 7, damage: 90, label: 'frag grenade' });
  }

  dispose() {
    for (const g of this.active) this.app.scene.remove(g.mesh);
    this.active.length = 0;
  }
}
