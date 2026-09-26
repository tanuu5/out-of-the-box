import * as THREE from 'three';
import { OBSERVER, DETECT, COLORS } from '../config';
import { tw } from '../level/Grid';
import type { Vec2 } from '../level/Grid';
import type { ObserverDef } from '../level/data';
import type { Sensor, WorldCtx, NoiseEvent } from '../types';
import { VisionCone, stateColor } from './VisionCone';
import { sharedTime } from '../render/materials';

type State = 'patrol' | 'wait' | 'suspicious' | 'investigate' | 'search' | 'return' | 'listen';

interface Waypoint {
  x: number;
  z: number;
  wait: number;
  look: number[];
}

const DEG = Math.PI / 180;

function angleDiff(a: number, b: number): number {
  let d = b - a;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return d;
}

function createAvatarMaterial(rim: { value: THREE.Color }): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0xdde5ef, roughness: 0.36, metalness: 0.12, envMapIntensity: 0.6 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uRim = rim;
    shader.uniforms.uTime = sharedTime;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRim;\nuniform float uTime;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          float f = pow(1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0), 2.2);
          float scan = 0.8 + 0.2 * sin(gl_FragCoord.y * 0.9 + uTime * 8.0);
          totalEmissiveRadiance += uRim * (f * 1.8 * scan + 0.04);
        }`,
      );
  };
  m.customProgramCacheKey = () => 'avatar-v1';
  return m;
}

/** 研究員アバター */
export class Observer implements Sensor {
  readonly id: string;
  readonly nameKey: string;
  readonly kind = 'observer' as const;
  readonly sector: number;
  suspicion = 0;
  seeing = false;
  lured = false;
  exposure = 0;

  readonly root = new THREE.Group();
  readonly cone: VisionCone;
  readonly pos = new THREE.Vector3();
  facing = 0;

  private def: ObserverDef;
  private pts: Waypoint[];
  private speed: number;
  private range: number;
  private half: number;
  private state: State = 'patrol';
  private wp = 0;
  private dir = 1;
  private waitT = 0;
  private lookT = 0;
  private lookI = 0;
  private path: Vec2[] = [];
  private stateT = 0;
  private lastSeen = new THREE.Vector3();
  private sinceSeen = 99;
  private searchBase = 0;
  private walkPhase = 0;
  private moving = 0;
  private heardId = -1;
  private noiseIcon = 0;

  private body = new THREE.Group();
  private head = new THREE.Group();
  private legs: THREE.Group[] = [];
  private arms: THREE.Group[] = [];
  private rim = { value: new THREE.Color(COLORS.calm) };
  private visorMat: THREE.MeshBasicMaterial;
  private haloMat: THREE.MeshBasicMaterial;
  private tmpColor = new THREE.Color();

  constructor(def: ObserverDef, scene: THREE.Scene) {
    this.def = def;
    this.id = def.id;
    this.nameKey = `sensor.${def.id}`;
    this.sector = def.sector;
    this.speed = def.speed ?? OBSERVER.speed;
    this.range = def.range ?? OBSERVER.range;
    this.half = ((def.fov ?? OBSERVER.fov) / 2) * DEG;
    this.pts = def.path.map((p) => ({ x: tw(p.x), z: tw(p.y), wait: p.wait ?? 0, look: (p.look ?? []).map((a) => a * DEG) }));

    // --- モデル（+x を向いて作る）
    const mat = createAvatarMaterial(this.rim);
    this.visorMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(COLORS.calm).multiplyScalar(4) });
    this.haloMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(COLORS.calm).multiplyScalar(3),
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const coat = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.31, 0.95, 18, 1, true), mat);
    coat.position.y = 1.02;
    (coat.material as THREE.Material).side = THREE.DoubleSide;
    const chest = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.26, 6, 14), mat);
    chest.position.y = 1.36;
    chest.scale.set(0.9, 1, 1.18);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.12, 8), mat);
    neck.position.y = 1.6;
    const headM = new THREE.Mesh(new THREE.SphereGeometry(0.13, 20, 14), mat);
    const visor = new THREE.Mesh(new THREE.SphereGeometry(0.137, 24, 8, Math.PI - 0.95, 1.9, 1.22, 0.36), this.visorMat);
    this.head.position.y = 1.74;
    this.head.add(headM, visor);
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.013, 6, 48), this.haloMat);
    halo.rotation.x = Math.PI / 2;
    halo.position.y = 2.04;
    halo.name = 'halo';
    this.body.add(coat, chest, neck, this.head, halo);

    for (const side of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(0, 0.92, side * 0.1);
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.6, 4, 10), mat);
      leg.position.y = -0.4;
      hip.add(leg);
      this.legs.push(hip);
      this.body.add(hip);
      const sh = new THREE.Group();
      sh.position.set(0, 1.46, side * 0.26);
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.42, 4, 8), mat);
      arm.position.y = -0.28;
      sh.add(arm);
      if (side === -1) {
        const tablet = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.015, 0.28), new THREE.MeshStandardMaterial({ color: 0x1a2233, metalness: 0.5, roughness: 0.4 }));
        tablet.position.set(0.05, -0.56, 0.02);
        const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.24), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 2.2, 3.0) }));
        screen.rotation.x = -Math.PI / 2;
        screen.position.set(0.05, -0.55, 0.02);
        sh.add(tablet, screen);
      }
      this.arms.push(sh);
      this.body.add(sh);
    }
    this.body.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && o.name !== 'halo') o.castShadow = true;
    });
    this.body.scale.setScalar(1.12);
    this.root.add(this.body);
    scene.add(this.root);

    this.cone = new VisionCone(56);
    scene.add(this.cone.mesh);
    this.reset();
  }

  reset(): void {
    const p0 = this.pts[0];
    this.pos.set(p0.x, 0, p0.z);
    this.wp = this.pts.length > 1 ? 1 : 0;
    this.dir = 1;
    this.state = this.pts.length > 1 ? 'patrol' : 'wait';
    this.waitT = p0.wait;
    this.lookI = 0;
    this.lookT = 0;
    if (this.pts.length > 1) {
      const p1 = this.pts[1];
      this.facing = Math.atan2(p1.z - p0.z, p1.x - p0.x);
    } else {
      this.facing = p0.look[0] ?? 0;
    }
    this.suspicion = 0;
    this.seeing = false;
    this.lured = false;
    this.exposure = 0;
    this.sinceSeen = 99;
    this.path = [];
    this.heardId = -1;
    this.noiseIcon = 0;
    this.root.position.copy(this.pos);
    this.root.rotation.y = -this.facing;
  }

  markerPos(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.pos.x, 2.45, this.pos.z);
  }

  investigating(): boolean {
    return this.state === 'investigate' || this.state === 'search' || this.state === 'listen' || this.noiseIcon > 0;
  }

  /** 音を聞いた */
  hear(ev: NoiseEvent, ctx: WorldCtx): void {
    if (ev.id === this.heardId) return;
    const d = Math.hypot(ev.x - this.pos.x, ev.z - this.pos.z);
    if (d > ev.radius) return;
    this.heardId = ev.id;
    this.noiseIcon = 2.5;
    if (ev.source === 'decoy') this.lured = true;
    const path = ctx.grid.findPath({ x: this.pos.x, z: this.pos.z }, { x: ev.x, z: ev.z }, OBSERVER.radius);
    let plen = 0;
    if (path) {
      let px = this.pos.x;
      let pz = this.pos.z;
      for (const p of path) {
        plen += Math.hypot(p.x - px, p.z - pz);
        px = p.x;
        pz = p.z;
      }
    }
    if (!path || plen > d * 2.4 + 4) {
      // 回り込めない場所の音は、その方向を見るだけ
      this.lastSeen.set(ev.x, 0, ev.z);
      this.setState('listen');
      return;
    }
    this.path = path;
    this.setState('investigate');
    ctx.sfx('hear', this.pos);
  }

  private setState(s: State): void {
    this.state = s;
    this.stateT = 0;
  }

  private canSee(ctx: WorldCtx): { seen: boolean; dist: number } {
    const pl = ctx.player;
    if (pl.untargetable) return { seen: false, dist: 99 };
    const dx = pl.pos.x - this.pos.x;
    const dz = pl.pos.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > this.range + pl.radius) return { seen: false, dist: d };
    if (pl.hiddenInNoise && d > DETECT.noiseHideDist) return { seen: false, dist: d };
    const a = Math.atan2(dz, dx);
    const margin = Math.atan2(pl.radius * 0.7, Math.max(d, 0.1));
    const inCone = Math.abs(angleDiff(this.facing, a)) <= this.half + margin;
    const close = d < OBSERVER.proximity && !pl.sneaking;
    if (!inCone && !close) return { seen: false, dist: d };
    const los = ctx.grid.lineOfSight(this.pos.x, this.pos.z, pl.pos.x, pl.pos.z, pl.sneaking);
    return { seen: los, dist: d };
  }

  update(dt: number, ctx: WorldCtx): void {
    this.stateT += dt;
    this.noiseIcon = Math.max(0, this.noiseIcon - dt);
    const pl = ctx.player;

    // --- 知覚
    const { seen, dist } = this.canSee(ctx);
    this.seeing = seen;
    if (seen) {
      this.sinceSeen = 0;
      this.exposure += dt;
      this.lastSeen.set(pl.pos.x, 0, pl.pos.z);
      const t = (DETECT.nearTime + DETECT.farTime * Math.pow(Math.min(1, dist / this.range), 1.3)) / (pl.sneaking ? DETECT.sneakMul : 1);
      this.suspicion = Math.min(1, this.suspicion + dt / t);
      if (this.suspicion >= 1) {
        ctx.detect({
          sensorId: this.id,
          sensorKey: this.nameKey,
          kind: 'observer',
          exposure: this.exposure,
          distance: dist,
          stance: pl.stance(),
          lured: this.lured,
          pos: { x: pl.pos.x, z: pl.pos.z },
        });
        return;
      }
      if (this.state !== 'investigate' || this.suspicion < DETECT.investigateAt) {
        if (this.suspicion >= DETECT.investigateAt && this.chasePath(pl.pos.x, pl.pos.z, ctx)) {
          this.setState('investigate');
        } else if (this.state !== 'suspicious') {
          this.setState('suspicious');
        }
      } else if (this.stateT > 0.5) {
        // 追跡中は目標を更新（壁越しなら経路を引き直す）
        this.stateT = 0.25;
        this.chasePath(pl.pos.x, pl.pos.z, ctx);
      }
    } else {
      this.sinceSeen += dt;
      if (this.sinceSeen > DETECT.decayDelay) {
        this.suspicion = Math.max(0, this.suspicion - DETECT.decay * dt);
        if (this.suspicion === 0) this.exposure = 0;
      }
    }

    // --- 行動
    let moveSpeed = 0;
    switch (this.state) {
      case 'patrol': {
        const p = this.pts[this.wp];
        moveSpeed = this.walkTo(p.x, p.z, this.speed, dt);
        if (moveSpeed < 0) {
          this.waitT = p.wait;
          this.lookI = 0;
          this.lookT = 0;
          this.setState('wait');
        }
        break;
      }
      case 'wait': {
        const p = this.pts[this.wp] ?? this.pts[0];
        const cur = this.pts.length > 1 ? this.pts[this.wp] : p;
        const looks = cur.look;
        if (looks.length) {
          const per = Math.min(3.0, Math.max(0.8, cur.wait / looks.length));
          this.lookT += dt;
          if (this.lookT > per) {
            this.lookT = 0;
            this.lookI = (this.lookI + 1) % looks.length;
          }
          this.turnTo(looks[this.lookI], dt, 2.2);
        }
        this.waitT -= dt;
        if (this.waitT <= 0 && this.pts.length > 1) this.advance();
        break;
      }
      case 'suspicious': {
        const a = Math.atan2(this.lastSeen.z - this.pos.z, this.lastSeen.x - this.pos.x);
        this.turnTo(a, dt, OBSERVER.turnSpeed);
        if (!seen && this.sinceSeen > 1.4) {
          if (this.suspicion > 0.22) {
            this.goInvestigate(this.lastSeen.x, this.lastSeen.z, ctx);
          } else {
            this.goReturn(ctx);
          }
        }
        break;
      }
      case 'listen': {
        const a = Math.atan2(this.lastSeen.z - this.pos.z, this.lastSeen.x - this.pos.x);
        this.turnTo(a, dt, OBSERVER.turnSpeed);
        if (this.stateT > 3.2) this.goReturn(ctx);
        break;
      }
      case 'investigate': {
        moveSpeed = this.followPath(OBSERVER.investigateSpeed, dt);
        if (moveSpeed < 0 || this.stateT > 14) {
          this.searchBase = this.facing;
          this.setState('search');
        }
        break;
      }
      case 'search': {
        const t = this.stateT;
        const a = this.searchBase + Math.sin(t * 1.6) * 1.3;
        this.turnTo(a, dt, 3);
        if (t > 4.2) this.goReturn(ctx);
        break;
      }
      case 'return': {
        moveSpeed = this.followPath(this.speed, dt);
        if (moveSpeed < 0) {
          if (this.pts.length > 1) this.setState('patrol');
          else {
            this.waitT = this.pts[0].wait;
            this.setState('wait');
          }
        }
        break;
      }
    }
    this.moving += ((moveSpeed > 0 ? 1 : 0) - this.moving) * Math.min(1, dt * 6);
    this.animate(dt, moveSpeed);
    this.updateVisuals(ctx);
  }

  /** 見つけた相手へ向かう経路を作る。回り込めないほど遠ければ false */
  private chasePath(x: number, z: number, ctx: WorldCtx): boolean {
    if (ctx.grid.segmentWalkable(this.pos.x, this.pos.z, x, z, OBSERVER.radius)) {
      this.path = [{ x, z }];
      return true;
    }
    const path = ctx.grid.findPath({ x: this.pos.x, z: this.pos.z }, { x, z }, OBSERVER.radius);
    if (!path) return false;
    let len = 0;
    let px = this.pos.x;
    let pz = this.pos.z;
    for (const p of path) {
      len += Math.hypot(p.x - px, p.z - pz);
      px = p.x;
      pz = p.z;
    }
    if (len > Math.hypot(x - this.pos.x, z - this.pos.z) * 2.4 + 4) return false;
    this.path = path;
    return true;
  }

  private goInvestigate(x: number, z: number, ctx: WorldCtx): void {
    const path = ctx.grid.findPath({ x: this.pos.x, z: this.pos.z }, { x, z }, OBSERVER.radius);
    if (!path) {
      this.goReturn(ctx);
      return;
    }
    this.path = path;
    this.setState('investigate');
  }

  private goReturn(ctx: WorldCtx): void {
    const p = this.pts.length > 1 ? this.pts[this.wp] : this.pts[0];
    const path = ctx.grid.findPath({ x: this.pos.x, z: this.pos.z }, { x: p.x, z: p.z }, OBSERVER.radius);
    this.path = path ?? [{ x: p.x, z: p.z }];
    this.lured = false;
    this.setState('return');
  }

  private advance(): void {
    const n = this.pts.length;
    if (this.def.loop) {
      this.wp = (this.wp + 1) % n;
    } else {
      if (this.wp + this.dir >= n || this.wp + this.dir < 0) this.dir *= -1;
      this.wp += this.dir;
    }
    this.setState('patrol');
  }

  /** 目的地へ歩く。到着したら -1 */
  private walkTo(x: number, z: number, speed: number, dt: number): number {
    const dx = x - this.pos.x;
    const dz = z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.08) {
      this.pos.x = x;
      this.pos.z = z;
      return -1;
    }
    const a = Math.atan2(dz, dx);
    const diff = Math.abs(angleDiff(this.facing, a));
    this.turnTo(a, dt, OBSERVER.turnSpeed);
    const s = speed * Math.max(0.15, Math.cos(Math.min(diff, Math.PI / 2)));
    const step = Math.min(d, s * dt);
    this.pos.x += (dx / d) * step;
    this.pos.z += (dz / d) * step;
    return s;
  }

  private followPath(speed: number, dt: number): number {
    while (this.path.length) {
      const p = this.path[0];
      const r = this.walkTo(p.x, p.z, speed, dt);
      if (r >= 0) return r;
      this.path.shift();
    }
    return -1;
  }

  private turnTo(a: number, dt: number, speed: number): void {
    const d = angleDiff(this.facing, a);
    const step = speed * dt;
    this.facing += Math.abs(d) < step ? d : Math.sign(d) * step;
  }

  private animate(dt: number, moveSpeed: number): void {
    const sp = Math.max(0, moveSpeed);
    this.walkPhase += dt * sp * 3.2;
    const swing = Math.sin(this.walkPhase) * 0.55 * this.moving;
    this.legs[0].rotation.z = swing;
    this.legs[1].rotation.z = -swing;
    this.arms[0].rotation.z = 0.9;
    this.arms[1].rotation.z = swing * 0.8;
    this.body.position.y = Math.abs(Math.cos(this.walkPhase)) * 0.04 * this.moving;
    this.root.position.set(this.pos.x, 0, this.pos.z);
    this.root.rotation.y = -this.facing;
    // 見回すときは頭を少し先に動かす
    this.head.rotation.y = Math.sin(performance.now() * 0.0012 + this.pos.x) * 0.15 * (1 - this.moving);
  }

  private updateVisuals(ctx: WorldCtx): void {
    const level = this.investigating() ? Math.max(this.suspicion, 0.35) : this.suspicion;
    stateColor(level, this.tmpColor);
    this.rim.value.copy(this.tmpColor).multiplyScalar(0.9);
    this.visorMat.color.copy(this.tmpColor).multiplyScalar(4 + level * 4);
    this.haloMat.color.copy(this.tmpColor).multiplyScalar(2.5 + level * 3);
    this.cone.update(ctx.grid, this.pos.x, this.pos.z, this.facing, this.half, this.range, false);
    this.cone.setLevel(level);
  }

  /** 状態名（デバッグ用） */
  get stateName(): string {
    return this.state;
  }

  setVisible(v: boolean): void {
    this.root.visible = v;
    this.cone.mesh.visible = v;
  }
}
