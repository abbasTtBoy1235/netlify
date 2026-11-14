/**
 * Textures — all surface textures are generated procedurally on 2D
 * canvases at load time (no external image assets). Results are cached.
 */
import * as THREE from '../../vendor/three.module.js';

const cache = new Map();

function make(name, w, h, draw) {
  if (cache.has(name)) return cache.get(name);
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  cache.set(name, tex);
  return tex;
}

/** Deterministic pseudo-random for stable texture detail. */
function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function speckle(ctx, w, h, n, alpha, dark = true) {
  const r = seeded(1234 + n);
  for (let i = 0; i < n; i++) {
    const a = r() * alpha;
    ctx.fillStyle = dark ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a})`;
    ctx.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2);
  }
}

export const Tex = {
  concrete(name = 'concrete') {
    return make('concrete', 256, 256, (ctx, w, h) => {
      ctx.fillStyle = '#696e6a';
      ctx.fillRect(0, 0, w, h);
      const r = seeded(99);
      for (let i = 0; i < 14; i++) { // stains
        ctx.fillStyle = `rgba(40,44,42,${0.04 + r() * 0.05})`;
        ctx.beginPath();
        ctx.ellipse(r() * w, r() * h, 20 + r() * 50, 12 + r() * 30, r() * 3, 0, 7);
        ctx.fill();
      }
      speckle(ctx, w, h, 5000, 0.1);
      ctx.strokeStyle = 'rgba(30,32,30,0.25)'; // expansion joints
      ctx.lineWidth = 2;
      ctx.strokeRect(0, 0, w, h);
      ctx.beginPath();
      ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h);
      ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(25,26,24,0.35)'; // cracks
      ctx.lineWidth = 1;
      for (let c = 0; c < 4; c++) {
        ctx.beginPath();
        let x = r() * w, y = r() * h;
        ctx.moveTo(x, y);
        for (let s = 0; s < 6; s++) {
          x += (r() - 0.5) * 40; y += (r() - 0.5) * 40;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    });
  },

  asphalt() {
    return make('asphalt', 256, 256, (ctx, w, h) => {
      ctx.fillStyle = '#31353a';
      ctx.fillRect(0, 0, w, h);
      speckle(ctx, w, h, 9000, 0.16);
      speckle(ctx, w, h, 1500, 0.05, false);
    });
  },

  road() {
    return make('road', 256, 256, (ctx, w, h) => {
      ctx.fillStyle = '#2c3034';
      ctx.fillRect(0, 0, w, h);
      speckle(ctx, w, h, 7000, 0.14);
      ctx.fillStyle = 'rgba(210,210,200,0.5)';
      for (let y = 8; y < h; y += 48) ctx.fillRect(w / 2 - 3, y, 6, 22);
    });
  },

  steel() {
    return make('steel', 256, 256, (ctx, w, h) => {
      ctx.fillStyle = '#394046';
      ctx.fillRect(0, 0, w, h);
      const r = seeded(55);
      for (let i = 0; i < 60; i++) { // streaks
        const x = r() * w;
        const g = 10 + r() * 30;
        ctx.fillStyle = `rgba(${g + 40},${g + 48},${g + 56},${0.15 + r() * 0.2})`;
        ctx.fillRect(x, 0, 1 + r() * 3, h);
      }
      speckle(ctx, w, h, 3000, 0.12);
      // rust patches
      for (let i = 0; i < 8; i++) {
        ctx.fillStyle = `rgba(120,70,35,${0.06 + r() * 0.1})`;
        ctx.beginPath();
        ctx.ellipse(r() * w, r() * h, 8 + r() * 24, 5 + r() * 14, r() * 3, 0, 7);
        ctx.fill();
      }
    });
  },

  container(colorHex, code) {
    return make('container|' + colorHex + '|' + code, 256, 128, (ctx, w, h) => {
      ctx.fillStyle = colorHex;
      ctx.fillRect(0, 0, w, h);
      const r = seeded(colorHex.length * 77 + code.length * 13 + 5);
      // corrugation
      for (let x = 0; x < w; x += 16) {
        ctx.fillStyle = 'rgba(0,0,0,0.22)';
        ctx.fillRect(x, 0, 6, h);
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.fillRect(x + 6, 0, 2, h);
      }
      // weathering
      for (let i = 0; i < 26; i++) {
        ctx.fillStyle = `rgba(90,55,25,${0.04 + r() * 0.08})`;
        const x = r() * w;
        ctx.fillRect(x, 0, 2 + r() * 4, h * (0.3 + r() * 0.7));
      }
      speckle(ctx, w, h, 2500, 0.1);
      // stencilled code
      ctx.fillStyle = 'rgba(235,235,230,0.75)';
      ctx.font = 'bold 20px monospace';
      ctx.fillText(code, 18, 34);
      ctx.fillStyle = 'rgba(235,235,230,0.4)';
      ctx.font = 'bold 12px monospace';
      ctx.fillText('PORT 7  //  SALTLINE LOGISTICS', 18, 54);
      // corner posts
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      [[0, 0], [w - 12, 0], [0, h - 12], [w - 12, h - 12]].forEach(([x, y]) => ctx.fillRect(x, y, 12, 12));
    });
  },

  crate() {
    return make('crate', 128, 128, (ctx, w, h) => {
      ctx.fillStyle = '#5d4a30';
      ctx.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 22) {
        ctx.fillStyle = `rgba(0,0,0,${0.12 + Math.random() * 0.08})`;
        ctx.fillRect(0, y, w, 3);
      }
      speckle(ctx, w, h, 1200, 0.15);
      ctx.strokeStyle = 'rgba(30,22,12,0.8)';
      ctx.lineWidth = 8;
      ctx.strokeRect(4, 4, w - 8, h - 8);
      ctx.fillStyle = 'rgba(220,215,200,0.5)';
      ctx.font = 'bold 14px monospace';
      ctx.fillText('SUPPLY 40x40', 14, h / 2 + 4);
    });
  },

  barrelFuel() {
    return make('barrelFuel', 128, 128, (ctx, w, h) => {
      ctx.fillStyle = '#7d3423';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(0, 26, w, 8);
      ctx.fillRect(0, h - 34, w, 8);
      const r = seeded(42);
      for (let i = 0; i < 12; i++) {
        ctx.fillStyle = `rgba(80,45,20,${0.1 + r() * 0.15})`;
        ctx.fillRect(r() * w, 0, 3 + r() * 6, h);
      }
      ctx.fillStyle = 'rgba(240,235,225,0.85)';
      ctx.font = 'bold 26px monospace';
      ctx.fillText('FUEL', 26, 76);
    });
  },

  barrelAmmo() {
    return make('barrelAmmo', 128, 128, (ctx, w, h) => {
      ctx.fillStyle = '#47543a';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(0, 26, w, 8);
      ctx.fillRect(0, h - 34, w, 8);
      ctx.fillStyle = '#d8b433';
      ctx.fillRect(0, 44, w, 34);
      ctx.fillStyle = '#20241a';
      ctx.font = 'bold 26px monospace';
      ctx.fillText('AMMO', 24, 69);
    });
  },

  water() {
    return make('water', 256, 256, (ctx, w, h) => {
      ctx.fillStyle = '#0d2229';
      ctx.fillRect(0, 0, w, h);
      const r = seeded(7);
      for (let i = 0; i < 900; i++) {
        ctx.fillStyle = `rgba(40,90,100,${0.03 + r() * 0.06})`;
        const y = r() * h;
        ctx.fillRect(r() * w, y, 4 + r() * 18, 1);
      }
    });
  },

  sky() {
    return make('sky', 64, 512, (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0.0, '#0d1520');
      g.addColorStop(0.45, '#1b2a3c');
      g.addColorStop(0.72, '#3d4f60');
      g.addColorStop(0.86, '#8a6a4d');
      g.addColorStop(0.94, '#c08a52');
      g.addColorStop(1.0, '#3d4f60');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    });
  },

  helipad() {
    return make('helipad', 256, 256, (ctx, w, h) => {
      ctx.fillStyle = '#2b2f2c';
      ctx.fillRect(0, 0, w, h);
      speckle(ctx, w, h, 4000, 0.14);
      ctx.strokeStyle = '#c9a53a';
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, 96, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#c9a53a';
      ctx.font = 'bold 110px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('H', w / 2, h / 2 + 40);
    });
  },

  shackWall() {
    return make('shackWall', 128, 128, (ctx, w, h) => {
      ctx.fillStyle = '#49544a';
      ctx.fillRect(0, 0, w, h);
      speckle(ctx, w, h, 1500, 0.12);
      ctx.fillStyle = '#171c18';
      ctx.fillRect(18, 30, 44, 30);
      ctx.fillStyle = 'rgba(150,170,160,0.15)';
      ctx.fillRect(18, 30, 44, 10);
    });
  }
};
