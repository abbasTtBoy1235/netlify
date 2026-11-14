/**
 * Pickups — health, armor, ammo, grenade and weapon caches placed in
 * the world or dropped by enemies. Auto-collected on proximity.
 */
import * as THREE from '../../vendor/three.module.js';
import { rand } from '../core/Utils.js';

const SPEC = {
  health:  { color: 0xd8dde2, label: '+35 HEALTH' },
  armor:   { color: 0x4a7ab8, label: '+40 ARMOR' },
  ammo:    { color: 0x8a9a5a, label: '+60 AMMO' },
  grenade: { color: 0x5a6a4a, label: '+1 FRAG GRENADE' },
  weapon:  { color: 0x33383e, label: 'WEAPON' }
};

export class PickupSystem {
  constructor(app) {
    this.app = app;
    this.items = [];
    this._box = new THREE.BoxGeometry(1, 1, 1);
    this._mats = {};
    for (const k of Object.keys(SPEC)) {
      this._mats[k] = new THREE.MeshStandardMaterial({
        color: SPEC[k].color,
        emissive: SPEC[k].color,
        emissiveIntensity: 0.35,
        roughness: 0.5,
        metalness: 0.2
      });
    }
    // spawn from level data
    for (const p of app.world.pickups) this._spawn(p.x, 0.45, p.z, p.type);
    for (const p of app.world.weaponPickups) this._spawn(p.x, p.y, p.z, 'weapon', p);
  }

  _spawn(x, y, z, type, data = null) {
    const spec = SPEC[type];
    const m = new THREE.Mesh(this._box, this._mats[type]);
    const s = type === 'weapon' ? [0.7, 0.16, 0.16] : [0.42, 0.3, 0.42];
    m.scale.set(...s);
    m.position.set(x, y, z);
    this.app.scene.add(m);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.45, 0.55, 20),
      new THREE.MeshBasicMaterial({ color: spec.color, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.03, z);
    this.app.scene.add(ring);
    this.items.push({ x, y, z, type, data, mesh: m, ring, phase: Math.random() * 6, alive: true });
  }

  /** Enemy loot drop. */
  drop(x, z, type) {
    this._spawn(x + rand(-0.4, 0.4), 0.45, z + rand(-0.4, 0.4), type);
  }

  update(dt, t) {
    const app = this.app;
    const player = app.player;
    for (const it of this.items) {
      if (!it.alive) continue;
      it.mesh.rotation.y += dt * 1.2;
      it.mesh.position.y = it.y + Math.sin(t * 2 + it.phase) * 0.07;
      it.ring.material.opacity = 0.3 + 0.2 * Math.sin(t * 3 + it.phase);
      if (player.dead) continue;
      const dx = player.pos.x - it.x, dz = player.pos.z - it.z;
      if (dx * dx + dz * dz < 1.6) {
        this._collect(it);
      }
    }
  }

  _collect(it) {
    const app = this.app;
    const p = app.player;
    let gained = true;
    switch (it.type) {
      case 'health':
        if (p.health >= 100) gained = false;
        else p.heal(35);
        break;
      case 'armor':
        if (p.armor >= 100) gained = false;
        else p.addArmor(40);
        break;
      case 'ammo':
        app.weapons.addReserve(app.weapons.current.def.id, 60);
        break;
      case 'grenade':
        app.grenades.add('frag');
        break;
      case 'weapon':
        app.weapons.addWeapon(it.data.weapon);
        break;
    }
    if (!gained) return; // leave the item behind
    it.alive = false;
    app.scene.remove(it.mesh);
    app.scene.remove(it.ring);
    app.audio.pickup();
    app.hud.notify(SPEC[it.type].label + (it.data && it.data.label ? ' — ' + it.data.label : ''), 'good');
  }

  dispose() {
    for (const it of this.items) {
      if (it.alive) {
        this.app.scene.remove(it.mesh);
        this.app.scene.remove(it.ring);
      }
    }
    this.items.length = 0;
  }
}
