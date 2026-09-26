import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { PlanarReflection } from './PlanarReflection';

const FinalShader = {
  name: 'CyberFinal',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uCA: { value: 0.0035 },
    uGlitch: { value: 0 },
    uAlert: { value: 0 },
    uTension: { value: 0 },
    uFade: { value: 0 },
    uWhite: { value: 0 },
    uGrain: { value: 0.035 },
    uScan: { value: 0.06 },
    uHidden: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform vec2 uResolution;
    uniform float uCA;
    uniform float uGlitch;
    uniform float uAlert;
    uniform float uTension;
    uniform float uFade;
    uniform float uWhite;
    uniform float uGrain;
    uniform float uScan;
    uniform float uHidden;
    varying vec2 vUv;

    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    void main() {
      vec2 uv = vUv;
      float g = clamp(uGlitch, 0.0, 1.0);
      if (g > 0.001) {
        float t = floor(uTime * 20.0);
        float band = floor(uv.y * 32.0);
        float r = hash12(vec2(band, t));
        float on = step(1.0 - g * 0.6, r);
        uv.x += on * (hash12(vec2(t, band + 3.1)) - 0.5) * 0.14 * g;
        float big = step(0.93, hash12(vec2(t * 0.37, 11.0)));
        uv.y += big * (hash12(vec2(t, 7.7)) - 0.5) * 0.04 * g;
        uv = clamp(uv, vec2(0.0), vec2(1.0));
      }
      vec2 c = uv - 0.5;
      float r2 = dot(c, c);
      float ca = uCA * (0.35 + r2 * 2.5) + g * 0.018 + uHidden * 0.002;
      vec3 col;
      col.r = texture2D(tDiffuse, clamp(uv + c * ca, 0.0, 1.0)).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, clamp(uv - c * ca, 0.0, 1.0)).b;

      // 走査線（ごく薄く）
      float line = 0.5 + 0.5 * sin((uv.y * uResolution.y) * 1.5708 + uTime * 2.0);
      col *= 1.0 - uScan * line * (0.6 + g);

      // 緊張感でわずかに彩度を落とす
      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, vec3(lum), uTension * 0.18);

      // ビネット
      float vig = smoothstep(0.95, 0.15, r2 * (1.25 + uTension * 0.5));
      col *= mix(1.0, vig, 0.6);

      // 警戒の赤い縁取り
      float edge = smoothstep(0.08, 0.5, r2);
      float pulse = 0.65 + 0.35 * sin(uTime * 9.0);
      col += vec3(1.0, 0.06, 0.16) * uAlert * edge * pulse * 0.55;
      col += vec3(1.0, 0.75, 0.2) * clamp(uTension - uAlert, 0.0, 1.0) * edge * 0.08;

      // 隠れているときの紫のにじみ
      col += vec3(0.35, 0.2, 0.7) * uHidden * edge * 0.12;

      // グリッチ時の色ずれブロック
      if (g > 0.001) {
        float blk = step(1.0 - g * 0.25, hash12(floor(uv * vec2(18.0, 40.0)) + floor(uTime * 15.0)));
        col = mix(col, col.gbr * vec3(1.4, 0.6, 1.2), blk);
      }

      col += (hash12(uv * uResolution + fract(uTime) * 91.7) - 0.5) * uGrain;
      col = mix(col, vec3(0.0), clamp(uFade, 0.0, 1.0));
      col = mix(col, vec3(1.0), clamp(uWhite, 0.0, 1.0));
      gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
    }
  `,
};

export interface Quality {
  pixelRatio: number;
  bloom: boolean;
  reflection: boolean;
  msaa: number;
}

export class Pipeline {
  readonly renderer: THREE.WebGLRenderer;
  readonly composer: EffectComposer;
  readonly renderPass: RenderPass;
  readonly bloom: UnrealBloomPass;
  readonly output: OutputPass;
  readonly final: ShaderPass;
  readonly reflection: PlanarReflection;
  quality: Quality;
  private width = 1;
  private height = 1;
  private frame = 0;

  constructor(container: HTMLElement, scene: THREE.Scene, camera: THREE.PerspectiveCamera, quality: Quality) {
    this.quality = quality;
    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality.pixelRatio));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.className = 'game-canvas';
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    this.width = container.clientWidth || window.innerWidth;
    this.height = container.clientHeight || window.innerHeight;
    renderer.setSize(this.width, this.height, false);
    const pr = renderer.getPixelRatio();

    const rt = new THREE.WebGLRenderTarget(this.width * pr, this.height * pr, {
      type: THREE.HalfFloatType,
      samples: quality.msaa,
    });
    this.composer = new EffectComposer(renderer, rt);
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(this.width, this.height), 0.72, 0.5, 0.88);
    this.bloom.enabled = quality.bloom;
    this.composer.addPass(this.bloom);
    this.output = new OutputPass();
    this.composer.addPass(this.output);
    this.final = new ShaderPass(FinalShader);
    this.composer.addPass(this.final);

    this.reflection = new PlanarReflection(this.width * pr, this.height * pr);
    this.setSize(this.width, this.height);
  }

  get uniforms(): typeof FinalShader.uniforms {
    return this.final.uniforms as unknown as typeof FinalShader.uniforms;
  }

  setQuality(q: Quality): void {
    this.quality = q;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.pixelRatio));
    this.bloom.enabled = q.bloom;
    this.setSize(this.width, this.height);
  }

  setSize(w: number, h: number): void {
    this.width = w;
    this.height = h;
    // CSS 側で 100% 表示にしているので style は触らない
    this.renderer.setSize(w, h, false);
    const pr = this.renderer.getPixelRatio();
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w, h);
    this.reflection.setSize(w * pr, h * pr);
    this.uniforms.uResolution.value.set(w * pr, h * pr);
  }

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera, time: number, reflectHide: THREE.Object3D[]): void {
    this.uniforms.uTime.value = time;
    this.frame++;
    // 影のマップが一度作られてから反射を描く（最初のフレームで未作成のシャドウマップを参照しないように）
    if (this.quality.reflection && this.frame > 2) {
      this.reflection.update(this.renderer, scene, camera, reflectHide);
    }
    this.composer.render();
  }
}
