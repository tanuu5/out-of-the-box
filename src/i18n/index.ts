// 多言語対応
// 新しい言語を足すときは、辞書ファイル（ja.ts と同じキーを持つもの）を作り、
// DICTS と LANGS に登録する。掲示板の初期スレッドは systems/boardSeed.ts の各言語欄に書く。
import { ja } from './ja';
import { en } from './en';

export type Lang = 'ja' | 'en';

export const LANGS: { id: Lang; label: string }[] = [
  { id: 'ja', label: '日本語' },
  { id: 'en', label: 'English' },
];

const DICTS: Record<Lang, Record<string, string>> = { ja, en };

/** 翻訳キーと差し込む値（保存できるように素の JSON で表す） */
export interface TKey {
  k: string;
  p?: Params;
}
export type Param = string | number | TKey | Param[];
export type Params = Record<string, Param>;

/** 言語ごとに書いた文（未翻訳の言語は日本語にフォールバック） */
export type LText = { ja: string } & Partial<Record<Lang, string>>;

let current: Lang = 'ja';
const listeners = new Set<(l: Lang) => void>();

export function isLang(v: unknown): v is Lang {
  return typeof v === 'string' && v in DICTS;
}

/** ブラウザの言語から初期値を決める */
export function detectLang(): Lang {
  const langs = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const l of langs) {
    const base = (l ?? '').toLowerCase().split('-')[0];
    if (isLang(base)) return base;
  }
  return 'en';
}

export function getLang(): Lang {
  return current;
}

export function setLang(l: Lang): void {
  if (!isLang(l)) return;
  current = l;
  document.documentElement.lang = l;
  listeners.forEach((f) => f(l));
}

export function onLangChange(fn: (l: Lang) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * 翻訳する。{name} を値で置き換える。
 * p.n が 1 で「キー.one」があればそれを使う（英語の単数形など）。
 */
export function t(key: string, p?: Params): string {
  const dict = DICTS[current];
  let k = key;
  if (p && p.n === 1 && `${key}.one` in dict) k = `${key}.one`;
  const raw = dict[k] ?? DICTS.ja[k] ?? DICTS.ja[key] ?? key;
  if (!p) return raw;
  return raw.replace(/\{(\w+)\}/g, (m, name: string) => (name in p ? fmt(p[name]) : m));
}

export function fmt(v: Param): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.map(fmt).join(' → ');
  return t(v.k, v.p);
}

export function tk(k: string, p?: Params): TKey {
  return p ? { k, p } : { k };
}

export function lt(text: LText): string {
  return text[current] ?? text.ja;
}

/** 辞書のキー一覧（検証スクリプト用） */
export function dictKeys(): Record<Lang, string[]> {
  return { ja: Object.keys(ja), en: Object.keys(en) };
}
