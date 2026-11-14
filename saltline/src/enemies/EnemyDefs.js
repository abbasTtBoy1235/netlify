/**
 * EnemyDefs — scriptable enemy classes. Each class has distinct health,
 * armor, speed, perception, weapon and behavioral flags (cover usage,
 * flanking, retreat-and-heal, stationary overwatch).
 */
export const ENEMY_DEFS = {
  guard: {
    name: 'SECURITY GUARD',
    hp: 55, armor: 0, speed: 2.4, scale: 0.97,
    vision: { range: 26, fov: 95 },
    weapon: { damage: 11, range: 26, acc: 0.5, rpm: 95, burst: 3, mag: 18 },
    behavior: { cover: false, flank: false, retreat: 0.35, regen: false, stationary: false, grenades: false },
    tint: 0x5a6a4a, accent: 0x7a8a5a, model: 'pistol'
  },
  rifleman: {
    name: 'INFANTRY',
    hp: 75, armor: 0, speed: 2.7, scale: 1.0,
    vision: { range: 34, fov: 105 },
    weapon: { damage: 12, range: 48, acc: 0.55, rpm: 180, burst: 3, mag: 24 },
    behavior: { cover: true, flank: false, retreat: 0, regen: false, stationary: false, grenades: false },
    tint: 0x4a5568, accent: 0x5a6a80, model: 'rifle'
  },
  assault: {
    name: 'TACTICAL ASSAULT',
    hp: 95, armor: 10, speed: 3.1, scale: 1.03,
    vision: { range: 40, fov: 115 },
    weapon: { damage: 13, range: 52, acc: 0.6, rpm: 240, burst: 5, mag: 28 },
    behavior: { cover: true, flank: true, retreat: 0, regen: false, stationary: false, grenades: true },
    tint: 0x6a5a48, accent: 0x8a7a5a, model: 'rifle'
  },
  heavy: {
    name: 'HEAVY SOLDIER',
    hp: 170, armor: 40, speed: 1.9, scale: 1.14,
    vision: { range: 36, fov: 100 },
    weapon: { damage: 14, range: 44, acc: 0.62, rpm: 200, burst: 6, mag: 32 },
    behavior: { cover: true, flank: false, retreat: 0.35, regen: true, stationary: false, grenades: false },
    tint: 0x3a4148, accent: 0x6a7a92, model: 'heavy'
  },
  sniper: {
    name: 'MARKSMAN',
    hp: 65, armor: 0, speed: 2.0, scale: 1.0,
    vision: { range: 70, fov: 50 },
    weapon: { damage: 45, range: 95, acc: 0.8, rpm: 45, burst: 1, mag: 6 },
    behavior: { cover: false, flank: false, retreat: 0, regen: false, stationary: true, grenades: false },
    tint: 0x44503f, accent: 0x5a6a4f, model: 'sniper'
  },
  elite: {
    name: 'SPECIAL FORCES',
    hp: 120, armor: 20, speed: 3.3, scale: 1.05,
    vision: { range: 46, fov: 120 },
    weapon: { damage: 18, range: 58, acc: 0.72, rpm: 130, burst: 2, mag: 20 },
    behavior: { cover: true, flank: true, retreat: 0.3, regen: true, stationary: false, grenades: true },
    tint: 0x2e3a4a, accent: 0x9a3030, model: 'rifle'
  }
};
