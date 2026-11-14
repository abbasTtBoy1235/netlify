/**
 * WorldFX — pooled, low-overhead combat/environment effects:
 * GPU-point particles (sparks, dust, blood, debris), sprite fireballs
 * and smoke, tracers, shell casings, bullet decals, shockwave rings.
 * One draw call for all particles (custom point shader).
 */
import * as THREE from '../../vendor/three.module.js';
import { pick, rand } from '../core/Utils.js';

const PARTICLE_CAP = 900;

const PARTICLE_VERT = `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vColor = aColor;
  vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (240.0 / max(1.0, -mv.z));
  gl_Position = projectionMatrix * mv;
}`;

const PARTICLE_FRAG = `
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  float a = smoothstep(0.5, 0.12, d) * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor, a);
}`;

export class WorldFX {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.particleScale = 1;

    // ---------- point particles ----------
    this.pCount = PARTICLE_CAP;
    this.pPos = new Float32Array(this.pCount * 3);
    this.pVel = new Float32Array(this.pCount * 3);
    this.pLife = new Float32Array(this.pCount);
    this.pMaxLife = new Float32Array(this.pCount);
    this.pSize = new Float32Array(this.pCount);
    this.pGrav = new Float32Array(this.pCount);
    this.aSize = new Float32Array(this.pCount);
    this.aAlpha = new Float32Array(this.pCount);
    this.aColor = new Float32Array(this.pCount * 3);
    this.pHead = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.aSize, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.aAlpha, 1));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.aColor, 3));
    const mat = new THREE.ShaderMaterial({
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.group.add(this.points);
    this.geo = geo;

    // ---------- sprites (fireballs / smoke / glow) ----------
    this.spritePool = [];
    this._glowTex = this._makeGlowTexture();
    for (let i = 0; i < 28; i++) {
      const m = new THREE.SpriteMaterial({ map: this._glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      const s = new THREE.Sprite(m);
      s.visible = false;
      s.userData = { life: 0, maxLife: 0, grow: 0, rise: 0 };
      this.group.add(s);
      this.spritePool.push(s);
    }

    // ---------- tracers ----------
    const tracerGeo = new THREE.CylinderGeometry(0.016, 0.016, 1, 4, 1, true);
    tracerGeo.rotateX(Math.PI / 2); // +Z axis
    this.tracerMats = {
      player: new THREE.MeshBasicMaterial({ color: 0xffd98a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
      enemy: new THREE.MeshBasicMaterial({ color: 0xff7744, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }),
      flash: new THREE.MeshBasicMaterial({ color: 0xaad4ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false })
    };
    this.tracers = [];
    for (let i = 0; i < 28; i++) {
      const t = new THREE.Mesh(tracerGeo, this.tracerMats.player);
      t.visible = false;
      t.userData = { life: 0, maxLife: 0.07 };
      this.group.add(t);
      this.tracers.push(t);
    }
    this.tracerHead = 0;

    // ---------- casings ----------
    const casingGeo = new THREE.BoxGeometry(0.018, 0.05, 0.018);
    const casingMat = new THREE.MeshStandardMaterial({ color: 0xb8963e, roughness: 0.35, metalness: 0.9 });
    this.casings = [];
    for (let i = 0; i < 40; i++) {
      const c = new THREE.Mesh(casingGeo, casingMat);
      c.visible = false;
      c.userData = { v: new THREE.Vector3(), av: 0, life: 0, resting: false };
      this.group.add(c);
      this.casings.push(c);
    }
    this.casingHead = 0;

    // ---------- decals (bullet holes) ----------
    const decalGeo = new THREE.CircleGeometry(0.035, 8);
    const decalMat = new THREE.MeshBasicMaterial({ color: 0x0a0a0a, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    this.decals = [];
    for (let i = 0; i < 140; i++) {
      const d = new THREE.Mesh(decalGeo, decalMat.clone());
      d.visible = false;
      d.userData = { life: 0 };
      this.group.add(d);
      this.decals.push(d);
    }
    this.decalHead = 0;

    // ---------- shockwave ring ----------
    const ringGeo = new THREE.RingGeometry(0.9, 1, 32);
    this.rings = [];
    for (let i = 0; i < 5; i++) {
      const r = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffc080, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
      r.rotation.x = -Math.PI / 2;
      r.visible = false;
      r.userData = { life: 0, maxLife: 0.45, from: 0.5, to: 6 };
      this.group.add(r);
      this.rings.push(r);
    }
    this.ringHead = 0;

    // flash light (shared, one per world)
    this.flashLight = new THREE.PointLight(0xffaa44, 0, 14, 2);
    this.group.add(this.flashLight);

    // smoke zones (for LOS blocking from smoke grenades)
    this.smokeZones = [];
  }

  _makeGlowTexture() {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const c = cv.getContext('2d');
    const g = c.createRadialGradient(32, 32, 2, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.5)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(cv);
  }

  setParticleScale(v) { this.particleScale = v; }

  // ------------------------------------------------------------- spawn

  /**
   * Burst of point particles.
   * opts: count, color (hex or [hex..]), speed, spread(0-1), gravity, size, life, up
   */
  burst(pos, opts = {}) {
    const n = Math.max(1, Math.round((opts.count || 8) * this.particleScale));
    const colors = Array.isArray(opts.color) ? opts.color : [opts.color || 0xffffff];
    for (let k = 0; k < n; k++) {
      const i = this.pHead;
      this.pHead = (this.pHead + 1) % this.pCount;
      const i3 = i * 3;
      this.pPos[i3] = pos.x; this.pPos[i3 + 1] = pos.y; this.pPos[i3 + 2] = pos.z;
      const spread = opts.spread ?? 0.8;
      const a = Math.random() * Math.PI * 2;
      const e = (Math.random() - 0.5) * 2 * spread;
      const sp = (opts.speed ?? 4) * (0.4 + Math.random() * 0.8);
      this.pVel[i3] = Math.cos(a) * Math.cos(e) * sp;
      this.pVel[i3 + 1] = (Math.sin(e) * sp + (opts.up ?? 0));
      this.pVel[i3 + 2] = Math.sin(a) * Math.cos(e) * sp;
      if (opts.dir) {
        const s = opts.speed ?? 4;
        this.pVel[i3] += opts.dir.x * s * (0.7 + Math.random() * 0.5);
        this.pVel[i3 + 1] += opts.dir.y * s * (0.7 + Math.random() * 0.5);
        this.pVel[i3 + 2] += opts.dir.z * s * (0.7 + Math.random() * 0.5);
      }
      const life = (opts.life ?? 0.5) * (0.6 + Math.random() * 0.8);
      this.pLife[i] = life;
      this.pMaxLife[i] = life;
      this.pSize[i] = (opts.size ?? 0.09) * (0.7 + Math.random() * 0.6);
      this.pGrav[i] = opts.gravity ?? 9;
      const col = new THREE.Color(pick(colors));
      this.aColor[i3] = col.r; this.aColor[i3 + 1] = col.g; this.aColor[i3 + 2] = col.b;
    }
    this._dirtyParticles = true;
  }

  tracer(from, to, kind = 'player') {
    const t = this.tracers[this.tracerHead];
    this.tracerHead = (this.tracerHead + 1) % this.tracers.length;
    const len = from.distanceTo(to);
    if (len < 0.2) return;
    t.position.copy(from).add(to).multiplyScalar(0.5);
    t.scale.set(1, 1, len);
    t.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3().subVectors(to, from).normalize());
    t.material = this.tracerMats[kind] || this.tracerMats.player;
    t.visible = true;
    t.userData.life = 0.07;
    t.userData.maxLife = 0.07;
  }

  muzzleFlash(pos, quat, size = 0.55) {
    const s = this._freeSprite();
    s.position.copy(pos);
    s.material.color.set(0xffc060);
    s.material.blending = THREE.AdditiveBlending;
    s.scale.setScalar(size * (0.8 + Math.random() * 0.5));
    s.material.opacity = 1;
    s.userData = { life: 0.055, maxLife: 0.055, grow: 0, rise: 0 };
    s.visible = true;
    this.flashLight.position.copy(pos);
    this.flashLight.intensity = 40;
    this.flashLight.color.set(0xffaa44);
  }

  casing(pos, rightDir) {
    const c = this.casings[this.casingHead];
    this.casingHead = (this.casingHead + 1) % this.casings.length;
    c.position.copy(pos);
    c.visible = true;
    const u = c.userData;
    u.v.set(rightDir.x * 3 + rand(-1, 1), rand(1.5, 2.6), rightDir.z * 3 + rand(-1, 1));
    u.av = rand(8, 16);
    u.life = 1.6;
    u.resting = false;
  }

  impact(point, normal, surface) {
    if (surface === 'metal') {
      this.burst(point, { count: 7, color: [0xffc873, 0xff9040], speed: 5, gravity: 8, size: 0.05, life: 0.35, up: 1.5, spread: 0.6, dir: normal });
    } else if (surface === 'wood') {
      this.burst(point, { count: 8, color: [0x8a6a3a, 0x5d4a30], speed: 3, gravity: 7, size: 0.06, life: 0.5, dir: normal });
    } else if (surface === 'water') {
      this.burst(point, { count: 8, color: [0x7fb8c8], speed: 3, gravity: 10, size: 0.06, life: 0.4, up: 2 });
    } else {
      this.burst(point, { count: 6, color: [0x9a9a92, 0x6e6e66], speed: 2.6, gravity: 6, size: 0.07, life: 0.45, dir: normal });
    }
    this.decal(point, normal);
  }

  blood(point, normal) {
    this.burst(point, { count: 9, color: [0x7a1212, 0x5a0d0d], speed: 3.4, gravity: 8, size: 0.055, life: 0.5, dir: normal });
  }

  decal(point, normal) {
    const d = this.decals[this.decalHead];
    this.decalHead = (this.decalHead + 1) % this.decals.length;
    d.position.copy(point).addScaledVector(normal, 0.006);
    d.lookAt(point.clone().add(normal));
    d.visible = true;
    d.userData.life = 16;
  }

  explosion(pos, radius = 6) {
    // fireball
    const f = this._freeSprite();
    f.position.copy(pos).add(new THREE.Vector3(0, 0.4, 0));
    f.material.color.set(0xffa040);
    f.material.blending = THREE.AdditiveBlending;
    f.scale.setScalar(radius * 0.7);
    f.material.opacity = 1;
    f.userData = { life: 0.4, maxLife: 0.4, grow: radius * 1.4, rise: 1.5 };
    f.visible = true;
    // inner flash
    const f2 = this._freeSprite();
    f2.position.copy(pos);
    f2.material.color.set(0xfff2c0);
    f2.material.blending = THREE.AdditiveBlending;
    f2.scale.setScalar(radius * 0.4);
    f2.material.opacity = 1;
    f2.userData = { life: 0.18, maxLife: 0.18, grow: radius * 0.5, rise: 0 };
    f2.visible = true;
    // smoke
    const n = Math.round(10 * this.particleScale);
    for (let i = 0; i < n; i++) {
      const s = this._freeSprite();
      s.position.copy(pos).add(new THREE.Vector3(rand(-1, 1), rand(0, 1.2), rand(-1, 1)));
      s.material.color.set(new THREE.Color(0x555a60).offsetHSL(0, 0, rand(-0.05, 0.08)));
      s.material.blending = THREE.NormalBlending;
      s.scale.setScalar(rand(1.2, 2.4));
      s.material.opacity = 0.55;
      s.userData = { life: rand(1, 1.9), maxLife: 1.9, grow: rand(1.5, 3), rise: rand(1.2, 2.4) };
      s.visible = true;
    }
    // sparks + debris
    this.burst(pos, { count: 26, color: [0xffc873, 0xff8030, 0xff5020], speed: 11, gravity: 9, size: 0.07, life: 0.7, up: 4 });
    this.burst(pos, { count: 14, color: [0x333333, 0x1e1e1e], speed: 7, gravity: 12, size: 0.1, life: 1.1, up: 3 });
    // ring
    const r = this.rings[this.ringHead];
    this.ringHead = (this.ringHead + 1) % this.rings.length;
    r.position.copy(pos).setY(pos.y + 0.05);
    r.scale.setScalar(0.5);
    r.material.opacity = 0.7;
    r.userData = { life: 0.45, maxLife: 0.45, from: 0.5, to: radius * 1.6 };
    r.visible = true;
    // light
    this.flashLight.position.copy(pos);
    this.flashLight.intensity = 320;
    this.flashLight.color.set(0xff9040);
  }

  smokeColumn(pos, life = 9) {
    const n = Math.round(9 * this.particleScale);
    for (let i = 0; i < n; i++) {
      const s = this._freeSprite();
      s.position.copy(pos).add(new THREE.Vector3(rand(-0.4, 0.4), rand(0, 0.6), rand(-0.4, 0.4)));
      s.material.color.set(new THREE.Color(0xaab4bc).offsetHSL(0, 0, rand(-0.04, 0.06)));
      s.material.blending = THREE.NormalBlending;
      s.scale.setScalar(rand(1.4, 2.6));
      s.material.opacity = 0.5;
      s.userData = { life: life * (0.6 + Math.random() * 0.5), maxLife: life, grow: rand(1.2, 2), rise: rand(0.5, 1.1) };
      s.visible = true;
    }
  }

  /** Register a smoke cloud that blocks line of sight (world-space sphere). */
  addSmokeZone(x, y, z, r, life) {
    this.smokeZones.push({ x, y, z, r, life, maxLife: life });
  }

  _freeSprite() {
    for (const s of this.spritePool) {
      if (!s.visible) return s;
    }
    // pool exhausted — recycle oldest
    return this.spritePool[0];
  }

  // ------------------------------------------------------------- update

  update(dt) {
    // particles
    const n = this.pCount;
    for (let i = 0; i < n; i++) {
      if (this.pLife[i] <= 0) continue;
      this.pLife[i] -= dt;
      const i3 = i * 3;
      this.pVel[i3 + 1] -= this.pGrav[i] * dt;
      this.pPos[i3] += this.pVel[i3] * dt;
      this.pPos[i3 + 1] += this.pVel[i3 + 1] * dt;
      this.pPos[i3 + 2] += this.pVel[i3 + 2] * dt;
      if (this.pPos[i3 + 1] < 0.02 && this.pVel[i3 + 1] < 0) {
        this.pPos[i3 + 1] = 0.02;
        this.pVel[i3 + 1] *= -0.3;
        this.pVel[i3] *= 0.7;
        this.pVel[i3 + 2] *= 0.7;
      }
      const t = Math.max(0, this.pLife[i] / this.pMaxLife[i]);
      this.aAlpha[i] = t;
      this.aSize[i] = this.pSize[i] * (0.5 + 0.5 * t);
    }
    if (this._dirtyParticles || this.pHead !== this._lastHead) {
      this._lastHead = this.pHead;
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.aAlpha.needsUpdate = true;
      this.geo.attributes.aSize.needsUpdate = true;
      this.geo.attributes.aColor.needsUpdate = true;
    }
    // sprites
    for (const s of this.spritePool) {
      if (!s.visible) continue;
      const u = s.userData;
      u.life -= dt;
      const t = Math.max(0, u.life / u.maxLife);
      s.position.y += u.rise * dt;
      s.scale.addScalar(u.grow * dt);
      s.material.opacity = s.material.blending === THREE.AdditiveBlending ? t : Math.min(1, t * 2.5) * 0.55;
      if (u.life <= 0) { s.visible = false; }
    }
    // tracers
    for (const t of this.tracers) {
      if (!t.visible) continue;
      t.userData.life -= dt;
      t.material.opacity = Math.max(0, (t.userData.life / t.userData.maxLife) * (t.userData.maxLife === 0.07 ? 0.9 : 0.7));
      if (t.userData.life <= 0) t.visible = false;
    }
    // casings
    for (const c of this.casings) {
      if (!c.visible) continue;
      const u = c.userData;
      u.life -= dt;
      if (!u.resting) {
        u.v.y -= 20 * dt;
        c.position.addScaledVector(u.v, dt);
        c.rotation.x += u.av * dt;
        c.rotation.z += u.av * 0.7 * dt;
        if (c.position.y <= 0.03) {
          c.position.y = 0.03;
          u.resting = true;
          u.life = Math.min(u.life, 0.7);
        }
      }
      if (u.life <= 0) c.visible = false;
    }
    // decals
    for (const d of this.decals) {
      if (!d.visible) continue;
      d.userData.life -= dt;
      if (d.userData.life <= 0) d.visible = false;
    }
    // rings
    for (const r of this.rings) {
      if (!r.visible) continue;
      const u = r.userData;
      u.life -= dt;
      const t = 1 - Math.max(0, u.life / u.maxLife);
      r.scale.setScalar(u.from + (u.to - u.from) * t);
      r.material.opacity = 0.7 * (1 - t);
      if (u.life <= 0) r.visible = false;
    }
    // flash light decay
    this.flashLight.intensity *= Math.exp(-22 * dt);
    if (this.flashLight.intensity < 0.5) this.flashLight.intensity = 0;
    // smoke zones
    for (let i = this.smokeZones.length - 1; i >= 0; i--) {
      const z = this.smokeZones[i];
      z.life -= dt;
      if (z.life <= 0) this.smokeZones.splice(i, 1);
    }
  }

  dispose() {
    this.scene.remove(this.group);
    this.geo.dispose();
    this.points.material.dispose();
  }
}
