/**
 * Relay — enemy uplink relay station. Destructible objective: takes
 * bullet/explosion damage, can be destroyed by hacking at the console
 * (hold F), blinks its beacon while alive.
 */
import * as THREE from '../../vendor/three.module.js';

const LABELS = { A: 'ALPHA', B: 'BRAVO', C: 'CHARLIE' };

export class Relay {
  constructor(scene, id, pos) {
    this.id = id;
    this.label = LABELS[id];
    this.pos = { x: pos.x, y: 0, z: pos.z };
    this.maxHp = 300;
    this.hp = 300;
    this.destroyed = false;
    this.interactT = 0;
    this._dieT = -1;

    this.group = new THREE.Group();
    this.meshes = [];
    const steel = new THREE.MeshStandardMaterial({ color: 0x3a4149, roughness: 0.55, metalness: 0.7 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x22262b, roughness: 0.7, metalness: 0.5 });
    const box = (w, h, d, mat, x, y, z, rx = 0, ry = 0) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
      m.scale.set(w, h, d);
      m.position.set(x, y, z);
      m.rotation.x = rx;
      m.rotation.y = ry;
      m.userData.relayId = id;
      this.group.add(m);
      this.meshes.push(m);
      return m;
    };
    // base + mast
    box(2.6, 0.35, 2.6, dark, 0, 0.18, 0);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 9, 8), steel);
    mast.position.y = 4.8;
    mast.userData.relayId = id;
    this.group.add(mast);
    this.meshes.push(mast);
    // head unit
    this.head = box(1.5, 1.0, 1.2, steel, 0, 9.5, 0);
    // dish
    this.dish = new THREE.Group();
    const dishMat = new THREE.MeshStandardMaterial({ color: 0x8a929a, roughness: 0.3, metalness: 0.9, side: THREE.DoubleSide });
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.08, 12), dishMat);
    disc.rotation.z = 0.7;
    disc.rotation.x = -0.4;
    disc.userData.relayId = id;
    this.dish.add(disc);
    this.meshes.push(disc);
    const strut = box(0.08, 0.6, 0.08, dark, 0, -0.25, 0);
    this.dish.add(strut);
    this.dish.position.set(0, 9.6, 0.7);
    this.group.add(this.dish);
    // beacon
    const beaconMat = new THREE.MeshStandardMaterial({ color: 0x300505, emissive: 0xff2015, emissiveIntensity: 2.5 });
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), beaconMat);
    beacon.position.y = 10.2;
    beacon.userData.relayId = id;
    this.group.add(beacon);
    this.meshes.push(beacon);
    this.beaconMat = beaconMat;
    this.beaconLight = new THREE.PointLight(0xff2015, 8, 14, 2);
    this.beaconLight.position.y = 10.2;
    this.group.add(this.beaconLight);
    // console (interaction marker)
    box(0.7, 1.0, 0.5, dark, 1.5, 0.5, 1.2);

    this.group.position.set(pos.x, 0, pos.z);
    scene.add(this.group);
  }

  get worldPos() { return { x: this.pos.x, y: 6, z: this.pos.z }; }

  damage(amount, point, fromPos) {
    if (this.destroyed) return;
    this.hp -= amount;
    this.app?.fx?.burst(point, { count: 4, color: [0xffc873, 0x8a929a], speed: 3, size: 0.05, life: 0.3, gravity: 6 });
    if (this.hp <= 0) this.destroy('fire');
  }

  destroy(cause) {
    if (this.destroyed) return;
    this.destroyed = true;
    this.destroyCause = cause;
    this._dieT = 0;
    this.beaconLight.intensity = 0;
    this.beaconMat.emissiveIntensity = 0.1;
    // disable hit detection on all parts
    for (const m of this.meshes) m.userData.relayId = null;
    const app = this.appRef;
    if (app) {
      const p = new THREE.Vector3(this.pos.x, 9.5, this.pos.z);
      app.fx.explosion(p, 5);
      app.audio.explosion(p, true);
      app.emitter.emit('relay-destroyed', { id: this.id, label: this.label, cause });
      app.mission.relayDestroyed(this.id);
    }
  }

  /** Set by App for effect wiring. */
  set appRef(app) { this.app = app; }
  get appRef() { return this.app; }

  update(dt, t) {
    if (!this.destroyed) {
      const blink = Math.sin(t * 5) > 0;
      this.beaconMat.emissiveIntensity = blink ? 2.8 : 0.3;
      this.beaconLight.intensity = blink ? 9 : 1;
      this.dish.rotation.y = Math.sin(t * 0.4) * 0.5;
    } else {
      this._dieT += dt;
      const k = Math.min(1, this._dieT / 0.9);
      this.dish.rotation.x = -0.4 + k * 1.4;
      this.dish.position.y = 9.6 - k * 1.2;
      this.head.scale.y = Math.max(0.2, 1 - k * 0.6);
    }
  }

  dispose(scene) {
    scene.remove(this.group);
    for (const m of this.meshes) m.geometry.dispose();
  }
}
