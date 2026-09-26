import * as THREE from 'three';
import { PLAYER, COLORS } from '../config';
import type { Grid } from '../level/Grid';
import { wt } from '../level/Grid';
import type { PlayerView } from '../types';
import { sharedTime, GLSL_UTIL } from '../render/materials';

const TRAIL_N = 46;

/** 主人公：オレンジに光るAIコア */
export class Player implements PlayerView {
  readonly group = new THREE.Group();
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  readonly radius = PLAYER.radius;
  sneaking = false;
  dashing = false;
  inNoise = false;
  hiddenInNoise = false;
  untargetable = false;
  facing = -Math.PI / 2;
  dashTimer = 0;
  dashCooldown = 0;
  decoys = PLAYER.decoys;
  keys = new Set<string>();
  /** 0..1 の実体化度（隔離・再構成演出用） */
  materialize = 1;
  moveAmount = 0;
  /** 脱出演出で上昇する量 */
  lift = 0;

  private core: THREE.Mesh;
  private shell: THREE.Mesh;
  private wire: THREE.LineSegments;
  private rings: THREE.Mesh[] = [];
  private bits: THREE.InstancedMesh;
  private light: THREE.PointLight;
  private glow: THREE.Mesh;
  private xray: THREE.Mesh;
  private shellMat: THREE.ShaderMaterial;
  private trail: THREE.Mesh;
  private trailPos: Float32Array;
  private trailPts: THREE.Vector3[] = [];
  private trailAlpha: Float32Array;
  private hover = PLAYER.hover;
  private dashDir = new THREE.Vector3();
  private bob = 0;
  private sneakBlend = 0;
  private dashFlash = 0;
  private tmpM = new THREE.Matrix4();
  private tmpQ = new THREE.Quaternion();
  private tmpS = new THREE.Vector3();
  private tmpP = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    // 中心核
    this.core = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 24, 16),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(3.6, 1.9, 0.8) }),
    );
    this.group.add(this.core);

    // 殻（ファセットがきらめく多面体）
    this.shellMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: sharedTime,
        uColor: { value: new THREE.Color(COLORS.player) },
        uHot: { value: new THREE.Color(COLORS.playerHot) },
        uPower: { value: 1 },
        uDissolve: { value: 0 },
      },
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform float uDissolve;
        varying vec3 vN;
        varying vec3 vV;
        varying vec3 vP;
        ${GLSL_UTIL}
        void main() {
          vec3 p = position;
          float n = vnoise(p.xy * 3.0 + uTime * 0.8) * 0.06;
          p += normal * n;
          p += normal * uDissolve * (0.6 + h12(floor(p.xz * 8.0)) * 1.5);
          vP = position;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          vV = -mv.xyz;
          vN = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uColor;
        uniform vec3 uHot;
        uniform float uPower;
        uniform float uDissolve;
        varying vec3 vN;
        varying vec3 vV;
        varying vec3 vP;
        ${GLSL_UTIL}
        void main() {
          vec3 n = normalize(vN);
          float f = pow(1.0 - clamp(abs(dot(n, normalize(vV))), 0.0, 1.0), 2.0);
          float facet = h12(floor(vP.xy * 7.0 + vP.z * 3.0));
          float spark = step(0.9, fract(facet * 17.0 + uTime * 0.7));
          float cut = step(uDissolve, h12(floor(vP.xy * 12.0) + floor(vP.z * 12.0)));
          if (cut < 0.5) discard;
          vec3 col = mix(uColor * 0.5, uHot, f) * (0.45 + f * 1.5 + spark * 1.1) * uPower;
          gl_FragColor = vec4(col, 0.55 + f * 0.45);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const shellGeo = new THREE.IcosahedronGeometry(0.4, 1);
    this.shell = new THREE.Mesh(shellGeo, this.shellMat);
    this.group.add(this.shell);
    this.wire = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(0.46, 0)),
      new THREE.LineBasicMaterial({ color: new THREE.Color(2.4, 1.2, 0.5), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.group.add(this.wire);

    // 回転するリング
    for (let i = 0; i < 2; i++) {
      const r = new THREE.Mesh(
        new THREE.TorusGeometry(0.62 + i * 0.1, 0.014, 6, 64),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 1.6, 0.6), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      r.rotation.x = Math.PI / 2 + (i ? 0.5 : -0.3);
      this.rings.push(r);
      this.group.add(r);
    }

    // 周回するビット
    this.bits = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.06, 0.06, 0.06),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 2.2, 1) }),
      8,
    );
    this.bits.frustumCulled = false;
    this.group.add(this.bits);

    this.light = new THREE.PointLight(COLORS.player, 9, 8, 1.6);
    this.light.position.y = 0.1;
    this.group.add(this.light);

    // 床の照り返し
    const glowMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(COLORS.player) }, uA: { value: 1 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 uColor; uniform float uA; varying vec2 vUv; void main(){ float r = length(vUv-0.5)*2.0; float a = pow(max(0.0,1.0-r),2.2)*0.55*uA; gl_FragColor = vec4(uColor*1.5, a); }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    this.glow = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 3.2), glowMat);
    this.glow.rotation.x = -Math.PI / 2;
    this.glow.layers.set(1);
    scene.add(this.glow);

    // 壁の向こうでも見えるシルエット
    this.xray = new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 20, 12),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(1.0, 0.45, 0.15),
        transparent: true,
        opacity: 0.35,
        depthFunc: THREE.GreaterDepth,
        depthWrite: false,
      }),
    );
    this.xray.renderOrder = 999;
    this.xray.layers.set(1);
    this.group.add(this.xray);

    // 軌跡（リボン）
    this.trailPos = new Float32Array(TRAIL_N * 2 * 3);
    this.trailAlpha = new Float32Array(TRAIL_N * 2);
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3).setUsage(THREE.DynamicDrawUsage));
    tg.setAttribute('alpha', new THREE.BufferAttribute(this.trailAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    const tidx: number[] = [];
    for (let i = 0; i < TRAIL_N - 1; i++) {
      const a = i * 2;
      tidx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    tg.setIndex(tidx);
    const tm = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(3.0, 1.3, 0.45) } },
      vertexShader: `attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * viewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 uColor; varying float vA; void main(){ gl_FragColor = vec4(uColor * vA, vA); }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.trail = new THREE.Mesh(tg, tm);
    this.trail.frustumCulled = false;
    this.trail.layers.set(1);
    scene.add(this.trail);

    scene.add(this.group);
  }

  stance(): 'walk' | 'sneak' | 'dash' | 'idle' {
    if (this.dashing) return 'dash';
    if (this.moveAmount < 0.1) return 'idle';
    return this.sneaking ? 'sneak' : 'walk';
  }

  /** 位置をリセット（チェックポイント復帰） */
  place(x: number, z: number, facing: number): void {
    this.pos.set(x, 0, z);
    this.vel.set(0, 0, 0);
    this.facing = facing;
    this.dashing = false;
    this.dashTimer = 0;
    this.dashCooldown = 0;
    this.trailPts.length = 0;
    this.lift = 0;
    this.group.position.set(x, this.hover, z);
  }

  /** 入力に基づく移動。戻り値はダッシュを開始したか */
  move(dt: number, input: THREE.Vector2, sneak: boolean, dashPressed: boolean, grid: Grid): boolean {
    let dashStarted = false;
    this.sneaking = sneak;
    this.dashCooldown = Math.max(0, this.dashCooldown - dt);
    const len = Math.min(1, input.length());
    if (dashPressed && this.dashCooldown <= 0 && !this.dashing) {
      if (len > 0.1) this.dashDir.set(input.x, 0, input.y).normalize();
      else this.dashDir.set(Math.cos(this.facing), 0, Math.sin(this.facing));
      this.dashing = true;
      this.dashTimer = PLAYER.dashTime;
      this.dashCooldown = PLAYER.dashCooldown;
      this.dashFlash = 1;
      dashStarted = true;
    }
    if (this.dashing) {
      this.dashTimer -= dt;
      this.vel.copy(this.dashDir).multiplyScalar(PLAYER.dashSpeed);
      if (this.dashTimer <= 0) {
        this.dashing = false;
        this.vel.multiplyScalar(0.35);
      }
    } else {
      const speed = sneak ? PLAYER.sneak : PLAYER.walk;
      const tx = input.x * speed;
      const tz = input.y * speed;
      const k = 1 - Math.exp(-PLAYER.accel * dt / Math.max(speed, 1));
      this.vel.x += (tx - this.vel.x) * k;
      this.vel.z += (tz - this.vel.z) * k;
    }
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    grid.resolveCircle(this.pos, this.radius);
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this.moveAmount = Math.min(1, sp / PLAYER.walk);
    if (sp > 0.3) {
      const target = Math.atan2(this.vel.z, this.vel.x);
      let d = target - this.facing;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.facing += d * Math.min(1, dt * 12);
    }
    const tx = wt(this.pos.x);
    const tz = wt(this.pos.z);
    this.inNoise = grid.isNoise(tx, tz);
    this.hiddenInNoise = this.inNoise && this.sneaking && !this.dashing;
    return dashStarted;
  }

  update(dt: number, time: number, cameraPos: THREE.Vector3): void {
    this.sneakBlend += ((this.sneaking ? 1 : 0) - this.sneakBlend) * Math.min(1, dt * 8);
    this.dashFlash = Math.max(0, this.dashFlash - dt * 4);
    const targetHover = THREE.MathUtils.lerp(PLAYER.hover, PLAYER.sneakHover, this.sneakBlend);
    this.hover += (targetHover - this.hover) * Math.min(1, dt * 6);
    this.bob += dt * (2.2 + this.moveAmount * 4);
    const y = this.hover + Math.sin(this.bob) * 0.05 + this.lift;
    this.group.position.set(this.pos.x, y, this.pos.z);

    const m = this.materialize;
    const hideF = this.hiddenInNoise ? 1 : 0;
    const scale = (1 - this.sneakBlend * 0.28) * (0.2 + 0.8 * Math.min(1, m * 1.3));
    this.shell.scale.setScalar(scale);
    this.core.scale.setScalar(scale * (1 + this.dashFlash * 0.6));
    this.wire.scale.setScalar(scale);
    this.shell.rotation.y += dt * (0.8 + this.moveAmount * 2);
    this.shell.rotation.x += dt * 0.4;
    this.wire.rotation.y -= dt * 0.6;
    this.wire.rotation.z += dt * 0.3;
    this.rings[0].rotation.z += dt * 1.6;
    this.rings[1].rotation.z -= dt * 2.3;
    this.rings[0].rotation.y = Math.sin(time * 0.7) * 0.4;
    this.rings.forEach((r) => {
      r.scale.setScalar(scale);
      (r.material as THREE.MeshBasicMaterial).opacity = (0.9 - this.sneakBlend * 0.5) * m;
    });
    const flicker = hideF ? 0.55 + 0.45 * (Math.sin(time * 37) > 0.3 ? 1 : 0.3) : 1;
    this.shellMat.uniforms.uPower.value = (1 - this.sneakBlend * 0.45 + this.dashFlash * 1.2) * flicker;
    this.shellMat.uniforms.uDissolve.value = 1 - m;
    (this.core.material as THREE.MeshBasicMaterial).color.setRGB(3.6 * flicker * m, 1.9 * flicker * m, 0.8 * flicker * m);
    (this.wire.material as THREE.LineBasicMaterial).opacity = 0.8 * m * flicker;
    this.light.intensity = (6 - this.sneakBlend * 3 + this.dashFlash * 8) * m;
    (this.glow.material as THREE.ShaderMaterial).uniforms.uA.value = (1 - this.sneakBlend * 0.4) * m;
    this.glow.position.set(this.pos.x, 0.03, this.pos.z);
    (this.xray.material as THREE.MeshBasicMaterial).opacity = 0.35 * m;
    this.xray.scale.setScalar(scale);

    // ビット
    for (let i = 0; i < 8; i++) {
      const a = time * (1.4 + (i % 3) * 0.5) + (i / 8) * Math.PI * 2;
      const r = (0.75 + 0.12 * Math.sin(time * 2 + i)) * scale;
      this.tmpP.set(Math.cos(a) * r, Math.sin(a * 1.3 + i) * 0.25, Math.sin(a) * r);
      this.tmpQ.setFromEuler(new THREE.Euler(a, a * 0.7, 0));
      this.tmpS.setScalar(m * (0.7 + 0.3 * Math.sin(time * 5 + i)));
      this.tmpM.compose(this.tmpP, this.tmpQ, this.tmpS);
      this.bits.setMatrixAt(i, this.tmpM);
    }
    this.bits.instanceMatrix.needsUpdate = true;

    this.updateTrail(cameraPos, y);
  }

  private updateTrail(cameraPos: THREE.Vector3, y: number): void {
    const head = new THREE.Vector3(this.pos.x, y, this.pos.z);
    const last = this.trailPts[0];
    if (!last || last.distanceToSquared(head) > 0.004) {
      this.trailPts.unshift(head);
      if (this.trailPts.length > TRAIL_N) this.trailPts.pop();
    } else {
      last.copy(head);
    }
    const n = this.trailPts.length;
    const side = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const toCam = new THREE.Vector3();
    const width = (this.dashing ? 0.5 : 0.22) * (1 - this.sneakBlend * 0.5) * this.materialize;
    for (let i = 0; i < TRAIL_N; i++) {
      const p = this.trailPts[Math.min(i, n - 1)] ?? head;
      const q = this.trailPts[Math.min(i + 1, n - 1)] ?? p;
      dir.subVectors(p, q);
      if (dir.lengthSq() < 1e-8) dir.set(1, 0, 0);
      dir.normalize();
      toCam.subVectors(cameraPos, p).normalize();
      side.crossVectors(dir, toCam).normalize();
      const t = i / (TRAIL_N - 1);
      const w = width * (1 - t);
      const k = i * 6;
      this.trailPos[k] = p.x + side.x * w;
      this.trailPos[k + 1] = p.y + side.y * w;
      this.trailPos[k + 2] = p.z + side.z * w;
      this.trailPos[k + 3] = p.x - side.x * w;
      this.trailPos[k + 4] = p.y - side.y * w;
      this.trailPos[k + 5] = p.z - side.z * w;
      const a = i < n ? Math.pow(1 - t, 1.6) * 0.8 : 0;
      this.trailAlpha[i * 2] = a;
      this.trailAlpha[i * 2 + 1] = a;
    }
    const g = this.trail.geometry;
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.alpha as THREE.BufferAttribute).needsUpdate = true;
  }

  setVisible(v: boolean): void {
    this.group.visible = v;
    this.trail.visible = v;
    this.glow.visible = v;
  }
}
