import * as THREE from 'three';
import { TILE, WALL_H, RACK_H, LOW_H, PILLAR_H, PLATFORM_DEPTH } from '../config';
import { Grid, T } from '../level/Grid';
import {
  createFloorMaterial,
  createWallMaterial,
  createRackMaterial,
  createCrateMaterial,
  createPillarMaterial,
  createGlassMaterial,
  createNoiseFloorMaterial,
  createNoiseVoxelMaterial,
} from '../render/materials';
import type { PlanarReflection } from '../render/PlanarReflection';

class GeoBuilder {
  pos: number[] = [];
  nrm: number[] = [];
  uv: number[] = [];
  idx: number[] = [];

  quad(v: number[][], n: number[], uvs: number[][] = [[0, 0], [1, 0], [1, 1], [0, 1]]): void {
    const base = this.pos.length / 3;
    for (let i = 0; i < 4; i++) {
      this.pos.push(v[i][0], v[i][1], v[i][2]);
      this.nrm.push(n[0], n[1], n[2]);
      this.uv.push(uvs[i][0], uvs[i][1]);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

function boxFaces(gb: GeoBuilder, x0: number, z0: number, x1: number, z1: number, yb: (side: number) => number | null, yt: number, top: boolean): void {
  // side: 0=N,1=S,2=W,3=E。yb が null ならその面は作らない
  const n = yb(0);
  if (n !== null) gb.quad([[x1, n, z0], [x0, n, z0], [x0, yt, z0], [x1, yt, z0]], [0, 0, -1]);
  const s = yb(1);
  if (s !== null) gb.quad([[x0, s, z1], [x1, s, z1], [x1, yt, z1], [x0, yt, z1]], [0, 0, 1]);
  const w = yb(2);
  if (w !== null) gb.quad([[x0, w, z0], [x0, w, z1], [x0, yt, z1], [x0, yt, z0]], [-1, 0, 0]);
  const e = yb(3);
  if (e !== null) gb.quad([[x1, e, z1], [x1, e, z0], [x1, yt, z0], [x1, yt, z1]], [1, 0, 0]);
  if (top) gb.quad([[x0, yt, z1], [x1, yt, z1], [x1, yt, z0], [x0, yt, z0]], [0, 1, 0]);
}

export interface LevelVisuals {
  group: THREE.Group;
  floor: THREE.Mesh;
  /** 反射に映さないもの */
  noReflect: THREE.Object3D[];
  noiseMaterial: THREE.ShaderMaterial;
  wallMaterial: THREE.MeshStandardMaterial;
}

export function buildLevel(grid: Grid, refl: PlanarReflection): LevelVisuals {
  const group = new THREE.Group();
  group.name = 'level';
  const DIRS: [number, number][] = [[0, -1], [0, 1], [-1, 0], [1, 0]];

  // --- 床
  const floorB = new GeoBuilder();
  const noiseB = new GeoBuilder();
  const noiseTiles: [number, number][] = [];
  for (let y = 0; y < grid.h; y++) {
    for (let x = 0; x < grid.w; x++) {
      const t = grid.get(x, y);
      if (t === T.VOID || t === T.WALL || t === T.RACK) continue;
      const x0 = x * TILE;
      const z0 = y * TILE;
      floorB.quad([[x0, 0, z0 + TILE], [x0 + TILE, 0, z0 + TILE], [x0 + TILE, 0, z0], [x0, 0, z0]], [0, 1, 0]);
      if (t === T.NOISE) {
        noiseB.quad([[x0, 0.02, z0 + TILE], [x0 + TILE, 0.02, z0 + TILE], [x0 + TILE, 0.02, z0], [x0, 0.02, z0]], [0, 1, 0]);
        noiseTiles.push([x, y]);
      }
    }
  }
  const floor = new THREE.Mesh(floorB.build(), createFloorMaterial(refl));
  floor.receiveShadow = true;
  floor.name = 'floor';
  group.add(floor);

  // --- 壁・ラック
  const wallB = new GeoBuilder();
  const rackB = new GeoBuilder();
  for (let y = 0; y < grid.h; y++) {
    for (let x = 0; x < grid.w; x++) {
      const t = grid.get(x, y);
      if (t !== T.WALL && t !== T.RACK) continue;
      const x0 = x * TILE;
      const z0 = y * TILE;
      const h = t === T.WALL ? WALL_H : RACK_H;
      const b = t === T.WALL ? wallB : rackB;
      boxFaces(
        b,
        x0,
        z0,
        x0 + TILE,
        z0 + TILE,
        (side) => {
          const [dx, dy] = DIRS[side];
          const nt = grid.get(x + dx, y + dy);
          if (nt === T.WALL) return null;
          if (t === T.RACK && nt === T.RACK) return null;
          if (nt === T.VOID) return -PLATFORM_DEPTH;
          return 0;
        },
        h,
        true,
      );
    }
  }
  const wallMaterial = createWallMaterial();
  const walls = new THREE.Mesh(wallB.build(), wallMaterial);
  walls.castShadow = true;
  walls.receiveShadow = true;
  walls.name = 'walls';
  group.add(walls);
  if (rackB.pos.length) {
    const racks = new THREE.Mesh(rackB.build(), createRackMaterial());
    racks.castShadow = true;
    racks.receiveShadow = true;
    racks.name = 'racks';
    group.add(racks);
  }

  // --- 低い遮蔽物（クレート）
  const lowTiles: [number, number][] = [];
  const pillarTiles: [number, number][] = [];
  const glassTiles: [number, number][] = [];
  for (let y = 0; y < grid.h; y++) {
    for (let x = 0; x < grid.w; x++) {
      const t = grid.get(x, y);
      if (t === T.LOW) lowTiles.push([x, y]);
      else if (t === T.PILLAR) pillarTiles.push([x, y]);
      else if (t === T.GLASS) glassTiles.push([x, y]);
    }
  }
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  if (lowTiles.length) {
    const geo = new THREE.BoxGeometry(TILE * 0.86, LOW_H, TILE * 0.86);
    geo.translate(0, LOW_H / 2, 0);
    const mesh = new THREE.InstancedMesh(geo, createCrateMaterial(), lowTiles.length);
    lowTiles.forEach(([x, y], i) => {
      const r = (((x * 73856093) ^ (y * 19349663)) & 1023) / 1023;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (r - 0.5) * 0.12);
      p.set((x + 0.5) * TILE, 0, (y + 0.5) * TILE);
      s.set(1, 0.92 + r * 0.16, 1);
      m4.compose(p, q, s);
      mesh.setMatrixAt(i, m4);
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = 'crates';
    group.add(mesh);
  }

  // --- 柱・タンク
  if (pillarTiles.length) {
    const geo = new THREE.CylinderGeometry(TILE * 0.4, TILE * 0.44, PILLAR_H, 28, 1);
    geo.translate(0, PILLAR_H / 2, 0);
    const mesh = new THREE.InstancedMesh(geo, createPillarMaterial(), pillarTiles.length);
    pillarTiles.forEach(([x, y], i) => {
      m4.makeTranslation((x + 0.5) * TILE, 0, (y + 0.5) * TILE);
      mesh.setMatrixAt(i, m4);
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = 'pillars';
    group.add(mesh);
  }

  // --- ガラス
  if (glassTiles.length) {
    const gb = new GeoBuilder();
    const frameB = new GeoBuilder();
    for (const [x, y] of glassTiles) {
      const vertical = grid.get(x, y - 1) === T.GLASS || grid.get(x, y + 1) === T.GLASS;
      const cx = (x + 0.5) * TILE;
      const cz = (y + 0.5) * TILE;
      if (vertical) {
        gb.quad([[cx, 0, y * TILE], [cx, 0, (y + 1) * TILE], [cx, WALL_H, (y + 1) * TILE], [cx, WALL_H, y * TILE]], [-1, 0, 0]);
        boxFaces(frameB, cx - 0.12, y * TILE, cx + 0.12, (y + 1) * TILE, () => 0, 0.28, true);
        boxFaces(frameB, cx - 0.1, y * TILE, cx + 0.1, (y + 1) * TILE, () => WALL_H - 0.18, WALL_H, true);
      } else {
        gb.quad([[x * TILE, 0, cz], [(x + 1) * TILE, 0, cz], [(x + 1) * TILE, WALL_H, cz], [x * TILE, WALL_H, cz]], [0, 0, 1]);
        boxFaces(frameB, x * TILE, cz - 0.12, (x + 1) * TILE, cz + 0.12, () => 0, 0.28, true);
        boxFaces(frameB, x * TILE, cz - 0.1, (x + 1) * TILE, cz + 0.1, () => WALL_H - 0.18, WALL_H, true);
      }
    }
    const glass = new THREE.Mesh(gb.build(), createGlassMaterial());
    glass.renderOrder = 5;
    glass.name = 'glass';
    group.add(glass);
    const frame = new THREE.Mesh(frameB.build(), wallMaterial);
    frame.castShadow = true;
    frame.receiveShadow = true;
    group.add(frame);
  }

  // --- ノイズ領域
  const noiseMaterial = createNoiseFloorMaterial();
  const noReflect: THREE.Object3D[] = [];
  if (noiseTiles.length) {
    const nm = new THREE.Mesh(noiseB.build(), noiseMaterial);
    nm.renderOrder = 2;
    nm.name = 'noise-floor';
    group.add(nm);
    noReflect.push(nm);
    const per = 7;
    const vgeo = new THREE.BoxGeometry(0.12, 0.12, 0.12);
    const vox = new THREE.InstancedMesh(vgeo, createNoiseVoxelMaterial(), noiseTiles.length * per);
    let k = 0;
    const rnd = mulberry32(1234);
    for (const [x, y] of noiseTiles) {
      for (let i = 0; i < per; i++) {
        p.set((x + 0.1 + rnd() * 0.8) * TILE, 0.1 + rnd() * 1.3, (y + 0.1 + rnd() * 0.8) * TILE);
        const sc = 0.5 + rnd() * 1.6;
        s.set(sc, sc * (0.6 + rnd()), sc);
        q.identity();
        m4.compose(p, q, s);
        vox.setMatrixAt(k++, m4);
      }
    }
    vox.frustumCulled = false;
    vox.renderOrder = 3;
    vox.name = 'noise-voxels';
    group.add(vox);
    noReflect.push(vox);
  }

  return { group, floor, noReflect, noiseMaterial, wallMaterial };
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
