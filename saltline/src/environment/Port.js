/**
 * Port — "Sector 7" industrial shipping port level.
 * Builds all static geometry, colliders, navigation waypoints, cover
 * points, lighting, sky, rain and environmental props. All meshes use
 * shared unit geometries + shared materials (disposable on teardown).
 */
import * as THREE from '../../vendor/three.module.js';
import { Tex } from './Textures.js';
import { clamp } from '../core/Utils.js';

const CONTAINER_COLORS = ['#6e3b2f', '#2e4257', '#4a5440', '#3d5a5e', '#7a6a4a', '#46525e', '#5e3a44', '#3f4a35'];

export class Port {
  constructor(scene, detail = 'full') {
    this.scene = scene;
    this.detail = detail;
    this.group = new THREE.Group();
    scene.add(this.group);

    this.staticMeshes = [];   // raycast targets (world)
    this.colliders = [];      // AABBs {minx,miny,minz,maxx,maxy,maxz}
    this.blockers = [];       // 2D AABBs that block nav edges
    this.waypoints = [];
    this.coverPoints = [];
    this.lights = [];
    this.lampBases = [];
    this._geom = new Set();
    this._mat = new Set();

    this.sunDir = new THREE.Vector3(-0.86, 0.22, -0.45).normalize();
    this._build();
  }

  // -------------------------------------------------------------- helpers

  _trackMat(m) { this._mat.add(m); return m; }
  _trackGeom(g) { this._geom.add(g); return g; }

  /** Shared unit box — every box in the level scales this one geometry. */
  get _unitBox() {
    if (!this.__ub) this.__ub = this._trackGeom(new THREE.BoxGeometry(1, 1, 1));
    return this.__ub;
  }

  box(x, y, z, w, h, d, mat, surface, o = {}) {
    const m = new THREE.Mesh(this._unitBox, mat);
    m.position.set(x, y, z);
    m.scale.set(w, h, d);
    if (o.rotY) m.rotation.y = o.rotY;
    if (o.rotX) m.rotation.x = o.rotX;
    m.userData.surface = surface || 'concrete';
    this.group.add(m);
    if (o.shoot !== false) this.staticMeshes.push(m);
    if (o.collide !== false) {
      this.colliders.push({ minx: x - w / 2, miny: y - h / 2, minz: z - d / 2, maxx: x + w / 2, maxy: y + h / 2, maxz: z + d / 2 });
    }
    if (o.block) this.blockers.push({ minx: x - w / 2, minz: z - d / 2, maxx: x + w / 2, maxz: z + d / 2 });
    return m;
  }

  cyl(x, y, z, r, h, mat, surface, o = {}) {
    const g = this._trackGeom(new THREE.CylinderGeometry(r, r, h, 10));
    const m = new THREE.Mesh(g, mat);
    m.position.set(x, y, z);
    m.userData.surface = surface || 'metal';
    this.group.add(m);
    if (o.shoot !== false) this.staticMeshes.push(m);
    if (o.collide !== false) {
      this.colliders.push({ minx: x - r, miny: y - h / 2, minz: z - r, maxx: x + r, maxy: y + h / 2, maxz: z + r });
    }
    if (o.block) this.blockers.push({ minx: x - r, minz: z - r, maxx: x + r, maxz: z + r });
    return m;
  }

  _stdMat(map, roughness = 0.9, metalness = 0.05, o = {}) {
    const m = new THREE.MeshStandardMaterial({ map, roughness, metalness, ...o });
    if (map && o.repeat) map.repeat.set(o.repeat[0], o.repeat[1]);
    return this._trackMat(m);
  }

  // ------------------------------------------------------------- building

  _build() {
    const matConcrete = this._stdMat(Tex.concrete(), 0.92, 0.02, { repeat: [14, 10] });
    const matAsphalt = this._stdMat(Tex.asphalt(), 0.95, 0.0, { repeat: [26, 20] });
    const matRoad = this._stdMat(Tex.road(), 0.95, 0.0);
    const matSteel = this._stdMat(Tex.steel(), 0.7, 0.55);
    const matCrate = this._stdMat(Tex.crate(), 0.9, 0.0);
    const matHull = this._trackMat(new THREE.MeshStandardMaterial({ color: 0x33292a, roughness: 0.85, metalness: 0.35 }));
    const matWater = this._stdMat(Tex.water(), 0.18, 0.55, { repeat: [10, 3] });
    const matShack = this._stdMat(Tex.shackWall(), 0.9, 0.0);
    const matDark = this._trackMat(new THREE.MeshStandardMaterial({ color: 0x1d2126, roughness: 0.8, metalness: 0.4 }));
    this.dprops = []; // destructible props (registered by later build steps)
    const matYellow = this._trackMat(new THREE.MeshStandardMaterial({ color: 0xc9a53a, roughness: 0.7, metalness: 0.2 }));
    const matPad = this._stdMat(Tex.helipad(), 0.95, 0.0);
    this.matWater = matWater;
    this.matAsphalt = matAsphalt;
    this.matConcrete = matConcrete;

    // ---- ground / water / roads
    const ground = new THREE.Mesh(this._trackGeom(new THREE.PlaneGeometry(260, 180)), matAsphalt);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, 0, -20);
    ground.userData.surface = 'asphalt';
    this.group.add(ground);
    this.staticMeshes.push(ground);
    this.colliders.push({ minx: -130, miny: -1, minz: -110, maxx: 130, maxy: 0, maxz: 70 });

    const yard = new THREE.Mesh(this._trackGeom(new THREE.PlaneGeometry(92, 132)), matConcrete);
    yard.rotation.x = -Math.PI / 2;
    yard.position.set(-70, 0.015, -30);
    yard.userData.surface = 'concrete';
    this.group.add(yard);
    this.staticMeshes.push(yard);

    const water = new THREE.Mesh(this._trackGeom(new THREE.PlaneGeometry(260, 45)), matWater);
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, -0.55, 92.5);
    water.userData.surface = 'water';
    this.group.add(water);
    this.staticMeshes.push(water);

    // roads (thin strips)
    this.box(0, 0.02, -51, 236, 0.04, 6, matRoad, 'asphalt', { collide: false });
    this.box(20, 0.02, 0, 6, 0.04, 94, matRoad, 'asphalt', { collide: false });
    this.box(-12, 0.02, -65, 6, 0.04, 30, matRoad, 'asphalt', { collide: false });
    this.box(30, 0.02, -68, 6, 0.04, 34, matRoad, 'asphalt', { collide: false });
    this.box(95, 0.02, -73, 6, 0.04, 46, matRoad, 'asphalt', { collide: false });
    // rail corridor
    this.box(-72, 0.03, -51, 88, 0.05, 0.25, matDark, 'metal', { collide: false });
    this.box(-72, 0.03, -50, 88, 0.05, 0.25, matDark, 'metal', { collide: false });

    // ---- pier + ship
    this.box(17.5, -0.8, 56, 95, 1.6, 34, matConcrete, 'concrete', { collide: false, block: false });
    this.box(17.5, -0.15, 72.9, 95, 1.4, 0.3, matDark, 'concrete', { collide: false });
    this.box(18, 0.5, 93, 60, 9, 14, matHull, 'metal', { block: true });
    this.box(18, 5.4, 93, 58, 0.6, 13, matSteel, 'metal', { collide: false });
    // deck cargo
    for (let i = 0; i < 6; i++) {
      const cm = this.containerMat(CONTAINER_COLORS[(i * 3) % 8], `DK-${200 + i}`);
      this.box(-4 + i * 8.4, 6.9, 91.5, 7.6, 2.5, 5.8, cm, 'metal', { collide: false });
    }
    this.box(44, 8.2, 93, 9, 5, 7, matConcrete, 'concrete', { collide: false });
    this.cyl(44, 12.5, 93, 0.15, 4, matSteel, 'metal', { collide: false });

    // ---- container yard
    const ROWS = [-85, -68, -34, -17, 0, 17, 34];
    const XS = [-108, -96, -84, -72, -60];
    const GAPS = { 0: 2, 2: 3, 4: 1, 6: 2 };
    for (let r = 0; r < ROWS.length; r++) {
      for (let s = 0; s < XS.length; s++) {
        if (GAPS[r] === s) continue;
        const x = XS[s], z = ROWS[r];
        const stacks = ((r * 3 + s) % 5 < 2) ? 2 : 1;
        for (let k = 0; k < stacks; k++) {
          const ci = (r * 5 + s + k * 3) % 8;
          const code = `SAL-${(1000 + r * 17 + s * 7 + k * 29) % 9000}`;
          this.box(x, 1.29 + k * 2.58, z, 12, 2.58, 2.56, this.containerMat(CONTAINER_COLORS[ci], code), 'metal', { block: true });
        }
        if (stacks === 1) {
          // cover positions flanking single containers
          for (const dx of [-4, 4]) {
            this.coverPoints.push({ x: x + dx, z: z - 2.3 }, { x: x + dx, z: z + 2.3 });
          }
        }
      }
    }

    // ---- warehouses
    this._warehouseA(matConcrete, matSteel, matCrate);
    this._warehouseB(matConcrete, matSteel, matCrate);

    // ---- industrial / power area
    this._industrial(matConcrete, matSteel, matYellow, matDark);

    // ---- cranes
    this._crane(-55, -51, matSteel, true);
    this._crane(10, -51, matSteel, false);

    // ---- watchtower
    const wt = (-30), wz = -9;
    for (const [dx, dz] of [[-1.8, -1.8], [1.8, -1.8], [-1.8, 1.8], [1.8, 1.8]]) {
      this.box(wt + dx, 3, wz + dz, 0.22, 6, 0.22, matSteel, 'metal', { collide: false });
    }
    this.box(wt, 6.1, wz, 4.4, 0.25, 4.4, matSteel, 'metal', { block: true });
    this.box(wt, 7.4, wz, 3, 2.4, 3, matShack, 'metal', { collide: false });

    // ---- perimeter fence + gate
    this._fence(matDark);

    // ---- gate props
    this.box(-118, 1.5, -60, 4, 3, 3.4, matShack, 'metal', { block: true });
    this.box(-116.5, 2.1, -58, 0.4, 1, 1, matDark, 'metal', { collide: false });
    this.box(-120, 2.6, -44, 0.3, 5.4, 0.3, matYellow, 'metal', { collide: false, rotY: 0.5 });
    this.box(-120, 2.6, -58, 0.3, 5.4, 0.3, matYellow, 'metal', { collide: false, rotY: -0.5 });

    // ---- destructible props (registered for the combat system)
    const matBarrelF = this._stdMat(Tex.barrelFuel(), 0.6, 0.4);
    const matBarrelA = this._stdMat(Tex.barrelAmmo(), 0.6, 0.4);
    const fuel = [[-95, -63], [-65, -26], [-40, 8], [-100, 17], [10, 55], [40, 60], [-28, -12], [12, -74], [16, -76]];
    for (const [x, z] of fuel) {
      const m = this.cyl(x, 0.7, z, 0.55, 1.4, matBarrelF, 'metal');
      this.dprops.push({ mesh: m, type: 'fuel', x, z });
    }
    const ammo = [[-116, -57], [-116, -46], [-2, -92], [68, -90], [30, 52]];
    for (const [x, z] of ammo) {
      const m = this.cyl(x, 0.7, z, 0.5, 1.4, matBarrelA, 'metal');
      this.dprops.push({ mesh: m, type: 'ammo', x, z });
    }
    // wooden crates (static cover + breakables)
    const crateSpots = [[-80, -63, 2], [-52, -9, 1], [-30, 26, 2], [-105, -80, 1], [-45, 8, 1], [20, 50, 2], [-20, 62, 1]];
    for (const [x, z, h] of crateSpots) {
      for (let k = 0; k < h; k++) {
        const m = this.box(x, 0.8 + k * 1.6, z, 1.6, 1.6, 1.6, matCrate, 'wood', { block: true });
        if (k === 0) this.dprops.push({ mesh: m, type: 'crate', x, z });
      }
      this.coverPoints.push({ x: x - 1.3, z }, { x: x + 1.3, z });
    }

    // ---- helipad + helicopter
    this.box(95, 0.06, -95, 15, 0.12, 15, matConcrete, 'concrete', { collide: false });
    const padTop = new THREE.Mesh(this._trackGeom(new THREE.CircleGeometry(7, 24)), matPad);
    padTop.rotation.x = -Math.PI / 2;
    padTop.position.set(95, 0.13, -95);
    padTop.userData.surface = 'concrete';
    this.group.add(padTop);
    this.staticMeshes.push(padTop);
    this.heli = new THREE.Group();
    const matHeli = this._trackMat(new THREE.MeshStandardMaterial({ color: 0x3d4a41, roughness: 0.55, metalness: 0.5 }));
    const hb = new THREE.Mesh(this._unitBox, matHeli); hb.scale.set(4.6, 1.7, 1.9); hb.position.set(99, 1.5, -95);
    const hn = new THREE.Mesh(this._unitBox, matHeli); hn.scale.set(1.6, 1.3, 1.6); hn.position.set(96.6, 1.4, -95);
    const ht = new THREE.Mesh(this._unitBox, matHeli); ht.scale.set(4.4, 0.5, 0.5); ht.position.set(102.6, 1.9, -95);
    const hf = new THREE.Mesh(this._unitBox, matHeli); hf.scale.set(0.9, 1.2, 0.1); hf.position.set(104.4, 2.5, -95);
    for (const sx of [-1.2, 1.2]) {
      const sk = new THREE.Mesh(this._unitBox, matDark); sk.scale.set(4.6, 0.12, 0.12); sk.position.set(99, 0.5, -95 + sx);
      this.heli.add(sk);
    }
    this.heliRotor = new THREE.Group();
    const r1 = new THREE.Mesh(this._unitBox, matDark); r1.scale.set(9.4, 0.07, 0.5);
    const r2 = new THREE.Mesh(this._unitBox, matDark); r2.scale.set(9.4, 0.07, 0.5); r2.rotation.y = Math.PI / 2;
    this.heliRotor.add(r1, r2);
    this.heliRotor.position.set(99, 2.6, -95);
    this.heli.add(hb, hn, ht, hf, this.heliRotor);
    this.group.add(this.heli);
    for (const m of this.heli.children) { m.userData.surface = 'metal'; }

    // ---- light poles
    const matLampGlass = this._trackMat(new THREE.MeshStandardMaterial({ color: 0x332211, emissive: 0xffc98a, emissiveIntensity: 2.2 }));
    const poleSpots = [[-105, -44], [-75, -44], [-45, -44], [-15, -44], [15, -44], [45, -44], [75, -44], [-118, -43], [-118, -59], [0, 62], [45, 62], [90, -92]];
    this._lampGlow = this._makeGlowSprite();
    poleSpots.forEach(([x, z], i) => {
      this.cyl(x, 3.25, z, 0.12, 6.5, matSteel, 'metal', { collide: false });
      this.box(x + 0.7, 6.3, z, 1.6, 0.12, 0.12, matSteel, 'metal', { collide: false });
      const lamp = new THREE.Mesh(this._unitBox, matLampGlass);
      lamp.scale.set(0.55, 0.22, 0.32);
      lamp.position.set(x + 1.4, 6.2, z);
      this.group.add(lamp);
      const glow = new THREE.Sprite(this._lampGlow.clone());
      glow.position.set(x + 1.4, 6.1, z);
      glow.scale.set(2.2, 2.2, 1);
      this.group.add(glow);
      if (i % 2 === 0) {
        const pl = new THREE.PointLight(0xffc98a, 26, 24, 1.8);
        pl.position.set(x + 1.4, 6.0, z);
        this.group.add(pl);
        this.lights.push(pl);
        this.lampBases.push(26);
      }
    });

    // ---- sky dome, stars, moon, sun glow
    const sky = new THREE.Mesh(
      this._trackGeom(new THREE.SphereGeometry(420, 20, 12)),
      this._trackMat(new THREE.MeshBasicMaterial({ map: Tex.sky(), side: THREE.BackSide, fog: false, depthWrite: false }))
    );
    this.group.add(sky);
    const starGeo = this._trackGeom(new THREE.BufferGeometry());
    const sp = new Float32Array(600 * 3);
    for (let i = 0; i < 600; i++) {
      const a = Math.random() * Math.PI * 2;
      const e = Math.random() * Math.PI * 0.42 + 0.18;
      sp[i * 3] = Math.cos(a) * Math.cos(e) * 400;
      sp[i * 3 + 1] = Math.sin(e) * 400;
      sp[i * 3 + 2] = Math.sin(a) * Math.cos(e) * 400;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    const stars = new THREE.Points(starGeo, this._trackMat(new THREE.PointsMaterial({ color: 0xbfd0e0, size: 0.7, sizeAttenuation: false, transparent: true, opacity: 0.65, fog: false })));
    this.group.add(stars);
    this._moonGlow = this._makeGlowSprite(0xdde8f5, 1.0);
    const moon = new THREE.Sprite(this._moonGlow);
    moon.position.set(240, 190, -300);
    moon.scale.set(26, 26, 1);
    this.group.add(moon);
    const sunGlow = new THREE.Sprite(this._makeGlowSprite(0xffa050, 1.4));
    sunGlow.position.copy(this.sunDir).multiplyScalar(380);
    sunGlow.scale.set(110, 110, 1);
    this.group.add(sunGlow);

    // ---- lights
    this.sun = new THREE.DirectionalLight(0xff9d5c, 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -75; sc.right = 75; sc.top = 75; sc.bottom = -75; sc.near = 20; sc.far = 320;
    this.sun.shadow.bias = -0.0006;
    this.group.add(this.sun);
    this.group.add(this.sun.target);
    const hemi = new THREE.HemisphereLight(0x44586e, 0x1c1a17, 0.5);
    this.group.add(hemi);
    const fill = new THREE.DirectionalLight(0x2a3a52, 0.4);
    fill.position.set(120, 90, 160);
    this.group.add(fill);

    // ---- rain
    const RAIN_MAX = 1200;
    this._px = 0; this._pz = 0;
    this.rainGeo = this._trackGeom(new THREE.BufferGeometry());
    this.rainPos = new Float32Array(RAIN_MAX * 2 * 3);
    for (let i = 0; i < RAIN_MAX; i++) this._rainSpawn(i, 0);
    this.rainGeo.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3));
    this.rainMat = this._trackMat(new THREE.LineBasicMaterial({ color: 0x8fa3b8, transparent: true, opacity: 0.22, depthWrite: false }));
    this.rain = new THREE.LineSegments(this.rainGeo, this.rainMat);
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.rainCount = RAIN_MAX;
    this.group.add(this.rain);

    // ---- gameplay anchors
    this.infiltrate = { x: -113, z: -51 };
    this.extract = { x: 95, z: -95, radius: 6 };
    this.playerSpawn = { x: -127, z: -51, yaw: -Math.PI / 2 };
    this.relaysPos = { A: { x: -88, z: -26 }, B: { x: 14, z: -72 }, C: { x: 48, z: 55 } };
    for (const [k, p] of Object.entries(this.relaysPos)) {
      this.box(p.x, 0.05, p.z, 9, 0.1, 9, matConcrete, 'concrete', { collide: false });
    }
    this.sniperPerch = { x: -26, y: 3.7, z: -91 };

    // ---- waypoints
    const wp = this.waypoints;
    const corridor = [-116, -100, -84, -68, -52, -36, -20, 20, 40, 60, 80, 100];
    for (const x of corridor) wp.push({ x, z: -51 });
    // west lane around the mid-wall (x −90..−78, z −35.3..−32.7): without a
    // node here the direct (−84,−51)→(−94,−26) edge clips the wall corner,
    // and A* is forced onto a 67 m east-then-north-then-west detour
    wp.push({ x: -94, z: -51 });
    for (const z of [-80, -63, -26, -9, 8, 26]) {
      for (const x of [-110, -94, -78, -62, -46, -30]) wp.push({ x, z });
    }
    for (const x of [20]) for (const z of [-30, -10, 10, 30]) wp.push({ x, z });
    for (const z of [-70, -80]) wp.push({ x: 30, z });
    for (const z of [-65, -80, -90]) wp.push({ x: 95, z });
    wp.push({ x: -24, z: -84 }, { x: -12, z: -88 }, { x: 0, z: -84 }, { x: -20, z: -92 });
    wp.push({ x: 50, z: -88 }, { x: 62, z: -88 });
    wp.push({ x: 14, z: -60 }, { x: 30, z: -60 }, { x: 48, z: -56 });
    wp.push({ x: -25, z: 55 }, { x: 0, z: 50 }, { x: 25, z: 55 }, { x: 48, z: 55 }, { x: 0, z: 66 }, { x: 30, z: 66 });
    wp.push({ x: -117, z: -51 });

    // cover: warehouse walls & pier
    for (const x of [-26, -12, 2]) this.coverPoints.push({ x, z: -78.5 }, { x, z: -95.5 });
    for (const x of [58, 68]) this.coverPoints.push({ x, z: -81 }, { x, z: -93 });
    for (const x of [-25, 5, 35]) this.coverPoints.push({ x, z: 71.5 });

    // ---- enemy roster (see EnemyDefs for class meanings)
    const G = (cls, x, z, o = {}) => ({ cls, x, z, y: o.y || 0, face: o.face ?? 0, mode: o.mode || 'patrol', route: o.route || null, wake: o.wake || null });
    this.spawnGroups = [
      G('guard', -116, -58, { mode: 'guard' }),
      G('guard', -116, -44, { mode: 'guard' }),
      G('rifleman', -105, -80, { route: [{ x: -105, z: -80 }, { x: -40, z: -80 }] }),
      G('rifleman', -40, -80, { route: [{ x: -40, z: -80 }, { x: -105, z: -80 }] }),
      G('rifleman', -105, 8, { route: [{ x: -105, z: 8 }, { x: -40, z: 8 }] }),
      G('rifleman', -40, 8, { route: [{ x: -40, z: 8 }, { x: -105, z: 8 }] }),
      G('heavy', -92, -26, { mode: 'guard' }),
      G('rifleman', -70, 0, { route: [{ x: -70, z: 0 }, { x: -70, z: -40 }, { x: -30, z: -40 }] }),
      G('rifleman', -55, -17, { wake: 'obj1' }),
      G('assault', -90, -51, { route: [{ x: -90, z: -51 }, { x: -30, z: -51 }] }),
      G('assault', -30, -51, { route: [{ x: -30, z: -51 }, { x: -90, z: -51 }] }),
      G('rifleman', -12, -88),
      G('rifleman', -2, -84),
      G('sniper', -26, -91, { y: 3.7, mode: 'static' }),
      G('heavy', 20, -70, { mode: 'guard' }),
      G('heavy', 36, -74, { mode: 'guard' }),
      G('elite', 25, -62),
      G('assault', 50, -88),
      G('assault', 64, -88),
      G('elite', 58, -84, { wake: 'obj3' }),
      G('sniper', -55, -51, { y: 16.6, mode: 'static' }),
      G('heavy', 40, 55, { mode: 'guard' }),
      G('guard', 0, 65, { route: [{ x: -20, z: 65 }, { x: 20, z: 65 }] }),
      G('elite', 90, -88, { wake: 'obj5', mode: 'guard' }),
      G('assault', 48, 48),
      G('rifleman', 35, 60, { route: [{ x: 35, z: 60 }, { x: 55, z: 66 }] }),
      G('rifleman', 55, 62, { route: [{ x: 55, z: 62 }, { x: 35, z: 60 }] })
    ];

    // ---- pre-placed pickups
    this.pickups = [
      { type: 'health', x: -40, z: -5 },
      { type: 'health', x: 95, z: -95 },
      { type: 'health', x: 0, z: 65 },
      { type: 'armor', x: -70, z: 17 },
      { type: 'armor', x: 25, z: -60 },
      { type: 'ammo', x: -108, z: -85 },
      { type: 'ammo', x: -30, z: 34 },
      { type: 'ammo', x: 10, z: 55 },
      { type: 'grenade', x: -60, z: 0 }
    ];
    this.weaponPickups = [
      { weapon: 'sniper', x: -26, y: 3.85, z: -91, label: 'HARKAN-14 SNIPER RIFLE' }
    ];
  }

  containerMat(hex, code) {
    const key = hex + code;
    if (!this._contMats) this._contMats = new Map();
    if (this._contMats.has(key)) return this._contMats.get(key);
    const m = this._stdMat(Tex.container(hex, code), 0.62, 0.45);
    this._contMats.set(key, m);
    return m;
  }

  _makeGlowSprite(color = 0xffc98a, intensity = 1) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const c = cv.getContext('2d');
    const g = c.createRadialGradient(32, 32, 2, 32, 32, 32);
    g.addColorStop(0, `rgba(255,255,255,${intensity})`);
    g.addColorStop(0.35, `rgba(255,220,170,${0.55 * intensity})`);
    g.addColorStop(1, 'rgba(255,200,140,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(cv);
    const mat = this._trackMat(new THREE.SpriteMaterial({ map: tex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    return mat;
  }

  _warehouseA(matConcrete, matSteel, matCrate) {
    // 36 x 16, opening 8m wide on the south (front, +z) wall
    this.box(-12, 4, -96, 36, 8, 0.4, matConcrete, 'concrete', { block: true });
    this.box(-30, 4, -88, 0.4, 8, 16, matConcrete, 'concrete', { block: true });
    this.box(6, 4, -88, 0.4, 8, 16, matConcrete, 'concrete', { block: true });
    this.box(-23, 4, -80, 14, 8, 0.4, matConcrete, 'concrete', { block: true });
    this.box(-1, 4, -80, 14, 8, 0.4, matConcrete, 'concrete', { block: true });
    this.box(-12, 7, -80, 8, 2, 0.4, matConcrete, 'concrete', { block: true });
    this.box(-12, 8.2, -88, 36.8, 0.4, 16.8, matConcrete, 'concrete', { collide: false });
    // interior crates
    const spots = [[-22, -86, 2], [-18, -92, 1], [-6, -86, 2], [2, -92, 1], [-26, -83, 1]];
    for (const [x, z, h] of spots) {
      for (let k = 0; k < h; k++) this.box(x, 0.8 + k * 1.6, z, 1.6, 1.6, 1.6, matCrate, 'wood', { block: k === 0 });
      this.coverPoints.push({ x: x - 1.3, z });
    }
    // sniper catwalk (perch) at the west end
    this.box(-26, 3.5, -91, 6, 0.3, 5, matSteel, 'metal', { block: true });
    this.box(-26, 3.95, -88.6, 6, 0.9, 0.1, matSteel, 'metal', { collide: false });
    this.box(-23, 3.95, -91, 0.1, 0.9, 5, matSteel, 'metal', { collide: false });
    this.cyl(-28, 5.1, -93, 0.1, 3.2, matSteel, 'metal', { collide: false });
    this.cyl(-24, 5.1, -89, 0.1, 3.2, matSteel, 'metal', { collide: false });
  }

  _warehouseB(matConcrete, matSteel, matCrate) {
    // 26 x 12, opening on the south-west
    this.box(58, 3.5, -94, 26, 7, 0.4, matConcrete, 'concrete', { block: true });
    this.box(45, 3.5, -88, 0.4, 7, 12, matConcrete, 'concrete', { block: true });
    this.box(71, 3.5, -88, 0.4, 7, 12, matConcrete, 'concrete', { block: true });
    this.box(63, 3.5, -82, 16, 7, 0.4, matConcrete, 'concrete', { block: true });
    this.box(51, 5.9, -82, 8, 2.2, 0.4, matConcrete, 'concrete', { block: true });
    this.box(58, 7.2, -88, 26.8, 0.4, 12.8, matConcrete, 'concrete', { collide: false });
    const spots = [[48, -90, 1], [54, -86, 2], [66, -90, 1], [60, -91, 1]];
    for (const [x, z, h] of spots) {
      for (let k = 0; k < h; k++) this.box(x, 0.8 + k * 1.6, z, 1.6, 1.6, 1.6, matCrate, 'wood', { block: k === 0 });
      this.coverPoints.push({ x: x + 1.3, z });
    }
  }

  _industrial(matConcrete, matSteel, matYellow, matDark) {
    this.box(30, 0.05, -72, 24, 0.1, 15, matConcrete, 'concrete', { collide: false });
    // fenced compound with a gap on the east side
    this.box(30, 0.7, -65, 24, 1.4, 0.2, matDark, 'metal');
    this.box(30, 0.7, -79, 24, 1.4, 0.2, matDark, 'metal');
    this.box(19, 0.7, -72, 0.2, 1.4, 14, matDark, 'metal');
    this.box(41, 0.7, -76.5, 0.2, 1.4, 5, matDark, 'metal');
    this.box(41, 0.7, -67.5, 0.2, 1.4, 5, matDark, 'metal');
    // transformers
    for (const [x, z] of [[24, -72], [30, -74], [36, -70]]) {
      this.box(x, 0.3, z, 3, 0.6, 2.6, matConcrete, 'concrete');
      this.box(x, 1.9, z, 2.4, 2.6, 2, matSteel, 'metal');
      this.box(x, 2.9, z, 2.6, 0.5, 2.2, matYellow, 'metal', { collide: false });
    }
    // fuel tank (large destructible)
    const tank = this.cyl(50, 4, -62, 3, 8, matSteel, 'metal', { block: true });
    this.dprops.push({ mesh: tank, type: 'tank', x: 50, z: -62 });
    // power poles
    for (const x of [8, 20, 32, 44]) {
      this.cyl(x, 4.5, -84, 0.18, 9, matDark, 'metal', { collide: false });
      this.box(x, 8.4, -84, 3, 0.15, 0.15, matDark, 'metal', { collide: false });
    }
  }

  _crane(x, z, matSteel, withLoad) {
    for (const [dx, dz] of [[-9, -5], [9, -5], [-9, 5], [9, 5]]) {
      this.box(x + dx, 8, z + dz, 0.7, 16, 0.7, matSteel, 'metal', { block: true });
    }
    this.box(x, 16.3, z - 5, 18.7, 0.7, 0.7, matSteel, 'metal', { collide: false });
    this.box(x, 16.3, z + 5, 18.7, 0.7, 0.7, matSteel, 'metal', { collide: false });
    this.box(x - 9, 16.3, z, 0.7, 0.7, 10.7, matSteel, 'metal', { collide: false });
    this.box(x + 9, 16.3, z, 0.7, 0.7, 10.7, matSteel, 'metal', { collide: false });
    this.box(x, 8, z, 18.7, 0.5, 0.5, matSteel, 'metal', { collide: false });
    this.box(x, 15.5, z, 2.2, 1.2, 2.2, matSteel, 'metal', { collide: false });
    this.box(x, 12, z, 0.1, 7, 0.1, matSteel, 'metal', { collide: false });
    if (withLoad) {
      const cm = this.containerMat(CONTAINER_COLORS[2], 'LIFT-77');
      this.box(x, 8.3, z, 6, 2.5, 2.4, cm, 'metal', { collide: false });
    } else {
      this.box(x, 8.2, z, 0.8, 0.8, 0.8, matSteel, 'metal', { collide: false });
    }
  }

  _fence(matDark) {
    const rail = (x, z, w, d) => this.box(x, 0, z, w, 0.07, d, matDark, 'metal', { collide: false });
    const rail2 = (x, z, w, d) => this.box(x, 1.1, z, w, 0.07, d, matDark, 'metal', { collide: false });
    const post = (x, z) => this.box(x, 0.85, z, 0.12, 1.7, 0.12, matDark, 'metal', { collide: false });
    // north
    rail(0, -100, 240, 0.07); rail2(0, -100, 240, 0.07);
    for (let x = -120; x <= 120; x += 10) post(x, -100);
    // west (gate gap z -56..-46)
    rail(-120, -78, 0.07, 44); rail2(-120, -78, 0.07, 44);
    rail(-120, -3, 0.07, 86); rail2(-120, -3, 0.07, 86);
    for (let z = -100; z <= 40; z += 10) {
      if (z > -57 && z < -45) continue;
      post(-120, z);
    }
    // east
    rail(120, -30, 0.07, 140); rail2(120, -30, 0.07, 140);
    for (let z = -100; z <= 40; z += 10) post(120, z);
  }

  _rainSpawn(i, y0) {
    const i3 = i * 6;
    this.rainPos[i3] = this._px + (Math.random() - 0.5) * 100;
    this.rainPos[i3 + 1] = y0 === undefined ? Math.random() * 28 : 28;
    this.rainPos[i3 + 2] = this._pz + (Math.random() - 0.5) * 100;
    this.rainPos[i3 + 3] = this.rainPos[i3];
    this.rainPos[i3 + 4] = this.rainPos[i3 + 1] - 0.7;
    this.rainPos[i3 + 5] = this.rainPos[i3 + 2];
  }

  // ----------------------------------------------------------- behaviour

  setRainEnabled(enabled, count) {
    this.rain.visible = enabled;
    this.rainCount = Math.min(count || 900, 1200);
    this.rainGeo.setDrawRange(0, this.rainCount * 2);
    this.matAsphalt.roughness = enabled ? 0.4 : 0.95;
    this.matConcrete.roughness = enabled ? 0.5 : 0.92;
  }

  /** Keep positions on solid ground (no water, inside the fence line). */
  clampToGround(pos) {
    // west: outer apron up to the ground edge (spawn sits outside the fence);
    // east: soft world limit; z: wall / water edges
    pos.x = clamp(pos.x, -129.5, 118.5);
    const pierX = pos.x > -30 && pos.x < 65;
    pos.z = clamp(pos.z, -99.5, pierX ? 72.4 : 69.4);
    return pos;
  }

  update(dt, t, player) {
    // sun follows the player so shadows stay crisp
    this.sun.position.copy(player.position).addScaledVector(this.sunDir, 140);
    this.sun.target.position.copy(player.position);
    // water shimmer
    if (this.matWater.map) {
      this.matWater.map.offset.x += dt * 0.015;
      this.matWater.map.offset.y += dt * 0.006;
    }
    // rotor idle spin
    this.heliRotor.rotation.y += dt * 1.6;
    // lamp flicker
    for (let i = 0; i < this.lights.length; i++) {
      this.lights[i].intensity = this.lampBases[i] * (0.93 + 0.07 * Math.sin(t * 11 + i * 7.3));
    }
    // rain
    if (this.rain.visible) {
      this._px = player.position.x;
      this._pz = player.position.z;
      const p = this.rainPos;
      const n = this.rainCount;
      for (let i = 0; i < n; i++) {
        const i3 = i * 6;
        p[i3 + 1] -= 24 * dt;
        p[i3 + 4] = p[i3 + 1] - 0.7;
        if (p[i3 + 1] < -1) {
          p[i3] = this._px + (Math.random() - 0.5) * 90;
          p[i3 + 1] = 8 + Math.random() * 20;
          p[i3 + 2] = this._pz + (Math.random() - 0.5) * 90;
          p[i3 + 3] = p[i3];
          p[i3 + 5] = p[i3 + 2];
        }
      }
      this.rainGeo.attributes.position.needsUpdate = true;
    }
  }

  dispose() {
    this.scene.remove(this.group);
    for (const g of this._geom) g.dispose();
    for (const m of this._mat) m.dispose();
    this._geom.clear();
    this._mat.clear();
    this.staticMeshes.length = 0;
    this.colliders.length = 0;
  }
}
