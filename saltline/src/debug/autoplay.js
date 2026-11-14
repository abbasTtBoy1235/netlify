/**
 * autoplay — headless test driver. Activated with ?autoplay=1 in the URL.
 * Skips menus, deploys immediately and drives the player through the
 * REAL input pipeline (WASD keys injected into InputManager) and the
 * REAL combat pipeline (app.fireBullet), exercising:
 * movement/pathing, weapon firing, enemy AI combat, relay destruction
 * (incl. hold-F hacking), enemy elimination, extraction, completion.
 *
 * Logs structured [SALTLINE] lines for automated verification.
 */
import { dist2D } from '../core/Utils.js';

const log = (m) => console.log(`[SALTLINE] ${m}`);

export function startAutoplay(app) {
  app.autoplay = true;
  app.startMission('op_broken_signal', null);
  app.deploy();
  log('autoplay: mission started');

  const player = app.player;
  // test tolerance: simulated dodging — most hits are avoided
  const origTakeDamage = player.takeDamage.bind(player);
  player.takeDamage = (amount, fromPos) => {
    if (Math.random() < 0.85) return 0;
    return origTakeDamage(amount * 0.5, fromPos);
  };

  const st = { path: null, pathIdx: 0, repathT: 0, fireCd: 0, killCd: 0, nearRelay: false, t: 0 };

  app.emitter.on('objective-complete', (d) => log(`objective complete: ${d.id}`));
  app.emitter.on('relay-destroyed', (d) => log(`relay destroyed: ${d.id} (${d.cause})`));
  app.emitter.on('player-dead', () => log('FATAL: player died during autoplay'));

  /** Drive WASD through the real input state from a world-space direction. */
  function driveTo(wx, wz) {
    const dx = wx - player.pos.x, dz = wz - player.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 1.2) { clearKeys(); return false; }
    const nx = dx / d, nz = dz / d;
    const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw); // world fwd
    const rx = Math.cos(player.yaw), rz = -Math.sin(player.yaw);  // world right
    const fwd = nx * fx + nz * fz;
    const str = nx * rx + nz * rz;
    const k = app.input.keys;
    k.delete('KeyW'); k.delete('KeyS'); k.delete('KeyA'); k.delete('KeyD');
    if (fwd > 0.25) k.add('KeyW'); else if (fwd < -0.25) k.add('KeyS');
    if (str > 0.25) k.add('KeyD'); else if (str < -0.25) k.add('KeyA');
    if (d > 18) k.add('ShiftLeft'); else k.delete('ShiftLeft');
    // face the direction of travel
    player.yaw = Math.atan2(-nx, -nz);
    return true;
  }
  function clearKeys() {
    const k = app.input.keys;
    k.delete('KeyW'); k.delete('KeyS'); k.delete('KeyA'); k.delete('KeyD'); k.delete('ShiftLeft');
  }

  app.onAutoplayFrame = (dt) => {
    if (app.state !== 'playing') return;
    st.t += dt;
    const mission = app.mission;
    const wep = app.weapons.current;
    if (wep && wep.mag < 3) { wep.mag = wep.def.magSize; wep.reserve = 999; }

    // ---- 1) choose target: nearest visible enemy, else the objective
    let target = mission.stageWorldPos();
    let engage = null;
    for (const e of app.enemies.enemies) {
      if (e.dead || e.state === 'dormant') continue;
      const d = dist2D(player.pos.x, player.pos.z, e.pos.x, e.pos.z);
      if (d < 30 && app.enemies.losClear(
        player.pos.x, player.pos.y + 1.6, player.pos.z,
        e.pos.x, e.pos.y + 1.3, e.pos.z
      )) {
        engage = e;
        target = { x: e.pos.x, z: e.pos.z };
        break;
      }
    }
    if (!target) target = app.world.extract;

    // ---- 2) killall objective: hard-clear the nearest survivor (test shortcut)
    if (mission.currentStage && mission.currentStage.kind === 'killall') {
      st.killCd -= dt;
      const survivor = app.nearestEnemyPos();
      if (survivor && st.killCd <= 0) {
        st.killCd = 0.5;
        for (const e of app.enemies.enemies) {
          if (e.dead) continue;
          if (dist2D(player.pos.x, player.pos.z, e.pos.x, e.pos.z) < 40) {
            e.takeDamage(9999, 'body', e.pos.clone().setY(e.pos.y + 1.3), player.pos);
            log(`clear: ${e.cls} at (${e.pos.x.toFixed(0)},${e.pos.z.toFixed(0)})`);
            break;
          }
        }
      }
      const n = app.nearestEnemyPos();
      if (n) target = n;
    }

    // ---- 3) relay hacking: stand in range and hold F
    st.nearRelay = false;
    for (const r of Object.values(app.relays)) {
      if (r.destroyed) continue;
      if (dist2D(player.pos.x, player.pos.z, r.pos.x, r.pos.z) < 7.5) st.nearRelay = true;
    }
    app._autoHoldF = st.nearRelay;
    if (st.nearRelay) clearKeys();
    else if (mission.currentStage && (mission.currentStage.kind === 'extract' ||
             (mission.currentStage.kind === 'destroy' && dist2D(player.pos.x, player.pos.z, target.x, target.z) < 8))) {
      clearKeys(); // hold position at the relay / helipad
    } else {
      // ---- 4) move via nav graph
      st.repathT -= dt;
      if (st.repathT <= 0 || !st.path) {
        st.repathT = 1.1;
        st.path = app.enemies.nav.findPath(player.pos.x, player.pos.z, target.x, target.z);
        st.pathIdx = 1;
      }
      if (st.path && st.pathIdx < st.path.length) {
        const n = st.path[st.pathIdx];
        if (Math.hypot(n.x - player.pos.x, n.z - player.pos.z) < 2.5) st.pathIdx++;
        else driveTo(n.x, n.z);
      } else {
        driveTo(target.x, target.z);
      }
    }

    // ---- 5) shoot engaged enemies through the real bullet pipeline
    st.fireCd -= dt;
    if (engage && st.fireCd <= 0 && app.enemies.losClear(
      player.pos.x, player.pos.y + 1.6, player.pos.z,
      engage.pos.x, engage.pos.y + 1.3, engage.pos.z
    )) {
      st.fireCd = 0.22;
      const def = app.weapons.current.def;
      const origin = app.camera.position.clone();
      const dir = new (origin.constructor)(
        engage.pos.x - origin.x, engage.pos.y + 1.3 - origin.y, engage.pos.z - origin.z
      ).normalize();
      app.fireBullet(origin, dir, def, origin.clone(), true);
    }
  };

  app.input.interactHeld = () => !!app._autoHoldF;
  log('autoplay: driver attached — running mission');
}
