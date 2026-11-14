/** Math + misc helpers. Engine-agnostic (no three import) so they are unit-testable in Node. */

export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }
/** Frame-rate independent exponential damping. */
export function damp(a, b, lambda, dt) { return lerp(a, b, 1 - Math.exp(-lambda * dt)); }
export function rand(min, max) { return min + Math.random() * (max - min); }
export function randInt(min, max) { return Math.floor(rand(min, max + 1)); }
export function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
export function chance(p) { return Math.random() < p; }

/** Shortest-path angle interpolation (radians). */
export function angleLerp(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export function dist2D(ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  return Math.sqrt(dx * dx + dz * dz);
}

export function toRad(deg) { return deg * Math.PI / 180; }
export function toDeg(rad) { return rad * 180 / Math.PI; }

/** Bearing in degrees (0 = north/-Z, 90 = east/+X). Returns 0..360. */
export function bearingTo(ox, oz, tx, tz) {
  const dx = tx - ox, dz = tz - oz;
  let b = Math.atan2(dx, -dz) * 180 / Math.PI;
  if (b < 0) b += 360;
  return b;
}

/** Compressed timestamp for save files. */
export function nowSec() { return Math.floor(Date.now() / 1000); }

/** Format seconds as m:ss. */
export function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec));
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
