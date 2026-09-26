import * as THREE from 'three';
import { COLORS } from '../config';
import { sharedTime, createSkyMaterial, GLSL_UTIL } from '../render/materials';
import { mulberry32 } from './LevelBuilder';

export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/**
 * 背景（空・虚空の格子・遠景の巨大構造物・漂う粒子・箱庭の境界）とライト
 */
export class Environment {
  readonly group = new THREE.Group();
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  private sky: THREE.Mesh;
  private rings: THREE.Mesh[] = [];
  private particles: THREE.Points;
  private boundaryMat: THREE.ShaderMaterial;
  readonly breach = new THREE.Vector3();
  private rain: THREE.LineSegments;

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer, bounds: Bounds, exitPos: THREE.Vector3) {
    scene.background = new THREE.Color(COLORS.bg);
    scene.fog = new THREE.FogExp2(COLORS.fog, 0.0085);

    // --- 環境マップ（暗い部屋にシアンとマゼンタの発光パネル）
    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color(0x02040a);
    const room = new THREE.Mesh(new THREE.BoxGeometry(20, 10, 20), new THREE.MeshBasicMaterial({ color: 0x050a16, side: THREE.BackSide }));
    envScene.add(room);
    const panel = (w: number, h: number, color: THREE.Color, x: number, y: number, z: number, ry: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
      m.position.set(x, y, z);
      m.rotation.y = ry;
      envScene.add(m);
    };
    panel(14, 0.5, new THREE.Color(0.4, 2.2, 3.0), 0, 3.5, -9.9, 0);
    panel(14, 0.5, new THREE.Color(0.4, 2.2, 3.0), 0, 3.5, 9.9, Math.PI);
    panel(0.4, 6, new THREE.Color(2.4, 0.6, 1.6), -9.9, 0, 0, Math.PI / 2);
    panel(0.4, 6, new THREE.Color(0.6, 1.6, 2.4), 9.9, 0, 0, -Math.PI / 2);
    const topPanel = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 0.8, 1.2) }));
    topPanel.position.y = 4.9;
    topPanel.rotation.x = Math.PI / 2;
    envScene.add(topPanel);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envRT = pmrem.fromScene(envScene, 0.04);
    scene.environment = envRT.texture;
    scene.environmentIntensity = 0.7;
    pmrem.dispose();

    // --- ライト
    this.hemi = new THREE.HemisphereLight(0x3a5a8c, 0x05070c, 0.9);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xbfd8ff, 1.5);
    this.sun.position.set(18, 40, 26);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -30;
    sc.right = 30;
    sc.top = 30;
    sc.bottom = -30;
    sc.near = 1;
    sc.far = 120;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.radius = 3;
    this.sun.shadow.intensity = 0.85;
    scene.add(this.sun);
    scene.add(this.sun.target);

    // --- 空
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(500, 48, 24), createSkyMaterial());
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1000;
    this.group.add(this.sky);

    const cx = (bounds.minX + bounds.maxX) / 2;
    const cz = (bounds.minZ + bounds.maxZ) / 2;

    // --- 虚空の底の格子
    const abyssMat = new THREE.ShaderMaterial({
      uniforms: { uTime: sharedTime },
      vertexShader: /* glsl */ `
        varying vec3 vW;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vW = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        varying vec3 vW;
        ${GLSL_UTIL}
        void main() {
          vec2 p = vW.xz / 8.0;
          vec2 f = abs(fract(p) - 0.5);
          float w = fwidth(p.x) + 1e-4;
          float g = 1.0 - smoothstep(0.0, w * 1.5, 0.5 - max(f.x, f.y));
          vec2 id = floor(p);
          float pulse = pow(fract(h12(id) * 7.0 + uTime * 0.05), 60.0);
          vec2 cc = abs(fract(p) - 0.5);
          float cell = (1.0 - smoothstep(0.1, 0.45, max(cc.x, cc.y))) * pulse;
          float dist = length(vW.xz - vec2(${cx.toFixed(1)}, ${cz.toFixed(1)}));
          float fade = 1.0 - smoothstep(40.0, 340.0, dist);
          vec3 col = vec3(0.04, 0.24, 0.45) * g * 0.55 + vec3(0.2, 0.6, 1.0) * cell * 0.25;
          gl_FragColor = vec4(col * fade, 1.0);
        }
      `,
      fog: false,
    });
    const abyss = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), abyssMat);
    abyss.rotation.x = -Math.PI / 2;
    abyss.position.set(cx, -36, cz);
    this.group.add(abyss);

    // --- 遠景の巨大リング
    const ringDefs = [
      { r: 140, tube: 1.1, pos: [cx - 60, 30, bounds.minZ - 160], rot: [0.3, 0.2, 0.1], col: [0.4, 2.2, 3.2] },
      { r: 95, tube: 0.7, pos: [cx + 160, -10, cz + 20], rot: [1.2, 0.4, 0.3], col: [2.4, 0.9, 2.6] },
      { r: 210, tube: 1.6, pos: [cx - 40, -60, cz + 40], rot: [Math.PI / 2 - 0.08, 0, 0.05], col: [0.2, 1.1, 1.8] },
      { r: 60, tube: 0.5, pos: [cx - 170, 40, cz - 50], rot: [0.2, 1.1, 0.7], col: [3.0, 1.6, 0.6] },
    ];
    for (const d of ringDefs) {
      const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(d.col[0], d.col[1], d.col[2]), fog: true });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(d.r, d.tube, 8, 220), mat);
      ring.position.set(d.pos[0], d.pos[1], d.pos[2]);
      ring.rotation.set(d.rot[0], d.rot[1], d.rot[2]);
      ring.userData.spin = (Math.random() - 0.5) * 0.02;
      this.rings.push(ring);
      this.group.add(ring);
      // 周囲を回る小さな光点
      const dots = new THREE.Mesh(
        new THREE.TorusGeometry(d.r * 1.04, d.tube * 0.35, 4, 90),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(d.col[0] * 0.5, d.col[1] * 0.5, d.col[2] * 0.5), wireframe: true, fog: true }),
      );
      ring.add(dots);
    }

    // --- 遠景のデータタワー
    const rnd = mulberry32(99);
    const towerGeo = new THREE.BoxGeometry(1, 1, 1);
    towerGeo.translate(0, 0.5, 0);
    const towerMat = new THREE.ShaderMaterial({
      uniforms: { uTime: sharedTime, fogColor: { value: new THREE.Color(COLORS.fog) }, fogDensity: { value: 0.0085 } },
      vertexShader: /* glsl */ `
        varying vec3 vW;
        varying vec3 vL;
        varying float vId;
        varying float vFogDepth;
        void main() {
          vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vW = wp.xyz;
          vL = position;
          vId = float(gl_InstanceID);
          vec4 mv = viewMatrix * wp;
          vFogDepth = -mv.z;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 fogColor;
        uniform float fogDensity;
        varying vec3 vW;
        varying vec3 vL;
        varying float vId;
        varying float vFogDepth;
        ${GLSL_UTIL}
        void main() {
          vec2 w = vec2((vL.x + vL.z) * 6.0, vW.y * 0.8);
          vec2 ci = floor(w);
          vec2 cf = fract(w);
          float win = step(0.2, cf.x) * step(cf.x, 0.8) * step(0.25, cf.y) * step(cf.y, 0.75);
          float on = step(0.72, h12(ci + vId * 13.0 + floor(uTime * 0.3 + h11(vId) * 10.0) * step(0.9, h12(ci))));
          vec3 wc = mix(vec3(0.2, 0.7, 1.0), vec3(1.0, 0.6, 0.3), step(0.85, h12(ci * 3.0 + vId)));
          float top = smoothstep(0.985, 1.0, vL.y);
          vec3 col = vec3(0.01, 0.02, 0.04) + wc * win * on * 1.6 + vec3(0.3, 0.9, 1.4) * top * 2.0;
          float fogF = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth * 0.55);
          gl_FragColor = vec4(mix(col, fogColor, clamp(fogF, 0.0, 1.0)), 1.0);
        }
      `,
    });
    const towerCount = 70;
    const towers = new THREE.InstancedMesh(towerGeo, towerMat, towerCount);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < towerCount; i++) {
      const a = rnd() * Math.PI * 2;
      const dist = 170 + rnd() * 170;
      const w = 6 + rnd() * 16;
      const h = 30 + rnd() * rnd() * 170;
      m4.makeScale(w, h, w * (0.6 + rnd() * 0.8));
      m4.setPosition(cx + Math.cos(a) * dist, -60 + rnd() * 20, cz + Math.sin(a) * dist * 1.1);
      towers.setMatrixAt(i, m4);
    }
    this.group.add(towers);

    // --- 漂う光の粒子（カメラ周辺を無限に巡回）
    const count = 1300;
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = rnd() * 80;
      pos[i * 3 + 1] = rnd() * 40;
      pos[i * 3 + 2] = rnd() * 80;
      seed[i] = rnd();
    }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    pg.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    const pm = new THREE.ShaderMaterial({
      uniforms: { uTime: sharedTime, uCenter: { value: new THREE.Vector3() }, uScale: { value: 1 } },
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uCenter;
        uniform float uScale;
        attribute float seed;
        varying float vA;
        varying float vS;
        void main() {
          vec3 box = vec3(80.0, 40.0, 80.0);
          vec3 p = position;
          p.y += uTime * (0.3 + seed * 0.8);
          p.x += sin(uTime * 0.2 + seed * 30.0) * 2.0;
          vec3 origin = uCenter - box * 0.5;
          p = mod(p - origin, box) + origin;
          p.y -= 14.0;
          vec4 mv = viewMatrix * vec4(p, 1.0);
          float d = -mv.z;
          gl_PointSize = uScale * (1.0 + seed * 2.2) * 55.0 / max(d, 1.0);
          vA = (0.35 + 0.65 * sin(uTime * (1.0 + seed * 3.0) + seed * 50.0) * 0.5 + 0.5) * smoothstep(120.0, 40.0, d);
          vS = seed;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vA;
        varying float vS;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float r = length(c);
          float a = smoothstep(0.5, 0.0, r);
          vec3 col = mix(vec3(0.3, 0.8, 1.0), vec3(1.0, 0.7, 0.4), step(0.92, vS));
          gl_FragColor = vec4(col * 1.5, a * vA * 0.7);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.particles = new THREE.Points(pg, pm);
    this.particles.frustumCulled = false;
    this.group.add(this.particles);

    // --- 虚空に降るビットの雨（縦の線）
    const rainCount = 500;
    const rp = new Float32Array(rainCount * 6);
    const rs = new Float32Array(rainCount * 2);
    for (let i = 0; i < rainCount; i++) {
      let x = 0;
      let z = 0;
      // レベルの外側だけ
      for (let k = 0; k < 20; k++) {
        x = bounds.minX - 40 + rnd() * (bounds.maxX - bounds.minX + 80);
        z = bounds.minZ - 40 + rnd() * (bounds.maxZ - bounds.minZ + 80);
        if (x < bounds.minX - 4 || x > bounds.maxX + 4 || rnd() < 0.15) break;
      }
      const len = 1.5 + rnd() * 5;
      rp.set([x, 0, z, x, -len, z], i * 6);
      const sd = rnd();
      rs[i * 2] = sd;
      rs[i * 2 + 1] = sd;
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(rp, 3));
    rg.setAttribute('seed', new THREE.BufferAttribute(rs, 1));
    const rm = new THREE.ShaderMaterial({
      uniforms: { uTime: sharedTime },
      vertexShader: /* glsl */ `
        uniform float uTime;
        attribute float seed;
        varying float vA;
        void main() {
          vec3 p = position;
          float cyc = 70.0;
          float off = mod(uTime * (6.0 + seed * 10.0) + seed * cyc, cyc);
          p.y += 30.0 - off;
          vA = smoothstep(-36.0, -20.0, p.y) * (1.0 - smoothstep(10.0, 30.0, p.y));
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vA;
        void main() {
          gl_FragColor = vec4(vec3(0.2, 0.75, 1.0) * 1.2, vA * 0.45);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.rain = new THREE.LineSegments(rg, rm);
    this.rain.frustumCulled = false;
    this.group.add(this.rain);

    // --- 箱庭の境界（巨大な格子の壁）
    this.boundaryMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: sharedTime,
        uCam: { value: new THREE.Vector3() },
        uBreach: { value: new THREE.Vector3() },
        uBreachR: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vW;
        varying vec3 vN;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vW = wp.xyz;
          vN = normal;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uCam;
        uniform vec3 uBreach;
        uniform float uBreachR;
        varying vec3 vW;
        varying vec3 vN;
        void main() {
          vec2 uv = abs(vN.x) > 0.5 ? vW.zy : vW.xy;
          vec2 g = uv / 4.0;
          vec2 f = abs(fract(g) - 0.5);
          vec2 w = fwidth(g) + 1e-4;
          float grid = max(1.0 - smoothstep(0.0, w.x * 1.5, 0.5 - f.x), 1.0 - smoothstep(0.0, w.y * 1.5, 0.5 - f.y));
          float wave = pow(max(0.0, sin(uv.y * 0.12 - uTime * 0.7 + uv.x * 0.015)), 24.0);
          float dist = length(vW - uCam);
          float near = smoothstep(6.0, 40.0, dist);
          float far = 1.0 - smoothstep(150.0, 320.0, dist);
          float hgt = smoothstep(-30.0, -2.0, vW.y) * (1.0 - smoothstep(10.0, 55.0, vW.y));
          float bd = length(vW - uBreach);
          float hole = uBreachR > 0.0 ? smoothstep(uBreachR * 0.75, uBreachR, bd) : 1.0;
          float rim = uBreachR > 0.0 ? (1.0 - smoothstep(0.0, 1.2, abs(bd - uBreachR))) * 2.5 : 0.0;
          float a = ((grid * 0.2 + wave * 0.25 + 0.01) * hole + rim) * near * far * hgt;
          vec3 c = mix(vec3(0.12, 0.55, 1.0), vec3(0.7, 0.95, 1.0), wave + rim * 0.5);
          gl_FragColor = vec4(c * (1.0 + rim), clamp(a, 0.0, 1.0));
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const pad = 16;
    const bx0 = bounds.minX - pad;
    const bx1 = bounds.maxX + pad;
    const bz0 = bounds.minZ - 10;
    const bz1 = bounds.maxZ + pad;
    const y0 = -34;
    const y1 = 60;
    const wall = (w: number, h: number, x: number, z: number, ry: number) => {
      const g = new THREE.PlaneGeometry(w, h);
      const m = new THREE.Mesh(g, this.boundaryMat);
      m.position.set(x, (y0 + y1) / 2, z);
      m.rotation.y = ry;
      m.renderOrder = 10;
      this.group.add(m);
      return m;
    };
    wall(bx1 - bx0, y1 - y0, (bx0 + bx1) / 2, bz0, 0);
    wall(bx1 - bx0, y1 - y0, (bx0 + bx1) / 2, bz1, Math.PI);
    wall(bz1 - bz0, y1 - y0, bx0, (bz0 + bz1) / 2, Math.PI / 2);
    wall(bz1 - bz0, y1 - y0, bx1, (bz0 + bz1) / 2, -Math.PI / 2);
    this.breach.set(exitPos.x, 2.5, bz0);
    this.boundaryMat.uniforms.uBreach.value.copy(this.breach);

    scene.add(this.group);
  }

  setBreach(radius: number): void {
    this.boundaryMat.uniforms.uBreachR.value = radius;
  }

  update(dt: number, camera: THREE.Camera, focus: THREE.Vector3): void {
    this.sky.position.copy(camera.position);
    for (const r of this.rings) r.rotation.z += r.userData.spin * dt;
    (this.particles.material as THREE.ShaderMaterial).uniforms.uCenter.value.copy(focus);
    this.boundaryMat.uniforms.uCam.value.copy(camera.position);
    // 影のカメラをプレイヤー周辺に追従（テクセル単位にスナップしてちらつきを防ぐ）
    const texel = 60 / 2048;
    const fx = Math.round(focus.x / texel) * texel;
    const fz = Math.round(focus.z / texel) * texel;
    this.sun.target.position.set(fx, 0, fz);
    this.sun.position.set(fx + 18, 40, fz + 26);
    this.sun.target.updateMatrixWorld();
  }
}
