/**
 * SALTLINE headless test suite.
 * Runs the engine-agnostic core (nav, AI brain, mission state machine,
 * player damage, data validation) directly in Node — no browser needed.
 *
 * Run: node saltline/test/run-tests.mjs
 */
import { segmentIntersectsAABB, NavGraph } from '../src/enemies/NavGraph.js';
import { EventBus } from '../src/core/EventBus.js';
import { Settings } from '../src/core/Settings.js';
import { SaveSystem } from '../src/save/SaveSystem.js';
import { Brain } from '../src/enemies/Brain.js';
import { ENEMY_DEFS } from '../src/enemies/EnemyDefs.js';
import { WEAPON_DEFS } from '../src/weapons/Weapons.js';
import { MISSIONS, Mission } from '../src/missions/Mission.js';
import { Player } from '../src/player/Player.js';

// ---- localStorage stub
const store = {};
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; }
};

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ FAIL: ${name}`); }
}
function section(name) { console.log(`\n${name}`); }

// --------------------------------------------------------------- NavGraph
section('NavGraph / A*');
{
  ok(segmentIntersectsAABB(0, 0, 10, 0, 4, -1, 6, 1), 'segment through AABB detected');
  ok(!segmentIntersectsAABB(0, 0, 10, 5, 4, -1, 6, 1), 'segment beside AABB clean');

  // 5x5 grid of waypoints, 20m spacing, blocked corridor in the middle
  const wp = [];
  for (let z = 0; z < 5; z++) for (let x = 0; x < 5; x++) wp.push({ x: x * 20, z: z * 20 });
  const blockers = [
    { minx: 40, minz: 15, maxx: 60, maxz: 55 },  // blocks middle column between rows
    { minx: 80, minz: 15, maxx: 100, maxz: 55 }
  ];
  const g = new NavGraph(wp, blockers, 45);
  const path = g.findPath(0, 0, 80, 80);
  ok(path && path.length > 2, `A* finds a path (${path ? path.length : 0} nodes)`);
  // path must not pass through the blocker boxes
  let blocked = false;
  for (let i = 0; i < path.length - 1; i++) {
    for (const b of blockers) {
      if (segmentIntersectsAABB(path[i].x, path[i].z, path[i + 1].x, path[i + 1].z, b.minx, b.minz, b.maxx, b.maxz)) blocked = true;
    }
  }
  ok(!blocked, 'path avoids blocker boxes');
  ok(path[0].x === 0 && path[0].z === 0, 'path starts at origin');
  ok(path[path.length - 1].x === 80 && path[path.length - 1].z === 80, 'path ends at goal');
  const nn = g.nearestNode(81, 79);
  ok(g.nodes[nn].x === 80 && g.nodes[nn].z === 80, 'nearestNode works');
}

// ---------------------------------------------------------------- EventBus
section('EventBus');
{
  const bus = new EventBus();
  let got = null;
  const off = bus.on('x', (d) => { got = d; });
  bus.emit('x', { a: 1 });
  ok(got && got.a === 1, 'on/emit deliver data');
  off();
  bus.emit('x', { a: 2 });
  ok(got.a === 1, 'off unsubscribes');
  bus.emit('never', 1);
  ok(true, 'emit with no subscribers is safe');
}

// ---------------------------------------------------------- Settings/Save
section('Settings & SaveSystem');
{
  const s = new Settings();
  ok(s.data.preset === 'HIGH', 'default preset HIGH');
  s.set('sensitivity', 99);
  ok(s.data.sensitivity <= 3, 'out-of-range values clamped');
  s.set('preset', 'LOW');
  ok(s.presetCfg.shadowSize === 0, 'LOW preset has no shadows');
  ok(!!localStorage.getItem('saltline.settings.v1'), 'settings auto-saved');

  SaveSystem.save({ missionId: 'op_broken_signal', objIdx: 2 });
  ok(SaveSystem.hasSave(), 'save exists');
  const ld = SaveSystem.load();
  ok(ld.objIdx === 2, 'save roundtrip');
  SaveSystem.clear();
  ok(!SaveSystem.hasSave(), 'save cleared');
}

// ------------------------------------------------------------------- Brain
section('Brain — AI state machine');
function makeFakePlayer(x, z) {
  return { pos: { x, z, y: 0 }, crouchT: 0, sprinting: false, dead: false, vel: { x: 0, z: 0 } };
}
function makeEnemy(cls, x, z, opts = {}) {
  const def = ENEMY_DEFS[cls];
  const spottedCalls = [];
  const mgr = {
    player: makeFakePlayer(opts.playerX ?? 0, opts.playerZ ?? -100),
    spottedCalls,
    losClear: () => opts.los !== false,
    spotted(e, pos) { spottedCalls.push({ e, pos }); },
    findCover: () => null,
    pathTo() {}
  };
  const route = opts.route !== undefined ? opts.route : [{ x: x + 20, z }, { x: x + 40, z }];
  const e = {
    cls, def, mgr,
    pos: { x, z, y: opts.y ?? 0 },
    yaw: opts.yaw ?? 0,
    maxHp: def.hp, hp: def.hp, armor: def.armor,
    blindT: 0, hitT: 0, mag: def.weapon.mag, reloadT: 0,
    wantFire: false, _didFire: false,
    moveSpeed: 0, moveTarget: null, faceTarget: null,
    route, routeIdx: 0, state: 'dormant'
  };
  e.pathTo = () => {};
  const brain = new Brain(e);
  brain.init({ x, z, y: opts.y ?? 0 }, opts.mode ?? 'patrol', route);
  return { e, brain, mgr };
}
function runTicks(brain, n, dt = 0.05) {
  for (let i = 0; i < n; i++) brain.tick(dt);
}

{
  // A: hearing a shot sends a patroller to investigate
  const { e, brain } = makeEnemy('rifleman', 0, 0);
  brain.onSound({ x: 10, z: 0, radius: 30, strength: 1, type: 'shot' });
  runTicks(brain, 3);
  ok(brain.state === 'investigate', `shot sound → investigate (got ${brain.state})`);

  // B: seeing the player (in front, in cone, LOS) → combat.
  // 10 iterations: catches the old intermittent _wasSeen bug where a short
  // first decision tick made the enemy never engage.
  let combatAll = true, anySpotted = false;
  for (let i = 0; i < 10; i++) {
    const b = makeEnemy('rifleman', 0, 0, { playerX: 0, playerZ: -20 });
    runTicks(b.brain, 12);
    if (b.brain.state !== 'combat') combatAll = false;
    if (b.mgr.spottedCalls.length > 0) anySpotted = true;
  }
  ok(combatAll, 'sight confirmation → combat (10/10 staggers)');
  ok(anySpotted, 'squad alert fired');

  // B2: outside vision cone (behind) → not combat
  const b2 = makeEnemy('rifleman', 0, 0, { playerX: 0, playerZ: 20 });
  runTicks(b2.brain, 8);
  ok(b2.brain.state !== 'combat', `no see-through-walls (state ${b2.brain.state})`);

  // C: heavy at low HP retreats
  const c = makeEnemy('heavy', 0, 0, { playerX: 0, playerZ: -15 });
  runTicks(c.brain, 8);
  ok(c.brain.state === 'combat', 'heavy engages when healthy');
  c.e.hp = c.e.maxHp * 0.25;
  c.e.hitT = 1;
  runTicks(c.brain, 24); // ~1.2s → several decision ticks
  ok(c.brain.state === 'retreat', `low-HP heavy retreats (got ${c.brain.state})`);

  // D: flashbang disorients a combat enemy
  const d = makeEnemy('rifleman', 0, 0, { playerX: 0, playerZ: -20 });
  runTicks(d.brain, 8);
  d.brain.onBlinded();
  ok(d.brain.state === 'search', 'blinded → search');

  // E: losing the player for 25s de-escalates combat → investigate
  const ev = makeEnemy('rifleman', 0, 0, { playerX: 0, playerZ: -20, los: false });
  // force combat first with clear LOS
  ev.mgr.losClear = () => true;
  runTicks(ev.brain, 8);
  ok(ev.brain.state === 'combat', 'pre-de-escalation combat');
  ev.mgr.losClear = () => false;
  runTicks(ev.brain, 600); // 600 × 0.05s = 30s > 25s lost-sight threshold
  ok(ev.brain.state !== 'combat', `lost-sight de-escalation (got ${ev.brain.state})`);

  // F: dormant enemies do not perceive
  const f = makeEnemy('guard', 0, 0, { mode: 'patrol', playerX: 0, playerZ: -10 });
  f.brain.state = 'dormant';
  runTicks(f.brain, 8);
  ok(f.brain.state === 'dormant', 'dormant stays dormant');
}

// ----------------------------------------------------------------- Mission
section('Mission — Operation: Broken Signal progression');
{
  const missionDef = MISSIONS.op_broken_signal;
  ok(missionDef.objectives.length === 7, 'seven objectives');

  const events = [];
  const relays = {};
  for (const id of ['A', 'B', 'C']) relays[id] = { id, label: id, pos: { x: 100 * (id === 'A' ? -1 : id === 'B' ? 0 : 1), z: 0 }, destroyed: false, appRef: null, app: null };
  const fakeApp = {
    world: {
      infiltrate: { x: -100, z: 0 },
      relaysPos: { A: { x: -100, z: 20 }, B: { x: 0, z: 0 }, C: { x: 100, z: 0 } },
      extract: { x: 200, z: 0, radius: 6 }
    },
    player: { pos: { x: -110, z: 0, y: 0 } },
    relays,
    enemies: { alive: 30, aliveCount: () => fakeApp.enemies.alive, wakeBy: () => {} },
    hud: { notify: (t) => events.push('notify:' + t), updateObjectives: () => {} },
    audio: { notification: () => {}, radioBeep: () => {}, victory: () => {} },
    emitter: new EventBus(),
    stats: { shots: 0, hits: 0, kills: 0, headshots: 0, damageDealt: 0, damageTaken: 0, grenades: 0 },
    checkpoint: () => events.push('checkpoint'),
    alarmAt: () => {},
    nearestEnemyPos: () => null,
    endMission: (s) => events.push('end:' + s)
  };
  const mission = new Mission(fakeApp, 'op_broken_signal', null);

  const near = (x, z) => { fakeApp.player.pos.x = x; fakeApp.player.pos.z = z; };
  const step = (n = 1, dt = 0.1) => { for (let i = 0; i < n; i++) mission.update(dt); };

  ok(mission.objIdx === 0, 'starts at objective 0');
  near(-100, 0); step(2);
  ok(mission.objIdx === 1, 'obj 01 complete at gate');

  near(-100, 20); step(2);
  ok(mission.objIdx === 2, 'obj 02 complete at relay A');

  relays.A.destroyed = true; step(2);
  ok(mission.objIdx === 3, 'obj 03 complete after destroying relay A');

  near(0, 0); step(2);
  ok(mission.objIdx === 3 && mission.stageIdx === 1, 'obj 04: at relay B, destroy stage active');
  relays.B.destroyed = true; step(2);
  ok(mission.objIdx === 4 && mission.stageIdx === 0, 'obj 05: relay C reach stage active');
  near(100, 0); step(2);
  ok(mission.objIdx === 4 && mission.stageIdx === 1, 'obj 05: relay C destroy stage active');
  relays.C.destroyed = true; step(2);
  ok(mission.objIdx === 5, 'obj 06 killall active after all relays down');

  fakeApp.enemies.alive = 12; step(2);
  ok(mission.objIdx === 5, 'obj 06 waits for all kills');
  fakeApp.enemies.alive = 0; step(2);
  ok(mission.objIdx === 6, 'obj 06 complete at zero hostiles');

  near(200, 0);
  step(Math.ceil(5 / 0.1) + 4);
  ok(mission.complete, 'obj 07 extraction completes the mission');
  ok(events.includes('end:true'), 'endMission(true) fired');
  ok(events.filter((e) => e === 'checkpoint').length >= 5, 'checkpoints saved on objectives');
}

// ----------------------------------------------------------------- Player
section('Player — damage & armor');
{
  const bus = new EventBus();
  const app = {
    hud: { setHealth: () => {}, damage: () => {}, setStamina: () => {} },
    emitter: bus,
    audio: { defeat: () => {} },
    shake: () => {}
  };
  const p = new Player(app);
  p.pos.set(0, 0, 0);
  p.health = 100; p.armor = 30;
  const lost = p.takeDamage(100, { x: 5, y: 0, z: 0 });
  ok(Math.abs(lost - 70) < 0.01, `armor absorbs 60% (health lost ${lost})`);
  ok(p.armor === 0, 'armor consumed');
  ok(!p.dead, 'alive after damage');

  let dead = false;
  bus.on('player-dead', () => { dead = true; });
  p.takeDamage(50, { x: 0, y: 0, z: -5 });
  ok(p.dead && dead, 'death fires player-dead');
}

// ------------------------------------------------------------- Data sanity
section('Data validation');
{
  const wstr = ['id', 'name', 'sound'];
  const wnum = ['damage', 'rpm', 'magSize', 'reserve0', 'reloadTime', 'spreadHip', 'spreadADS', 'recoil', 'range', 'adsFov', 'headMult'];
  let wOk = true;
  for (const w of Object.values(WEAPON_DEFS)) {
    for (const k of wstr) if (typeof w[k] !== 'string' || !w[k]) { wOk = false; console.error(`weapon missing ${k}`); }
    for (const k of wnum) if (!(w[k] > 0)) { wOk = false; console.error(`weapon ${w.id} missing ${k}`); }
  }
  ok(wOk, 'all weapon defs have valid required fields');
  ok(Object.keys(WEAPON_DEFS).length >= 4, '4+ weapon classes');

  const ereq = ['name', 'hp', 'speed', 'vision', 'weapon', 'behavior'];
  let eOk = true;
  for (const e of Object.values(ENEMY_DEFS)) {
    for (const k of ereq) if (e[k] === undefined) { eOk = false; console.error(`enemy ${k} missing`); }
    if (!(e.hp > 0 && e.speed > 0 && e.vision.range > 0 && e.weapon.damage > 0)) eOk = false;
  }
  ok(eOk, 'all enemy class defs valid');
  ok(Object.keys(ENEMY_DEFS).length >= 5, '5+ enemy classes');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
