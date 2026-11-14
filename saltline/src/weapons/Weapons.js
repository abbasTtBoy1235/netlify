/**
 * Weapons — data-driven weapon definitions + the player weapon system:
 * firing modes (semi/auto/burst), magazines & reload, ADS with FOV
 * shift, recoil, spread, tracers, muzzle flash, casing ejection and
 * procedural first-person view models.
 */
import * as THREE from '../../vendor/three.module.js';
import { clamp, damp, rand } from '../core/Utils.js';

export const WEAPON_DEFS = {
  ar: {
    id: 'ar', name: 'M4V "VEX" CARBINE', short: 'M4V',
    damage: 22, headMult: 2.5, rpm: 510, auto: true, burst: 3,
    magSize: 30, reserve0: 180, reloadTime: 2.1,
    spreadHip: 1.7, spreadADS: 0.55, recoil: 0.011, range: 130,
    sound: 'ar', adsFov: 56, adsSens: 0.55,
    model: { len: 0.78, color: 0x2a2e33, accent: 0x3a4046, mag: 0.2, sight: 'red' }
  },
  smg: {
    id: 'smg', name: 'PM-90 SIDEARM CARBINE', short: 'PM-90',
    damage: 14, headMult: 2.4, rpm: 690, auto: true, burst: 0,
    magSize: 32, reserve0: 192, reloadTime: 1.7,
    spreadHip: 2.3, spreadADS: 0.8, recoil: 0.007, range: 70,
    sound: 'smg', adsFov: 62, adsSens: 0.6,
    model: { len: 0.52, color: 0x333a40, accent: 0x4a525a, mag: 0.17, sight: 'dot' }
  },
  pistol: {
    id: 'pistol', name: 'P-9 SIDEARM', short: 'P-9',
    damage: 27, headMult: 2.6, rpm: 270, auto: false, burst: 0,
    magSize: 15, reserve0: 60, reloadTime: 1.4,
    spreadHip: 1.3, spreadADS: 0.4, recoil: 0.009, range: 60,
    sound: 'pistol', adsFov: 65, adsSens: 0.6,
    model: { len: 0.3, color: 0x26292e, accent: 0x3a3f45, mag: 0.1, sight: 'iron', pistol: true }
  },
  sniper: {
    id: 'sniper', name: 'HARKAN-14 SNIPER RIFLE', short: 'HARKAN-14',
    damage: 95, headMult: 2.2, rpm: 51, auto: false, burst: 0,
    magSize: 5, reserve0: 25, reloadTime: 2.8,
    spreadHip: 1.0, spreadADS: 0.06, recoil: 0.032, range: 300,
    sound: 'sniper', adsFov: 24, adsSens: 0.35,
    model: { len: 1.05, color: 0x1f2428, accent: 0x2e343a, mag: 0.16, sight: 'scope' }
  }
};

const MODE_LABEL = (def, mode) => def.auto ? (mode === 'auto' ? 'AUTO' : 'BURST') : (def.burst ? 'BURST' : 'SEMI');

export class WeaponSystem {
  constructor(app) {
    this.app = app;
    this.group = new THREE.Group();
    app.camera.add(this.group);
    this.weapons = [];          // slot -> weapon instance
    this.active = 0;
    this._buildAll();
    this.bobY = 0; this.bobX = 0; this.bobAmp = 0; this.hSpeed = 0;
    this.adsT = 0;
    this._switchT = 1;
    this._reloadT = -1;
    this._fireCooldown = 0;
    this._burstLeft = 0;
    this._muzzleWorld = new THREE.Vector3();
    this._rayDir = new THREE.Vector3();
    this._camDir = new THREE.Vector3();
  }

  // -------------------------------------------------------- construction

  _mat(color, metal = 0.7, rough = 0.45) {
    return new THREE.MeshStandardMaterial({ color, metalness: metal, roughness: rough });
  }

  _buildModel(def) {
    const g = new THREE.Group();
    const M = (w, h, d, mat, x, y, z, rx = 0) => {
      const m = new THREE.Mesh(this._unitBox(), mat);
      m.scale.set(w, h, d);
      m.position.set(x, y, z);
      if (rx) m.rotation.x = rx;
      g.add(m);
      return m;
    };
    const main = this._mat(def.model.color);
    const acc = this._mat(def.model.accent, 0.8, 0.35);
    const dark = this._mat(0x14171a, 0.5, 0.6);
    const L = def.model.len;
    const pistol = !!def.model.pistol;

    // receiver
    M(0.062, 0.075, L * 0.62, main, 0, 0, -L * 0.18);
    // barrel
    M(0.032, 0.032, L * 0.5, dark, 0, 0.012, -L * 0.62);
    // handguard
    M(0.05, 0.05, L * 0.3, acc, 0, 0.004, -L * 0.42);
    // muzzle brake
    M(0.04, 0.04, 0.06, dark, 0, 0.012, -L * 0.86);
    // stock
    if (!pistol) M(0.05, 0.07, L * 0.3, acc, 0, -0.015, L * 0.22);
    // grip
    M(0.035, 0.09, 0.045, dark, 0, -0.07, pistol ? -L * 0.05 : L * 0.02, 0.25);
    // magazine
    M(0.04, def.model.mag, 0.05, dark, 0, -0.075 - def.model.mag / 2 + 0.035, pistol ? -L * 0.12 : -L * 0.05, pistol ? 0.12 : 0.35);
    // trigger guard
    M(0.02, 0.02, 0.05, dark, 0, -0.045, pistol ? -L * 0.02 : 0);
    // sights
    if (def.model.sight === 'red' || def.model.sight === 'dot') {
      M(0.05, 0.03, 0.05, dark, 0, 0.06, -L * 0.3);
      const dot = new THREE.Mesh(this._unitBox(), this._mat(0xff3020, 0.1, 0.4));
      dot.scale.set(0.012, 0.012, 0.012);
      dot.position.set(0, 0.062, -L * 0.31);
      dot.material.emissive = new THREE.Color(0xff3020);
      dot.material.emissiveIntensity = 2;
      g.add(dot);
    } else if (def.model.sight === 'scope') {
      const scope = new THREE.Mesh(this._cyl(), this._mat(0x111417, 0.4, 0.4));
      scope.scale.set(0.055, 0.055, 0.34);
      scope.rotation.x = Math.PI / 2;
      scope.position.set(0, 0.075, -L * 0.32);
      g.add(scope);
      M(0.03, 0.02, 0.03, dark, 0, 0.045, -L * 0.22);
      M(0.03, 0.02, 0.03, dark, 0, 0.045, -L * 0.42);
    } else {
      M(0.012, 0.02, 0.012, dark, 0, 0.05, L * 0.02);
      M(0.012, 0.022, 0.02, dark, 0, 0.05, -L * 0.4);
    }
    // hands (simplified)
    const skin = this._mat(0x8a6f57, 0.1, 0.8);
    const glove = this._mat(0x23262a, 0.2, 0.8);
    this.handR = M(0.045, 0.05, 0.09, glove, 0, -0.06, pistol ? -L * 0.03 : L * 0.02);
    this.handL = M(0.045, 0.045, 0.08, glove, 0, -0.03, -L * 0.36);
    if (pistol) this.handL.visible = false;
    // muzzle anchor
    this.muzzle = new THREE.Object3D();
    this.muzzle.position.set(0, 0.012, -L * 0.9);
    g.add(this.muzzle);
    this.casingAnchor = new THREE.Object3D();
    this.casingAnchor.position.set(0.03, -0.02, 0);
    g.add(this.casingAnchor);
    return g;
  }

  _unitBox() {
    if (!this.__box) this.__box = new THREE.BoxGeometry(1, 1, 1);
    return this.__box;
  }
  _cyl() {
    if (!this.__cyl) this.__cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 10);
    return this.__cyl;
  }

  _buildAll() {
    for (const id of ['ar', 'smg', 'pistol']) this.addWeapon(id, true);
  }

  /** Add (or top up) a weapon in the next free slot. */
  addWeapon(id, silent = false) {
    const def = WEAPON_DEFS[id];
    const existing = this.weapons.find((w) => w.def.id === id);
    if (existing) {
      existing.reserve += Math.round(def.reserve0 / 3);
      if (!silent) this.app.hud.notify(`+${Math.round(def.reserve0 / 3)} AMMO — ${def.short}`, 'info');
      this.markDirty();
      return existing;
    }
    const g = this._buildModel(def);
    const w = {
      def, group: g,
      mag: def.magSize,
      reserve: def.reserve0,
      mode: def.auto ? 'auto' : 'semi',
      visible: false
    };
    g.visible = false;
    this.group.add(g);
    this.weapons.push(w);
    if (this.weapons.length - 1 === this.active) g.visible = true;
    if (!silent) this.app.hud.notify(`PICKED UP — ${def.name}`, 'good');
    this.markDirty();
    return w;
  }

  get current() { return this.weapons[this.active]; }

  markDirty() {
    if (this.app.hud) this.app.hud.setWeapon(this);
  }

  setBob(bobY, bobX, amp, hSpeed) {
    this.bobY = bobY; this.bobX = bobX; this.bobAmp = amp; this.hSpeed = hSpeed;
  }

  // ------------------------------------------------------------- update

  update(dt) {
    const app = this.app;
    const input = app.input;
    const w = this.current;
    if (!w) return;
    const def = w.def;
    const s = input.state;
    const player = app.player;

    // weapon switching
    let target = this.active;
    for (let i = 1; i <= 4; i++) if (input.slotPressed(i) && i <= this.weapons.length) target = i - 1;
    if (input.wheelNext()) target = (this.active + 1) % this.weapons.length;
    if (input.wheelPrev()) target = (this.active - 1 + this.weapons.length) % this.weapons.length;
    if (target !== this.active) {
      this.weapons[this.active].group.visible = false;
      this.active = target;
      w.group.visible = true;
      this._switchT = 0;
      this._reloadT = -1;
      this._burstLeft = 0;
      this.markDirty();
    }
    this._switchT = Math.min(1, this._switchT + dt / 0.18);

    // fire mode toggle (B)
    if (input.pressed('KeyB') && def.auto) {
      w.mode = w.mode === 'auto' ? 'burst' : 'auto';
      this.markDirty();
    }

    // ADS
    const wantAim = s.aim && this._switchT >= 1;
    this.adsT = damp(this.adsT, wantAim ? 1 : 0, 12, dt);
    app.input.aiming = wantAim;
    app.camera.fov = damp(app.camera.fov, wantAim ? def.adsFov : app.settings.data.fov, 12, dt);
    app.camera.updateProjectionMatrix();
    app.hud.setScope(def.model.sight === 'scope' && this.adsT > 0.6);

    // reload
    if (input.reloadPressed() && this._reloadT < 0 && w.mag < def.magSize && w.reserve > 0) {
      this.startReload();
    }
    if (this._reloadT >= 0) {
      this._reloadT += dt;
      if (this._reloadT >= def.reloadTime) {
        const take = Math.min(def.magSize - w.mag, w.reserve);
        w.mag += take;
        w.reserve -= take;
        this._reloadT = -1;
        app.audio.reload(def.id, 'end');
        this.markDirty();
      }
    }
    // auto reload when empty
    if (w.mag === 0 && this._reloadT < 0 && w.reserve > 0 && !this._autoReloaded) {
      this._autoReloadDelay = (this._autoReloadDelay || 0) + dt;
      if (this._autoReloadDelay > 0.35) this.startReload();
    } else {
      this._autoReloadDelay = 0;
    }
    this._autoReloaded = this._reloadT >= 0;

    // firing
    this._fireCooldown -= dt;
    const reloading = this._reloadT >= 0;
    const canFire = !reloading && w.mag > 0 && !player.dead && this._switchT >= 1;
    let wantFire = false;
    if (canFire) {
      if (def.auto && w.mode === 'auto') wantFire = s.fire;
      else if (def.auto && w.mode === 'burst') {
        if (this._burstLeft > 0) wantFire = true;
        else if (input.firePressed()) { this._burstLeft = def.burst || 3; wantFire = true; }
      } else wantFire = input.firePressed();
    }
    if (wantFire && this._fireCooldown <= 0) {
      this._fireCooldown = 60 / def.rpm;
      w.mag--;
      if (def.auto && w.mode === 'burst') this._burstLeft--;
      this._doFire(def, w);
      this.markDirty();
    }
    if (!s.fire) this._burstLeft = 0;
    // dry-fire click on empty magazine
    this._dryT = (this._dryT || 0) - dt;
    if (w.mag === 0 && !reloading && s.fire && this._dryT <= 0) {
      this._dryT = 0.35;
      app.audio.dryFire();
    }

    // view model transform
    const hip = { x: 0.27, y: -0.25, z: -0.52, ry: 0.02 };
    const ads = { x: 0, y: def.model.sight === 'scope' ? -0.148 : -0.155, z: def.model.sight === 'scope' ? -0.3 : -0.34 };
    const t = this.adsT;
    const crouch = player.crouchT;
    const dy = crouch * (t > 0.5 ? -0.03 : 0.05);
    w.group.position.set(
      damp(w.group.position.x, hip.x + (ads.x - hip.x) * t, 16, dt),
      damp(w.group.position.y, hip.y + (ads.y - hip.y) * t + dy + this.bobY * (1 - t * 0.85), 16, dt),
      damp(w.group.position.z, hip.z + (ads.z - hip.z) * t + (1 - this._switchT) * 0.25 + this._recoilKick + this.bobX * (1 - t) * 0.4, 16, dt)
    );
    w.group.rotation.set(
      this.bobY * 2.2 * (1 - t) + (1 - this._switchT) * -0.9 + this._recoilKick * 1.6,
      damp(w.group.rotation.y, hip.ry * (1 - t) + this.bobX * 1.4 * (1 - t), 16, dt),
      0
    );
    // reload pose
    if (reloading) {
      const rt = this._reloadT / def.reloadTime;
      const dip = Math.sin(Math.min(1, rt * 1.6) * Math.PI);
      w.group.rotation.x -= dip * 0.55;
      w.group.position.y -= dip * 0.09;
    }
    // hands track the grip slightly while aiming
    if (w.handL) {
      w.handL.position.x = -t * 0.012;
      w.handL.visible = !def.model.pistol;
    }
    this._recoilKick = damp(this._recoilKick, 0, 14, dt);
    app.hud.setSpread(this._spreadPx, this._lastHit);
  }

  startReload() {
    const w = this.current;
    if (!w || this._reloadT >= 0) return;
    this._reloadT = 0;
    this.app.audio.reload(w.def.id, 'start');
  }

  _doFire(def, w) {
    const app = this.app;
    const player = app.player;
    // muzzle world position
    w.muzzle.getWorldPosition(this._muzzleWorld);
    // direction with spread
    const camDir = this._camDir;
    app.camera.getWorldDirection(camDir);
    const spread = this._computeSpread(def);
    const a = Math.random() * Math.PI * 2;
    const rr = Math.sqrt(Math.random()) * spread;
    const cosP = Math.cos(player.pitch), sinP = Math.sin(player.pitch);
    const cosY = Math.cos(player.yaw), sinY = Math.sin(player.yaw);
    // camera basis
    const fx = -Math.sinY * cosP, fy = sinP, fz = -Math.cosY * cosP;
    const rx = cosY, ry = 0, rz = -sinY;
    const ux = -Math.sinY * sinP, uy = cosP, uz = -Math.cosY * sinP;
    const dx = fx + (rx * Math.cos(a) + ux * Math.sin(a)) * rr;
    const dy = fy + (ry * Math.cos(a) + uy * Math.sin(a)) * rr;
    const dz = fz + (rz * Math.cos(a) + uz * Math.sin(a)) * rr;
    const dir = new THREE.Vector3(dx, dy, dz).normalize();
    const origin = app.camera.position.clone();

    // effects + gameplay
    app.fireBullet(origin, dir, def, this._muzzleWorld, true);
    app.audio.shot(def.sound);
    app.fx.muzzleFlash(this._muzzleWorld, null, def.id === 'sniper' ? 0.9 : 0.55);
    const right = new THREE.Vector3(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
    const casPos = this._muzzleWorld.clone();
    casPos.x += 0.05; casPos.y -= 0.05;
    app.fx.casing(casPos, right);
    // recoil
    player.pitch += def.recoil * (0.75 + Math.random() * 0.5) * (1 - this.adsT * 0.55);
    player.pitch = Math.min(player.pitch, 1.52);
    this._recoilKick = Math.min(0.09, this._recoilKick + def.recoil * 2.2);
    app.shake(0.12 + (def.id === 'sniper' ? 0.3 : 0), 0.05);
    // hearing
    app.emitter.emit('hearing', {
      x: player.pos.x, z: player.pos.z,
      radius: def.id === 'sniper' ? 70 : 48,
      strength: 1, type: 'shot'
    });
    this._spreadPx = (spread * 180 / Math.PI) * 40 + (def.id === 'sniper' ? 2 : 6);
  }

  _computeSpread(def) {
    const player = this.app.player;
    let spread = def.spreadHip + (def.spreadADS - def.spreadHip) * this.adsT;
    spread += this.hSpeed * 0.09 * (1 - this.adsT * 0.6);
    if (!player.onGround) spread += 1.4;
    if (player.crouchT > 0.5) spread *= 0.75;
    return THREE.MathUtils.degToRad(Math.max(0.02, spread));
  }

  addReserve(id, amount) {
    const w = this.weapons.find((x) => x.def.id === id);
    if (w) { w.reserve += amount; this.markDirty(); }
  }

  dispose() {
    this.app.camera.remove(this.group);
  }
}
