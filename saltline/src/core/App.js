/**
 * App — top-level orchestrator. Owns the renderer/scene/camera, the
 * game state machine (menu → briefing → playing ⇄ paused → complete /
 * dead), and constructs + disposes all per-mission systems.
 */
import * as THREE from '../../vendor/three.module.js';
import { EventBus } from './EventBus.js';
import { Settings } from './Settings.js';
import { InputManager } from '../input/InputManager.js';
import { AudioEngine } from '../audio/AudioEngine.js';
import { Port } from '../environment/Port.js';
import { WorldFX } from '../environment/WorldFX.js';
import { Player } from '../player/Player.js';
import { WeaponSystem } from '../weapons/Weapons.js';
import { GrenadeSystem } from '../weapons/Grenades.js';
import { PickupSystem } from '../weapons/Pickups.js';
import { Destructibles } from '../combat/Destructibles.js';
import { EnemyManager } from '../enemies/EnemyManager.js';
import { Relay } from '../missions/Relay.js';
import { Mission, MISSIONS } from '../missions/Mission.js';
import { HUD } from '../ui/HUD.js';
import { Menus } from '../ui/Menus.js';
import { SaveSystem } from '../save/SaveSystem.js';
import { dist2D, bearingTo, clamp } from './Utils.js';

const freshStats = () => ({
  shots: 0, hits: 0, kills: 0, headshots: 0,
  damageDealt: 0, damageTaken: 0, grenades: 0
});

// ---------------------------------------------------------------- headless
// Stub surfaces used by the headless test rig (new App(null, { headless: true })):
// same App wiring, no WebGL/DOM. Every system under test is the real one.

class HeadlessRenderer {
  constructor() {
    this.domElement = null;
    this.info = { render: { calls: 0 } };
    this.shadowMap = { enabled: false, type: 0 };
  }
  setSize() {} render() {} setClearColor() {} setPixelRatio() {}
}

class HeadlessInput {
  constructor() {
    this.keys = new Set();
    this.edges = new Set();
    this.mouse = { fire: false, aim: false, fireEdge: false, aimEdge: false };
    this.locked = false; this.fallback = true;
    this.sens = 1; this.adsSens = 0.5; this.aiming = false; this.paused = false;
    this.lookDX = 0; this.lookDY = 0; this.mouseX = 0; this.mouseY = 0;
    this.onLockChange = null;
  }
  attach() {} dispose() {} refresh() {}
  requestLock() { return true; } releaseLock() {} enableFallback() {}
  endFrame() { this.edges.clear(); this.mouse.fireEdge = false; this.mouse.aimEdge = false; this.lookDX = 0; this.lookDY = 0; }
  /** Frame state, computed from keys exactly like the real InputManager. */
  get state() {
    const k = (code) => this.keys.has(code);
    return {
      forward: (k('KeyW') ? 1 : 0) - (k('KeyS') ? 1 : 0),
      strafe: (k('KeyD') ? 1 : 0) - (k('KeyA') ? 1 : 0),
      sprint: k('ShiftLeft') || k('ShiftRight'),
      crouch: k('ControlLeft') || k('ControlRight') || k('KeyC'),
      aim: this.mouse.aim,
      fire: this.mouse.fire,
      lookDX: this.lookDX,
      lookDY: this.lookDY,
      fallback: this.fallback,
      cursor: { x: this.mouseX, y: this.mouseY }
    };
  }
  pressed(code) { return this.edges.has(code); }
  jumpPressed() { return this.edges.has('Space'); }
  firePressed() { return this.mouse.fireEdge; }
  reloadPressed() { return this.edges.has('KeyR'); }
  interactHeld() { return this.keys.has('KeyF'); }
  interactPressed() { return this.edges.has('KeyF'); }
  grenadePressed() { return this.edges.has('KeyG'); }
  grenadeCyclePressed() { return this.edges.has('KeyV'); }
  leanLeft() { return this.keys.has('KeyQ'); }
  leanRight() { return this.keys.has('KeyE'); }
  slotPressed(n) { return this.edges.has('Digit' + n); }
  debugPressed() { return this.edges.has('F3'); }
  pausePressed() { return this.edges.has('Escape'); }
  wheelNext() { return this.edges.has('WheelNext'); }
  wheelPrev() { return this.edges.has('WheelPrev'); }
}

class HeadlessHUD {
  constructor() { this.notifies = []; this.prompts = []; }
  show() {} hide() {} applySettings() {} setHealth(h, a) { this.hp = h; this.armor = a; }
  setStamina() {} setSpread() {} setWeapon() {} setGrenades() {} setScope() {}
  updateObjectives() {} setDistance() {} compass() {} minimap() {} hitMarker() {}
  damage() {} flashWhite() {} killFeed() {} hint() {} debug() {} aimNote() {} frameOverlay() {}
  notify(t) { this.notifies.push(t); }
  prompt(t) { if (t) this.prompts.push(t); }
}

class HeadlessMenus {
  constructor() {}
  show() {} hide() {} showBriefing() {} showComplete() {} showDead() {}
}

export class App {
  constructor(container, opts = {}) {
    this.container = container;
    this.headless = !!opts.headless;
    this.state = 'boot';
    this.time = 0;
    this.settings = new Settings();
    this.emitter = new EventBus();
    this.stats = freshStats();
    this.saveData = null;
    this.sun = null;
    this.onAutoplayFrame = null;

    // renderer
    if (this.headless) {
      this.renderer = new HeadlessRenderer();
    } else {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.06;
      this.renderer.shadowMap.enabled = this.settings.presetCfg.shadows;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.renderer.setClearColor(0x0a0e13);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.settings.presetCfg.pixelRatio || 2));
      container.appendChild(this.renderer.domElement);
    }

    this.scene = new THREE.Scene();
    this.fogRef = new THREE.FogExp2(0x2a3644, this.settings.presetCfg.fog);
    this.scene.fog = this.fogRef;
    this.camera = new THREE.PerspectiveCamera(this.settings.data.fov, 1, 0.05, 700);
    this.scene.add(this.camera);

    this.raycaster = new THREE.Raycaster();
    this.rayTmp = new THREE.Ray();

    if (this.headless) {
      this.input = new HeadlessInput();
      this.hud = new HeadlessHUD();
      this.menus = new HeadlessMenus();
    } else {
      this.input = new InputManager(this.renderer.domElement);
      this.input.attach();
      this.input.onLockChange = (locked) => {
        if (this.state === 'playing' && !locked && !this.autoplay) this.pause();
      };
      this.hud = new HUD(document.getElementById('hud'), this);
      this.menus = new Menus(document.getElementById('menus'), this);
    }

    this.audio = new AudioEngine();
    this.audio._wantAmbience = true;

    // global event subscriptions
    this.emitter.on('player-damaged', (d) => { this.stats.damageTaken += d.amount; });
    this.emitter.on('player-dead', () => { this._deathDelay = 1.15; });
    this.emitter.on('grenade-thrown', () => { this.stats.grenades++; });

    this._shakeMag = 0;
    this._shakeT = 0;
    this._deathDelay = -1;
    this._debugOn = false;
    this._fps = 60;
    this._v1 = new THREE.Vector3();
    this._v2 = new THREE.Vector3();

    if (!this.headless) window.addEventListener('resize', () => this.resize());
    this.resize();
    this._loop = this._loop.bind(this);
  }

  // ------------------------------------------------------------- boot

  start() {
    if (this.headless) { this.menus.show('main'); return; }
    document.getElementById('boot').classList.add('done');
    this.menus.show('main');
    requestAnimationFrame(this._loop);
  }

  /** Advance the simulation by dt seconds (drives the headless test rig). */
  advance(dt) {
    this._frame(dt);
    // mirror what renderer.render() does in the browser: keep world matrices
    // current so raycasts (bullets, LOS) test real geometry headlessly
    this.scene.updateMatrixWorld();
  }

  unlockAudio() {
    this.audio.unlock();
    if (this.audio._wantAmbience) this.audio.startAmbience();
  }

  resize() {
    const w = this.headless ? 1280 : window.innerWidth;
    const h = this.headless ? 720 : window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  applySettings(key, value) {
    this.settings.set(key, value);
    if (key === 'preset') this.settings.applyGraphics(this);
    else this.settings.applyLive(this);
  }

  // -------------------------------------------------------- mission flow

  newGame(missionId) { this.startMission(missionId, null); }

  continueGame() {
    const sd = SaveSystem.load();
    if (sd && !sd.complete && MISSIONS[sd.missionId]) this.startMission(sd.missionId, sd);
    else this.menus.show('main');
  }

  startMission(missionId, resume = null) {
    this._teardown();
    this.saveData = resume ? { ...resume } : null;
    this.stats = (resume && resume.stats) ? { ...freshStats(), ...resume.stats } : freshStats();
    this._deathDelay = -1;
    this.time = 0;

    this.world = new Port(this.scene, this.settings.presetCfg.detail);
    this.sun = this.world.sun;
    this.fogRef.density = this.settings.presetCfg.fog;
    this.fx = new WorldFX(this.scene);
    this.fx.setParticleScale(this.settings.presetCfg.particles);

    this.player = new Player(this);
    this.player.reset(this.world.playerSpawn, 100, 30);

    this.weapons = new WeaponSystem(this);
    this.grenades = new GrenadeSystem(this);
    this.pickups = new PickupSystem(this);
    this.destructibles = new Destructibles(this);
    this.enemies = new EnemyManager(this);

    this.relays = {};
    for (const [id, p] of Object.entries(this.world.relaysPos)) {
      this.relays[id] = new Relay(this.scene, id, p);
      this.relays[id].appRef = this;
    }
    if (resume && resume.relayHp) {
      for (const [id, hp] of Object.entries(resume.relayHp)) {
        if (this.relays[id]) this.relays[id].hp = Math.max(0, Math.min(this.relays[id].maxHp, hp));
      }
    }
    this.mission = new Mission(this, missionId, resume);
    this._buildShootables();

    if (this.settings.data.rain) this.world.setRainEnabled(true, this.settings.presetCfg.rain);
    this.audio._wantMusic = true;
    this.audio.startMusic();
    if (this.audio._wantAmbience) this.audio.startAmbience();

    // brief view from the spawn point while the briefing shows
    const sp = this.world.playerSpawn;
    this.camera.position.set(sp.x, 1.62, sp.z);
    this.camera.rotation.set(0, sp.yaw, 0);

    this.hud.show();
    this.hud.applySettings(this.settings.data);
    this.hud.setHealth(this.player.health, this.player.armor);
    this.hud.setStamina(100);
    this.hud.updateObjectives(this.mission);
    this.weapons.markDirty();
    this.grenades.markDirty();

    this.state = 'briefing';
    this.menus.showBriefing(missionId, !!resume);
  }

  deploy() {
    if (this.state !== 'briefing') return;
    this.state = 'playing';
    this.input.paused = false;
    this.menus.hide();
    this.input.requestLock();
    this.hud.hint();
    this.hud.aimNote(this.input.fallback);
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.releaseLock();
    this.input.paused = true;
    this.menus.show('pause');
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.input.paused = false;
    this.menus.hide();
    this.input.requestLock();
  }

  quitToMenu() {
    this._teardown();
    this.input.paused = true;
    this.state = 'menu';
    this.hud.hide();
    this.menus.show('main');
  }

  restartFromCheckpoint() {
    const sd = this.saveData;
    const id = this.mission ? this.mission.missionId : 'op_broken_signal';
    this.startMission(id, sd);
    this.deploy();
  }

  endMission(success) {
    if (this.state === 'complete' || this.state === 'dead') return;
    this.input.releaseLock();
    this.input.paused = true;
    this.audio.setTension(0);
    if (success) {
      this.state = 'complete';
      this.menus.showComplete(this.mission.statsSummary());
    } else {
      this.state = 'dead';
      this.menus.showDead();
    }
  }

  checkpoint() {
    if (!this.mission || !this.enemies) return;
    const killed = this.enemies.enemies
      .filter((e) => e.dead)
      .map((e) => this.enemies._uid(e.spawnKey));
    this.saveData = {
      missionId: this.mission.missionId,
      objIdx: this.mission.objIdx,
      stageIdx: this.mission.stageIdx,
      time: this.mission.time,
      stats: { ...this.stats },
      killed,
      relayHp: Object.fromEntries(Object.entries(this.relays).map(([k, r]) => [k, Math.max(0, r.hp)])),
      wakes: [...this.mission._wakeSent],
      complete: false
    };
    SaveSystem.save(this.saveData);
    this.hud.notify('CHECKPOINT SAVED', 'info');
  }

  _buildShootables() {
    this.shootables = [...this.world.staticMeshes];
    for (const e of this.enemies.enemies) this.shootables.push(...e.partMeshes);
    for (const d of this.destructibles.items) this.shootables.push(d.mesh);
    for (const r of Object.values(this.relays)) this.shootables.push(...r.meshes);
    this.losTargets = this.world.staticMeshes;
  }

  _teardown() {
    if (this.weapons) this.weapons.dispose();
    if (this.grenades) this.grenades.dispose();
    if (this.pickups) this.pickups.dispose();
    if (this.enemies) this.enemies.dispose();
    if (this.relays) for (const r of Object.values(this.relays)) r.dispose(this.scene);
    if (this.fx) this.fx.dispose();
    if (this.world) this.world.dispose();
    this.player = null;
    this.weapons = null;
    this.grenades = null;
    this.pickups = null;
    this.destructibles = null;
    this.enemies = null;
    this.relays = null;
    this.fx = null;
    this.world = null;
    this.mission = null;
    this.audio.stopMusic();
    this.onAutoplayFrame = null;
  }

  // ------------------------------------------------------------ combat

  fireBullet(origin, dir, def, muzzleWorld, isPlayer = true) {
    this.raycaster.set(origin, dir);
    this.raycaster.far = def.range;
    const hits = this.raycaster.intersectObjects(this.shootables, false);
    let hitPoint = null;
    let hit = null;
    if (hits.length) { hit = hits[0]; hitPoint = hit.point; }
    const endPoint = hitPoint || this._v1.copy(origin).addScaledVector(dir, Math.min(def.range, 100));
    this.fx.tracer(muzzleWorld, endPoint, 'player');
    if (!hit) return;
    const obj = hit.object;
    const dist = hit.distance;
    let dmg = def.damage * (1 - 0.4 * (dist / def.range));
    const normal = hit.face ? hit.face.normal : dir;

    const ep = obj.userData.enemyPart;
    if (ep && !ep.dead) {
      const part = obj.userData.part || 'body';
      const mult = part === 'head' ? def.headMult : 1;
      if (isPlayer) {
        this.stats.shots++;
        this.stats.hits++;
        this.stats.damageDealt += dmg * mult;
        if (part === 'head') this.stats.headshots++;
        this.hud.hitMarker(false);
      }
      ep.takeDamage(dmg * mult, part, hitPoint, origin);
      return;
    }
    if (obj.userData.dpropId !== undefined) {
      if (isPlayer) { this.stats.shots++; this.stats.hits++; }
      this.destructibles.damage(obj.userData.dpropId, dmg, hitPoint);
      this.fx.impact(hitPoint, normal, 'metal');
      this.audio.impact('metal', hitPoint);
      return;
    }
    if (obj.userData.relayId) {
      if (isPlayer) { this.stats.shots++; this.stats.hits++; }
      const r = this.relays[obj.userData.relayId];
      r.damage(dmg, hitPoint, origin);
      return;
    }
    // world surface
    if (isPlayer) this.stats.shots++;
    const surface = obj.userData.surface || 'concrete';
    this.fx.impact(hitPoint, normal, surface);
    this.audio.impact(surface, hitPoint);
    if (surface === 'metal' && Math.random() < 0.12) this.audio.ricochet(hitPoint);
  }

  explode(pos, opts) {
    const { radius, damage, label = 'explosion' } = opts;
    this.fx.explosion(pos, radius);
    this.audio.explosion(pos, radius >= 5);

    const player = this.player;
    const dp = Math.hypot(pos.x - player.pos.x, pos.z - player.pos.z);
    if (dp < radius * 1.5 && !player.dead) {
      player.takeDamage(damage * (1 - (dp / (radius * 1.5)) * 0.7), pos);
    }
    for (const e of this.enemies.enemies) {
      if (e.dead) continue;
      const d = Math.hypot(pos.x - e.pos.x, pos.z - e.pos.z);
      if (d < radius + 0.5) {
        e.takeDamage(damage * (1 - (d / (radius + 0.5)) * 0.6), 'body', pos, pos);
      }
    }
    this.destructibles.splash(pos, radius * 0.9);
    for (const r of Object.values(this.relays)) {
      if (r.destroyed) continue;
      const d = Math.hypot(pos.x - r.pos.x, pos.z - r.pos.z);
      if (d < radius + 2) r.damage(damage * 1.2 * Math.max(0.2, 1 - d / (radius + 2)), pos, pos);
    }
    this.shake(clamp(0.6 * (1 - dp / 30), 0, 0.6), 0.3);
    this.emitter.emit('hearing', { x: pos.x, z: pos.z, radius: 90, strength: 1, type: 'boom' });
  }

  nearestEnemyPos() {
    let best = null, bd = Infinity;
    for (const e of this.enemies.enemies) {
      if (e.dead || e.state === 'dormant') continue;
      const d = dist2D(this.player.pos.x, this.player.pos.z, e.pos.x, e.pos.z);
      if (d < bd) { bd = d; best = { x: e.pos.x, z: e.pos.z }; }
    }
    return best;
  }

  alarmAt(pos) {
    const p = this.player.pos;
    for (const e of this.enemies.enemies) {
      if (e.dead || e.state === 'dormant') continue;
      if (dist2D(e.pos.x, e.pos.z, pos.x, pos.z) > 40) continue;
      e.brain.alertT = 30;
      e.brain.lastKnown = { x: p.x, z: p.z };
      const sees = e.blindT <= 0 && this.enemies.losClear(
        e.pos.x, e.pos.y + 1.6 * e.def.scale, e.pos.z, p.x, p.y + 1.4, p.z
      );
      e.brain.setState(sees ? 'combat' : 'investigate');
    }
  }

  shake(mag, dur = 0.2) {
    this._shakeMag = Math.max(this._shakeMag, mag);
    this._shakeT = Math.max(this._shakeT, dur);
  }

  // ------------------------------------------------------------ loop

  _loop() {
    requestAnimationFrame(this._loop);
    const dt = clamp((performance.now() - (this._lastT || performance.now())) / 1000, 0.001, 0.05);
    this._lastT = performance.now();
    this._frame(dt);
    this.renderer.render(this.scene, this.camera);
  }

  /** One simulated frame: input → systems → HUD (no render in headless). */
  _frame(dt) {
    this._fps = this._fps * 0.95 + (1 / dt) * 0.05;
    this.time += dt;
    const t = this.time;

    this.input.sens = this.settings.data.sensitivity;
    this.input.adsSens = this.settings.data.adsSensScale;

    switch (this.state) {
      case 'playing': this._updatePlaying(dt, t); break;
      case 'briefing': this._updateAmbient(dt, t); break;
      case 'dead':
      case 'complete': this._updatePost(dt, t); break;
      case 'paused': break; // frozen
      default: break; // menu / boot
    }

    this.input.endFrame();
  }

  _updateAmbient(dt, t) {
    if (!this.world) return;
    this._v1.set(this.world.playerSpawn.x, 0, this.world.playerSpawn.z);
    this.world.update(dt, t, { position: this._v1 });
    for (const r of Object.values(this.relays)) r.update(dt, t);
    this.fx.update(dt);
    this.audio.updateListener(this.camera.position, this.camera.quaternion);
    this.audio.update(dt, true);
  }

  _updatePost(dt, t) {
    if (!this.world) return;
    this.world.update(dt, t, this.player);
    for (const r of Object.values(this.relays)) r.update(dt, t);
    this.enemies.update(dt, t);
    this.fx.update(dt);
    this.audio.updateListener(this.camera.position, this.camera.quaternion);
    this.audio.update(dt, true);
    this.hud.frameOverlay(dt, this.player);
  }

  _updatePlaying(dt, t) {
    const player = this.player;
    if (this.onAutoplayFrame) this.onAutoplayFrame(dt);

    player.update(dt);
    this.weapons.update(dt);

    if (this.input.grenadePressed()) this.grenades.throw();
    if (this.input.grenadeCyclePressed()) this.grenades.cycle();
    this.grenades.update(dt);

    this.pickups.update(dt, t);
    this.enemies.update(dt, t);

    this.mission.update(dt);
    this.mission.updateInteract(dt);
    for (const r of Object.values(this.relays)) r.update(dt, t);

    this.fx.update(dt);
    this.world.update(dt, t, player);
    this.audio.updateListener(this.camera.position, this.camera.quaternion);
    this.audio.update(dt, true);

    // music tension
    let tension = 0.12;
    for (const e of this.enemies.enemies) {
      if (e.dead) continue;
      const d = dist2D(player.pos.x, player.pos.z, e.pos.x, e.pos.z);
      const active = e.state === 'combat' || e.state === 'cover' || e.state === 'retreat';
      if (active && d < 50) tension = Math.max(tension, 0.75);
      else if (active && d < 90) tension = Math.max(tension, 0.4);
      else if (e.state === 'investigate' && d < 60) tension = Math.max(tension, 0.35);
    }
    this.audio.setTension(tension);

    // screen shake
    if (this._shakeT > 0) {
      this._shakeT -= dt;
      const m = this._shakeMag * clamp(this._shakeT / 0.25, 0, 1) * this.settings.data.cameraShake;
      this.camera.position.x += (Math.random() - 0.5) * m * 0.28;
      this.camera.position.y += (Math.random() - 0.5) * m * 0.28;
    } else {
      this._shakeMag = 0;
    }

    // HUD dynamic
    const st = this.mission.currentStage;
    const target = this.mission.stageWorldPos();
    if (target && !this.mission.complete) {
      const d = dist2D(player.pos.x, player.pos.z, target.x, target.z);
      const b = bearingTo(player.pos.x, player.pos.z, target.x, target.z);
      this.hud.compass(player.yaw, b);
      this.hud.setDistance(d, '');
    } else {
      this.hud.compass(player.yaw, null);
      this.hud.setDistance(null);
    }
    this.hud.minimap(player.pos, player.yaw, this.mission, this.enemies.enemies, this.relays, this.world.extract);
    this.hud.frameOverlay(dt, player);

    if (this.input.debugPressed()) this._debugOn = !this._debugOn;
    if (this._debugOn) {
      this.hud.debug(
        `FPS ${Math.round(this._fps)} · DRAWS ${this.renderer.info.render.calls} · ` +
        `ENEMIES ${this.enemies.aliveCount()} · POS ${player.pos.x.toFixed(0)},${player.pos.z.toFixed(0)} · F3 off`
      );
    } else this.hud.debug('');

    // death → fail flow
    if (player.dead && this._deathDelay > 0) {
      this._deathDelay -= dt;
      if (this._deathDelay <= 0) this.mission.fail();
    }

    if (this.input.pausePressed()) this.pause();
  }
}
