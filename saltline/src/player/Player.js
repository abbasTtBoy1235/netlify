/**
 * Player — first-person controller: movement, sprint stamina, crouch,
 * jump, lean, head-bob, footstep events, and the health/armor/stamina
 * status system.
 */
import * as THREE from '../../vendor/three.module.js';
import { clamp, damp } from '../core/Utils.js';

const EYE_STAND = 1.62;
const EYE_CROUCH = 1.02;
const WALK = 4.3, SPRINT = 6.7, CROUCH_SPEED = 2.3;
const GRAVITY = 22, JUMP_V = 7.4;
const PLAYER_RADIUS = 0.38;

export class Player {
  constructor(app) {
    this.app = app;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.crouchT = 0;        // 0 standing .. 1 crouched
    this.lean = 0;           // -1 left .. +1 right
    this.onGround = true;
    this.sprinting = false;
    this.stamina = 100;
    this._staminaDelay = 0;
    this._sprintLock = false;
    this.health = 100;
    this.armor = 30;
    this.dead = false;
    this._bobPhase = 0;
    this._bobAmp = 0;
    this._stepFlip = 0;
    this.eyeHeight = EYE_STAND;
    this._tmpV = new THREE.Vector3();
  }

  reset(spawn, health, armor) {
    this.pos.set(spawn.x, 0, spawn.z);
    this.yaw = spawn.yaw;
    this.pitch = 0;
    this.vel.set(0, 0, 0);
    this.crouchT = 0;
    this.lean = 0;
    this.stamina = 100;
    this.health = health ?? 100;
    this.armor = armor ?? 30;
    this.dead = false;
    this.onGround = true;
    this._sprintLock = false;
  }

  /** three.js-style alias for the position vector (world systems read this). */
  get position() { return this.pos; }

  get forward() {
    return this._tmpV.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  get eyePos() {
    return this._tmpV.set(this.pos.x, this.pos.y + this.eyeHeight, this.pos.z);
  }

  update(dt) {
    const app = this.app;
    const input = app.input;
    const s = input.state;
    if (this.dead) {
      // slow camera drop to the ground
      this.eyeHeight = damp(this.eyeHeight, 0.35, 4, dt);
      this._applyCamera(dt, 0);
      return;
    }

    // ---------- look
    this.yaw -= s.lookDX * 0.0022;
    this.pitch -= s.lookDY * 0.0022;
    this.pitch = clamp(this.pitch, -1.52, 1.52);

    // ---------- lean
    const leanTarget = (input.leanLeft() ? 1 : 0) - (input.leanRight() ? 1 : 0);
    this.lean = damp(this.lean, leanTarget, 12, dt);

    // ---------- crouch
    const wantCrouch = s.crouch && this.onGround;
    this.crouchT = damp(this.crouchT, wantCrouch ? 1 : 0, 10, dt);
    this.eyeHeight = EYE_STAND + (EYE_CROUCH - EYE_STAND) * this.crouchT;

    // ---------- sprint / stamina
    this._staminaDelay = Math.max(0, this._staminaDelay - dt);
    const moving = s.forward !== 0 || s.strafe !== 0;
    const wantSprint = s.sprint && s.forward > 0 && !wantCrouch && !s.aim && moving && !this._sprintLock;
    this.sprinting = wantSprint;
    if (this.sprinting) {
      this.stamina = Math.max(0, this.stamina - 24 * dt);
      this._staminaDelay = 0.7;
      if (this.stamina <= 0) this._sprintLock = true;
    } else {
      if (this._staminaDelay <= 0) this.stamina = Math.min(100, this.stamina + 16 * dt);
      if (this._sprintLock && this.stamina > 25) this._sprintLock = false;
    }

    // ---------- movement
    let speed = this.sprinting ? SPRINT : (wantCrouch ? CROUCH_SPEED : WALK);
    if (s.aim) speed *= wantCrouch ? 0.55 : 0.75;
    const fwd = s.forward, str = s.strafe;
    const len = Math.hypot(fwd, str) || 1;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    const tx = (fx * (fwd / len) + rx * (str / len)) * speed;
    const tz = (fz * (fwd / len) + rz * (str / len)) * speed;
    const accel = this.onGround ? 14 : 3;
    this.vel.x = damp(this.vel.x, tx, accel, dt);
    this.vel.z = damp(this.vel.z, tz, accel, dt);

    // ---------- jump / gravity
    if (input.jumpPressed() && this.onGround) {
      this.vel.y = JUMP_V;
      this.onGround = false;
    }
    this.vel.y -= GRAVITY * dt;
    const prevY = this.pos.y;
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
    this.pos.z += this.vel.z * dt;

    const wasAirborne = !this.onGround;
    if (this.pos.y <= 0) {
      this.pos.y = 0;
      if (wasAirborne && this.vel.y < -7) {
        app.audio.landing(this.pos);
        app.emitter.emit('hearing', { x: this.pos.x, z: this.pos.z, radius: 16, strength: 0.5, type: 'land' });
        app.shake(0.25, 0.15);
      }
      this.vel.y = 0;
      this.onGround = true;
    } else if (this.pos.y > 0.01) {
      this.onGround = false;
    }

    // ---------- collision (circle vs AABB, xz)
    this._collide(app.world.colliders);
    app.world.clampToGround(this.pos);

    // ---------- head bob + footsteps
    const hSpeed = Math.hypot(this.vel.x, this.vel.z);
    const targetAmp = !this.onGround ? 0 : hSpeed > 0.6 ? (this.sprinting ? 0.055 : 0.032) * (1 - 0.45 * (s.aim ? 1 : 0)) : 0;
    this._bobAmp = damp(this._bobAmp, targetAmp, 8, dt);
    if (this._bobAmp > 0.004) {
      this._bobPhase += dt * (2.2 + hSpeed * 1.35);
      const step = Math.sin(this._bobPhase * 2);
      if (step > 0 && this._stepFlip <= 0) this._onFootstep(hSpeed);
      if (step < -0.9 && this._stepFlip >= 0) this._stepFlip = 1;
      if (step > -0.9) this._stepFlip = 0;
    } else {
      this._bobPhase = 0;
      this._stepFlip = 0;
    }

    this._applyCamera(dt, hSpeed);
    app.hud.setStamina(this.stamina);
  }

  _onFootstep(speed) {
    const app = this.app;
    app.audio.step('concrete', speed, this.pos);
    const sprinting = this.sprinting;
    app.emitter.emit('hearing', {
      x: this.pos.x, z: this.pos.z,
      radius: sprinting ? 24 : 9,
      strength: sprinting ? 0.7 : 0.3,
      type: 'foot'
    });
  }

  _collide(colliders) {
    const r = PLAYER_RADIUS;
    for (let iter = 0; iter < 2; iter++) {
      for (const c of colliders) {
        if (c.maxy <= this.pos.y + 0.3 || c.miny > this.pos.y + 1.4) continue;
        const nx = clamp(this.pos.x, c.minx, c.maxx);
        const nz = clamp(this.pos.z, c.minz, c.maxz);
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

  _applyCamera(dt, hSpeed) {
    const app = this.app;
    const cam = app.camera;
    const bobY = Math.sin(this._bobPhase * 2) * this._bobAmp;
    const bobX = Math.cos(this._bobPhase) * this._bobAmp * 0.6;
    // lean shifts the camera sideways + rolls slightly
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    cam.position.set(
      this.pos.x + rx * this.lean * 0.28 + this.forward.x * bobX,
      this.pos.y + this.eyeHeight + bobY,
      this.pos.z + rz * this.lean * 0.28 + this.forward.z * bobX
    );
    cam.rotation.order = 'YXZ';
    cam.rotation.y = this.yaw;
    cam.rotation.x = this.pitch;
    cam.rotation.z = -this.lean * 0.03;
    // weapon sway target consumed by WeaponSystem
    app.weapons.setBob(bobY, bobX, this._bobAmp, hSpeed);
    // audio listener
    app.audio.updateListener(cam.position, cam.quaternion);
  }

  // ------------------------------------------------------------- status

  /**
   * Apply damage with armor absorption.
   * @returns actual health lost
   */
  takeDamage(amount, fromPos) {
    if (this.dead) return 0;
    let dmg = amount;
    const absorbed = Math.min(this.armor, dmg * 0.6);
    this.armor -= absorbed;
    dmg -= absorbed;
    this.health = Math.max(0, this.health - dmg);
    const dir = Math.atan2(fromPos.x - this.pos.x, -(fromPos.z - this.pos.z));
    this.app.hud.setHealth(this.health, this.armor);
    this.app.hud.damage(dir);
    this.app.hud.setStamina(this.stamina);
    this.app.emitter.emit('player-damaged', { amount: dmg, dir });
    if (this.health <= 0) this.die();
    return dmg;
  }

  die() {
    if (this.dead) return;
    this.dead = true;
    this.app.audio.defeat();
    this.app.emitter.emit('player-dead');
  }

  heal(amount) {
    this.health = Math.min(100, this.health + amount);
    this.app.hud.setHealth(this.health, this.armor);
  }

  addArmor(amount) {
    this.armor = Math.min(100, this.armor + amount);
    this.app.hud.setHealth(this.health, this.armor);
  }
}
