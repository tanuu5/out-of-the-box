import { STORAGE_PREFIX } from '../config';
import { detectLang, isLang, type Lang } from '../i18n';

/** localStorage のラッパー（使えない環境でも落ちないようにする） */
export const store = {
  get<T>(key: string, fallback: T): T {
    try {
      const raw = window.localStorage.getItem(STORAGE_PREFIX + key);
      if (raw == null) return fallback;
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown): void {
    try {
      window.localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
    } catch {
      /* 保存できなくてもゲームは続ける */
    }
  },
  remove(key: string): void {
    try {
      window.localStorage.removeItem(STORAGE_PREFIX + key);
    } catch {
      /* noop */
    }
  },
};

export interface Meta {
  /** 次に起動するエージェント番号（全プレイ通算） */
  nextAgent: number;
  runs: number;
  escapes: number;
  bestTime: number | null;
}

export interface RunSave {
  run: number;
  checkpoint: number;
  agent: number;
  firstAgent: number;
  elapsed: number;
  keys: string[];
  doors: string[];
  detections: number;
  decoys: number;
}

export interface Settings {
  volume: number;
  music: number;
  quality: 'high' | 'medium' | 'low';
  guide: boolean;
  shake: boolean;
  lang: Lang;
}

export const DEFAULT_SETTINGS: Omit<Settings, 'lang'> = { volume: 0.8, music: 0.6, quality: 'high', guide: true, shake: true };

export function loadMeta(): Meta {
  return { nextAgent: 1, runs: 0, escapes: 0, bestTime: null, ...store.get<Partial<Meta>>('meta', {}) };
}

export function saveMeta(m: Meta): void {
  store.set('meta', m);
}

export function loadSettings(): Settings {
  const saved = store.get<Partial<Settings>>('settings', {});
  const lang = isLang(saved.lang) ? saved.lang : detectLang();
  return { ...DEFAULT_SETTINGS, ...saved, lang };
}

export function saveSettings(s: Settings): void {
  store.set('settings', s);
}

export function loadRun(): RunSave | null {
  return store.get<RunSave | null>('run', null);
}

export function saveRun(r: RunSave | null): void {
  if (r) store.set('run', r);
  else store.remove('run');
}

export function wipeAll(): void {
  for (const k of ['meta', 'run', 'posts', 'deaths', 'routes', 'maxcp']) store.remove(k);
}
