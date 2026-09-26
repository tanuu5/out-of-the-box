import * as THREE from 'three';
import { DETECT, PILLAR_H, WALL_H, COLORS } from '../config';
import { tw } from '../level/Grid';
import type { CamDef } from '../level/data';
import type { Sensor, WorldCtx } from '../types';
import { VisionCone, stateColor } from './VisionCone';
import { createBeamMaterial } from '../render/materials';

const DEG = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);

function angleDiff(a: number, b: number): number {
  const d = b - a;
  return Math.atan2(Math.sin(d), Math.cos(d));
}

/** 監視カメラ（首振り / 回転） */
export class SecurityCam implements Sensor {
  readonly id: string;
  readonly nameKey: string;
  readonly kind = 'camera' as const;
  readonly sector: number;
  suspicion = 0;
  seeing = false;
  exposure = 0;
  readonly def: CamDef;
  readonly cone: VisionCone;
  readonly root = new THREE.Group();
  angle = 0;
  disabled = false;

  private x: number;
  private z: number;
  private height: number;
  private range: number;
  private half: number;
  private sweepT = 0;
  private sinceSeen = 99;
  private tracking = false;
  private holdT = 0;
  private blend = 1;
  private head = new THREE.Group();
  private lensMat: THREE.MeshBasicMaterial;
  private ledMat: THREE.MeshBasicMaterial;
  private beam: THREE.Mesh;
  private beamMat: THREE.ShaderMaterial;
  private tmpColor = new THREE.Color();
  private v0 = new THREE.Vector3();
  private v1 = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  private v3 = new THREE.Vector3();
  private v4 = new THREE.Vector3();
  private m4 = new THREE.Matrix4();

  constructor(def: CamDef, scene: THREE.Scene) {
    this.def = def;
    this.id = def.id;
    this.nameKey = `sensor.${def.id}`;
    this.sector = def.sector;
    this.x = tw(def.x);
    this.z = tw(def.y);
    this.range = def.range ?? 10;
    this.half = ((def.fov ?? 46) / 2) * DEG;
    this.height = def.mount === 'pillar' ? PILLAR_H + 0.35 : WALL_H - 0.35;

    const dark = new THREE.MeshStandardMaterial({ color: 0x1b2436, metalness: 0.7, roughness: 0.35 });
    const light = new THREE.MeshStandardMaterial({ color: 0xc9d3e0, metalness: 0.3, roughness: 0.4 });
    this.lensMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(COLORS.calm).multiplyScalar(4) });
    this.ledMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.4, 0.5) });

    // 台座
    if (def.mount === 'pillar') {
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.25, 16), dark);
      base.position.y = PILLAR_H + 0.12;
      this.root.add(base);
    } else {
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.4, 0.4), dark);
      const back = def.yaw * DEG + Math.PI;
      plate.position.set(Math.cos(back) * 0.05, this.height + 0.1, Math.sin(back) * 0.05);
      plate.rotation.y = -back;
      this.root.add(plate);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.06, 0.06), dark);
      arm.position.set(Math.cos(back) * -0.15, this.height + 0.12, Math.sin(back) * -0.15);
      arm.rotation.y = -back;
      this.root.add(arm);
    }
    // 首（ヨー回転する部分）
    this.head.position.y = this.height;
    const housing = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.34, 6, 14), light);
    housing.rotation.z = Math.PI / 2;
    housing.position.x = 0.12;
    const hood = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.34), dark);
    hood.position.set(0.14, 0.17, 0);
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.08, 20), this.lensMat);
    lens.rotation.z = Math.PI / 2;
    lens.position.x = 0.42;
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), this.ledMat);
    led.position.set(0.05, 0.1, 0.12);
    this.head.add(housing, hood, lens, led);
    this.head.traverse((o) => ((o as THREE.Mesh).isMesh ? (o.castShadow = true) : null));
    this.root.add(this.head);
    this.root.position.set(this.x, 0, this.z);

    // 光の円錐
    this.beamMat = createBeamMaterial(COLORS.calm, 0.22);
    const beamGeo = new THREE.ConeGeometry(1, 1, 32, 1, true);
    beamGeo.translate(0, -0.5, 0);
    beamGeo.rotateZ(Math.PI / 2);
    this.beam = new THREE.Mesh(beamGeo, this.beamMat);
    this.beam.layers.set(1);
    this.beam.renderOrder = 6;
    scene.add(this.beam);

    scene.add(this.root);
    this.cone = new VisionCone(56);
    scene.add(this.cone.mesh);
    this.reset();
  }

  reset(): void {
    this.suspicion = 0;
    this.seeing = false;
    this.exposure = 0;
    this.sweepT = 0;
    this.tracking = false;
    this.holdT = 0;
    this.blend = 1;
    this.sinceSeen = 99;
    this.angle = this.sweepAngle();
  }

  private sweepAngle(): number {
    const d = this.def;
    if (d.mode === 'rotate') return d.yaw * DEG + (this.sweepT / d.period) * Math.PI * 2;
    return d.yaw * DEG + Math.sin((this.sweepT / d.period) * Math.PI * 2) * d.sweep * DEG;
  }

  /** センサーの原点（壁の中に埋まらないよう少し前に出す） */
  private origin(): { x: number; z: number } {
    if (this.def.mount === 'pillar') return { x: this.x, z: this.z };
    const a = this.def.yaw * DEG;
    return { x: this.x + Math.cos(a) * 0.35, z: this.z + Math.sin(a) * 0.35 };
  }

  markerPos(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.x, this.height + 0.7, this.z);
  }

  investigating(): boolean {
    return this.tracking;
  }

  update(dt: number, ctx: WorldCtx): void {
    this.disabled = ctx.isDisabled(this.id);
    const o = this.origin();
    if (this.disabled) {
      this.seeing = false;
      this.suspicion = Math.max(0, this.suspicion - dt * 2);
      this.tracking = false;
      this.cone.mesh.visible = false;
      this.beam.visible = false;
      this.lensMat.color.setRGB(0.05, 0.05, 0.08);
      this.ledMat.color.setRGB(0.1, 0.1, 0.1);
      // 首が垂れる
      this.head.rotation.z += (-0.5 - this.head.rotation.z) * Math.min(1, dt * 3);
      return;
    }
    this.head.rotation.z += (0 - this.head.rotation.z) * Math.min(1, dt * 3);
    this.cone.mesh.visible = true;
    this.beam.visible = true;

    const pl = ctx.player;
    let seen = false;
    let dist = 99;
    if (!pl.untargetable) {
      const dx = pl.pos.x - o.x;
      const dz = pl.pos.z - o.z;
      dist = Math.hypot(dx, dz);
      if (dist <= this.range + pl.radius && !(pl.hiddenInNoise && dist > DETECT.noiseHideDist)) {
        const a = Math.atan2(dz, dx);
        const margin = Math.atan2(pl.radius * 0.7, Math.max(dist, 0.1));
        if (Math.abs(angleDiff(this.angle, a)) <= this.half + margin) {
          seen = ctx.grid.lineOfSight(o.x, o.z, pl.pos.x, pl.pos.z, pl.sneaking, this.def.mount === 'pillar');
        }
      }
    }
    this.seeing = seen;
    if (seen) {
      this.sinceSeen = 0;
      this.exposure += dt;
      this.tracking = true;
      this.holdT = 1.6;
      const t = (DETECT.camNear + DETECT.camFar * Math.min(1, dist / this.range)) / (pl.sneaking ? 0.75 : 1);
      this.suspicion = Math.min(1, this.suspicion + dt / t);
      if (this.suspicion >= 1) {
        ctx.detect({
          sensorId: this.id,
          sensorKey: this.nameKey,
          kind: 'camera',
          exposure: this.exposure,
          distance: dist,
          stance: pl.stance(),
          lured: false,
          rotating: this.def.mode === 'rotate',
          pos: { x: pl.pos.x, z: pl.pos.z },
        });
        return;
      }
      const a = Math.atan2(pl.pos.z - o.z, pl.pos.x - o.x);
      const d = angleDiff(this.angle, a);
      this.angle += Math.sign(d) * Math.min(Math.abs(d), dt * 1.5);
    } else {
      this.sinceSeen += dt;
      if (this.sinceSeen > DETECT.decayDelay) {
        this.suspicion = Math.max(0, this.suspicion - DETECT.decay * dt);
        if (this.suspicion === 0) this.exposure = 0;
      }
      if (this.tracking) {
        this.holdT -= dt;
        if (this.holdT <= 0) {
          this.tracking = false;
          this.blend = 0;
        }
      } else {
        this.sweepT += dt;
        const target = this.sweepAngle();
        if (this.blend < 1) {
          this.blend = Math.min(1, this.blend + dt * 0.8);
          const d = angleDiff(this.angle, target);
          this.angle += d * Math.min(1, dt * 2.5);
          if (Math.abs(d) < 0.02) this.blend = 1;
        } else {
          this.angle = target;
        }
      }
    }

    // 見た目
    this.head.rotation.y = -this.angle;
    const level = this.tracking ? Math.max(this.suspicion, 0.3) : this.suspicion;
    stateColor(level, this.tmpColor);
    this.lensMat.color.copy(this.tmpColor).multiplyScalar(5);
    const blink = Math.sin(ctx.time * (4 + level * 12)) > 0 ? 1 : 0.1;
    this.ledMat.color.setRGB(4 * blink, 0.4 * blink, 0.5 * blink);
    this.cone.update(ctx.grid, o.x, o.z, this.angle, this.half, this.range, this.def.mount === 'pillar');
    this.cone.setLevel(level);
    (this.beamMat.uniforms.uColor.value as THREE.Color).copy(this.tmpColor);

    // 光の円錐をレンズから床の中央へ
    const reach = this.range * 0.62;
    const tx = o.x + Math.cos(this.angle) * reach;
    const tz = o.z + Math.sin(this.angle) * reach;
    const lensX = this.x + Math.cos(this.angle) * 0.42;
    const lensZ = this.z + Math.sin(this.angle) * 0.42;
    const from = this.v0.set(lensX, this.height, lensZ);
    const to = this.v1.set(tx, 0.05, tz);
    const len = from.distanceTo(to);
    const dir = this.v2.subVectors(to, from).normalize();
    const zA = this.v3.crossVectors(dir, UP).normalize();
    const yA = this.v4.crossVectors(zA, dir).normalize();
    this.m4.makeBasis(dir, yA, zA);
    this.beam.position.copy(from);
    this.beam.quaternion.setFromRotationMatrix(this.m4);
    this.beam.scale.set(len, Math.tan(this.half) * len * 0.3, Math.tan(this.half) * len * 0.95);
  }
}
