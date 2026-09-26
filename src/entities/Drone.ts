import * as THREE from 'three';
import { DETECT, COLORS } from '../config';
import { tw } from '../level/Grid';
import type { DroneDef } from '../level/data';
import type { Sensor, WorldCtx } from '../types';
import { createBeamMaterial, createSpotDecalMaterial } from '../render/materials';
import { stateColor } from './VisionCone';

const FLY_H = 4.3;

/** 監査ドローン：床に落ちる光の円で検知する */
export class Drone implements Sensor {
  readonly id: string;
  readonly nameKey: string;
  readonly kind = 'drone' as const;
  readonly sector: number;
  suspicion = 0;
  seeing = false;
  exposure = 0;
  readonly root = new THREE.Group();
  readonly pos = new THREE.Vector3();

  private def: DroneDef;
  private pts: { x: number; z: number }[];
  private speed: number;
  readonly radius: number;
  private wp = 1;
  private dir = 1;
  private sinceSeen = 99;
  private hold = 0;
  private vel = new THREE.Vector3();
  private rotors: THREE.Mesh[] = [];
  private beam: THREE.Mesh;
  private beamMat: THREE.ShaderMaterial;
  private decal: THREE.Mesh;
  private decalMat: THREE.ShaderMaterial;
  private eyeMat: THREE.MeshBasicMaterial;
  private navL: THREE.MeshBasicMaterial;
  private navR: THREE.MeshBasicMaterial;
  private tmpColor = new THREE.Color();
  private bank = new THREE.Vector2();

  constructor(def: DroneDef, scene: THREE.Scene) {
    this.def = def;
    this.id = def.id;
    this.nameKey = `sensor.${def.id}`;
    this.sector = def.sector;
    this.speed = def.speed ?? 3;
    this.radius = def.radius ?? 2.3;
    this.pts = def.path.map((p) => ({ x: tw(p.x), z: tw(p.y) }));

    const shell = new THREE.MeshStandardMaterial({ color: 0xd5dde8, metalness: 0.35, roughness: 0.3 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x171e2c, metalness: 0.8, roughness: 0.3 });
    this.eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(COLORS.calm).multiplyScalar(5) });
    this.navL = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.3, 0.3) });
    this.navR = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 4, 0.8) });

    const body = new THREE.Mesh(new THREE.SphereGeometry(0.42, 24, 12), shell);
    body.scale.set(1, 0.42, 1);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.04, 8, 32), dark);
    ring.rotation.x = Math.PI / 2;
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), this.eyeMat);
    eye.position.y = -0.1;
    this.root.add(body, ring, eye);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.05, 0.08), dark);
      arm.position.set(Math.cos(a) * 0.55, 0.02, Math.sin(a) * 0.55);
      arm.rotation.y = -a;
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.1, 10), dark);
      hub.position.set(Math.cos(a) * 0.86, 0.06, Math.sin(a) * 0.86);
      const rotor = new THREE.Mesh(
        new THREE.CircleGeometry(0.3, 24),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 0.9, 1.2), transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }),
      );
      rotor.rotation.x = -Math.PI / 2;
      rotor.position.set(Math.cos(a) * 0.86, 0.13, Math.sin(a) * 0.86);
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.01, 0.05), dark);
      blade.position.copy(rotor.position);
      this.rotors.push(blade);
      const nav = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), i < 2 ? this.navL : this.navR);
      nav.position.set(Math.cos(a) * 0.86, -0.02, Math.sin(a) * 0.86);
      this.root.add(arm, hub, rotor, blade, nav);
    }
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.material !== this.eyeMat) m.castShadow = true;
    });
    scene.add(this.root);

    // 下向きの光
    this.beamMat = createBeamMaterial(0x9fe8ff, 0.3);
    const beamGeo = new THREE.ConeGeometry(1, 1, 36, 1, true);
    beamGeo.translate(0, -0.5, 0);
    this.beam = new THREE.Mesh(beamGeo, this.beamMat);
    this.beam.layers.set(1);
    this.beam.renderOrder = 6;
    scene.add(this.beam);

    this.decalMat = createSpotDecalMaterial();
    this.decal = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.decalMat);
    this.decal.rotation.x = -Math.PI / 2;
    this.decal.layers.set(1);
    this.decal.renderOrder = 4;
    scene.add(this.decal);
    this.reset();
  }

  reset(): void {
    this.pos.set(this.pts[0].x, FLY_H, this.pts[0].z);
    this.wp = 1 % this.pts.length;
    this.dir = 1;
    this.suspicion = 0;
    this.seeing = false;
    this.exposure = 0;
    this.sinceSeen = 99;
    this.hold = 0;
    this.vel.set(0, 0, 0);
  }

  markerPos(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.pos.x, this.pos.y + 0.9, this.pos.z);
  }

  investigating(): boolean {
    return this.hold > 0;
  }

  update(dt: number, ctx: WorldCtx): void {
    const pl = ctx.player;
    // --- 知覚：光の円の中にいるか
    let seen = false;
    let dist = 99;
    if (!pl.untargetable) {
      dist = Math.hypot(pl.pos.x - this.pos.x, pl.pos.z - this.pos.z);
      if (dist < this.radius + pl.radius * 0.4 && !pl.hiddenInNoise) seen = true;
    }
    this.seeing = seen;
    if (seen) {
      this.sinceSeen = 0;
      this.exposure += dt;
      this.hold = 1.8;
      this.suspicion = Math.min(1, this.suspicion + dt / DETECT.droneTime);
      if (this.suspicion >= 1) {
        ctx.detect({
          sensorId: this.id,
          sensorKey: this.nameKey,
          kind: 'drone',
          exposure: this.exposure,
          distance: dist,
          stance: pl.stance(),
          lured: false,
          pos: { x: pl.pos.x, z: pl.pos.z },
        });
        return;
      }
    } else {
      this.sinceSeen += dt;
      if (this.sinceSeen > DETECT.decayDelay * 0.6) {
        this.suspicion = Math.max(0, this.suspicion - DETECT.decay * 1.5 * dt);
        if (this.suspicion === 0) this.exposure = 0;
      }
      this.hold = Math.max(0, this.hold - dt);
    }

    // --- 移動
    const target = new THREE.Vector3();
    if (seen) {
      target.set(pl.pos.x, FLY_H, pl.pos.z);
    } else if (this.hold > 0) {
      target.copy(this.pos);
    } else {
      const p = this.pts[this.wp];
      target.set(p.x, FLY_H, p.z);
      const d = Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
      if (d < 0.2) this.advance();
    }
    const dx = target.x - this.pos.x;
    const dz = target.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    const sp = seen ? 1.4 : this.hold > 0 ? 0 : this.speed;
    const want = new THREE.Vector3();
    if (d > 0.01) want.set((dx / d) * Math.min(sp, d * 3), 0, (dz / d) * Math.min(sp, d * 3));
    this.vel.lerp(want, Math.min(1, dt * 2.5));
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    const t = ctx.time;
    const y = FLY_H + Math.sin(t * 1.7 + this.pos.x * 0.3) * 0.12;
    this.root.position.set(this.pos.x, y, this.pos.z);
    this.bank.x += (this.vel.z * 0.08 - this.bank.x) * Math.min(1, dt * 3);
    this.bank.y += (-this.vel.x * 0.08 - this.bank.y) * Math.min(1, dt * 3);
    this.root.rotation.set(this.bank.x, t * 0.3, this.bank.y);
    for (const r of this.rotors) r.rotation.y += dt * 38;

    // --- 見た目
    const level = this.hold > 0 ? Math.max(this.suspicion, 0.3) : this.suspicion;
    stateColor(level, this.tmpColor);
    this.eyeMat.color.copy(this.tmpColor).multiplyScalar(5);
    const blink = Math.sin(t * 6 + this.pos.z) > 0.6 ? 1 : 0.15;
    this.navL.color.setRGB(4 * blink, 0.3 * blink, 0.3 * blink);
    this.navR.color.setRGB(0.3 * blink, 4 * blink, 0.8 * blink);
    (this.beamMat.uniforms.uColor.value as THREE.Color).copy(this.tmpColor).lerp(new THREE.Color(0xbff0ff), 1 - level);
    (this.decalMat.uniforms.uColor.value as THREE.Color).copy(this.tmpColor).lerp(new THREE.Color(0x9fe8ff), 1 - Math.min(1, level * 1.5));
    this.decalMat.uniforms.uLevel.value = this.suspicion;
    this.beam.position.set(this.pos.x, y - 0.12, this.pos.z);
    this.beam.scale.set(this.radius, y - 0.12, this.radius);
    this.decal.position.set(this.pos.x, 0.05, this.pos.z);
    this.decal.scale.set(this.radius * 2, this.radius * 2, 1);
  }

  private advance(): void {
    const n = this.pts.length;
    if (this.def.loop) {
      this.wp = (this.wp + 1) % n;
    } else {
      if (this.wp + this.dir >= n || this.wp + this.dir < 0) this.dir *= -1;
      this.wp += this.dir;
    }
  }
}
