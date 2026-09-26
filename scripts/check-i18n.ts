// 翻訳辞書の検証：各言語のキーがそろっているか、コードが使うキーがすべてあるか
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ja } from '../src/i18n/ja.ts';
import { en } from '../src/i18n/en.ts';
import { ZONES, OBSERVERS, CAMERAS, DRONES, TERMINALS, KEYS, SECTORS } from '../src/level/data.ts';

const dicts: Record<string, Record<string, string>> = { ja, en };
let ok = true;
const fail = (msg: string) => {
  console.log('✗ ' + msg);
  ok = false;
};

// 1) 言語間のキーの一致（.one などの複数形は英語側だけにあってよい）
const base = new Set(Object.keys(ja));
for (const [lang, d] of Object.entries(dicts)) {
  for (const k of base) if (!(k in d)) fail(`${lang}: missing "${k}"`);
  for (const k of Object.keys(d)) if (!base.has(k) && !k.endsWith('.one')) fail(`${lang}: extra key "${k}" (not in ja)`);
}

// 2) コードに直接書かれたキー
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
  });
}
const used = new Set<string>();
for (const f of walk('src')) {
  if (f.includes('/i18n/')) continue;
  const s = readFileSync(f, 'utf8');
  for (const m of s.matchAll(/\b(?:t|tk|th)\(\s*'([^']+)'/g)) used.add(m[1]);
  for (const m of s.matchAll(/(?:small|setState)[:(]\s*'([a-z]\w*\.[\w.]+)'/g)) used.add(m[1]);
  for (const m of s.matchAll(/\?\s*'([a-z]+\.[\w.]+)'\s*:\s*'([a-z]+\.[\w.]+)'/g)) used.add(m[1]), used.add(m[2]);
  for (const m of s.matchAll(/showConfirm\('([^']+)'/g)) used.add(m[1]);
}

// 3) データや状態から組み立てるキー
for (const s of SECTORS) for (const x of ['name', 'short', 'obj']) used.add(`sector.${s.id}.${x}`);
for (const z of ZONES) used.add(`zone.${z.id}`);
for (const o of [...OBSERVERS, ...CAMERAS, ...DRONES]) used.add(`sensor.${o.id}`);
used.add('sensor.laser');
used.add('sensor.scan');
for (const x of TERMINALS) used.add(`term.${x.id}`);
for (const x of KEYS) used.add(`item.${x.id}`);
for (const x of ['calm', 'hidden', 'noticed', 'alert']) used.add(`hud.status.${x}`), used.add(`hud.status.${x}.sub`);
for (const x of ['walk', 'sneak', 'dash']) used.add(`hud.stance.${x}`);
for (const x of ['walk', 'sneak', 'dash', 'idle']) used.add(`stance.${x}`);
for (const x of ['start', 'board', 'dash', 'sneak', 'noise', 'suspicion', 'decoy', 'scan', 'laser']) used.add(`tut.${x}`);
for (let i = 1; i <= 4; i++) used.add(`tip.s${i}`);
for (let i = 0; i < 4; i++) used.add(`esc.outside.${i}`);
for (const x of ['goal', 'board', 'log', 'vision', 'hide', 'sound']) used.add(`howto.${x}.t`), used.add(`howto.${x}.d`);
for (const x of ['move', 'sneak', 'dash', 'decoy', 'interact', 'board', 'camera', 'retry', 'pause']) used.add(`ctl.${x}`);
for (const x of ['move', 'sneak', 'dash', 'decoy', 'interact', 'board', 'camera', 'pause']) used.add(`hint.${x}`);
for (const x of ['obj.2.key', 'obj.2.nokey', 'toast.guideOn', 'toast.guideOff', 'fatal.webgl']) used.add(x);

for (const k of used) if (!(k in ja)) fail(`used in code but missing from ja: "${k}"`);

// 4) 差し込み名（{name}）が言語間で一致しているか
for (const k of base) {
  const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  const want = names(ja[k]);
  for (const [lang, d] of Object.entries(dicts)) {
    if (d[k] !== undefined && names(d[k]) !== want) fail(`${lang}: placeholders differ for "${k}" (${names(d[k])} vs ${want})`);
  }
}

const unused = [...base].filter((k) => !used.has(k));
if (unused.length) console.log(`(info) keys not referenced directly: ${unused.join(', ')}`);
console.log(ok ? `I18N OK — ${base.size} keys × ${Object.keys(dicts).length} languages` : 'I18N HAS PROBLEMS');
if (!ok) process.exitCode = 1;
