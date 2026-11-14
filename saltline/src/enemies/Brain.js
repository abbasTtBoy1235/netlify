/**
 * Brain — modular enemy behavior state machine.
 * States: DORMANT, PATROL, IDLE, SUSPICIOUS, INVESTIGATE, SEARCH,
 * COMBAT, COVER, RETREAT, DEAD.
 *
 * Decisions run at ~8 Hz (staggered per enemy); movement and firing
 * are executed per-frame by Enemy from the intents this class sets:
 *   e.moveTarget, e.moveSpeed, e.faceTarget, e.wantFire, e.state
 *
 * The Brain is engine-agnostic (no three imports) so its logic can be
 * unit-tested headlessly.
 */
import { dist2D, angleLerp, chance, rand, pick } from '../core/Utils.js';

const TICK = 0.125;

export class Brain {
  constructor(enemy) {
    this.e = enemy;
    this.tickT = Math.random() * TICK; // stagger
    this.state = 'dormant';
    this.stateT = 0;
    this.alertT = 0;
    this.lostT = 0;
    this.seenT = 0;
    this.lastKnown = { x: enemy.pos.x, z: enemy.pos.z };
    this.interest = null;
    this.path = null;
    this.pathIdx = 0;
    this.repathT = 0;
    this.burstLeft = 0;
    this.firePause = 0;
    this.strafeDir = 0;
    this.strafeT = 0;
    this.coverPt = null;
    this.coverCycles = 0;
    this.peeking = false;
    this.peekT = 0;
    this.searchAngle = 0;
    this.home = { x: enemy.pos.x, z: enemy.pos.z };
    this.grenadeT = rand(4, 9);
    this.moveTarget = null;
  }

  init(spawn, mode, route) {
    this.home = { x: spawn.x, z: spawn.z };
    this.lastKnown = { x: spawn.x, z: spawn.z };
    this.e.pos.x = spawn.x; this.e.pos.z = spawn.z;
    if (mode === 'patrol' && route) {
      this.state = 'patrol';
      this.e.route = route;
      this.e.routeIdx = 0;
    } else if (mode === 'guard') {
      this.state = 'idle';
    } else if (mode === 'static') {
      this.state = 'idle';
    } else {
      this.state = 'dormant';
    }
  }

  wake() {
    if (this.state === 'dormant') {
      this.state = 'idle';
      this.alertT = 5;
      this.interest = { x: this.e.mgr.player.pos.x, z: this.e.mgr.player.pos.z };
      this.stateT = 0;
    }
  }

  onSound(evt) {
    const e = this.e;
    if (e.state === 'dead' || this.state === 'dormant') return;
    if (this.state === 'retreat') return;
    if (evt.type === 'flash') return; // handled via blind
    const strong = evt.type === 'shot' || evt.type === 'boom' || evt.type === 'throw';
    if (strong) {
      this.interest = { x: evt.x, z: evt.z };
      if (this.state === 'patrol' || this.state === 'idle' || this.state === 'suspicious') {
        this.setState('investigate');
      }
    } else {
      this.interest = { x: evt.x, z: evt.z };
      if (this.state === 'patrol' || this.state === 'idle') {
        this.setState('suspicious');
      }
    }
  }

  onBlinded() {
    if (this.state === 'combat' || this.state === 'cover') {
      this.setState('search');
    }
  }

  spotted(playerPos) {
    const e = this.e;
    this.interest = { x: playerPos.x, z: playerPos.z };
    this.lastKnown = { x: playerPos.x, z: playerPos.z };
    this.alertT = 30;
    this.lostT = 0;
    const s = this.state;
    if (s === 'patrol' || s === 'idle' || s === 'suspicious' || s === 'investigate' || s === 'dormant' || s === 'search') {
      this.setState('combat');
    }
  }

  setState(s) {
    if (this.state === s) return;
    this.state = s;
    this.stateT = 0;
    this.moveTarget = null;
    if (s === 'combat') {
      this.burstLeft = 0;
      this.firePause = rand(0.15, 0.5);
      this.coverCycles = 0;
      this.coverPt = null;
    }
    if (s === 'investigate' && this.interest) {
      this.e.pathTo(this.interest.x, this.interest.z);
    }
  }

  tick(dt) {
    const e = this.e;
    if (e.state === 'dead') return;
    this.tickT += dt;
    this.stateT += dt;
    this.alertT = Math.max(0, this.alertT - dt);
    this.firePause = Math.max(0, this.firePause - dt);

    if (this.tickT < TICK) return;
    const step = this.tickT;
    this.tickT = 0;

    const player = e.mgr.player;
    if (player.dead) { e.wantFire = false; return; }

    // consume a shot fired since the last decision tick (burst bookkeeping)
    if (e._didFire) {
      e._didFire = false;
      if (this.burstLeft > 0) {
        this.burstLeft--;
        if (this.burstLeft <= 0) {
          this.burstLeft = e.def.weapon.burst;
          this.firePause = rand(0.45, 1.0);
        }
      }
    }

    if (this.state === 'dormant') {
      e.moveSpeed = 0;
      e.wantFire = false;
      return;
    }

    // ---------- perception
    const canSee = e.blindT <= 0 && this._seePlayer(player);
    if (canSee) {
      this.seenT += step;
      if (this.seenT > 0.15) { // require ~0.15s to confirm (anti-ghost)
        if (!this._wasSeen) {
          this._wasSeen = true;
          e.mgr.spotted(e, player.pos); // alert the squad
          this.spotted(player.pos);     // engage ourselves
        }
        this.lastKnown = { x: player.pos.x, z: player.pos.z };
        this.alertT = 30;
        this.lostT = 0;
      }
    } else {
      this.seenT = 0; // reset the confirmation window
      this._wasSeen = false;
      this.lostT += step;
    }

    const dist = dist2D(e.pos.x, e.pos.z, player.pos.x, player.pos.z);

    // ---------- de-escalation
    if (this.state === 'combat' && !canSee && this.lostT > 25) {
      this.setState('investigate');
    }
    if (this.state === 'investigate' && this.alertT <= 0 && this.stateT > 10) {
      this.setState('patrol');
    }

    // ---------- retreat check (low-HP classes)
    const def = e.def;
    if (def.behavior.retreat > 0 && this.state === 'combat' && e.hp < e.maxHp * def.behavior.retreat && canSee) {
      this.setState('retreat');
    }

    // ---------- state machine
    switch (this.state) {
      case 'dormant':
        e.moveSpeed = 0;
        e.wantFire = false;
        break;

      case 'idle': {
        e.moveSpeed = 0;
        e.wantFire = false;
        // slow scan; face interest if any
        const face = this.interest || this.home;
        e.faceTarget = { x: face.x, z: face.z };
        if (this.interest && this.stateT > 2) {
          this.setState('investigate');
        }
        break;
      }

      case 'patrol': {
        e.wantFire = false;
        const r = e.route;
        if (r && r.length) {
          const t = r[e.routeIdx % r.length];
          this.moveTarget = { x: t.x, z: t.z };
          e.moveSpeed = def.speed * 0.55;
          e.pathTo(t.x, t.z);
          if (dist2D(e.pos.x, e.pos.z, t.x, t.z) < 1.6) e.routeIdx++;
        } else {
          e.moveSpeed = 0;
        }
        break;
      }

      case 'suspicious': {
        e.moveSpeed = 0;
        e.wantFire = false;
        e.faceTarget = this.interest;
        if (this.stateT > 2) this.setState('investigate');
        break;
      }

      case 'investigate': {
        e.wantFire = false;
        if (this.interest) {
          this.moveTarget = this.interest;
          e.moveSpeed = def.speed * 0.9;
          e.pathTo(this.interest.x, this.interest.z);
          if (dist2D(e.pos.x, e.pos.z, this.interest.x, this.interest.z) < 2.2) {
            this.setState('search');
            this.searchAngle = Math.random() * 6.28;
          }
        } else this.setState('patrol');
        break;
      }

      case 'search': {
        e.wantFire = false;
        this.searchAngle += step * 1.4;
        const cx = this.lastKnown.x, cz = this.lastKnown.z;
        this.moveTarget = { x: cx + Math.cos(this.searchAngle) * 4, z: cz + Math.sin(this.searchAngle) * 4 };
        e.moveSpeed = def.speed * 0.5;
        e.pathTo(this.moveTarget.x, this.moveTarget.z);
        e.faceTarget = { x: player.pos.x, z: player.pos.z };
        if (this.stateT > 7) this.setState('patrol');
        break;
      }

      case 'combat': this._combat(step, dist, canSee, player); break;
      case 'cover': this._cover(step, dist, canSee, player); break;
      case 'retreat': this._retreat(step, dist, canSee, player); break;
    }
  }

  _combat(step, dist, canSee, player) {
    const e = this.e;
    const def = e.def;

    // cover usage: recently shot + cover-capable + (low HP or heavy in range)
    if (def.behavior.cover && e.hitT > 0 && !this.coverPt) {
      if (e.hp < e.maxHp * 0.5 || dist < 14) {
        const cp = e.mgr.findCover(e.pos.x, e.pos.z, player.pos);
        if (cp) {
          this.coverPt = cp;
          this.coverCycles = 0;
          this.setState('cover');
          return;
        }
      }
    }

    if (canSee) {
      e.faceTarget = { x: player.pos.x, z: player.pos.z };

      // --- movement: close mid range / back off up close / hold & strafe
      this.strafeT -= step;
      if (this.strafeT <= 0) {
        this.strafeT = rand(1.1, 2.2);
        this.strafeDir = pick([-1, 0, 0, 1]);
      }
      let tx, tz, spd;
      if (def.behavior.flank && this.strafeDir !== 0 && chance(0.08) && dist > 16) {
        // flank: route via a side cover point
        const cp = e.mgr.findCover(e.pos.x, e.pos.z, player.pos, 10, 24);
        if (cp) { tx = cp.x; tz = cp.z; spd = def.speed * 0.9; }
      }
      if (tx === undefined) {
        if (dist > 24) {
          tx = player.pos.x; tz = player.pos.z; spd = def.speed * 0.95;
        } else if (dist < 8) {
          tx = e.pos.x + (e.pos.x - player.pos.x) * 0.5;
          tz = e.pos.z + (e.pos.z - player.pos.z) * 0.5;
          spd = def.speed * 0.5;
        } else {
          const rx = Math.cos(e.yaw), rz = -Math.sin(e.yaw);
          tx = e.pos.x + rx * this.strafeDir * 3;
          tz = e.pos.z + rz * this.strafeDir * 3;
          spd = def.speed * 0.4;
        }
      }
      this.moveTarget = { x: tx, z: tz };
      e.moveSpeed = spd;
      e.pathTo(tx, tz);

      // --- firing
      this._handleFire(e, canSee && dist < def.weapon.range);

      // --- grenades
      if (def.behavior.grenades) {
        this.grenadeT -= step;
        if (this.grenadeT <= 0 && dist < 22 && !canSee) {
          this.grenadeT = rand(7, 12);
          e.mgr.enemyGrenade(e, player);
        }
      }
    } else {
      e.wantFire = false;
      // lost sight: push to last known position
      this.moveTarget = this.lastKnown;
      e.moveSpeed = def.speed;
      e.pathTo(this.lastKnown.x, this.lastKnown.z);
      if (dist2D(e.pos.x, e.pos.z, this.lastKnown.x, this.lastKnown.z) < 2.5) {
        this.setState('search');
      }
    }
  }

  /** Burst-fire scheduling shared by combat / cover / retreat. */
  _handleFire(e, allowed, accMul = 1) {
    if (!allowed || e.mag <= 0 || e.reloadT > 0 || this.firePause > 0) {
      e.wantFire = false;
      return;
    }
    if (this.burstLeft === 0) this.burstLeft = e.def.weapon.burst;
    e.fireAccMul = accMul;
    e.wantFire = true;
  }

  _cover(step, dist, canSee, player) {
    const e = this.e;
    if (!this.coverPt) { this.setState('combat'); return; }
    // move to cover point
    if (dist2D(e.pos.x, e.pos.z, this.coverPt.x, this.coverPt.z) > 1.2) {
      this.moveTarget = this.coverPt;
      e.moveSpeed = e.def.speed;
      e.pathTo(this.coverPt.x, this.coverPt.z);
      e.wantFire = false;
      return;
    }
    // peek cycle
    this.peekT += step;
    const cycle = this.peekT % 3.0;
    this.peeking = cycle > 1.6;
    e.moveSpeed = 0;
    e.faceTarget = { x: player.pos.x, z: player.pos.z };
    // peek fire: reduced accuracy (shooting around cover)
    this._handleFire(e, this.peeking && dist < e.def.weapon.range, 0.55);
    this.coverCycles = Math.floor(this.peekT / 3.0);
    // re-engage after a few cycles or when healed
    if (this.coverCycles >= 3 || (e.def.behavior.regen && e.hp > e.maxHp * 0.65)) {
      this.coverPt = null;
      this.coverCycles = 0;
      this.setState('combat');
    }
  }

  _retreat(step, dist, canSee, player) {
    const e = this.e;
    const def = e.def;
    e.faceTarget = { x: player.pos.x, z: player.pos.z };
    if (dist < 22) {
      // back away along the line to the player
      const away = {
        x: e.pos.x + (e.pos.x - player.pos.x) * 0.5,
        z: e.pos.z + (e.pos.z - player.pos.z) * 0.5
      };
      this.moveTarget = away;
      e.moveSpeed = def.speed;
      e.pathTo(away.x, away.z);
      e.wantFire = false;
    } else {
      e.moveSpeed = 0;
      this._handleFire(e, canSee && dist < def.weapon.range, 0.8);
    }
    // heal out of combat
    if (def.behavior.regen && e.hitT <= -3 && e.hp < e.maxHp * 0.8) {
      e.hp = Math.min(e.maxHp * 0.8, e.hp + 6 * step);
    }
    if (e.hp > e.maxHp * 0.7) this.setState('combat');
    if (!canSee && this.lostT > 10) this.setState('patrol');
  }

  /** Can the enemy see the player right now? (cone + range + LOS + smoke) */
  _seePlayer(player) {
    const e = this.e;
    const def = e.def;
    const vis = def.vision;
    const crouch = player.crouchT > 0.5 ? 0.72 : 1;
    const sprint = player.sprinting ? 1.15 : 1;
    const dist = dist2D(e.pos.x, e.pos.z, player.pos.x, player.pos.z);
    if (dist > vis.range * crouch * sprint) return false;
    // facing cone
    const toP = Math.atan2(-(player.pos.x - e.pos.x), -(player.pos.z - e.pos.z));
    let dAng = toP - e.yaw;
    while (dAng > Math.PI) dAng -= Math.PI * 2;
    while (dAng < -Math.PI) dAng += Math.PI * 2;
    const half = (vis.fov * Math.PI / 180) / 2;
    if (Math.abs(dAng) > half && dist > 3) return false;
    // line of sight
    return e.mgr.losClear(
      e.pos.x, e.pos.y + 1.6 * e.def.scale, e.pos.z,
      player.pos.x, player.pos.y + 1.4, player.pos.z
    );
  }
}
