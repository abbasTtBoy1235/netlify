# SALTLINE — Operation: Broken Signal

A complete, genuinely playable **3D first-person tactical shooter** that runs in the
browser (Three.js r187, WebGL). Built to the spec of a Unity 6.6 / C# tactical FPS,
with the same modular architecture — every asset (geometry, textures, models,
audio) is **100% procedurally generated at runtime**. No external assets, no
dependencies beyond the vendored three.js build.

## Play it

- **Live preview**: the game is served from this repo (publish dir `saltline/`).
- **Local**: `npm start` → open http://localhost:8080
- **Headless self-test**: append `?autoplay=1` to the URL — an autonomous driver
  plays the full mission through the real input/combat pipelines and logs
  `[SALTLINE]` verification lines to the console.

## The mission

**OPERATION: BROKEN SIGNAL** — an abandoned shipping port (Sector 7) at night,
rain on wet concrete, hostile forces uplinking targeting data through three
relay stations.

Seven objectives: infiltrate the gate → locate & destroy relays **ALPHA /
BRAVO / CHARLIE** (shoot them, blow them up, or hold **F** to hack the console)
→ eliminate all remaining hostiles → reach the helipad and hold position for
extraction. Checkpoints auto-save at every objective; **Continue** resumes
them. A stats screen (time, kills, headshots, accuracy, rating) closes the run.

## Controls

| Key | Action | | Key | Action |
|---|---|---|---|---|
| WASD | Move | | LMB / RMB | Fire / Aim (ADS) |
| SHIFT | Sprint (stamina) | | R | Reload |
| CTRL / C | Crouch | | Q / E | Lean |
| SPACE | Jump | | G | Throw grenade |
| V | Cycle grenade type / weapon (wheel) | | B | Toggle auto/burst |
| 1-3 | Weapon slots | | F | Interact (hack relay) |
| F3 | Debug overlay | | ESC | Pause |

## What's in the build

- **Weapons** (data-driven defs, ScriptableObject-style): M4V carbine (auto/burst,
  red dot), PM-90 SMG, P-9 pistol, HARKAN-14 scoped sniper (catwalk pickup).
  ADS, recoil, hip/ADS spread, reload, suppressor-free attachments framework,
  3D-spatial procedural gunfire.
- **Grenades**: frag (splash damage, chain reactions), smoke (blocks AI line of
  sight), flashbang (blinds squads).
- **Enemy AI**: 11-state behavior state machine (dormant → patrol → suspicious →
  investigate → search → combat → cover → retreat → dead) running at 8 Hz over a
  waypoint A* nav graph. Six enemy classes (guard, rifleman, assault, heavy,
  marksman, elite) with vision cones + hearing, cover use with peek cycles,
  flanking, squad alerts on sighting, low-HP retreat + out-of-combat regen,
  enemy grenades. They never chase in a straight line.
- **World**: procedural port — warehouses, container yard, ship, cranes, fuel
  depot, helipad; destructibles (fuel tanks, ammo crates, wooden crates with
  loot, water tank) with chain-reaction explosions; pickups (health, armor,
  ammo, grenades, weapons).
- **HUD** per spec: objectives + progress (top-left), compass with objective
  marker (top-center), minimap (top-right), minimal crosshair with dynamic
  spread, weapon/ammo/fire-mode panel (bottom-right), health/armor/stamina
  (bottom-left), damage-direction arcs, hit markers, kill feed, notifications.
- **Screens**: main menu (New / Continue / Mission Select / Settings / Credits /
  Exit), mission briefing, pause, settings (presets LOW–ULTRA, sensitivity,
  ADS sens, FOV, crosshair, camera shake, rain, 4 audio sliders — auto-saved),
  mission-complete stats, death + checkpoint restart.
- **Audio**: fully procedural WebAudio — spatial gunshots/explosions/impacts/
  footsteps, wind + gulls + ship-horn ambience, and a tension-reactive score
  that swells when combat gets close.
- **Persistence**: settings autosave; checkpoint saves (objective stage, kills,
  relay HP, stats) with Continue.

## Architecture

Mirrors the intended Unity 6.6 / C# design so a C# port is mechanical:

```
saltline/
  index.html            app shell (#gl, HUD, menus, overlays)
  vendor/               vendored three.js r187
  src/
    core/        App (orchestrator/state machine), Settings (presets), EventBus, Pool, Utils
    input/       InputManager (pointer lock + cursor-aim fallback, frame-edged state)
    audio/       AudioEngine (procedural SFX, ambience, tension score, 3D panning)
    environment/ Port (level), Textures (canvas textures), WorldFX (pooled particles)
    player/      Player (FPS controller, health/armor/stamina)
    weapons/     Weapons (data defs + WeaponSystem), Grenades, Pickups
    combat/      Destructibles
    enemies/     NavGraph (A*), EnemyDefs (6 classes), Brain (state machine),
                 Enemy (model/execution), EnemyManager (roster, LOS, alerts)
    missions/    Mission (data-driven objectives), Relay (destruction/hacking)
    save/        SaveSystem (localStorage checkpoint)
    ui/          HUD, Menus
    debug/       autoplay.js (?autoplay=1 headless driver)
  test/          run-tests.mjs (49 headless Node tests)
```

## Tests

`npm test` — 49 headless tests in Node (no browser needed): nav graph/A*,
event bus, settings & save roundtrip, the full AI state machine (hearing,
sight confirmation, engagement, retreat, blinding, de-escalation), the entire
7-objective mission progression, player damage/armor/death, and weapon/enemy
data validation.
