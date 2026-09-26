import { TILE } from '../config';

export const T = {
  VOID: 0,
  FLOOR: 1,
  WALL: 2,
  RACK: 3,
  LOW: 4,
  NOISE: 5,
  GLASS: 6,
  DOOR: 7,
  PILLAR: 8,
} as const;

export type TileCode = (typeof T)[keyof typeof T];

export interface Vec2 {
  x: number;
  z: number;
}

const CHAR_TO_TILE: Record<string, TileCode> = {
  ' ': T.VOID,
  '.': T.FLOOR,
  '#': T.WALL,
  R: T.RACK,
  b: T.LOW,
  '~': T.NOISE,
  '=': T.GLASS,
  D: T.DOOR,
  P: T.PILLAR,
  S: T.FLOOR,
  C: T.FLOOR,
  X: T.FLOOR,
  K: T.FLOOR,
  T: T.FLOOR,
};

/** タイル座標（中心が整数）→ ワールド座標 */
export function tw(t: number): number {
  return (t + 0.5) * TILE;
}

/** ワールド座標 → タイル番号 */
export function wt(w: number): number {
  return Math.floor(w / TILE);
}

export class Grid {
  readonly w: number;
  readonly h: number;
  readonly tiles: Uint8Array;
  readonly doorOpen: Uint8Array;
  readonly markers: Record<string, [number, number][]> = {};

  constructor(map: string[]) {
    this.h = map.length;
    this.w = Math.max(...map.map((r) => r.length));
    this.tiles = new Uint8Array(this.w * this.h);
    this.doorOpen = new Uint8Array(this.w * this.h);
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const c = map[y][x] ?? ' ';
        this.tiles[y * this.w + x] = CHAR_TO_TILE[c] ?? T.VOID;
        if ('SCXKT'.includes(c)) {
          (this.markers[c] ??= []).push([x, y]);
        }
      }
    }
  }

  get(x: number, y: number): TileCode {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return T.VOID;
    return this.tiles[y * this.w + x] as TileCode;
  }

  setDoor(x: number, y: number, open: boolean): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.doorOpen[y * this.w + x] = open ? 1 : 0;
  }

  isDoorOpen(x: number, y: number): boolean {
    return this.doorOpen[y * this.w + x] === 1;
  }

  isWalkable(x: number, y: number): boolean {
    const t = this.get(x, y);
    if (t === T.FLOOR || t === T.NOISE) return true;
    if (t === T.DOOR) return this.isDoorOpen(x, y);
    return false;
  }

  isNoise(x: number, y: number): boolean {
    return this.get(x, y) === T.NOISE;
  }

  /** 視線を遮るか。低い遮蔽物は対象が低電力モードのときだけ遮る */
  blocksSight(x: number, y: number, lowBlocks: boolean): boolean {
    const t = this.get(x, y);
    switch (t) {
      case T.WALL:
      case T.RACK:
      case T.PILLAR:
        return true;
      case T.DOOR:
        return !this.isDoorOpen(x, y);
      case T.LOW:
        return lowBlocks;
      default:
        return false;
    }
  }

  /** 高い障害物（コーン描画用） */
  blocksTall(x: number, y: number): boolean {
    return this.blocksSight(x, y, false);
  }

  /**
   * DDA レイキャスト。ワールド座標で原点と正規化方向を渡し、最初に遮られるまでの距離を返す。
   * skipOrigin が true なら原点のタイル自体は無視する（柱に付いたカメラなど）。
   */
  raycast(
    ox: number,
    oz: number,
    dx: number,
    dz: number,
    maxDist: number,
    blocks: (x: number, y: number) => boolean,
    skipOrigin = false,
  ): number {
    const px = ox / TILE;
    const pz = oz / TILE;
    let cx = Math.floor(px);
    let cz = Math.floor(pz);
    const ox0 = cx;
    const oz0 = cz;
    if (!skipOrigin && blocks(cx, cz)) return 0;
    const stepX = dx > 0 ? 1 : -1;
    const stepZ = dz > 0 ? 1 : -1;
    const invDx = Math.abs(dx) < 1e-9 ? 1e9 : Math.abs(1 / dx);
    const invDz = Math.abs(dz) < 1e-9 ? 1e9 : Math.abs(1 / dz);
    let tMaxX = (dx > 0 ? cx + 1 - px : px - cx) * invDx;
    let tMaxZ = (dz > 0 ? cz + 1 - pz : pz - cz) * invDz;
    const maxT = maxDist / TILE;
    let t = 0;
    for (let i = 0; i < 256; i++) {
      if (tMaxX < tMaxZ) {
        t = tMaxX;
        tMaxX += invDx;
        cx += stepX;
      } else {
        t = tMaxZ;
        tMaxZ += invDz;
        cz += stepZ;
      }
      if (t >= maxT) return maxDist;
      if (skipOrigin && cx === ox0 && cz === oz0) continue;
      if (blocks(cx, cz)) return t * TILE;
    }
    return maxDist;
  }

  lineOfSight(ax: number, az: number, bx: number, bz: number, lowBlocks: boolean, skipOrigin = false): boolean {
    const dx = bx - ax;
    const dz = bz - az;
    const d = Math.hypot(dx, dz);
    if (d < 1e-4) return true;
    const hit = this.raycast(ax, az, dx / d, dz / d, d, (x, y) => this.blocksSight(x, y, lowBlocks), skipOrigin);
    return hit >= d - 1e-3;
  }

  /** 円と壁の衝突解決 */
  resolveCircle(p: Vec2, r: number): boolean {
    let hit = false;
    for (let iter = 0; iter < 3; iter++) {
      const x0 = wt(p.x - r);
      const x1 = wt(p.x + r);
      const z0 = wt(p.z - r);
      const z1 = wt(p.z + r);
      let moved = false;
      for (let y = z0; y <= z1; y++) {
        for (let x = x0; x <= x1; x++) {
          if (this.isWalkable(x, y)) continue;
          const minX = x * TILE;
          const maxX = minX + TILE;
          const minZ = y * TILE;
          const maxZ = minZ + TILE;
          const qx = Math.max(minX, Math.min(p.x, maxX));
          const qz = Math.max(minZ, Math.min(p.z, maxZ));
          let ddx = p.x - qx;
          let ddz = p.z - qz;
          const d2 = ddx * ddx + ddz * ddz;
          if (d2 >= r * r) continue;
          if (d2 > 1e-10) {
            const d = Math.sqrt(d2);
            const push = r - d;
            p.x += (ddx / d) * push;
            p.z += (ddz / d) * push;
          } else {
            // 中心がタイル内：一番近い辺から押し出す
            const l = p.x - minX;
            const rr = maxX - p.x;
            const t = p.z - minZ;
            const b = maxZ - p.z;
            const m = Math.min(l, rr, t, b);
            if (m === l) p.x = minX - r;
            else if (m === rr) p.x = maxX + r;
            else if (m === t) p.z = minZ - r;
            else p.z = maxZ + r;
            ddx = ddz = 0;
          }
          moved = true;
          hit = true;
        }
      }
      if (!moved) break;
    }
    return hit;
  }

  /** 円が通れる線分か（ワールド座標） */
  segmentWalkable(ax: number, az: number, bx: number, bz: number, r: number): boolean {
    const d = Math.hypot(bx - ax, bz - az);
    const n = Math.max(2, Math.ceil((d / TILE) * 5));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = ax + (bx - ax) * t;
      const z = az + (bz - az) * t;
      if (!this.isWalkable(wt(x - r), wt(z - r))) return false;
      if (!this.isWalkable(wt(x + r), wt(z - r))) return false;
      if (!this.isWalkable(wt(x - r), wt(z + r))) return false;
      if (!this.isWalkable(wt(x + r), wt(z + r))) return false;
    }
    return true;
  }

  nearestWalkable(x: number, y: number): [number, number] {
    if (this.isWalkable(x, y)) return [x, y];
    for (let rad = 1; rad < 6; rad++) {
      for (let dy = -rad; dy <= rad; dy++) {
        for (let dx = -rad; dx <= rad; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue;
          if (this.isWalkable(x + dx, y + dy)) return [x + dx, y + dy];
        }
      }
    }
    return [x, y];
  }

  /** A*（8方向・角抜けなし）。ワールド座標の経路を返す（始点は含まない） */
  findPath(from: Vec2, to: Vec2, radius: number, maxNodes = 4000): Vec2[] | null {
    const [sx, sy] = this.nearestWalkable(wt(from.x), wt(from.z));
    const [gx, gy] = this.nearestWalkable(wt(to.x), wt(to.z));
    const W = this.w;
    const start = sy * W + sx;
    const goal = gy * W + gx;
    if (start === goal) return [{ x: to.x, z: to.z }];
    const g = new Map<number, number>();
    const came = new Map<number, number>();
    const open: { i: number; f: number }[] = [];
    const h = (i: number) => {
      const x = i % W;
      const y = (i / W) | 0;
      const dx = Math.abs(x - gx);
      const dy = Math.abs(y - gy);
      return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
    };
    g.set(start, 0);
    open.push({ i: start, f: h(start) });
    const closed = new Set<number>();
    let found = false;
    let count = 0;
    while (open.length && count++ < maxNodes) {
      // 小さな開放リストなので線形探索で十分
      let bi = 0;
      for (let k = 1; k < open.length; k++) if (open[k].f < open[bi].f) bi = k;
      const cur = open[bi].i;
      open.splice(bi, 1);
      if (cur === goal) {
        found = true;
        break;
      }
      if (closed.has(cur)) continue;
      closed.add(cur);
      const cx = cur % W;
      const cy = (cur / W) | 0;
      const gc = g.get(cur)!;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = cx + dx;
          const ny = cy + dy;
          if (!this.isWalkable(nx, ny)) continue;
          if (dx && dy && (!this.isWalkable(cx + dx, cy) || !this.isWalkable(cx, cy + dy))) continue;
          const ni = ny * W + nx;
          if (closed.has(ni)) continue;
          const ng = gc + (dx && dy ? Math.SQRT2 : 1);
          if (ng < (g.get(ni) ?? Infinity)) {
            g.set(ni, ng);
            came.set(ni, cur);
            open.push({ i: ni, f: ng + h(ni) });
          }
        }
      }
    }
    if (!found) return null;
    const cells: number[] = [];
    let c = goal;
    while (c !== start) {
      cells.push(c);
      c = came.get(c)!;
    }
    cells.reverse();
    const pts: Vec2[] = cells.map((i) => ({ x: tw(i % W), z: tw((i / W) | 0) }));
    pts[pts.length - 1] = { x: to.x, z: to.z };
    if (!this.isWalkable(wt(to.x), wt(to.z))) pts[pts.length - 1] = { x: tw(gx), z: tw(gy) };
    // 糸引き法で平滑化
    const out: Vec2[] = [];
    let ax = from.x;
    let az = from.z;
    let k = 0;
    while (k < pts.length) {
      let far = k;
      for (let j = pts.length - 1; j > k; j--) {
        if (this.segmentWalkable(ax, az, pts[j].x, pts[j].z, radius)) {
          far = j;
          break;
        }
      }
      out.push(pts[far]);
      ax = pts[far].x;
      az = pts[far].z;
      k = far + 1;
    }
    return out;
  }
}
