/**
 * Menus — main menu, mission select, briefing, pause, settings,
 * credits, mission-complete and death screens. Every button is wired
 * to a real App action.
 */
import { SaveSystem } from '../save/SaveSystem.js';
import { MISSIONS } from '../missions/Mission.js';

export class Menus {
  constructor(root, app) {
    this.root = root;
    this.app = app;
    this._build();
    const unlock = () => {
      app.unlockAudio();
      document.removeEventListener('pointerdown', unlock);
    };
    document.addEventListener('pointerdown', unlock);
  }

  _btn(label, onClick, cls = '') {
    const b = document.createElement('button');
    b.className = 'menu-btn ' + cls;
    b.textContent = label;
    b.addEventListener('click', () => {
      if (this.app.audio._ok()) this.app.audio.uiClick();
      onClick();
    });
    return b;
  }

  _build() {
    const app = this.app;
    const screen = (id, cls) => {
      const d = document.createElement('div');
      d.className = 'screen ' + cls;
      d.id = 'screen-' + id;
      d.style.display = 'none';
      this.root.appendChild(d);
      return d;
    };
    this.screens = {};

    // ---------------- main menu
    const main = screen('main', 'center');
    main.innerHTML = `
      <div class="logo">SALT<span>LINE</span></div>
      <div class="logo-sub">TACTICAL OPERATIONS · PORT SECTOR 7</div>
      <div class="menu-col" id="mainCol"></div>
      <div class="version">BUILD 1.0.0 · WEB ENGINE (THREE r187) · UNIFIED SAVE v1</div>`;
    this.screens.main = main;
    const col = main.querySelector('#mainCol');
    col.appendChild(this._btn('NEW OPERATION', () => app.newGame('op_broken_signal'), 'primary'));
    this._continueBtn = this._btn('CONTINUE', () => app.continueGame());
    col.appendChild(this._continueBtn);
    col.appendChild(this._btn('MISSION SELECT', () => this.show('missionsel')));
    col.appendChild(this._btn('SETTINGS', () => this.show('settings', 'main')));
    col.appendChild(this._btn('CREDITS', () => this.show('credits')));
    col.appendChild(this._btn('EXIT GAME', () => {
      window.close();
      main.querySelector('.version').textContent = 'SESSION ENDED — CLOSE THIS TAB TO EXIT.';
    }));

    // ---------------- mission select
    const ms = screen('missionsel', 'center');
    ms.innerHTML = `<h2 class="screen-title">MISSION SELECT</h2><div class="menu-col" id="msCol"></div>`;
    this.screens.missionsel = ms;
    const mcol = ms.querySelector('#msCol');
    mcol.appendChild(this._btn('01 · OPERATION: BROKEN SIGNAL', () => app.newGame('op_broken_signal'), 'primary'));
    const locked1 = this._btn('02 · OPERATION: SALT FIELDS  [LOCKED — CLASSIFIED]', () => {});
    locked1.disabled = true;
    mcol.appendChild(locked1);
    const locked2 = this._btn('03 · OPERATION: BLACK TIDE  [LOCKED — CLASSIFIED]', () => {});
    locked2.disabled = true;
    mcol.appendChild(locked2);
    mcol.appendChild(this._btn('← BACK', () => this.show('main')));

    // ---------------- briefing
    const bf = screen('briefing', 'center briefing');
    bf.innerHTML = `
      <div class="bf-head"><div class="bf-kicker">MISSION BRIEFING</div><h2 id="bfName"></h2></div>
      <div class="bf-body">
        <p id="bfText"></p>
        <div class="bf-grid">
          <div><div class="bf-label">OBJECTIVES</div><ol id="bfObj"></ol></div>
          <div><div class="bf-label">ARMAMENT</div><div id="bfWeapon"></div>
               <div class="bf-label" style="margin-top:10px">INTEL</div>
               <div>3 uplink relays · ~30 hostile personnel · 2 marksmen on high ground. Relay consoles can be hacked (hold F at the base).</div>
          </div>
        </div>
      </div>
      <div class="menu-row" id="bfBtns"></div>`;
    this.screens.briefing = bf;

    // ---------------- pause
    const pa = screen('pause', 'center');
    pa.innerHTML = `
      <h2 class="screen-title">PAUSED</h2>
      <div class="pause-obj" id="pauseObj"></div>
      <div class="menu-col" id="pauseCol"></div>`;
    this.screens.pause = pa;
    const pcol = pa.querySelector('#pauseCol');
    pcol.appendChild(this._btn('RESUME', () => app.resume(), 'primary'));
    pcol.appendChild(this._btn('SETTINGS', () => this.show('settings', 'pause')));
    pcol.appendChild(this._btn('SAVE & EXIT TO MENU', () => {
      app.checkpoint();
      app.quitToMenu();
    }));

    // ---------------- settings
    const se = screen('settings', 'center settings');
    se.innerHTML = `<h2 class="screen-title">SETTINGS</h2><div class="set-wrap" id="setWrap"></div>
      <div class="menu-row"><button class="menu-btn primary" id="setClose">SAVE & CLOSE</button></div>`;
    this.screens.settings = se;
    this._buildSettings(se.querySelector('#setWrap'));
    se.querySelector('#setClose').addEventListener('click', () => {
      app.settings.save();
      this.show(this._settingsReturn || 'main');
    });

    // ---------------- credits
    const cr = screen('credits', 'center');
    cr.innerHTML = `
      <h2 class="screen-title">CREDITS</h2>
      <div class="credits">
        <p><b>SALTLINE</b> — a playable browser build of a tactical FPS concept.</p>
        <p>Engine: Three.js r187 (WebGL) · All geometry, textures, models and audio are 100% procedurally generated at runtime.</p>
        <p>Architecture mirrors a Unity 6.6 / C# modular design: PlayerController, data-driven WeaponSystem (ScriptableObject-style defs), NavGraph + Brain AI, Mission/Objective manager, pooled FX, settings & checkpoint save.</p>
        <p>Built in Arena Agent Mode. No proprietary assets used.</p>
      </div>
      <div class="menu-row"><button class="menu-btn" id="crBack">← BACK</button></div>`;
    this.screens.credits = cr;
    cr.querySelector('#crBack').addEventListener('click', () => this.show('main'));

    // ---------------- complete
    const co = screen('complete', 'center');
    co.innerHTML = `
      <div class="done-kicker">MISSION COMPLETE</div>
      <h2 class="done-title">SIGNAL SEVERED</h2>
      <div class="done-rating" id="doneRating"></div>
      <div class="stats-grid" id="doneStats"></div>
      <div class="menu-row" id="doneBtns"></div>`;
    this.screens.complete = co;
    const dcol = co.querySelector('#doneBtns');
    dcol.appendChild(this._btn('RETURN TO MENU', () => app.quitToMenu()));
    dcol.appendChild(this._btn('REPLAY MISSION', () => app.newGame('op_broken_signal'), 'primary'));

    // ---------------- dead
    const de = screen('dead', 'center');
    de.innerHTML = `
      <div class="dead-kicker">SIGNAL LOST</div>
      <h2 class="dead-title">K.I.A.</h2>
      <div class="menu-row" id="deadBtns"></div>`;
    this.screens.dead = de;
    const ecol = de.querySelector('#deadBtns');
    ecol.appendChild(this._btn('RESUME FROM CHECKPOINT', () => app.restartFromCheckpoint(), 'primary'));
    ecol.appendChild(this._btn('RETURN TO MENU', () => app.quitToMenu()));
  }

  _buildSettings(wrap) {
    const app = this.app;
    const s = app.settings.data;
    const row = (label, input, key, isInt = false) => {
      const d = document.createElement('div');
      d.className = 'set-row';
      const lab = document.createElement('label');
      lab.textContent = label;
      d.appendChild(lab);
      d.appendChild(input);
      const val = document.createElement('span');
      val.className = 'set-val';
      val.textContent = isInt ? Math.round(input.value) : input.value;
      d.appendChild(val);
      wrap.appendChild(d);
      input.addEventListener('input', () => {
        const v = isInt ? Math.round(parseFloat(input.value)) : parseFloat(input.value);
        val.textContent = isInt ? v : v;
        app.applySettings(key, v);
      });
    };
    const range = (min, max, step, value, isInt = false) => {
      const i = document.createElement('input');
      i.type = 'range'; i.min = min; i.max = max; i.step = step; i.value = value;
      return i;
    };
    const section = (t) => {
      const h = document.createElement('div');
      h.className = 'set-section';
      h.textContent = t;
      wrap.appendChild(h);
    };

    section('CONTROLS');
    row('Mouse sensitivity', range(0.2, 3, 0.05, s.sensitivity), 'sensitivity');
    row('ADS sensitivity', range(0.2, 1, 0.05, s.adsSensScale), 'adsSensScale');
    row('Field of view', range(60, 110, 1, s.fov, true), 'fov');
    row('Crosshair size', range(0.5, 2, 0.1, s.crosshairSize), 'crosshairSize');
    row('Camera shake', range(0, 1, 0.1, s.cameraShake), 'cameraShake');
    {
      const d = document.createElement('div');
      d.className = 'set-row';
      const lab = document.createElement('label');
      lab.textContent = 'Crosshair color';
      const c = document.createElement('input');
      c.type = 'color';
      c.value = s.crosshairColor;
      d.appendChild(lab);
      d.appendChild(c);
      d.appendChild(document.createElement('span'));
      wrap.appendChild(d);
      c.addEventListener('input', () => app.applySettings('crosshairColor', c.value));
    }

    section('VIDEO');
    {
      const d = document.createElement('div');
      d.className = 'set-row';
      const lab = document.createElement('label');
      lab.textContent = 'Graphics preset';
      const sel = document.createElement('select');
      for (const p of ['LOW', 'MEDIUM', 'HIGH', 'ULTRA']) {
        const o = document.createElement('option');
        o.value = p; o.textContent = p;
        if (s.preset === p) o.selected = true;
        sel.appendChild(o);
      }
      d.appendChild(lab);
      d.appendChild(sel);
      d.appendChild(document.createElement('span'));
      wrap.appendChild(d);
      sel.addEventListener('change', () => app.applySettings('preset', sel.value));
    }
    {
      const d = document.createElement('div');
      d.className = 'set-row';
      const lab = document.createElement('label');
      lab.textContent = 'Rain (wet surfaces)';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!s.rain;
      d.appendChild(lab);
      d.appendChild(cb);
      d.appendChild(document.createElement('span'));
      wrap.appendChild(d);
      cb.addEventListener('change', () => app.applySettings('rain', cb.checked));
    }

    section('AUDIO');
    row('Master volume', range(0, 1, 0.05, s.masterVol), 'masterVol');
    row('Music volume', range(0, 1, 0.05, s.musicVol), 'musicVol');
    row('Sound effects', range(0, 1, 0.05, s.sfxVol), 'sfxVol');
    row('Voice / radio', range(0, 1, 0.05, s.voiceVol), 'voiceVol');
  }

  // ---------------------------------------------------------- flow

  show(name, returnTo = 'main') {
    if (name === 'settings') this._settingsReturn = returnTo;
    // refresh continue state
    const has = SaveSystem.hasSave() && !SaveSystem.load()?.complete;
    this._continueBtn.disabled = !has;
    for (const [k, el] of Object.entries(this.screens)) el.style.display = k === name ? 'flex' : 'none';
    if (name === 'pause' && this.app.mission) {
      const o = this.app.mission.currentObjective;
      document.getElementById('pauseObj').textContent = o ? `CURRENT: ${o.title}` : '';
    }
  }

  showBriefing(missionId, isResume) {
    const def = MISSIONS[missionId];
    this.screens.briefing.querySelector('#bfName').textContent = def.name;
    this.screens.briefing.querySelector('#bfText').textContent = def.briefing;
    this.screens.briefing.querySelector('#bfObj').innerHTML = def.objectives
      .map((o, i) => `<li>${String(i + 1).padStart(2, '0')} — ${o.title}</li>`).join('');
    this.screens.briefing.querySelector('#bfWeapon').textContent = def.weapon;
    const btns = this.screens.briefing.querySelector('#bfBtns');
    btns.innerHTML = '';
    btns.appendChild(this._btn('ABORT', () => this.app.quitToMenu()));
    const deploy = this._btn(isResume ? 'RESUME OPERATION' : 'DEPLOY', () => this.app.deploy(), 'primary');
    btns.appendChild(deploy);
    this.show('briefing');
  }

  showComplete(stats) {
    const el = this.screens.complete;
    el.querySelector('#doneRating').textContent = 'RATING — ' + stats.rating;
    el.querySelector('#doneRating').className = 'done-rating r' + stats.rating;
    el.querySelector('#doneStats').innerHTML = [
      ['TIME', stats.time], ['KILLS', stats.kills], ['HEADSHOTS', stats.headshots],
      ['ACCURACY', stats.accuracy], ['SHOTS FIRED', stats.shots], ['HITS', stats.hits],
      ['DMG DEALT', stats.damageDealt], ['DMG TAKEN', stats.damageTaken],
      ['GRENADES', stats.grenades], ['RELAYS DESTROYED', stats.relays]
    ].map(([k, v]) => `<div class="stat"><span>${k}</span><b>${v}</b></div>`).join('');
    this.show('complete');
  }

  showDead() {
    this.show('dead');
  }

  hide() {
    for (const el of Object.values(this.screens)) el.style.display = 'none';
  }
}
