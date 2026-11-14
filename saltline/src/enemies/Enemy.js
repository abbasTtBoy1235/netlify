/**
 * Enemy — visual soldier (procedural low-poly model with procedural
 * walk/aim animation), movement execution (path following, collision)
 * and the death sequence. Decisions come from Brain; world interaction
 * (fire, loot, alerts) goes through EnemyManager.
 */
import * as THREE from '../../vendor/three.module.js';
import { ENEMY_DEFS } from './EnemyDefs.js';
import { Brain } from './Brain.js';
import { angleLerp, damp, rand, dist2D } from '../core/Utils.js';

export class Enemy {
  constructor(cls, mgr, spawn) {
    this.cls = cls;
    this.def = ENEMY_DEFS[cls];
    this.mgr = mgr;
    this.pos = new THREE.Vector3(spawn.x, spawn.y || 0, spawn.z);
    this.baseY = spawn.y || 0;
    this.yaw = spawn.face !== undefined ? spawn.face : Math.random() * Math.PI * 2;
    this.maxHp = this.def.hp;
    this.hp = this.def.hp;
    this.armor = this.def.armor;
    this._state = 'dormant';
    this.dead = false;
    this.deathT = 0;
    this.blindT = 0;
    this.hitT = 0;
    this.reloadT = 0;
    this.mag = this.def.weapon.mag;
    this.fireCd = rand(0, 0.4);
    this.wantFire = false;
    this._didFire = false;
    this.fireAccMul = 1;
    this.moveSpeed = 0;
    this.moveTarget = null;
    this.faceTarget = null;
    this.path = null;
    this.pathIdx = 0;
    this._walkPhase = Math.random() * 6;
    this._aimT = 0;
    this._seed = Math.random() * 10;

    this.group = this._buildModel();
    this.group.position.copy(this.pos);
    this.group.scale.setScalar(this.def.scale);
    mgr.app.scene.add(this.group);
    this.partMeshes = [];
    this.brain = new Brain(this);
    this.brain.init(spawn, spawn.mode || 'patrol', spawn.route || null);
  }

  // ---------------------------------------------------------- model

  _mat(color, metal = 0.35, rough = 0.75) {
    return new THREE.MeshStandardMaterial({ color, metalness: metal, roughness: rough });
  }

  _buildModel() {
    const g = new THREE.Group();
    const box = (w, h, d, mat, x, y, z) => {
      const m = new THREE.Mesh(this._unitBox(), mat);
      m.scale.set(w, h, d);
      m.position.set(x, y, z);
      g.add(m);
      return m;
    };
    const d = this.def;
    const bodyMat = this._mat(d.tint);
    const darkMat = this._mat(new THREE.Color(d.tint).multiplyScalar(0.65));
    const accMat = this._mat(d.accent, 0.5, 0.5);
    const skinMat = this._mat(0x8a705a, 0.1, 0.9);

    this.torso = box(0.6, 0.72, 0.34, bodyMat, 0, 1.02, 0);
    box(0.62, 0.16, 0.36, accMat, 0, 1.22, 0); // chest rig
    this.head = box(0.3, 0.3, 0.3, skinMat, 0, 1.62, 0);
    this.helmet = box(0.36, 0.15, 0.36, darkMat, 0, 1.81, 0);
    if (d.behavior.stationary) box(0.5, 0.35, 0.3, bodyMat, 0, 0.18, 0); // sniper legs / sandbags

    // limbs with pivots
    const limb = (x, side) => {
      const piv = new THREE.Group();
      piv.position.set(x, 0.72, 0);
      const m = new THREE.Mesh(this._unitBox(), darkMat);
      m.scale.set(0.2, 0.7, 0.22);
      m.position.y = -0.35;
      piv.add(m);
      g.add(piv);
      return piv;
    };
    this.legL = limb(-0.16, -1);
    this.legR = limb(0.16, 1);
    const arm = (x) => {
      const piv = new THREE.Group();
      piv.position.set(x, 1.32, 0);
      const m = new THREE.Mesh(this._unitBox(), bodyMat);
      m.scale.set(0.15, 0.5, 0.16);
      m.position.y = -0.22;
      piv.add(m);
      g.add(piv);
      return piv;
    };
    this.armL = arm(-0.38);
    this.armR = arm(0.38);

    // weapon in right hand
    const gunMat = this._mat(0x14171a, 0.6, 0.45);
    const gm = new THREE.Mesh(this._unitBox(), gunMat);
    const glen = d.model === 'sniper' ? 0.95 : d.model === 'pistol' ? 0.35 : 0.7;
    gm.scale.set(0.07, 0.11, glen);
    gm.position.set(0, -0.45, -glen * 0.35);
    this.armR.add(gm);
    if (d.model === 'sniper') {
      const scope = new THREE.Mesh(this._unitBox(), gunMat);
      scope.scale.set(0.05, 0.05, 0.25);
      scope.position.set(0, -0.38, -0.2);
      this.armR.add(scope);
    }
    if (d.model === 'heavy') {
      box(0.44, 0.52, 0.24, darkMat, 0, 1.02, 0.26);      // backpack
      box(0.5, 0.46, 0.09, this._mat(0x5a6a80, 0.8, 0.35), 0, 1.08, -0.2); // armor plate
    }

    // hit-part registration
    this.muzzle = new THREE.Object3D();
    this.muzzle.position.set(0, -0.45, -glen * 0.75);
    this.armR.add(this.muzzle);
    const reg = (m, part) => {
      m.userData.enemyPart = this;
      m.userData.part = part;
      this.partMeshes.push(m);
    };
    reg(this.head, 'head');
    reg(this.helmet, 'head');
    reg(this.torso, 'body');

    this.group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    return g;
  }

  _unitBox() {
    if (!this.__box) this.__box = new THREE.BoxGeometry(1, 1, 1);
    return this.__box;
  }

  /** Behavior state — proxied to the Brain's state machine. */
  get state() { return this.brain ? this.brain.state : this._state; }
  set state(v) { if (this.brain) this.brain.state = v; else this._state = v; }

  // -------------------------------------------------------- behaviour

  pathTo(x, z) {
    this.path = this.mgr.nav.findPath(this.pos.x, this.pos.z, x, z);
    this.pathIdx = 1;
  }

  takeDamage(dmg, part, point, fromPos) {
    if (this.dead) return;
    let d = dmg;
    if (part !== 'head' && this.armor > 0) {
      const ab = Math.min(this.armor, d * 0.3);
      this.armor -= ab;
      d -= ab;
    }
    this.hp -= d;
    this.hitT = 1.5;
    const dir = new THREE.Vector3().subVectors(point, fromPos).normalize();
    this.mgr.app.fx.blood(point, dir);
    if (this.hp <= 0) this.die(fromPos);
  }

  die(fromPos) {
    if (this.dead) return;
    this.dead = true;
    this.deathT = 0;
    this.state = 'dead';
    this.wantFire = false;
    for (const m of this.partMeshes) m.userData.enemyPart = null; // no more hits
    this.mgr.onDeath(this, fromPos);
  }

  update(dt, t) {
    const e = this;
    if (this.dead) {
      this.deathT += dt;
      const fall = Math.min(1, this.deathT / 0.5);
      this.group.rotation.x = -fall * Math.PI / 2;
      if (this.baseY > 1.5) {
        this.pos.y = this.baseY * (1 - Math.min(1, this.deathT / 0.45));
        this.group.position.y = this.pos.y;
      }
      if (this.deathT > 45) this.group.visible = false;
      return;
    }

    if (this.blindT > 0) this.blindT -= dt;
    if (this.hitT > 0) this.hitT -= dt;

    this.brain.tick(dt);

    // reload
    if (this.mag <= 0 && this.reloadT <= 0) this.reloadT = 1.9;
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) this.mag = this.def.weapon.mag;
    }

    // firing (per-frame cadence)
    this.fireCd -= dt;
    if (this.wantFire && this.fireCd <= 0 && this.mag > 0 && this.reloadT <= 0) {
      this.fireCd = 60 / this.def.weapon.rpm;
      this.mag--;
      this._didFire = true;
      this.mgr.enemyFire(this, this.mgr.player, this.fireAccMul);
    }

    // ---- movement along path
    let moving = false;
    if (this.path && this.pathIdx < this.path.length) {
      const n = this.path[this.pathIdx];
      const d = dist2D(this.pos.x, this.pos.z, n.x, n.z);
      if (d < 2.0) {
        this.pathIdx++;
      } else if (this.moveSpeed > 0.05) {
        const dx = (n.x - this.pos.x) / d, dz = (n.z - this.pos.z) / d;
        this.pos.x += dx * this.moveSpeed * dt;
        this.pos.z += dz * this.moveSpeed * dt;
        moving = true;
      }
    }
    this.mgr.app.world.clampToGround(this.pos);
    this._collide();

    // ---- facing
    let faceYaw = this.yaw;
    if (this.faceTarget) {
      faceYaw = Math.atan2(-(this.faceTarget.x - this.pos.x), -(this.faceTarget.z - this.pos.z));
    } else if (this.path && this.pathIdx < this.path.length) {
      const n = this.path[this.pathIdx];
      faceYaw = Math.atan2(-(n.x - this.pos.x), -(n.z - this.pos.z));
    }
    this.yaw = angleLerp(this.yaw, faceYaw, 1 - Math.exp(-9 * dt));

    // ---- sync visuals
    this.group.position.x = this.pos.x;
    this.group.position.z = this.pos.z;
    this.group.rotation.y = this.yaw;

    // ---- procedural animation
    const walkTarget = moving ? 1 : 0;
    this._aimT = damp(this._aimT, (this.wantFire || this.state === 'combat' || this.state === 'cover') ? 1 : 0, 8, dt);
    if (moving) this._walkPhase += dt * this.moveSpeed * 2.3;
    const swing = Math.sin(this._walkPhase) * 0.55 * (this._aimT * 0.4 + (1 - this._aimT));
    this.legL.rotation.x = swing;
    this.legR.rotation.x = -swing;
    this.armL.rotation.x = damp(this.armL.rotation.x, -1.1 * this._aimT - Math.sin(this._walkPhase) * 0.25 * (1 - this._aimT), 10, dt);
    this.armR.rotation.x = damp(this.armR.rotation.x, -1.35 * this._aimT + Math.sin(this._walkPhase) * 0.3 * (1 - this._aimT), 10, dt);
    this.torso.position.y = 1.02 + Math.sin(t * 2.1 + this._seed) * 0.012;
  }

  _collide() {
    const r = 0.45;
    const colliders = this.mgr.app.world.colliders;
    for (const c of colliders) {
      if (c.maxy <= this.pos.y + 0.2 || c.miny > this.pos.y + 1.6) continue;
      const nx = Math.max(c.minx, Math.min(this.pos.x, c.maxx));
      const nz = Math.max(c.minz, Math.min(this.pos.z, c.maxz));
      const dx = this.pos.x - nx, dz = this.pos.z - nz;
      const d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        const d = Math.sqrt(d2) || 0.0001;
        const push = r - d;
        this.pos.x += (dx / d) * push;
        this.pos.z += (dz / d) * push;
      }
    }
  }
}
