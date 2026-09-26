import * as THREE from 'three';
import { sharedTime } from '../render/materials';

export interface RouteRecord {
  time: number;
  agent: number;
  /** x,z の組 */
  path: number[];
}

/** 過去に区画を突破したエージェントの軌跡を床に描く */
export class RouteGuide {
  readonly group = new THREE.Group();
  private mat: THREE.ShaderMaterial;

  constructor(scene: THREE.Scene) {
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: sharedTime, uColor: { value: new THREE.Color(1.0, 0.62, 0.3) } },
      vertexShader: /* glsl */ `
        attribute float dist;
        attribute float side;
        varying float vDist;
        varying float vSide;
        void main() {
          vDist = dist;
          vSide = side;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uColor;
        varying float vDist;
        varying float vSide;
        void main() {
          float dash = fract(vDist * 0.7 - uTime * 0.9);
          float chevron = smoothstep(0.0, 0.08, dash) * (1.0 - smoothstep(0.35, 0.5, dash));
          float edge = 1.0 - smoothstep(0.6, 1.0, abs(vSide));
          float a = (0.08 + chevron * 0.32) * edge;
          gl_FragColor = vec4(uColor * (1.0 + chevron * 1.5), a);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.group.layers.set(1);
    scene.add(this.group);
  }

  set(routes: Record<string, RouteRecord>): void {
    for (const c of [...this.group.children]) {
      (c as THREE.Mesh).geometry.dispose();
      c.removeFromParent();
    }
    for (const r of Object.values(routes)) {
      const pts = this.simplify(r.path);
      if (pts.length < 2) continue;
      const pos: number[] = [];
      const dist: number[] = [];
      const side: number[] = [];
      const idx: number[] = [];
      let acc = 0;
      const w = 0.16;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const a = pts[Math.max(0, i - 1)];
        const b = pts[Math.min(pts.length - 1, i + 1)];
        let dx = b.x - a.x;
        let dz = b.y - a.y;
        const l = Math.hypot(dx, dz) || 1;
        dx /= l;
        dz /= l;
        if (i > 0) acc += Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y);
        pos.push(p.x - dz * w, 0.05, p.y + dx * w, p.x + dz * w, 0.05, p.y - dx * w);
        dist.push(acc, acc);
        side.push(-1, 1);
        if (i < pts.length - 1) {
          const k = i * 2;
          idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('dist', new THREE.Float32BufferAttribute(dist, 1));
      g.setAttribute('side', new THREE.Float32BufferAttribute(side, 1));
      g.setIndex(idx);
      const m = new THREE.Mesh(g, this.mat);
      m.layers.set(1);
      m.renderOrder = 3;
      m.frustumCulled = false;
      this.group.add(m);
    }
  }

  private simplify(path: number[]): THREE.Vector2[] {
    const out: THREE.Vector2[] = [];
    for (let i = 0; i + 1 < path.length; i += 2) {
      const p = new THREE.Vector2(path[i], path[i + 1]);
      const last = out[out.length - 1];
      if (!last || last.distanceTo(p) > 0.9) out.push(p);
    }
    return out;
  }

  setVisible(v: boolean): void {
    this.group.visible = v;
  }

  update(time: number): void {
    void time;
  }
}
