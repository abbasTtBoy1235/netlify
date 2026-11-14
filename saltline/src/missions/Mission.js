/**
 * Mission — data-driven mission + objective system.
 * Each objective is a list of stages (reach / destroy / killall /
 * extract); objectives complete when every stage does. Reusable for
 * future missions: add a definition to MISSIONS, no core changes.
 */
import { dist2D, fmtTime } from '../core/Utils.js';
import { SaveSystem } from '../save/SaveSystem.js';

export const MISSIONS = {
  op_broken_signal: {
    id: 'op_broken_signal',
    name: 'OPERATION: BROKEN SIGNAL',
    sector: 'PORT SECTOR 7',
    briefing:
      'Hostile military forces have seized the industrial port of Sector 7 and established an ' +
      'encrypted uplink network relaying targeting data inland. Intelligence has located three relay ' +
      'stations: ALPHA in the western container yard, BRAVO beside the power substation, and CHARLIE ' +
      'on the east pier. Infiltrate the port, destroy all three relays, eliminate remaining hostile ' +
      'forces, and extract from the northern helipad.',
    weapon: 'M4V CARBINE / PM-90 / P-9 SIDEARM',
    objectives: [
      {
        id: 'obj1', title: 'INFILTRATE THE INDUSTRIAL PORT',
        desc: 'Pass through the east gate and enter Sector 7.',
        stages: [{ kind: 'reach', ref: 'gate', radius: 5, label: 'Reach the gate' }]
      },
      {
        id: 'obj2', title: 'LOCATE UPLINK RELAY ALPHA',
        desc: 'Find the first communication relay in the western container yard.',
        stages: [{ kind: 'reach', ref: 'A', radius: 11, label: 'Approach relay ALPHA' }]
      },
      {
        id: 'obj3', title: 'DESTROY UPLINK RELAY ALPHA',
        desc: 'Destroy the relay by gunfire, explosives — or hold F at its console.',
        stages: [{ kind: 'destroy', ref: 'A' }]
      },
      {
        id: 'obj4', title: 'LOCATE & DESTROY UPLINK RELAY BRAVO',
        desc: 'The second relay sits beside the power substation.',
        stages: [
          { kind: 'reach', ref: 'B', radius: 11, label: 'Approach relay BRAVO' },
          { kind: 'destroy', ref: 'B' }
        ]
      },
      {
        id: 'obj5', title: 'LOCATE & DESTROY UPLINK RELAY CHARLIE',
        desc: 'The final relay is on the east pier, by the cargo ship.',
        stages: [
          { kind: 'reach', ref: 'C', radius: 11, label: 'Approach relay CHARLIE' },
          { kind: 'destroy', ref: 'C' }
        ]
      },
      {
        id: 'obj6', title: 'ELIMINATE REMAINING HOSTILE FORCES',
        desc: 'Sweep Sector 7 until no live hostile personnel remain.',
        stages: [{ kind: 'killall' }]
      },
      {
        id: 'obj7', title: 'REACH THE EXTRACTION ZONE',
        desc: 'Get to the northern helipad and hold position for the pick-up flight.',
        stages: [{ kind: 'extract', radius: 6, hold: 5 }]
      }
    ]
  }
};

export class Mission {
  constructor(app, missionId, saveData = null) {
    this.app = app;
    this.def = MISSIONS[missionId];
    this.missionId = missionId;
    this.objIdx = saveData?.objIdx ?? 0;
    this.stageIdx = saveData?.stageIdx ?? 0;
    this.time = saveData?.time ?? 0;
    this.extractProgress = 0;
    this.complete = !!saveData?.complete;
    this.failed = false;
    this._wakeSent = new Set(saveData?.wakes || []);
  }

  get currentObjective() {
    return this.def.objectives[this.objIdx] || null;
  }

  get currentStage() {
    const o = this.currentObjective;
    return o ? o.stages[this.stageIdx] : null;
  }

  /** World position of the active objective stage (for marker/compass). */
  stageWorldPos() {
    const st = this.currentStage;
    if (!st) return null;
    const w = this.app.world;
    switch (st.kind) {
      case 'reach':
        if (st.ref === 'gate') return { x: w.infiltrate.x, z: w.infiltrate.z };
        return w.relaysPos[st.ref];
      case 'destroy':
        // bugfix: was missing — returned null, so the HUD objective marker
        // and anything targeting the stage had no position during relay ops
        return w.relaysPos[st.ref] || null;
      case 'extract':
        return w.extract;
      case 'killall':
        // nearest live enemy
        return this.app.nearestEnemyPos() || null;
      default:
        return null;
    }
  }

  update(dt) {
    if (this.complete || this.failed) return;
    this.time += dt;
    const st = this.currentStage;
    if (!st) return;
    const p = this.app.player.pos;
    switch (st.kind) {
      case 'reach': {
        const t = this.stageWorldPos();
        if (t && dist2D(p.x, p.z, t.x, t.z) < st.radius) this._stageComplete();
        break;
      }
      case 'destroy': {
        const r = this.app.relays[st.ref];
        if (r && r.destroyed) this._stageComplete();
        break;
      }
      case 'killall': {
        if (this.app.enemies.aliveCount() === 0) this._stageComplete();
        break;
      }
      case 'extract': {
        const t = this.app.world.extract;
        const d = dist2D(p.x, p.z, t.x, t.z);
        if (d < st.radius) {
          this.extractProgress += dt;
          if (this.extractProgress >= st.hold) this._stageComplete();
        } else {
          this.extractProgress = Math.max(0, this.extractProgress - dt * 1.5);
        }
        break;
      }
    }
  }

  _stageComplete() {
    const app = this.app;
    const obj = this.currentObjective;
    this.stageIdx++;
    if (this.stageIdx >= obj.stages.length) {
      this.stageIdx = 0;
      this.objIdx++;
      app.emitter.emit('objective-complete', { id: obj.id, title: obj.title });
      app.audio.notification();
      app.hud.notify(`OBJECTIVE COMPLETE — ${obj.title}`, 'good');
      this._maybeWake(obj.id);
      app.checkpoint();
      if (this.objIdx >= this.def.objectives.length) {
        this.completeMission();
        return;
      }
    } else {
      app.audio.radioBeep();
      const next = this.currentStage;
      app.hud.notify(`STAGE — ${next ? (next.label || next.kind).toUpperCase() : ''}`, 'info');
    }
    app.hud.updateObjectives(this);
  }

  _maybeWake(objId) {
    const app = this.app;
    if (this._wakeSent.has(objId)) return;
    this._wakeSent.add(objId);
    app.enemies.wakeBy(objId);
  }

  /** Called by EnemyManager on each kill (stats feed the complete screen). */
  onEnemyKilled() {
    // kill-all objective is evaluated via enemies.aliveCount() in update()
  }

  relayDestroyed(id) {
    const app = this.app;
    app.hud.notify(`UPLINK RELAY ${this.app.relays[id].label} DESTROYED`, 'good');
    // alarm: enemies nearby converge on the player
    app.alarmAt(this.app.relays[id].pos);
  }

  completeMission() {
    this.complete = true;
    const app = this.app;
    app.audio.victory();
    const save = app.saveData || {};
    save.complete = true;
    save.objIdx = this.def.objectives.length;
    SaveSystem.save(save);
    app.endMission(true);
  }

  fail() {
    this.failed = true;
    this.app.endMission(false);
  }

  // ---------------------------------------------------- interaction

  /** Relay hacking (hold F) + extraction prompt. */
  updateInteract(dt) {
    const app = this.app;
    const p = app.player.pos;
    const input = app.input;
    let prompt = null, progress = null;

    if (!this.complete) {
      // relay hacking
      for (const r of Object.values(app.relays)) {
        if (r.destroyed) continue;
        const d = dist2D(p.x, p.z, r.pos.x, r.pos.z);
        if (d < 9) {
          prompt = `HOLD [F] — HACK UPLINK RELAY ${r.label}`;
          if (input.interactHeld() && !app.player.dead) {
            r.interactT += dt / 5;
            if (r.interactT >= 1) {
              r.interactT = 0;
              r.destroy('hack');
              prompt = null;
            }
          } else {
            r.interactT = Math.max(0, r.interactT - dt * 2);
          }
          progress = r.interactT;
        }
      }
      // extraction
      const st = this.currentStage;
      if (!prompt && st && st.kind === 'extract') {
        const t = app.world.extract;
        const d = dist2D(p.x, p.z, t.x, t.z);
        if (d < st.radius + 4) {
          if (d < st.radius) {
            prompt = `EXTRACTION IN PROGRESS — ${Math.round((this.extractProgress / st.hold) * 100)}%`;
            progress = this.extractProgress / st.hold;
          } else {
            prompt = 'REACH THE HELIPAD CENTER';
          }
        }
      }
    }
    app.hud.prompt(prompt, progress);
  }

  get progressFraction() {
    const total = this.def.objectives.reduce((n, o) => n + o.stages.length, 0);
    let done = 0;
    for (let i = 0; i < this.objIdx; i++) done += this.def.objectives[i].stages.length;
    done += this.stageIdx;
    return done / total;
  }

  statsSummary() {
    const s = this.app.stats;
    const acc = s.shots > 0 ? Math.round((s.hits / s.shots) * 100) : 0;
    return {
      time: fmtTime(this.time),
      kills: s.kills,
      headshots: s.headshots,
      accuracy: acc + '%',
      shots: s.shots,
      hits: s.hits,
      damageDealt: Math.round(s.damageDealt),
      damageTaken: Math.round(s.damageTaken),
      grenades: s.grenades,
      relays: Object.values(this.app.relays).filter((r) => r.destroyed).length + '/3',
      rating: this._rating(acc)
    };
  }

  _rating(acc) {
    const t = this.time;
    if (t < 700 && acc >= 45) return 'S';
    if (t < 1100 && acc >= 30) return 'A';
    if (acc >= 20) return 'B';
    return 'C';
  }
}
