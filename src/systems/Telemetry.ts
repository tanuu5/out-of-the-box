import type { Sensor } from '../types';

export interface SegmentStats {
  sector: number;
  time: number;
  /** 何らかのセンサーに気づかれかけた回数 */
  spotted: number;
  /** ゲージが7割を超えてから逃げ切った回数 */
  closeCalls: number;
  decoys: number;
  dashes: number;
  hacks: number;
  noiseTime: number;
  sneakTime: number;
  zones: string[];
  /** x,z の組（0.3秒ごと） */
  path: number[];
}

function fresh(sector: number): SegmentStats {
  return { sector, time: 0, spotted: 0, closeCalls: 0, decoys: 0, dashes: 0, hacks: 0, noiseTime: 0, sneakTime: 0, zones: [], path: [] };
}

/** 区画ごとの行動記録（掲示板への自動書き込みに使う） */
export class Telemetry {
  stats: SegmentStats = fresh(1);
  /** 通しの記録 */
  totalSpotted = 0;
  private flags = new Map<string, { noticed: boolean; high: boolean }>();
  private pathT = 0;

  begin(sector: number): void {
    this.stats = fresh(sector);
    this.flags.clear();
    this.pathT = 0;
  }

  update(dt: number, px: number, pz: number, sneaking: boolean, hidden: boolean, sensors: Sensor[], zone: string): void {
    const s = this.stats;
    s.time += dt;
    if (sneaking) s.sneakTime += dt;
    if (hidden) s.noiseTime += dt;
    if (zone && s.zones[s.zones.length - 1] !== zone) s.zones.push(zone);
    this.pathT += dt;
    if (this.pathT >= 0.3 && s.path.length < 4000) {
      this.pathT = 0;
      s.path.push(Math.round(px * 10) / 10, Math.round(pz * 10) / 10);
    }
    for (const sn of sensors) {
      let f = this.flags.get(sn.id);
      if (!f) {
        f = { noticed: false, high: false };
        this.flags.set(sn.id, f);
      }
      if (!f.noticed && sn.suspicion > 0.2) {
        f.noticed = true;
        s.spotted++;
        this.totalSpotted++;
      }
      if (sn.suspicion > 0.7) f.high = true;
      if (f.noticed && sn.suspicion <= 0.001) {
        if (f.high) s.closeCalls++;
        f.noticed = false;
        f.high = false;
      }
    }
  }
}
