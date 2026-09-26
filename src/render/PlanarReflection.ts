import * as THREE from 'three';

/**
 * y = 0 の平面の鏡面反射を描くためのレンダーターゲット。
 * three の Reflector と同じ斜め近クリップ面の計算を使い、床は MeshStandardMaterial のまま
 * onBeforeCompile で反射テクスチャを合成する（影やライトを床で受けたいので）。
 */
export class PlanarReflection {
  readonly target: THREE.WebGLRenderTarget;
  readonly textureMatrix = new THREE.Matrix4();
  readonly camera = new THREE.PerspectiveCamera();
  private readonly plane = new THREE.Plane();
  private readonly normal = new THREE.Vector3(0, 1, 0);
  private readonly planePos = new THREE.Vector3(0, 0, 0);
  private readonly clip = new THREE.Vector4();
  private readonly q = new THREE.Vector4();
  private readonly view = new THREE.Vector3();
  private readonly lookAt = new THREE.Vector3();
  private readonly target3 = new THREE.Vector3();
  private readonly rot = new THREE.Matrix4();
  private readonly camPos = new THREE.Vector3();
  scale = 0.5;

  constructor(width: number, height: number) {
    this.target = new THREE.WebGLRenderTarget(Math.max(1, width * this.scale), Math.max(1, height * this.scale), {
      type: THREE.HalfFloatType,
      samples: 0,
    });
    this.target.texture.generateMipmaps = false;
    // 反射には床の装飾やコーンなどを描かない（レイヤー 1 は反射から除外）
    this.camera.layers.enable(0);
    this.camera.layers.disable(1);
  }

  setSize(width: number, height: number): void {
    this.target.setSize(Math.max(1, Math.floor(width * this.scale)), Math.max(1, Math.floor(height * this.scale)));
  }

  update(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, hide: THREE.Object3D[]): void {
    const rc = this.camera;
    this.camPos.setFromMatrixPosition(camera.matrixWorld);
    this.view.subVectors(this.planePos, this.camPos);
    if (this.view.dot(this.normal) > 0) return;
    this.view.reflect(this.normal).negate();
    this.view.add(this.planePos);

    this.rot.extractRotation(camera.matrixWorld);
    this.lookAt.set(0, 0, -1).applyMatrix4(this.rot).add(this.camPos);
    this.target3.subVectors(this.planePos, this.lookAt);
    this.target3.reflect(this.normal).negate();
    this.target3.add(this.planePos);

    rc.position.copy(this.view);
    rc.up.set(0, 1, 0).applyMatrix4(this.rot).reflect(this.normal);
    rc.lookAt(this.target3);
    rc.near = camera.near;
    rc.far = camera.far;
    rc.fov = camera.fov;
    rc.aspect = camera.aspect;
    rc.updateMatrixWorld();
    rc.projectionMatrix.copy(camera.projectionMatrix);

    this.textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.textureMatrix.multiply(rc.projectionMatrix);
    this.textureMatrix.multiply(rc.matrixWorldInverse);

    this.plane.setFromNormalAndCoplanarPoint(this.normal, this.planePos);
    this.plane.applyMatrix4(rc.matrixWorldInverse);
    this.clip.set(this.plane.normal.x, this.plane.normal.y, this.plane.normal.z, this.plane.constant);
    const pm = rc.projectionMatrix;
    const q = this.q;
    q.x = (Math.sign(this.clip.x) + pm.elements[8]) / pm.elements[0];
    q.y = (Math.sign(this.clip.y) + pm.elements[9]) / pm.elements[5];
    q.z = -1.0;
    q.w = (1.0 + pm.elements[10]) / pm.elements[14];
    this.clip.multiplyScalar(2.0 / this.clip.dot(q));
    pm.elements[2] = this.clip.x;
    pm.elements[6] = this.clip.y;
    pm.elements[10] = this.clip.z + 1.0 - 0.003;
    pm.elements[14] = this.clip.w;
    rc.projectionMatrixInverse.copy(pm).invert();

    const prevTarget = renderer.getRenderTarget();
    const prevShadow = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    const vis = hide.map((o) => o.visible);
    hide.forEach((o) => (o.visible = false));
    renderer.setRenderTarget(this.target);
    renderer.state.buffers.depth.setMask(true);
    renderer.clear();
    renderer.render(scene, rc);
    hide.forEach((o, i) => (o.visible = vis[i]));
    renderer.setRenderTarget(prevTarget);
    renderer.shadowMap.autoUpdate = prevShadow;
  }
}
