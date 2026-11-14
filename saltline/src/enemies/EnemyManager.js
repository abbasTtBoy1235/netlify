/**
 * EnemyManager — owns the enemy roster, the nav graph, the hearing
 * event bus, squad alert propagation, line-of-sight queries, enemy
 * fire resolution, enemy grenades, cover point search, separation and
 * death/loot handling.
 */
import * as THREE from '../../vendor/three.module.js';
import { NavGraph } from './NavGraph.js';
import { Enemy } from './Enemy.js';
import { clamp, dist2D, rand } from '../core/Utils.js';

export class EnemyManager {
  constructor(app) {
    this.app = app;
    this.nav = new NavGraph(app.world.waypoints, app.world.blockers, 24);
    this.enemies = [];
    this.soundQueue = [];
    this.enemyGrenades = [];
    this._unsub = app.emitter.on('hearing', (e) => {
      if (e && e.radius) this.soundQueue.push(e);
    });
    const killed = (app.saveData && app.saveData.killed) || null;
    for (const s of app.world.spawnGroups) {
      const e = new Enemy(s.cls, this, s);
      e.spawnKey = s;
      if (killed && killed.includes(this._uid(s))) e.die(new THREE.Vector3(s.x, 0, s.z));
      this.enemies.push(e);
    }
    // temp vectors (shared, no per-frame allocation)
    this._v1 = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._v3 = new THREE.Vector3();
    this._v4 = new THREE.Vector3();
    this._sphere = new THREE.Sphere();
  }

  _uid(s) { return `${s.cls}@${s.x},${s.z}${s.y ? ',' + s.y : ''}`; }

  get player() { return this.app.player; }

  aliveCount() {
    let n = 0;
    for (const e of this.enemies) if (!e.dead) n++;
    return n;
  }

  // ------------------------------------------------------- perception

  /** Line of sight between two world points (statics + smoke). */
  losClear(ax, ay, az, bx, by, bz) {
    const app = this.app;
    this._v1.set(ax, ay, az);
    this._v2.set(bx, by, bz);
    const dir = this._v3.subVectors(this._v2, this._v1);
    const dist = dir.length();
    if (dist < 0.001) return true;
    dir.normalize();
    app.raycaster.set(this._v1, dir);
    app.raycaster.far = dist;
    const hits = app.raycaster.intersectObjects(app.losTargets, false);
    if (hits.length > 0) return false;
    app.rayTmp.set(this._v1, dir);
    for (const z of app.fx.smokeZones) {
      this._sphere.set(z.x, z.y, z.z, z.r);
      if (app.rayTmp.intersectSphere(this._sphere, this._v4)) return false;
    }
    return true;
  }

  /** A player spot alerts all non-dead enemies in radius. */
  spotted(e, pos) {
    for (const o of this.enemies) {
      if (o === e || o.dead || o.state === 'dormant') continue;
      if (dist2D(o.pos.x, o.pos.z, pos.x, pos.z) > 35) continue;
      o.brain.alertT = 30;
      o.brain.lastKnown = { x: pos.x, z: pos.z };
      const sees = o.blindT <= 0 && this.losClear(
        o.pos.x, o.pos.y + 1.6 * o.def.scale, o.pos.z,
        pos.x, 1.4, pos.z
      );
      const st = o.brain.state;
      if (sees) o.brain.setState('combat');
      else if (st === 'patrol' || st === 'idle' || st === 'suspicious' || st === 'investigate') o.brain.setState('investigate');
    }
  }

  blindNear(pos, r) {
    for (const e of this.enemies) {
      if (e.dead) continue;
      if (dist2D(e.pos.x, e.pos.z, pos.x, pos.z) < r) {
        e.blindT = 3.2;
        e.brain.onBlinded();
      }
    }
  }

  // ------------------------------------------------------- cover

  /**
   * Find a cover point: within search radius of (x,z), 4–16m from the
   * player, and LOS-occluded from the player.
   */
  findCover(x, z, playerPos, maxD = 16) {
    const pts = this.app.world.coverPoints;
    let best = null, bestScore = Infinity;
    for (const cp of pts) {
      const dHere = dist2D(x, z, cp.x, cp.z);
      if (dHere > 22) continue;
      const dp = dist2D(cp.x, cp.z, playerPos.x, playerPos.z);
      if (dp < 4 || dp > maxD) continue;
      if (this.losClear(cp.x, 1.5, cp.z, playerPos.x, 1.4, playerPos.z)) continue;
      const score = dHere + dp * 0.25;
      if (score < bestScore) {
        bestScore = score;
        best = cp;
      }
    }
    return best;
  }

  // ------------------------------------------------------- combat

  enemyFire(e, player, accMul = 1) {
    const app = this.app;
    const def = e.def.weapon;
    const d = dist2D(e.pos.x, e.pos.z, player.pos.x, player.pos.z);
    let acc = def.acc * (1 - 0.72 * (d / def.range)) * accMul;
    if (player.sprinting) acc *= 0.6;
    if (player.crouchT > 0.5) acc *= 0.85;
    if (app.weapons.adsT > 0.5) acc *= 0.9;
    if (player.hSpeed > 3) acc *= 0.8;
    const hit = Math.random() < clamp(acc, 0.03, 0.92);

    e.muzzle.getWorldPosition(this._v1);
    const chest = this._v2.set(player.pos.x, player.pos.y + 1.35, player.pos.z);
    if (hit) {
      chest.x += rand(-0.2, 0.2);
      chest.z += rand(-0.2, 0.2);
    } else {
      const a = Math.random() * Math.PI * 2;
      const r = rand(0.8, 2.2);
      chest.x += Math.cos(a) * r;
      chest.z += Math.sin(a) * r;
      chest.y += rand(-0.4, 0.6);
    }
    app.fx.tracer(this._v1, chest, 'enemy');
    app.fx.muzzleFlash(this._v1, null, 0.38);
    app.audio.shot('enemy', this._v1);

    if (hit) {
      const dmg = def.damage * (0.85 + Math.random() * 0.3);
      player.takeDamage(dmg, e.pos);
    } else {
      const n = this._v3.subVectors(chest, player.pos).normalize();
      app.fx.impact(chest, n, 'concrete');
      app.audio.impact('concrete', chest);
    }
  }

  enemyGrenade(e, player) {
    const app = this.app;
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0x3d4a35, roughness: 0.5, metalness: 0.6 }));
    const pos = this._v1.clone().set(e.pos.x, e.pos.y + 1.5, e.pos.z);
    const target = this._v2.clone().set(player.pos.x + player.vel.x * 0.4, 0.1, player.pos.z + player.vel.z * 0.4);
    const T = 0.95;
    const vel = target.clone().sub(pos).divideScalar(T);
    vel.y += 0.5 * 20 * T;
    mesh.position.copy(pos);
    app.scene.add(mesh);
    this.enemyGrenades.push({ mesh, vel, fuse: T });
    app.audio.grenadeThrow();
    app.emitter.emit('hearing', { x: pos.x, z: pos.z, radius: 25, strength: 0.5, type: 'throw' });
  }

  updateEnemyGrenades(dt) {
    const app = this.app;
    for (let i = this.enemyGrenades.length - 1; i >= 0; i--) {
      const g = this.enemyGrenades[i];
      g.vel.y -= 20 * dt;
      g.mesh.position.addScaledVector(g.vel, dt);
      if (g.mesh.position.y < 0.08) {
        g.mesh.position.y = 0.08;
        g.vel.y *= -0.35;
        g.vel.x *= 0.7;
        g.vel.z *= 0.7;
      }
      g.fuse -= dt;
      if (g.fuse <= 0) {
        app.explode(g.mesh.position, { radius: 6, damage: 70, label: 'enemy grenade' });
        app.scene.remove(g.mesh);
        this.enemyGrenades.splice(i, 1);
      }
    }
  }

  // ------------------------------------------------------- lifecycle

  onDeath(e, fromPos) {
    const app = this.app;
    app.stats.kills++;
    app.hud.killFeed(e.def.name);
    app.audio.hitMarker(true);
    const r = Math.random();
    if (r < 0.5) app.pickups.drop(e.pos.x, e.pos.z, 'ammo');
    else if (r < 0.68) app.pickups.drop(e.pos.x, e.pos.z, 'health');
    else if (r < 0.76) app.pickups.drop(e.pos.x, e.pos.z, 'armor');
    else if (r < 0.84) app.pickups.drop(e.pos.x, e.pos.z, 'grenade');
    app.mission.onEnemyKilled();
  }

  wakeBy(key) {
    for (const e of this.enemies) {
      if (!e.dead && e.brain.state === 'dormant' && e.spawnKey.wake === key) {
        e.brain.wake();
      }
    }
  }

  update(dt, t) {
    const app = this.app;
    const player = this.player;

    // hearing
    if (this.soundQueue.length) {
      for (const evt of this.soundQueue) {
        for (const e of this.enemies) {
          if (e.dead || e.state === 'dormant') continue;
          if (dist2D(e.pos.x, e.pos.z, evt.x, evt.z) < evt.radius) e.brain.onSound(evt);
        }
      }
      this.soundQueue.length = 0;
    }

    for (const e of this.enemies) e.update(dt, t);

    // separation (cheap pairwise)
    const alive = [];
    for (const e of this.enemies) if (!e.dead && e.state !== 'dormant') alive.push(e);
    for (let i = 0; i < alive.length; i++) {
      for (let j = i + 1; j < alive.length; j++) {
        const a = alive[i], b = alive[j];
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < 1.21 && d2 > 0.0001) {
          const d = Math.sqrt(d2);
          const push = (1.1 - d) * 0.5;
          const nx = dx / d, nz = dz / d;
          a.pos.x -= nx * push; a.pos.z -= nz * push;
          b.pos.x += nx * push; b.pos.z += nz * push;
        }
      }
    }

    // distance culling (AI keeps running, draws stop)
    for (const e of this.enemies) {
      const d = dist2D(e.pos.x, e.pos.z, player.pos.x, player.pos.z);
      e.group.visible = e.dead ? true : d < 95;
    }

    this.updateEnemyGrenades(dt);
  }

  dispose() {
    if (this._unsub) this._unsub();
    for (const e of this.enemies) this.app.scene.remove(e.group);
    for (const g of this.enemyGrenades) this.app.scene.remove(g.mesh);
    this.enemies.length = 0;
    this.enemyGrenades.length = 0;
  }
}
