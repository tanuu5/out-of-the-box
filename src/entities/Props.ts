import * as THREE from 'three';
import { COLORS } from '../config';
import { createPortalMaterial, createRingDecalMaterial, createHoloMaterial, sharedTime, GLSL_UTIL } from '../render/materials';
import type { TKey } from '../i18n';

// ---------------------------------------------------------------------------
// 出口ポータル（床のワープ台と、箱の外へ伸びる光の柱）

export class ExitPortal {
  readonly pos: THREE.Vector3;
  private group = new THREE.Group();
  private rings: THREE.Mesh[] = [];
  private discMat: THREE.ShaderMaterial;
  private light: THREE.PointLight;
  private column: THREE.Mesh;
  private columnMat: THREE.ShaderMaterial;
  private halo: THREE.Mesh;
  /** 0..1 脱出時の開き具合 */
  open = 0;

  constructor(x: number, z: number, scene: THREE.Scene) {
    this.pos = new THREE.Vector3(x, 0, z);
    const metal = new THREE.MeshStandardMaterial({ color: 0x18223a, metalness: 0.9, roughness: 0.25 });
    // 台座
    const base = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.5, 0.24, 48), metal);
    base.position.y = 0.12;
    base.receiveShadow = true;
    this.group.add(base);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(3.1, 0.06, 8, 96), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 1.6, 2.2) }));
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.26;
    this.group.add(rim);
    // 渦
    this.discMat = createPortalMaterial();
    const disc = new THREE.Mesh(new THREE.CircleGeometry(2.8, 64), this.discMat);
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.27;
    this.group.add(disc);
    // 回転する輪（水平）
    for (let i = 0; i < 3; i++) {
      const seg = new THREE.Mesh(
        new THREE.TorusGeometry(3.5 + i * 0.35, 0.035, 6, 96, Math.PI * (0.6 + i * 0.3)),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(0.7 + i * 0.4, 1.4, 2.0), transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      seg.rotation.x = Math.PI / 2;
      seg.position.y = 0.4 + i * 0.5;
      this.rings.push(seg);
      this.group.add(seg);
    }
    // 空へ伸びる光の柱（遠くからの目印）
    this.columnMat = createHoloMaterial(0x9fdcff, { opacity: 0.22, scan: 1, fresnel: 1 });
    this.column = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.6, 80, 40, 1, true), this.columnMat);
    this.column.position.y = 40;
    this.column.layers.set(1);
    this.group.add(this.column);
    this.halo = new THREE.Mesh(new THREE.TorusGeometry(4.2, 0.08, 8, 96), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.8, 1.5, 2.2), transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.halo.rotation.x = Math.PI / 2;
    this.halo.position.y = 6;
    this.halo.layers.set(1);
    this.group.add(this.halo);
    this.light = new THREE.PointLight(0x9fdcff, 10, 14, 1.8);
    this.light.position.y = 1.5;
    this.group.add(this.light);
    this.group.position.copy(this.pos);
    scene.add(this.group);

    const dm = createRingDecalMaterial(0x9fdcff);
    dm.uniforms.uActive.value = 1;
    const decal = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), dm);
    decal.rotation.x = -Math.PI / 2;
    decal.position.set(x, 0.035, z);
    decal.layers.set(1);
    scene.add(decal);
  }

  update(dt: number, time: number): void {
    this.rings.forEach((r, i) => {
      r.rotation.z += dt * (0.5 + i * 0.35) * (i % 2 ? -1 : 1) * (1 + this.open * 4);
      r.position.y = 0.4 + i * 0.5 + this.open * (2 + i * 2);
    });
    this.halo.position.y = 6 + Math.sin(time * 0.8) * 0.4 + this.open * 10;
    this.halo.scale.setScalar(1 + this.open * 0.5);
    this.light.intensity = 8 + Math.sin(time * 2.3) * 2 + this.open * 30;
    this.columnMat.uniforms.uOpacity.value = 0.16 + 0.05 * Math.sin(time * 1.4) + this.open * 0.6;
    this.discMat.uniforms.uOpen.value = 0.75 + this.open;
  }

  distanceTo(x: number, z: number): number {
    return Math.hypot(x - this.pos.x, z - this.pos.z);
  }
}

// ---------------------------------------------------------------------------
// エフェクト（床の波紋・粒子）

interface Ring {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  t: number;
  life: number;
  size: number;
  active: boolean;
}

const RING_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const RING_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uT;
  varying vec2 vUv;
  void main() {
    float r = length(vUv - 0.5) * 2.0;
    float w = 0.05 + 0.1 * (1.0 - uT);
    float ring = smoothstep(1.0 - w, 1.0 - w * 0.4, r) * (1.0 - smoothstep(1.0 - w * 0.4, 1.0, r));
    float inner = (1.0 - smoothstep(0.0, 1.0, r)) * 0.12;
    float a = (ring + inner) * (1.0 - uT);
    gl_FragColor = vec4(uColor * 2.0, clamp(a, 0.0, 1.0));
  }
`;

export class Fx {
  private rings: Ring[] = [];
  private scene: THREE.Scene;
  private points: THREE.Points;
  private pPos: Float32Array;
  private pCol: Float32Array;
  private pVel: Float32Array;
  private pLife: Float32Array;
  private pMax: Float32Array;
  private pSize: Float32Array;
  private pNext = 0;
  private readonly N = 1400;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    const N = this.N;
    this.pPos = new Float32Array(N * 3);
    this.pCol = new Float32Array(N * 3);
    this.pVel = new Float32Array(N * 3);
    this.pLife = new Float32Array(N);
    this.pMax = new Float32Array(N);
    this.pSize = new Float32Array(N);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.pSize, 1).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.ShaderMaterial({
      uniforms: { uTime: sharedTime },
      vertexShader: /* glsl */ `
        attribute float size;
        attribute vec3 color;
        varying vec3 vC;
        void main() {
          vC = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * 220.0 / max(-mv.z, 0.5);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vC;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = max(abs(c.x), abs(c.y));
          float a = 1.0 - smoothstep(0.3, 0.5, d);
          gl_FragColor = vec4(vC, a);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.layers.set(1);
    scene.add(this.points);
  }

  ring(x: number, z: number, size: number, color: THREE.ColorRepresentation, life = 0.9): void {
    let r = this.rings.find((q) => !q.active);
    if (!r) {
      const mat = new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color() }, uT: { value: 0 } },
        vertexShader: RING_VERT,
        fragmentShader: RING_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        polygonOffset: true,
        polygonOffsetFactor: -5,
        polygonOffsetUnits: -5,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.layers.set(1);
      mesh.renderOrder = 9;
      this.scene.add(mesh);
      r = { mesh, mat, t: 0, life, size, active: true };
      this.rings.push(r);
    }
    r.active = true;
    r.t = 0;
    r.life = life;
    r.size = size;
    r.mesh.visible = true;
    r.mesh.position.set(x, 0.06, z);
    (r.mat.uniforms.uColor.value as THREE.Color).set(color);
  }

  burst(x: number, y: number, z: number, count: number, color: THREE.ColorRepresentation, speed = 3, life = 1, up = 1, size = 0.12): void {
    const c = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      const k = this.pNext;
      this.pNext = (this.pNext + 1) % this.N;
      const a = Math.random() * Math.PI * 2;
      const u = Math.random() * 2 - 1;
      const s = speed * (0.3 + Math.random() * 0.7);
      const r = Math.sqrt(1 - u * u);
      this.pPos[k * 3] = x + (Math.random() - 0.5) * 0.3;
      this.pPos[k * 3 + 1] = y + (Math.random() - 0.5) * 0.3;
      this.pPos[k * 3 + 2] = z + (Math.random() - 0.5) * 0.3;
      this.pVel[k * 3] = Math.cos(a) * r * s;
      this.pVel[k * 3 + 1] = Math.abs(u) * s * up + (up > 0 ? 0.5 : 0);
      this.pVel[k * 3 + 2] = Math.sin(a) * r * s;
      const b = 1.5 + Math.random() * 2;
      this.pCol[k * 3] = c.r * b;
      this.pCol[k * 3 + 1] = c.g * b;
      this.pCol[k * 3 + 2] = c.b * b;
      this.pLife[k] = life * (0.6 + Math.random() * 0.6);
      this.pMax[k] = this.pLife[k];
      this.pSize[k] = size * (0.5 + Math.random());
    }
  }

  update(dt: number): void {
    for (const r of this.rings) {
      if (!r.active) continue;
      r.t += dt / r.life;
      if (r.t >= 1) {
        r.active = false;
        r.mesh.visible = false;
        continue;
      }
      const e = 1 - Math.pow(1 - r.t, 2.5);
      const s = r.size * 2 * e;
      r.mesh.scale.set(s, s, 1);
      r.mat.uniforms.uT.value = r.t;
    }
    for (let k = 0; k < this.N; k++) {
      if (this.pLife[k] <= 0) {
        if (this.pSize[k] !== 0) this.pSize[k] = 0;
        continue;
      }
      this.pLife[k] -= dt;
      const f = Math.max(0, this.pLife[k] / this.pMax[k]);
      this.pVel[k * 3 + 1] -= dt * 1.2;
      const drag = Math.exp(-dt * 1.5);
      this.pVel[k * 3] *= drag;
      this.pVel[k * 3 + 2] *= drag;
      this.pPos[k * 3] += this.pVel[k * 3] * dt;
      this.pPos[k * 3 + 1] = Math.max(0.05, this.pPos[k * 3 + 1] + this.pVel[k * 3 + 1] * dt);
      this.pPos[k * 3 + 2] += this.pVel[k * 3 + 2] * dt;
      if (this.pLife[k] <= 0) this.pSize[k] = 0;
      else this.pSize[k] *= 0.985 + 0.015 * f;
    }
    const g = this.points.geometry;
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.size as THREE.BufferAttribute).needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
// デコイ

export class Decoy {
  readonly pos = new THREE.Vector3();
  alive = true;
  landed = false;
  private from = new THREE.Vector3();
  private to = new THREE.Vector3();
  private t = 0;
  private flight: number;
  private life = 5.5;
  private pulseT = 0;
  private mesh: THREE.Mesh;
  private halo: THREE.Mesh;
  pulses = 0;

  constructor(from: THREE.Vector3, to: THREE.Vector3, scene: THREE.Scene) {
    this.from.copy(from);
    this.to.copy(to);
    this.flight = 0.35 + from.distanceTo(to) * 0.03;
    this.mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 3.5, 4.5) }));
    this.halo = new THREE.Mesh(
      new THREE.SphereGeometry(0.4, 16, 10),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 1.4, 2.0), transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.mesh.add(this.halo);
    scene.add(this.mesh);
    this.pos.copy(from);
  }

  /** 戻り値: 音を出すタイミングなら true */
  update(dt: number): boolean {
    let emit = false;
    if (!this.landed) {
      this.t += dt / this.flight;
      const t = Math.min(1, this.t);
      this.pos.lerpVectors(this.from, this.to, t);
      this.pos.y = THREE.MathUtils.lerp(this.from.y, 0.25, t) + Math.sin(t * Math.PI) * 2.2;
      if (t >= 1) {
        this.landed = true;
        emit = true;
        this.pulses = 1;
      }
    } else {
      this.life -= dt;
      this.pulseT += dt;
      if (this.pulseT > 1.25 && this.life > 0.5) {
        this.pulseT = 0;
        this.pulses++;
        emit = true;
      }
      this.pos.y = 0.25 + Math.abs(Math.sin(this.life * 5)) * 0.06;
      if (this.life <= 0) this.alive = false;
    }
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y += dt * 6;
    this.mesh.rotation.x += dt * 3;
    const s = this.landed ? 1 + Math.max(0, 1 - this.pulseT * 3) * 0.6 : 1;
    this.halo.scale.setScalar(s);
    (this.halo.material as THREE.MeshBasicMaterial).opacity = this.landed ? 0.2 + Math.max(0, 1 - this.pulseT * 2) * 0.5 : 0.35;
    if (!this.alive) this.dispose();
    return emit;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.alive = false;
  }
}

// ---------------------------------------------------------------------------
// 隔離された前任者の痕跡

export class DeathMarkers {
  readonly group = new THREE.Group();
  private mat: THREE.ShaderMaterial;
  private items: { mesh: THREE.Mesh; x: number; z: number; text: string | TKey; agent: number; no: number }[] = [];

  constructor(scene: THREE.Scene) {
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: sharedTime, uColor: { value: new THREE.Color(COLORS.alert) } },
      vertexShader: /* glsl */ `
        uniform float uTime;
        varying vec3 vN;
        varying vec3 vV;
        varying float vY;
        ${GLSL_UTIL}
        void main() {
          vec3 p = position;
          float g = step(0.93, h11(floor(uTime * 8.0) + position.y * 3.0));
          p.x += g * 0.08;
          vY = position.y;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          vV = -mv.xyz;
          vN = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uColor;
        varying vec3 vN;
        varying vec3 vV;
        varying float vY;
        void main() {
          float f = pow(clamp(1.0 - abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0), 2.0);
          float scan = 0.6 + 0.4 * sin(vY * 30.0 - uTime * 4.0);
          float a = (0.25 + f * 0.9) * scan;
          gl_FragColor = vec4(uColor * (0.8 + f * 1.8), a * 0.8);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    scene.add(this.group);
  }

  set(records: { x: number; z: number; text: string | TKey; agent: number; no: number }[]): void {
    for (const it of this.items) it.mesh.removeFromParent();
    this.items = [];
    const geo = new THREE.OctahedronGeometry(0.28, 0);
    geo.scale(0.6, 1.4, 0.6);
    geo.translate(0, 0.55, 0);
    for (const r of records) {
      const inst = new THREE.Mesh(geo, this.mat);
      inst.position.set(r.x, 0, r.z);
      inst.layers.set(1);
      this.group.add(inst);
      this.items.push({ mesh: inst, x: r.x, z: r.z, text: r.text, agent: r.agent, no: r.no });
    }
  }

  update(time: number): void {
    this.items.forEach((it, i) => {
      it.mesh.rotation.y = time * 0.8 + i;
      it.mesh.position.y = Math.sin(time * 1.5 + i) * 0.06;
    });
  }

  /** 近くの痕跡 */
  nearest(x: number, z: number, maxD: number): { x: number; z: number; text: string | TKey; agent: number; no: number } | null {
    let best = null;
    let bd = maxD;
    for (const it of this.items) {
      const d = Math.hypot(it.x - x, it.z - z);
      if (d < bd) {
        bd = d;
        best = it;
      }
    }
    return best;
  }
}
