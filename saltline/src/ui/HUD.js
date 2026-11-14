/**
 * HUD — in-game interface: objective panel, compass, minimap, health /
 * armor / stamina bars, weapon panel, crosshair, hit markers, damage
 * direction arcs, kill feed, notifications, interaction prompts, scope
 * mask, screen flash and debug readout. All DOM/canvas based.
 */
import { toDeg, bearingTo, clamp } from '../core/Utils.js';

const CARDS = [['N', 0], ['NE', 45], ['E', 90], ['SE', 135], ['S', 180], ['SW', 225], ['W', 270], ['NW', 315]];

export class HUD {
  constructor(root, app) {
    this.app = app;
    this.root = root;
    this._build();
    this._hpFlash = 0;
    this._dmgArcs = [];
    this._flash = 0;
    this._crossSize = 1;
    this._crossColor = '#9fd6ff';
    this._minimapCache = null;
    this.dmgCanvas = document.getElementById('dmgOverlay');
    this.dmgCtx = this.dmgCanvas.getContext('2d');
    this._resizeDmg();
    window.addEventListener('resize', () => this._resizeDmg());
  }

  _resizeDmg() {
    this.dmgCanvas.width = window.innerWidth;
    this.dmgCanvas.height = window.innerHeight;
  }

  _build() {
    this.root.innerHTML = `
      <div class="hud-panel hud-topleft" id="objPanel">
        <div class="obj-mission" id="objMission"></div>
        <div class="obj-title" id="objTitle"></div>
        <div class="obj-desc" id="objDesc"></div>
        <div class="obj-bar"><i id="objBarFill"></i></div>
        <div class="obj-list" id="objList"></div>
      </div>
      <div class="hud-panel hud-topcenter">
        <canvas id="compass" width="420" height="30"></canvas>
        <div class="obj-dist" id="objDist"></div>
      </div>
      <div class="hud-panel hud-topright"><canvas id="minimap" width="150" height="106"></canvas></div>
      <div class="hud-panel hud-bottomleft">
        <div class="bar-row"><span class="bar-label">HP</span><div class="bar hp"><i id="hpFill"></i></div><span class="bar-num" id="hpNum">100</span></div>
        <div class="bar-row"><span class="bar-label">ARM</span><div class="bar armor"><i id="armorFill"></i></div><span class="bar-num" id="armorNum">30</span></div>
        <div class="bar-row slim"><span class="bar-label">STM</span><div class="bar stamina"><i id="stamFill"></i></div></div>
      </div>
      <div class="hud-panel hud-bottomright">
        <div class="w-name" id="wName"></div>
        <div class="w-mode" id="wMode"></div>
        <div class="w-ammo"><span id="wMag">30</span><span class="w-sep">/</span><span id="wRes">180</span></div>
        <div class="w-slots" id="wSlots"></div>
        <div class="w-gren" id="wGren"></div>
      </div>
      <div class="crosshair" id="cross">
        <i class="ch up"></i><i class="ch dn"></i><i class="ch lf"></i><i class="ch rt"></i><b class="ch dot"></b>
      </div>
      <div class="hitmarker" id="hitmark"><i></i><i></i><i></i><i></i></div>
      <div class="killfeed" id="killfeed"></div>
      <div class="notify" id="notify"></div>
      <div class="interact" id="interact"><span id="interactText"></span><div class="obj-bar small"><i id="interactFill"></i></div></div>
      <div class="hint" id="hint"></div>
      <div class="debug" id="debug"></div>
      <div class="scope-mask" id="scopeMask"></div>
      <div class="flash" id="flash"></div>
      <div class="aim-note" id="aimNote"></div>
    `;
    this.el = {};
    for (const id of ['objMission', 'objTitle', 'objDesc', 'objBarFill', 'objList', 'objDist',
      'hpFill', 'hpNum', 'armorFill', 'armorNum', 'stamFill', 'wName', 'wMode', 'wMag', 'wRes',
      'wSlots', 'wGren', 'cross', 'hitmark', 'killfeed', 'notify', 'interact', 'interactText',
      'interactFill', 'hint', 'debug', 'scopeMask', 'flash', 'aimNote']) {
      this.el[id] = document.getElementById(id);
    }
    this.compassCtx = document.getElementById('compass').getContext('2d');
    this.minimapCtx = document.getElementById('minimap').getContext('2d');
    this.el.hitmark.classList.add('hidden');
  }

  show() { this.root.classList.remove('hidden'); }
  hide() { this.root.classList.add('hidden'); }

  applySettings(s) {
    this._crossSize = s.crosshairSize;
    this._crossColor = s.crosshairColor;
  }

  // ------------------------------------------------ status

  setHealth(hp, armor) {
    this.el.hpFill.style.width = hp + '%';
    this.el.hpNum.textContent = Math.ceil(hp);
    this.el.armorFill.style.width = armor + '%';
    this.el.armorNum.textContent = Math.ceil(armor);
    this.el.hpFill.classList.toggle('low', hp < 30);
  }

  setStamina(v) { this.el.stamFill.style.width = v + '%'; }

  setSpread(px, hit) {
    const gap = clamp(4 + px * this._crossSize, 4, 60);
    for (const c of this.el.cross.children) {
      c.style.borderColor = this._crossColor;
      c.style.backgroundColor = this._crossColor;
      c.style.transform = this._chTransform(c, gap);
    }
  }

  _chTransform(c, gap) {
    const cls = c.className;
    if (cls.includes('up')) return `translateY(${-gap - 6}px)`;
    if (cls.includes('dn')) return `translateY(${gap + 6}px)`;
    if (cls.includes('lf')) return `translateX(${-gap - 6}px)`;
    if (cls.includes('rt')) return `translateX(${gap + 6}px)`;
    return '';
  }

  setWeapon(ws) {
    const w = ws.current;
    if (!w) return;
    this.el.wName.textContent = w.def.name;
    this.el.wMode.textContent = w.def.auto ? (w.mode === 'auto' ? 'AUTO' : 'BURST ×' + w.def.burst) : 'SEMI';
    this.el.wMag.textContent = w.mag;
    this.el.wRes.textContent = w.reserve;
    this.el.wSlots.innerHTML = ws.weapons.map((x, i) =>
      `<span class="slot ${i === ws.active ? 'on' : ''}"><b>${i + 1}</b> ${x.def.short}</span>`).join('');
  }

  setGrenades(counts, sel) {
    const names = { frag: 'FRAG', smoke: 'SMK', flash: 'FLSH' };
    this.el.wGren.innerHTML = Object.entries(names).map(([k, n]) =>
      `<span class="gren ${k === sel ? 'on' : ''}">${n}×${counts[k] || 0}</span>`).join('') +
      '<span class="gren-hint">[V] cycle · [G] throw</span>';
  }

  setScope(on) { this.el.scopeMask.classList.toggle('on', !!on); }

  // ------------------------------------------------ objectives

  updateObjectives(mission) {
    const m = mission;
    this.el.objMission.textContent = `MISSION 01 — ${m.def.name}`;
    const o = m.currentObjective;
    if (o) {
      this.el.objTitle.textContent = `OBJECTIVE ${String(m.objIdx + 1).padStart(2, '0')}: ${o.title}`;
      const st = m.currentStage;
      this.el.objDesc.textContent = st ? st.label.toUpperCase() : o.desc;
    } else {
      this.el.objTitle.textContent = 'MISSION COMPLETE';
      this.el.objDesc.textContent = '';
    }
    this.el.objBarFill.style.width = (m.progressFraction * 100) + '%';
    this.el.objList.innerHTML = m.def.objectives.map((x, i) => {
      const cls = i < m.objIdx ? 'done' : i === m.objIdx ? 'cur' : 'todo';
      const icon = i < m.objIdx ? '✓' : i === m.objIdx ? '▸' : '○';
      return `<div class="${cls}"><span>${icon}</span> ${x.title}</div>`;
    }).join('');
  }

  setDistance(m, bearingText) {
    this.el.objDist.textContent = m !== null ? `${Math.round(m)} m ${bearingText || ''}` : '';
  }

  compass(yaw, targetBearing) {
    const ctx = this.compassCtx;
    const W = 420, H = 30;
    ctx.clearRect(0, 0, W, H);
    const fwd = ((-toDeg(yaw)) % 360 + 360) % 360;
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    // ticks every 5°, labels at cardinals
    for (let b = Math.floor((fwd - 75) / 5) * 5; b <= fwd + 75; b += 5) {
      const rel = ((b - fwd) % 360 + 360) % 360;
      const x = W / 2 + (rel - 75) * (W / 150);
      const major = b % 45 === 0;
      ctx.strokeStyle = 'rgba(200,215,225,0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, major ? 4 : 8);
      ctx.lineTo(x, major ? 12 : 12);
      ctx.stroke();
      if (major) {
        const card = CARDS.find((c) => c[1] === ((b % 360) + 360) % 360);
        ctx.fillStyle = 'rgba(220,230,238,0.85)';
        ctx.fillText(card ? card[0] : String(((b % 360) + 360) % 360), x, 24);
      }
    }
    // centre marker
    ctx.fillStyle = '#9fd6ff';
    ctx.fillRect(W / 2 - 1, 0, 2, 6);
    // objective tick
    if (targetBearing !== null && targetBearing !== undefined) {
      let rel = (targetBearing - fwd) % 360;
      if (rel > 180) rel -= 360;
      if (rel < -180) rel += 360;
      const x = W / 2 + rel * (W / 150);
      if (x > 4 && x < W - 4) {
        ctx.fillStyle = '#ffb454';
        ctx.beginPath();
        ctx.moveTo(x, 4); ctx.lineTo(x - 5, -2 + 6); ctx.lineTo(x + 5, 6);
        ctx.fill();
        ctx.fillRect(x - 1, 2, 2, 10);
      }
    }
  }

  minimap(player, yaw, mission, enemies, relays, extract) {
    const ctx = this.minimapCtx;
    const W = 150, H = 106;
    // static cache
    if (!this._minimapCache) {
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const g = c.getContext('2d');
      const sx = (x) => ((x + 130) / 260) * W;
      const sz = (z) => ((z + 100) / 173) * H;
      g.fillStyle = '#0b1014';
      g.fillRect(0, 0, W, H);
      // water
      g.fillStyle = '#0d2229';
      g.fillRect(0, sz(70), W, H - sz(70));
      // pier
      g.fillStyle = '#2a3036';
      g.fillRect(sx(-30), sz(39), sx(65) - sx(-30), sz(73) - sz(39));
      // container yard
      g.fillStyle = '#232a30';
      g.fillRect(sx(-114), sz(-90), sx(-54) - sx(-114), sz(38) - sz(-90));
      // warehouses
      g.fillStyle = '#39424a';
      g.fillRect(sx(-30), sz(-96), sx(6) - sx(-30), sz(-80) - sz(-96));
      g.fillRect(sx(45), sz(-94), sx(71) - sx(45), sz(-82) - sz(-94));
      // fence
      g.strokeStyle = 'rgba(150,160,170,0.35)';
      g.strokeRect(sx(-120), sz(-100), sx(120) - sx(-120), sz(40) - sz(-100));
      // helipad
      g.strokeStyle = '#c9a53a';
      g.beginPath();
      g.arc(sx(95), sz(-95), 4.5, 0, Math.PI * 2);
      g.stroke();
      this._minimapCache = c;
    }
    const sx = (x) => ((x + 130) / 260) * W;
    const sz = (z) => ((z + 100) / 173) * H;
    ctx.drawImage(this._minimapCache, 0, 0);
    // relays
    for (const r of Object.values(relays)) {
      ctx.fillStyle = r.destroyed ? '#3a4a3a' : '#ff4030';
      ctx.beginPath();
      ctx.arc(sx(r.pos.x), sz(r.pos.z), 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // enemies (within 45m)
    ctx.fillStyle = '#ff5544';
    for (const e of enemies) {
      if (e.dead) continue;
      const d = Math.hypot(e.pos.x - player.x, e.pos.z - player.z);
      if (d < 45) {
        ctx.beginPath();
        ctx.arc(sx(e.pos.x), sz(e.pos.z), 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // objective star
    const t = mission.stageWorldPos();
    if (t) {
      ctx.fillStyle = '#ffb454';
      ctx.beginPath();
      const px = sx(t.x), pz = sz(t.z);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + performance.now() * 0.002;
        const rr = i % 2 === 0 ? 4.5 : 2;
        ctx.lineTo(px + Math.cos(a) * rr, pz + Math.sin(a) * rr);
      }
      ctx.fill();
    }
    // player
    ctx.save();
    ctx.translate(sx(player.x), sz(player.z));
    ctx.rotate(-yaw);
    ctx.fillStyle = '#9fd6ff';
    ctx.beginPath();
    ctx.moveTo(0, -5); ctx.lineTo(3.4, 4); ctx.lineTo(-3.4, 4);
    ctx.fill();
    ctx.restore();
  }

  // ------------------------------------------------ feedback

  hitMarker(kill = false) {
    const h = this.el.hitmark;
    h.classList.remove('hidden');
    h.classList.toggle('kill', kill);
    h.style.animation = 'none';
    void h.offsetWidth;
    h.style.animation = 'hitmark 0.28s ease-out';
  }

  damage(worldDir) {
    const app = this.app;
    const fwd = ((-toDeg(app.player.yaw)) % 360 + 360) % 360;
    let rel = worldDir - fwd;
    while (rel > Math.PI) rel -= Math.PI * 2;
    while (rel < -Math.PI) rel += Math.PI * 2;
    this._dmgArcs.push({ rel, life: 0.8 });
    this._hpFlash = 0.35;
  }

  flashWhite(v = 1) { this._flash = Math.max(this._flash, v); }

  notify(text, kind = 'info') {
    const n = this.el.notify;
    n.textContent = text;
    n.className = 'notify ' + kind;
    n.style.animation = 'none';
    void n.offsetWidth;
    n.style.animation = 'notifyIn 3.4s ease-out forwards';
  }

  killFeed(name) {
    const k = this.el.killfeed;
    const d = document.createElement('div');
    d.className = 'kill-row';
    d.textContent = `▸ ${name} NEUTRALIZED`;
    k.appendChild(d);
    setTimeout(() => d.remove(), 4200);
    while (k.children.length > 5) k.firstElementChild.remove();
  }

  prompt(text, progress) {
    if (!text) {
      this.el.interact.classList.add('hidden');
      return;
    }
    this.el.interact.classList.remove('hidden');
    this.el.interactText.textContent = text;
    this.el.interactFill.style.width = (progress !== null && progress !== undefined ? clamp(progress, 0, 1) * 100 : 0) + '%';
  }

  hint() {
    const h = this.el.hint;
    h.textContent = 'WASD move · SHIFT sprint · CTRL crouch · Q/E lean · LMB fire · RMB aim · R reload · G grenade · V cycle · B fire mode · F interact · ESC pause';
    h.classList.remove('hidden');
    setTimeout(() => h.classList.add('hidden'), 14000);
  }

  debug(info) {
    this.el.debug.textContent = info;
    this.el.debug.classList.toggle('hidden', !info);
  }

  aimNote(show) {
    this.el.aimNote.classList.toggle('hidden', !show);
  }

  // ------------------------------------------------ frame overlay

  frameOverlay(dt, player) {
    const ctx = this.dmgCtx;
    const W = this.dmgCanvas.width, H = this.dmgCanvas.height;
    ctx.clearRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2;
    const R = Math.min(W, H) * 0.34;
    // damage arcs
    for (let i = this._dmgArcs.length - 1; i >= 0; i--) {
      const a = this._dmgArcs[i];
      a.life -= dt;
      if (a.life <= 0) { this._dmgArcs.splice(i, 1); continue; }
      const t = a.life / 0.8;
      ctx.strokeStyle = `rgba(255,40,30,${0.75 * t})`;
      ctx.lineWidth = 10 * t + 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(cx, cy, R, -Math.PI / 2 + a.rel - 0.16, -Math.PI / 2 + a.rel + 0.16);
      ctx.stroke();
    }
    // low-HP vignette
    const hp = player.health;
    const v = this._hpFlash > 0 ? this._hpFlash : (hp < 35 ? (1 - hp / 35) * 0.5 * (0.7 + 0.3 * Math.sin(performance.now() * 0.005)) : 0);
    if (v > 0.01) {
      this._hpFlash = Math.max(0, this._hpFlash - dt * 0.9);
      const g = ctx.createRadialGradient(cx, cy, Math.min(W, H) * 0.3, cx, cy, Math.max(W, H) * 0.72);
      g.addColorStop(0, 'rgba(120,0,0,0)');
      g.addColorStop(1, `rgba(150,10,5,${v * 0.55})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    // white flash (flashbang)
    if (this._flash > 0.01) {
      this._flash = Math.max(0, this._flash - dt * 1.4);
      ctx.fillStyle = `rgba(255,255,250,${Math.min(1, this._flash)})`;
      ctx.fillRect(0, 0, W, H);
    }
  }
}
