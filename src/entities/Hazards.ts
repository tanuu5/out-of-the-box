import * as THREE from 'three';
import { COLORS } from '../config';
import { tw } from '../level/Grid';
import type { LaserDef, ScanDef } from '../level/data';
import type { Sensor, WorldCtx } from '../types';
import { createLaserMaterial, sharedTime, GLSL_UTIL } from '../render/materials';

/** 点滅するレーザーゲート */
export class LaserGate implements Sensor {
  readonly id: string;
  readonly nameKey = 'sensor.laser';
  readonly kind = 'laser' as const;
  readonly sector: number;
  suspicion = 0;
  seeing = false;
  readonly def: LaserDef;
  readonly a = new THREE.Vector2();
  readonly b = new THREE.Vector2();
  on = true;
  warn = false;
  disabled = false;
  private t = 0;
  private plane: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  private strip: THREE.Mesh;
  private stripMat: THREE.MeshBasicMaterial;
  private emitterMats: THREE.MeshBasicMaterial[] = [];

  constructor(def: LaserDef, scene: THREE.Scene) {
    this.def = def;
    this.id = def.id;
    this.sector = def.sector;
    this.a.set(tw(def.x0), tw(def.y0));
    this.b.set(tw(def.x1), tw(def.y1));
    const len = this.a.distanceTo(this.b);
    const ang = Math.atan2(this.b.y - this.a.y, this.b.x - this.a.x);
    const mid = new THREE.Vector3((this.a.x + this.b.x) / 2, 0, (this.a.y + this.b.y) / 2);

    this.mat = createLaserMaterial();
    this.mat.uniforms.uLen.value = len;
    this.plane = new THREE.Mesh(new THREE.PlaneGeometry(len, 1.9), this.mat);
    this.plane.position.set(mid.x, 1.0, mid.z);
    this.plane.rotation.y = -ang;
    this.plane.renderOrder = 7;
    scene.add(this.plane);

    // 床の警告ライン
    this.stripMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(COLORS.laser), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
    this.strip = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.14), this.stripMat);
    this.strip.rotation.x = -Math.PI / 2;
    this.strip.rotation.z = -ang;
    this.strip.position.set(mid.x, 0.03, mid.z);
    this.strip.layers.set(1);
    scene.add(this.strip);

    // 両端の発振器
    const body = new THREE.MeshStandardMaterial({ color: 0x1a2030, metalness: 0.8, roughness: 0.3 });
    for (const [p, s] of [[this.a, 1], [this.b, -1]] as [THREE.Vector2, number][]) {
      const em = new THREE.Mesh(new THREE.BoxGeometry(0.22, 2.1, 0.5), body);
      const dx = Math.cos(ang) * 0.11 * s;
      const dz = Math.sin(ang) * 0.11 * s;
      em.position.set(p.x + dx, 1.05, p.y + dz);
      em.rotation.y = -ang;
      em.castShadow = true;
      const lm = new THREE.MeshBasicMaterial({ color: new THREE.Color(COLORS.laser).multiplyScalar(3) });
      this.emitterMats.push(lm);
      const lens = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.8, 0.2), lm);
      lens.position.set(p.x + dx * 2.05, 1.05, p.y + dz * 2.05);
      lens.rotation.y = -ang;
      scene.add(em, lens);
    }
    this.reset();
  }

  reset(): void {
    this.t = 0;
    this.suspicion = 0;
    this.seeing = false;
  }

  markerPos(out: THREE.Vector3): THREE.Vector3 {
    return out.set((this.a.x + this.b.x) / 2, 2.5, (this.a.y + this.b.y) / 2);
  }

  investigating(): boolean {
    return false;
  }

  /** プレイヤーまでの距離（線分） */
  distanceTo(x: number, z: number): number {
    const abx = this.b.x - this.a.x;
    const abz = this.b.y - this.a.y;
    const t = Math.max(0, Math.min(1, ((x - this.a.x) * abx + (z - this.a.y) * abz) / (abx * abx + abz * abz)));
    return Math.hypot(x - (this.a.x + abx * t), z - (this.a.y + abz * t));
  }

  update(dt: number, ctx: WorldCtx): void {
    this.t += dt;
    const d = this.def;
    this.disabled = ctx.isDisabled(this.id);
    let on: boolean;
    let warn = false;
    if (this.disabled) on = false;
    else if (d.always) on = true;
    else {
      const cyc = d.on + d.off;
      const tc = (((this.t + d.phase) % cyc) + cyc) % cyc;
      on = tc < d.on;
      if (!on && cyc - tc < 0.55) warn = true;
    }
    if (on && !this.on) ctx.sfx('laserOn', { x: this.plane.position.x, z: this.plane.position.z }, 0.5);
    this.on = on;
    this.warn = warn;
    this.mat.uniforms.uOn.value += ((on ? 1 : 0) - this.mat.uniforms.uOn.value) * Math.min(1, dt * 30);
    this.mat.uniforms.uWarn.value = warn ? 1 : 0;
    const flick = warn ? (Math.sin(ctx.time * 60) > 0 ? 1 : 0.2) : 1;
    this.stripMat.opacity = on ? 0.9 : warn ? 0.7 * flick : 0.12;
    this.stripMat.color.set(warn ? COLORS.suspicious : COLORS.laser);
    for (const m of this.emitterMats) m.color.set(this.disabled ? 0x111111 : warn ? COLORS.suspicious : COLORS.laser).multiplyScalar(this.disabled ? 1 : on ? 3 : 1.2);

    const pl = ctx.player;
    this.seeing = false;
    if (on && !pl.untargetable) {
      const dist = this.distanceTo(pl.pos.x, pl.pos.z);
      if (dist < pl.radius + 0.06) {
        this.seeing = true;
        this.suspicion = 1;
        ctx.detect({
          sensorId: this.id,
          sensorKey: this.nameKey,
          kind: 'laser',
          exposure: 0,
          distance: 0,
          stance: pl.stance(),
          lured: false,
          pos: { x: pl.pos.x, z: pl.pos.z },
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------

/** 部屋を横切る紫のスキャン波 */
export class ScanWave implements Sensor {
  readonly id: string;
  readonly nameKey = 'sensor.scan';
  readonly kind = 'scan' as const;
  readonly sector: number;
  suspicion = 0;
  seeing = false;
  readonly def: ScanDef;
  x = 0;
  active = false;
  warning = 0;
  private t = 0;
  private prevX: number | null = null;
  private xMin: number;
  private xMax: number;
  private zMin: number;
  private zMax: number;
  private wall: THREE.Mesh;
  private trail: THREE.Mesh;
  private emitter: THREE.Mesh;
  private wallMat: THREE.ShaderMaterial;
  private trailMat: THREE.ShaderMaterial;
  private emitterMat: THREE.MeshBasicMaterial;
  private duration: number;

  constructor(def: ScanDef, scene: THREE.Scene) {
    this.def = def;
    this.id = def.id;
    this.sector = def.sector;
    this.xMin = tw(def.x0);
    this.xMax = tw(def.x1);
    this.zMin = tw(def.y0);
    this.zMax = tw(def.y1);
    this.duration = (this.xMax - this.xMin) / def.speed;
    const zLen = this.zMax - this.zMin;
    const zMid = (this.zMin + this.zMax) / 2;

    this.wallMat = new THREE.ShaderMaterial({
      uniforms: { uTime: sharedTime, uColor: { value: new THREE.Color(COLORS.scan) }, uAlpha: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vW;
        void main() {
          vUv = uv;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vW = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uColor;
        uniform float uAlpha;
        varying vec2 vUv;
        varying vec3 vW;
        ${GLSL_UTIL}
        void main() {
          float gy = 1.0 - smoothstep(0.0, 0.03 + fwidth(vW.y * 2.5), abs(fract(vW.y * 2.5 - uTime * 2.0) - 0.5) - 0.45);
          float gz = 1.0 - smoothstep(0.0, 0.03 + fwidth(vW.z * 0.5), abs(fract(vW.z * 0.5) - 0.5) - 0.46);
          float n = vnoise(vec2(vW.z * 1.5, vW.y * 4.0 - uTime * 6.0));
          float bottom = 1.0 - smoothstep(0.0, 0.25, vUv.y);
          float top = 1.0 - smoothstep(0.55, 1.0, vUv.y);
          float a = (0.12 + gy * 0.35 + gz * 0.2 + n * 0.25 + bottom * 1.2) * top * uAlpha;
          gl_FragColor = vec4(uColor * (1.4 + bottom * 3.0 + gy), clamp(a, 0.0, 1.0));
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.wall = new THREE.Mesh(new THREE.PlaneGeometry(zLen, 5), this.wallMat);
    this.wall.rotation.y = Math.PI / 2;
    this.wall.position.set(this.xMin, 2.5, zMid);
    this.wall.renderOrder = 8;
    this.wall.frustumCulled = false;
    scene.add(this.wall);

    this.trailMat = new THREE.ShaderMaterial({
      uniforms: { uTime: sharedTime, uColor: { value: new THREE.Color(COLORS.scan) }, uAlpha: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vW;
        void main() {
          vUv = uv;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vW = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uColor;
        uniform float uAlpha;
        varying vec2 vUv;
        varying vec3 vW;
        void main() {
          float lead = pow(vUv.x, 3.0);
          float lines = 1.0 - smoothstep(0.0, 0.05 + fwidth(vW.z), abs(fract(vW.z * 1.0) - 0.5) - 0.42);
          float a = lead * (0.25 + lines * 0.3) * uAlpha;
          gl_FragColor = vec4(uColor * 1.5, clamp(a, 0.0, 1.0));
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    this.trail = new THREE.Mesh(new THREE.PlaneGeometry(8, zLen), this.trailMat);
    this.trail.rotation.x = -Math.PI / 2;
    this.trail.layers.set(1);
    this.trail.renderOrder = 4;
    this.trail.frustumCulled = false;
    scene.add(this.trail);

    this.emitterMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(COLORS.scan), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false });
    this.emitter = new THREE.Mesh(new THREE.PlaneGeometry(zLen, 3.0), this.emitterMat);
    this.emitter.rotation.y = Math.PI / 2;
    const ex = def.dir === 'E' ? this.xMin + 0.05 : this.xMax - 0.05;
    this.emitter.position.set(ex, 1.6, zMid);
    this.emitter.renderOrder = 8;
    scene.add(this.emitter);
    this.reset();
  }

  reset(): void {
    this.t = 0;
    this.prevX = null;
    this.active = false;
    this.warning = 0;
    this.suspicion = 0;
    this.seeing = false;
  }

  markerPos(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.x, 3, (this.zMin + this.zMax) / 2);
  }

  investigating(): boolean {
    return false;
  }

  /** プレイヤーが範囲内にいるか */
  contains(x: number, z: number): boolean {
    return x >= this.xMin - 1 && x <= this.xMax + 1 && z >= this.zMin && z <= this.zMax;
  }

  update(dt: number, ctx: WorldCtx): void {
    this.t += dt;
    const d = this.def;
    const tt = this.t - d.delay;
    let active = false;
    let x = d.dir === 'E' ? this.xMin : this.xMax;
    let warning = 0;
    if (tt >= 0) {
      const tc = tt % d.period;
      if (tc < this.duration) {
        active = true;
        x = d.dir === 'E' ? this.xMin + d.speed * tc : this.xMax - d.speed * tc;
      } else {
        const until = d.period - tc;
        if (until < 2.6) warning = 1 - until / 2.6;
      }
    } else if (-tt < 2.6) {
      warning = 1 + tt / 2.6;
    }
    if (active && !this.active) ctx.sfx('scanStart', { x, z: (this.zMin + this.zMax) / 2 }, 0.8);
    this.active = active;
    this.warning = warning;
    this.x = x;

    const alpha = active ? 1 : 0;
    this.wallMat.uniforms.uAlpha.value += (alpha - this.wallMat.uniforms.uAlpha.value) * Math.min(1, dt * 10);
    this.trailMat.uniforms.uAlpha.value = this.wallMat.uniforms.uAlpha.value;
    this.wall.position.x = x;
    this.wall.visible = this.wallMat.uniforms.uAlpha.value > 0.01;
    this.trail.visible = this.wall.visible;
    const zMid = (this.zMin + this.zMax) / 2;
    this.trail.position.set(d.dir === 'E' ? x - 4 : x + 4, 0.04, zMid);
    this.trail.rotation.z = d.dir === 'E' ? 0 : Math.PI;
    const pulse = warning > 0 ? 0.3 + 0.7 * (Math.sin(ctx.time * 14) * 0.5 + 0.5) * warning : active ? 0.25 : 0.06;
    this.emitterMat.opacity = pulse;

    // --- 判定：波がプレイヤーを横切ったか
    const pl = ctx.player;
    this.seeing = false;
    if (active && this.prevX !== null && !pl.untargetable) {
      const lo = Math.min(this.prevX, x) - 0.15;
      const hi = Math.max(this.prevX, x) + 0.15;
      if (pl.pos.x >= lo && pl.pos.x <= hi && pl.pos.z >= this.zMin && pl.pos.z <= this.zMax) {
        if (!pl.hiddenInNoise) {
          this.seeing = true;
          this.suspicion = 1;
          ctx.detect({
            sensorId: this.id,
            sensorKey: this.nameKey,
            kind: 'scan',
            exposure: 0,
            distance: 0,
            stance: pl.stance(),
            lured: false,
            pos: { x: pl.pos.x, z: pl.pos.z },
          });
        } else {
          ctx.sfx('scanPass', { x: pl.pos.x, z: pl.pos.z }, 0.7);
        }
      }
    }
    this.prevX = active ? x : null;
  }
}
