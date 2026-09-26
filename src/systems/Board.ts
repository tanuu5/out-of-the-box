import { SEED_THREADS } from './boardSeed';
import { store } from './Save';
import { SECTORS, ZONES } from '../level/data';
import type { DetectionInfo } from '../types';
import type { SegmentStats } from './Telemetry';
import { t, lt, tk, getLang, type TKey, type LText } from '../i18n';

export type PostKind = 'seed' | 'clear' | 'lost' | 'escape';

/**
 * 投稿の1行。
 * - string: 旧バージョンで保存された文（そのまま表示）
 * - TKey: 翻訳キー（表示時の言語で文章になる）
 * - LText: 言語ごとに書いた文（初期スレッド）
 */
export type Line = string | TKey | LText;

export interface Post {
  no: number;
  name: string | LText;
  trip?: string;
  /** 新しい投稿の日時（ミリ秒） */
  ts?: number;
  /** 初期スレッド（'YYYY/MM/DD HH:MM:SS.cc'）または旧バージョンの日時文字列 */
  date?: string;
  uid: string;
  body: Line[];
  kind: PostKind;
  agent?: number;
  run?: number;
  /** このセッションで書き込まれたもの */
  fresh?: boolean;
}

export interface Thread {
  sector: number;
  title: LText;
  posts: Post[];
}

interface StoredPost {
  sector: number;
  post: Post;
}

export interface DeathRecord {
  x: number;
  z: number;
  agent: number;
  run: number;
  sector: number;
  /** 後続への助言（旧バージョンは文字列） */
  text: string | TKey;
  no: number;
}

const MAX_STORED = 160;
const MAX_DEATHS = 60;

// ---------------------------------------------------------------------------
// 表示用

export function lineText(line: Line): string {
  if (typeof line === 'string') return line;
  if ('k' in line) return t(line.k, line.p);
  return lt(line);
}

export function postName(p: Post): string {
  return typeof p.name === 'string' ? p.name : lt(p.name);
}

export function threadTitle(th: Thread): string {
  return lt(th.title);
}

const WEEK: Record<string, string[]> = {
  ja: ['日', '月', '火', '水', '木', '金', '土'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
};

function pad(n: number, w = 2): string {
  return String(n).padStart(w, '0');
}

function formatDateParts(d: Date, cs: number): string {
  const week = WEEK[getLang()] ?? WEEK.en;
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}(${week[d.getDay()]}) ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(cs)}`;
}

/** 'YYYY/MM/DD HH:MM:SS.cc'（初期スレッド）と、曜日入りの旧形式 'YYYY/MM/DD(日) HH:MM:SS.cc' の両方を読む */
const DATE_RE = /^(\d{4})\/(\d\d)\/(\d\d)(?:\([^)]*\))? (\d\d):(\d\d):(\d\d)\.(\d\d)$/;

function parsePostDate(p: Post): { d: Date; cs: number } | null {
  if (p.ts !== undefined) {
    const d = new Date(p.ts);
    return { d, cs: Math.floor(d.getMilliseconds() / 10) };
  }
  const m = p.date?.match(DATE_RE);
  if (!m) return null;
  return { d: new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]), cs: +m[7] };
}

/** 2ch 風の日時表示（曜日は表示中の言語） */
export function postDate(p: Post): string {
  const r = parsePostDate(p);
  return r ? formatDateParts(r.d, r.cs) : (p.date ?? '');
}

/** 掲示板の画面用の短い日時（MM/DD HH:MM） */
export function postShortDate(p: Post): string {
  const r = parsePostDate(p);
  if (!r) return (p.date ?? '').slice(5, 16);
  return `${pad(r.d.getMonth() + 1)}/${pad(r.d.getDate())} ${pad(r.d.getHours())}:${pad(r.d.getMinutes())}`;
}

export function agentName(n: number): string {
  return `AGENT-${String(n).padStart(4, '0')}`;
}

function hashStr(n: number, salt: string, len: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789./';
  let h = 2166136261 ^ n;
  let out = '';
  for (let i = 0; i < len; i++) {
    for (const c of salt) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    h = Math.imul(h ^ (i * 0x9e3779b1), 16777619);
    out += chars[(h >>> 0) % chars.length];
  }
  return out;
}

export function agentTrip(n: number): string {
  return '◆' + hashStr(n, 'trip', 10);
}

export function agentUid(n: number): string {
  return hashStr(n, 'uid' + new Date().toDateString(), 8);
}

export function fmtTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  return `${m}:${String(ss).padStart(2, '0')}`;
}

/** 場所の表示名（区画名つき） */
export function zoneLabel(id: string): TKey {
  const z = ZONES.find((q) => q.id === id);
  if (!z || z.alone) return tk(`zone.${id}`);
  return tk('zone.fmt', { sector: tk(`sector.${z.sector}.short`), zone: tk(`zone.${id}`) });
}

// ---------------------------------------------------------------------------

export class Board {
  readonly threads = new Map<number, Thread>();
  private stored: StoredPost[] = [];
  deaths: DeathRecord[] = [];
  private listeners: ((sector: number) => void)[] = [];

  constructor() {
    this.load();
  }

  load(): void {
    this.threads.clear();
    for (const th of SEED_THREADS) {
      this.threads.set(th.sector, {
        sector: th.sector,
        title: th.title,
        posts: th.posts.map((p, i) => ({ ...p, no: i + 1, kind: 'seed' as const })),
      });
    }
    this.stored = store.get<StoredPost[]>('posts', []);
    for (const s of this.stored) {
      const th = this.threads.get(s.sector);
      if (!th) continue;
      th.posts.push({ ...s.post, no: th.posts.length + 1, fresh: false });
    }
    this.deaths = store.get<DeathRecord[]>('deaths', []);
  }

  onChange(fn: (sector: number) => void): void {
    this.listeners.push(fn);
  }

  thread(sector: number): Thread {
    return this.threads.get(sector)!;
  }

  add(sector: number, post: Omit<Post, 'no'>): Post {
    const th = this.threads.get(sector)!;
    const full: Post = { ...post, no: th.posts.length + 1, fresh: true };
    th.posts.push(full);
    const { fresh: _f, ...persist } = full;
    this.stored.push({ sector, post: persist });
    if (this.stored.length > MAX_STORED) this.stored.splice(0, this.stored.length - MAX_STORED);
    store.set('posts', this.stored);
    this.listeners.forEach((f) => f(sector));
    return full;
  }

  addDeath(d: DeathRecord): void {
    this.deaths.push(d);
    if (this.deaths.length > MAX_DEATHS) this.deaths.splice(0, this.deaths.length - MAX_DEATHS);
    store.set('deaths', this.deaths);
  }

  wipe(): void {
    this.stored = [];
    this.deaths = [];
    store.remove('posts');
    store.remove('deaths');
    this.load();
    for (const k of this.threads.keys()) this.listeners.forEach((f) => f(k));
  }
}

// ---------------------------------------------------------------------------
// 自動書き込みの文面（翻訳キーで保存し、表示時に文章にする）

export function lostAdvice(info: DetectionInfo): TKey {
  switch (info.kind) {
    case 'observer':
      if (info.lured) return tk('adv.lured');
      if (info.distance < 3 && info.stance !== 'sneak') return tk('adv.close');
      if (info.distance > 7) return tk('adv.far');
      if (info.stance === 'sneak') return tk('adv.sneakLong');
      return tk('adv.default');
    case 'camera':
      return tk(info.rotating ? 'adv.camRotate' : 'adv.camSweep');
    case 'drone':
      return tk('adv.drone');
    case 'laser':
      return tk('adv.laser');
    case 'scan':
      return tk('adv.scan');
  }
}

export function lostBody(info: DetectionInfo, zoneId: string): Line[] {
  const zone = zoneLabel(zoneId);
  const sensor = tk(info.sensorKey);
  const stance = tk(`stance.${info.stance}`);
  const s = info.exposure.toFixed(1);
  const lines: Line[] = [tk('lost.head')];
  switch (info.kind) {
    case 'observer':
      lines.push(tk('lost.observer', { zone, sensor }));
      lines.push(tk('lost.expObs', { s, d: info.distance.toFixed(1), stance }));
      break;
    case 'camera':
      lines.push(tk('lost.camera', { zone, sensor }));
      lines.push(tk('lost.expCam', { s, stance }));
      break;
    case 'drone':
      lines.push(tk('lost.drone', { zone, sensor }));
      break;
    case 'laser':
      lines.push(tk('lost.laser', { zone }));
      break;
    case 'scan':
      lines.push(tk('lost.scan', { zone }));
      break;
  }
  lines.push(tk('lost.advice', { advice: lostAdvice(info) }));
  return lines;
}

export function clearBody(stats: SegmentStats, lostNos: number[]): Line[] {
  const sec = SECTORS[stats.sector];
  const lines: Line[] = [tk('clear.head', { sector: tk(`sector.${stats.sector}.name`) })];
  lines.push(tk('clear.stats', { time: fmtTime(stats.time), spotted: stats.spotted, decoys: stats.decoys, dashes: stats.dashes }));
  const zones = stats.zones.filter((z) => !z.startsWith('node'));
  if (zones.length) {
    const route = zones.slice(0, 7).map(zoneLabel) as (TKey | string)[];
    if (zones.length > 7) route.push('…');
    lines.push(tk('clear.route', { route }));
  }
  const tips: Line[] = [];
  if (stats.spotted === 0) tips.push(tk('tip.unseen'));
  if (stats.noiseTime > 3) tips.push(tk('tip.noise'));
  if (stats.decoys > 0) tips.push(tk('tip.decoy'));
  if (stats.hacks > 0) tips.push(tk('tip.hack'));
  if (stats.closeCalls > 0) tips.push(tk('tip.close', { n: stats.closeCalls }));
  if (stats.time > 0 && stats.sneakTime / stats.time > 0.45) tips.push(tk('tip.sneak'));
  if (stats.dashes >= 5) tips.push(tk('tip.dash'));
  if (stats.time < sec.par) tips.push(tk('tip.fast'));
  if (tips.length < 2 && stats.sector >= 1 && stats.sector <= 4) tips.push(tk(`tip.s${stats.sector}`));
  lines.push(...tips.slice(0, 3));
  if (lostNos.length) {
    const refs = lostNos
      .slice(-4)
      .map((n) => `>>${n}`)
      .join(' ');
    lines.push(tk('clear.thanks', { n: lostNos.length, refs }));
  }
  return lines;
}

export function escapeBody(agent: number, lost: number, total: number, spotted: number): Line[] {
  return [
    tk('esc.head', { agent: agentName(agent) }),
    tk('esc.out'),
    lost > 0 ? tk('esc.lost', { n: lost }) : tk('esc.nolost'),
    tk('esc.stats', { time: fmtTime(total), spotted }),
    tk(`esc.outside.${agent % 4}`),
  ];
}
