// レベルデータの検証: 行幅、配置、巡回路が壁を横切らないか
import { MAP, OBSERVERS, CAMERAS, DRONES, LASERS, CHECKPOINTS, DOORS, KEYS, TERMINALS } from '../src/level/data.ts';

const W = MAP[0].length;
let ok = true;
MAP.forEach((row, i) => {
  if (row.length !== W) { console.log(`row ${i} width ${row.length} != ${W}`); ok = false; }
});
const at = (x: number, y: number) => (MAP[y] ?? '')[x] ?? ' ';
const walk = (c: string) => '.~SCXKT'.includes(c);

// print with coordinates
const pad = (n: number) => String(n).padStart(3, ' ');
let head1 = '    ', head2 = '    ';
for (let x = 0; x < W; x++) { head1 += x % 10 === 0 ? String((x / 10) | 0) : ' '; head2 += String(x % 10); }
if (process.argv.includes('--print')) {
  console.log(head1); console.log(head2);
  MAP.forEach((row, i) => console.log(pad(i) + ' ' + row));
}

function tileWalkable(x: number, y: number) { return walk(at(Math.round(x), Math.round(y))); }
// サンプリングで線分チェック（半径も考慮）
function segmentClear(ax: number, ay: number, bx: number, by: number, r = 0.25) {
  const d = Math.hypot(bx - ax, by - ay);
  const n = Math.max(2, Math.ceil(d * 8));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
    for (const [ox, oy] of [[r, 0], [-r, 0], [0, r], [0, -r], [0, 0]]) {
      if (!tileWalkable(x + ox, y + oy)) return `blocked near (${(x + ox).toFixed(2)}, ${(y + oy).toFixed(2)}) '${at(Math.round(x + ox), Math.round(y + oy))}'`;
    }
  }
  return null;
}

for (const o of OBSERVERS) {
  const pts = o.path;
  for (const p of pts) if (!tileWalkable(p.x, p.y)) { console.log(`observer ${o.id} point (${p.x},${p.y}) not walkable '${at(Math.round(p.x), Math.round(p.y))}'`); ok = false; }
  const n = pts.length;
  const segs = o.loop ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const e = segmentClear(a.x, a.y, b.x, b.y, 0.22);
    if (e) { console.log(`observer ${o.id} seg ${i}: ${e}`); ok = false; }
  }
}
for (const c of CHECKPOINTS) if (at(c.x, c.y) !== 'C') { console.log(`checkpoint ${c.id} not on C: '${at(c.x, c.y)}'`); ok = false; }
for (const d of DOORS) for (const [x, y] of d.tiles) if (at(x, y) !== 'D') { console.log(`door ${d.id} tile (${x},${y}) '${at(x, y)}'`); ok = false; }
for (const k of KEYS) if (at(k.x, k.y) !== 'K') { console.log(`key ${k.id} '${at(k.x, k.y)}'`); ok = false; }
for (const t of TERMINALS) if (at(t.x, t.y) !== 'T') { console.log(`terminal ${t.id} '${at(t.x, t.y)}'`); ok = false; }
for (const c of CAMERAS) console.log(`cam ${c.id} at (${c.x},${c.y}) tile '${at(Math.round(c.x), Math.round(c.y))}'`);
for (const l of LASERS) {
  const cy = Math.round(l.y0);
  const cells = [];
  for (let x = Math.ceil(l.x0); x <= Math.floor(l.x1); x++) cells.push(at(x, cy));
  const left = at(Math.floor(l.x0), cy), right = at(Math.ceil(l.x1), cy);
  console.log(`laser ${l.id} cells '${cells.join('')}' ends '${left}' '${right}'`);
}
for (const d of DRONES) for (const p of d.path) if (!tileWalkable(p.x, p.y)) console.log(`drone ${d.id} point over '${at(Math.round(p.x), Math.round(p.y))}' (ok for flying)`);
// 到達可能性: S から C, X, K, T へ
const start = (() => { for (let y = 0; y < MAP.length; y++) { const x = MAP[y].indexOf('S'); if (x >= 0) return [x, y]; } return [0, 0]; })();
const seen = new Set<string>();
const q: number[][] = [start];
seen.add(start.join(','));
while (q.length) {
  const [x, y] = q.shift()!;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx, ny = y + dy;
    const c = at(nx, ny);
    if ((walk(c) || c === 'D') && !seen.has(nx + ',' + ny)) { seen.add(nx + ',' + ny); q.push([nx, ny]); }
  }
}
for (let y = 0; y < MAP.length; y++) for (let x = 0; x < W; x++) {
  const c = at(x, y);
  if ('CXKT'.includes(c) && !seen.has(x + ',' + y)) { console.log(`unreachable ${c} at (${x},${y})`); ok = false; }
}
console.log(ok ? 'LEVEL OK' : 'LEVEL HAS PROBLEMS', `size ${W}x${MAP.length}`);
