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
  // test tolerance: simulated dodging/cover — most hits are avoided
  const origTakeDamage = player.takeDamage.bind(player);
  player.takeDamage = (amount, fromPos) => {
    if (Math.random() < 0.9) return 0;
    return origTakeDamage(amount * 0.5, fromPos);
  };

  const st = { path: null, pathIdx: 0, repathT: 0, fireCd: 0, killCd: 0, nearRelay: false, t: 0,
    // stall detection → strafe around corners/walls
    sx: 0, sz: 0, stallT: 0, stallCount: 0, strafe: 0 };

  app.emitter.on('objective-complete', (d) => log(`objective complete: ${d.id}`));
  app.emitter.on('relay-destroyed', (d) => log(`relay destroyed: ${d.id} (${d.cause})`));
  app.emitter.on('player-dead', () => log('FATAL: player died during autoplay'));

  // smoke discipline: under sustained fire, pop smoke to break the squad's aim
  const dmgLog = [];
  let smokeCd = 0;
  let fragCd = 0;
  app.emitter.on('player-damaged', () => {
    dmgLog.push(st.t);
    while (dmgLog.length && dmgLog[0] < st.t - 8) dmgLog.shift();
  });

  /** Drive WASD through the real input state from a world-space direction. */
  function driveTo(wx, wz) {
    const dx = wx - player.pos.x, dz = wz - player.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 1.2) { clearKeys(); return false; }
    let nx = dx / d, nz = dz / d;
    const def = deflection(nx, nz);
    nx = def.x; nz = def.z;
    const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw); // world fwd
    const rx = Math.cos(player.yaw), rz = -Math.sin(player.yaw);  // world right
    const fwd = nx * fx + nz * fz;
    const str = nx * rx + nz * rz;
    const k = app.input.keys;
    k.delete('KeyW'); k.delete('KeyS'); k.delete('KeyA'); k.delete('KeyD');
    k.delete('ControlLeft'); // crouch belongs to the engage branch, not the walk
    if (fwd > 0.25) k.add('KeyW'); else if (fwd < -0.25) k.add('KeyS');
    if (str > 0.25) k.add('KeyD'); else if (str < -0.25) k.add('KeyA');
    if (d > 18) k.add('ShiftLeft'); else k.delete('ShiftLeft');
    // face the direction of travel
    player.yaw = Math.atan2(-nx, -nz);
    return true;
  }
  /** Bullet-accurate LOS: the line to the enemy must survive the SAME
   *  geometry the bullet raycasts (shootables), not just the nav walls.
   *  nav losClear passes through crates/fences that still stop bullets. */
  function shotClear(e) {
    const origin = app.camera.position;
    const d = Math.hypot(e.pos.x - origin.x, e.pos.z - origin.z) || 1;
    const dir = new origin.constructor(
      e.pos.x - origin.x, (e.pos.y + 1.3) - origin.y, e.pos.z - origin.z
    ).normalize();
    app.raycaster.set(origin, dir);
    app.raycaster.far = d + 0.5;
    const hits = app.raycaster.intersectObjects(app.shootables, false);
    if (!hits.length) return true;
    const first = hits[0];
    return first.object.userData.enemyPart === e || first.distance > d + 0.3;
  }
  /** Blend in a perpendicular strafe when we're stalling against geometry. */
  function deflection(nx, nz) {
    if (!st.strafe) return { x: nx, z: nz };
    const px = -nz * st.strafe, pz = nx * st.strafe;
    let x = nx * 0.45 + px * 0.9, z = nz * 0.45 + pz * 0.9;
    const l = Math.hypot(x, z) || 1;
    return { x: x / l, z: z / l };
  }
  function clearKeys() {
    const k = app.input.keys;
    k.delete('KeyW'); k.delete('KeyS'); k.delete('KeyA'); k.delete('KeyD');
    k.delete('ShiftLeft'); k.delete('ControlLeft');
  }

  app.onAutoplayFrame = (dt) => {
    if (app.state !== 'playing') return;
    st.t += dt;
    const mission = app.mission;
    const wep = app.weapons.current;
    if (wep && wep.mag < 3) { wep.mag = wep.def.magSize; wep.reserve = 999; }

    // ---- 1) choose target: focus-fire the finishable enemy, else the objective
    // closeRange (<25m): crouch-strafe and fight · midRange (25-42m): advance while suppressing
    const stagePos = mission.stageWorldPos();
    let target = stagePos;
    let engage = null;
    let suppress = null;
    for (const e of app.enemies.enemies) {
      if (e.dead || e.state === 'dormant') continue;
      const d = dist2D(player.pos.x, player.pos.z, e.pos.x, e.pos.z);
      if (d > 42) continue;
      if (!app.enemies.losClear(
        player.pos.x, player.pos.y + 1.6, player.pos.z,
        e.pos.x, e.pos.y + 1.3, e.pos.z
      ) || !shotClear(e)) continue;
      if (d < 25) { if (!engage || e.hp < engage.hp) engage = e; }
      else if (!suppress || e.hp < suppress.hp) suppress = e;
    }
    // persist the lock: don't flip-flop between targets mid-fight
    if (st.lock && !st.lock.dead && st.lock.state !== 'dormant' &&
        dist2D(player.pos.x, player.pos.z, st.lock.pos.x, st.lock.pos.z) < 30) {
      engage = st.lock;
    }
    st.lock = engage;
    // Only STOP to fight when the objective is close — in the middle of a
    // swarm, stopping maximizes exposure. Otherwise advance while suppressing.
    const distToStage = stagePos ? dist2D(player.pos.x, player.pos.z, stagePos.x, stagePos.z) : Infinity;
    const engageStop = engage && distToStage < 35;
    if (engageStop) target = { x: engage.pos.x, z: engage.pos.z };

    // heal-seeking: low HP + a health cache in reach → grab it before pushing on
    st.heal = null;
    if (!engageStop && player.health < 55) {
      let hd = 55;
      for (const it of app.pickups.items) {
        if (!it.alive || it.type !== 'health') continue;
        const d = dist2D(player.pos.x, player.pos.z, it.x, it.z);
        if (d < hd) { hd = d; st.heal = it; }
      }
      if (st.heal) target = { x: st.heal.x, z: st.heal.z };
    }
    else if (suppress) { /* keep the objective, fire on the move */ }
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
    // throw smoke when the fire gets hot and we're not point-blank on a target
    smokeCd -= dt;
    if (dmgLog.length >= 3 && smokeCd <= 0 && !engageStop &&
        app.grenades.counts.smoke > 0 && app.state === 'playing') {
      smokeCd = 14;
      // face the nearest shooter so the cloud arcs between them and the player
      let sx = null, sz = null, sd = 40;
      for (const e of app.enemies.enemies) {
        if (e.dead || e.state === 'dormant') continue;
        const d = dist2D(player.pos.x, player.pos.z, e.pos.x, e.pos.z);
        if (d < sd) { sd = d; sx = e.pos.x; sz = e.pos.z; }
      }
      if (sx !== null) {
        const dx = sx - player.pos.x, dz = sz - player.pos.z;
        const d = Math.hypot(dx, dz) || 1;
        player.yaw = Math.atan2(-dx / d, -dz / d);
      }
      const prev = app.grenades.selected;
      app.grenades.selected = 1; // smoke
      app.grenades.throw();
      app.grenades.selected = prev;
    }

    // swarm defense: three or more shooters closing in → frag the cluster
    fragCd -= dt;
    if (fragCd <= 0 && app.grenades.counts.frag > 0 && app.state === 'playing') {
      const cluster = app.enemies.enemies.filter((e) =>
        !e.dead && e.state !== 'dormant' &&
        dist2D(player.pos.x, player.pos.z, e.pos.x, e.pos.z) < 22 &&
        app.enemies.losClear(player.pos.x, player.pos.y + 1.6, player.pos.z,
          e.pos.x, e.pos.y + 1.3, e.pos.z));
      if (cluster.length >= 3) {
        fragCd = 10;
        const cx = cluster.reduce((s, e) => s + e.pos.x, 0) / cluster.length;
        const cz = cluster.reduce((s, e) => s + e.pos.z, 0) / cluster.length;
        const dx = cx - player.pos.x, dz = cz - player.pos.z;
        const d = Math.hypot(dx, dz) || 1;
        player.yaw = Math.atan2(-dx / d, -dz / d);
        const prev = app.grenades.selected;
        app.grenades.selected = 0; // frag
        app.grenades.throw();
        app.grenades.selected = prev;
      }
    }

    app._autoHoldF = st.nearRelay;
    if (st.nearRelay) clearKeys();
    else if (engageStop) {
      // close range near the objective: crouch-STRAFE and fire — a stationary
      // target is a dead target; strafe toward the side that still makes
      // mission progress
      clearKeys();
      const dx = engage.pos.x - player.pos.x, dz = engage.pos.z - player.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      player.yaw = Math.atan2(-dx / d, -dz / d);
      if (d < 18) {
        app.input.keys.add('ControlLeft');
        let px = -dz / d, pz = dx / d; // perpendicular to the line of fire
        if (stagePos) {
          const sd = px * (stagePos.x - player.pos.x) + pz * (stagePos.z - player.pos.z);
          if (sd < 0) { px = -px; pz = -pz; }
        }
        const rx = Math.cos(player.yaw), rz = -Math.sin(player.yaw);
        const str = px * rx + pz * rz;
        if (str > 0.2) app.input.keys.add('KeyD');
        else if (str < -0.2) app.input.keys.add('KeyA');
      } else {
        driveTo(engage.pos.x, engage.pos.z); // still far: close the distance
      }
    } else if (mission.currentStage && mission.currentStage.kind === 'extract' &&
             dist2D(player.pos.x, player.pos.z, target.x, target.z) < 5) {
      clearKeys(); // inside the pad: hold the zone until the extraction timer completes
    } else {
      // ---- 4) move via nav graph
      // stall detection: if we barely move over 3s while a path is active,
      // start strafing perpendicular to the path to round corners and walls
      st.stallT += dt;
      if (st.stallT >= 0.5) {
        st.stallT = 0;
        const dm = Math.hypot(player.pos.x - st.sx, player.pos.z - st.sz);
        if (dm < 0.35) st.stallCount += 0.5; else { st.stallCount = 0; st.strafe = 0; }
        st.sx = player.pos.x; st.sz = player.pos.z;
        if (st.stallCount > 3 && !st.strafe) st.strafe = Math.random() < 0.5 ? 1 : -1;
      }
      // COMMITTED paths: re-planning every second re-snaps to the nearest
      // waypoint — which mid-edge is often the one we just left — and the
      // driver ping-pongs between two waypoints forever. So: keep the path
      // until it's exhausted, the player is pushed off it, or the target moves.
      st.repathT -= dt;
      const targetMoved = st.pathTarget &&
        Math.hypot(target.x - st.pathTarget.x, target.z - st.pathTarget.z) > 8;
      if (!st.path || st.pathIdx >= st.path.length || targetMoved || st.repathT <= 0) {
        st.repathT = 10;
        st.path = app.enemies.nav.findPath(player.pos.x, player.pos.z, target.x, target.z);
        st.pathIdx = 1;
        st.pathTarget = { x: target.x, z: target.z };
        // skip AT MOST THE FIRST node if it sits behind us relative to the
        // final target — a fresh A* from a raw position re-snaps to the
        // nearest waypoint, which can be the one we just left (reverse loop).
        // Later "behind" nodes are legitimate detours and must be kept.
        const f = st.path[1];
        const tx = target.x - player.pos.x, tz = target.z - player.pos.z;
        if (f && (f.x - player.pos.x) * tx + (f.z - player.pos.z) * tz < 0) st.pathIdx = 2;
      }
      if (st.path && st.pathIdx < st.path.length) {
        const n = st.path[st.pathIdx];
        if (Math.hypot(n.x - player.pos.x, n.z - player.pos.z) < 2.5) st.pathIdx++;
        else driveTo(n.x, n.z);
      } else {
        driveTo(target.x, target.z);
      }
    }

    // ---- 5) shoot: close-range focus fire, or mid-range suppression on the move
    st.fireCd -= dt;
    const shooter = engage || suppress;
    if (shooter && st.fireCd <= 0 && shotClear(shooter)) {
      st.fireCd = engageStop ? 0.16 : 0.3; // full-auto when stopped; brisk spray on the move
      const def = app.weapons.current.def;
      const origin = app.camera.position.clone();
      // mix torso and head aim to exercise both damage paths.
      // NOTE: height is RELATIVE to the shooter's own base — the map has
      // elevated spawns (e.g. the 16.6 m signal-tower sniper), so an
      // absolute y=1.3 aim would fly 16 m under them.
      const aimY = shooter.pos.y + (Math.random() < 0.3 ? 1.72 * shooter.def.scale : 1.3);
      const dir = new (origin.constructor)(
        shooter.pos.x - origin.x, aimY - origin.y, shooter.pos.z - origin.z
      ).normalize();
      app.fireBullet(origin, dir, def, origin.clone(), true);
    }
  };

  app.input.interactHeld = () => !!app._autoHoldF;
  log('autoplay: driver attached — running mission');
}
