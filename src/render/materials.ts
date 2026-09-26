import * as THREE from 'three';
import { WALL_H, RACK_H, LOW_H, PILLAR_H } from '../config';
import type { PlanarReflection } from './PlanarReflection';

/** 全マテリアルで共有する時間 */
export const sharedTime = { value: 0 };

/** 壁の手前抜き（カメラとプレイヤーの間の壁をディザで透かす） */
export const cutaway = {
  uCamPos: { value: new THREE.Vector3() },
  uFocus: { value: new THREE.Vector3() },
  uCut: { value: 0 },
};

const CUTAWAY_GLSL = /* glsl */ `
  {
    vec3 seg = uFocus - uCamPos;
    float L = length(seg);
    vec3 dir = seg / max(L, 1e-4);
    vec3 rel = vWPos - uCamPos;
    float t = dot(rel, dir);
    if (uCut > 0.001 && t > 0.0 && t < L - 0.6) {
      float r = length(rel - dir * t);
      float rad = mix(1.0, 3.4, clamp(t / max(L, 1e-4), 0.0, 1.0));
      float fade = (1.0 - smoothstep(rad * 0.45, rad, r)) * uCut;
      fade *= smoothstep(0.05, 0.5, vWPos.y);
      float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
      if (fade * 0.92 > ign) discard;
    }
  }
`;

export const GLSL_UTIL = /* glsl */ `
  float h11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
  float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float vnoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(h12(i), h12(i + vec2(1.0, 0.0)), u.x), mix(h12(i + vec2(0.0, 1.0)), h12(i + vec2(1.0, 1.0)), u.x), u.y);
  }
`;

function injectWorldVaryings(shader: THREE.WebGLProgramParametersWithUniforms, cut = false): void {
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      `#include <common>
      varying vec3 vWPos;
      varying vec3 vWNrm;`,
    )
    .replace(
      '#include <worldpos_vertex>',
      `#include <worldpos_vertex>
      {
        vec4 wp4 = vec4(transformed, 1.0);
        vec3 wn = objectNormal;
        #ifdef USE_INSTANCING
          wp4 = instanceMatrix * wp4;
          wn = mat3(instanceMatrix) * wn;
        #endif
        wp4 = modelMatrix * wp4;
        vWPos = wp4.xyz;
        vWNrm = normalize(mat3(modelMatrix) * wn);
      }`,
    );
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <common>',
    `#include <common>
    varying vec3 vWPos;
    varying vec3 vWNrm;
    uniform float uTime;
    uniform vec3 uCamPos;
    uniform vec3 uFocus;
    uniform float uCut;
    ${GLSL_UTIL}`,
  );
  shader.uniforms.uTime = sharedTime;
  shader.uniforms.uCamPos = cutaway.uCamPos;
  shader.uniforms.uFocus = cutaway.uFocus;
  shader.uniforms.uCut = cutaway.uCut;
  if (cut) {
    shader.fragmentShader = shader.fragmentShader.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${CUTAWAY_GLSL}`);
  }
}

// ---------------------------------------------------------------------------
// 床

export function createFloorMaterial(refl: PlanarReflection): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: 0x0b1222,
    roughness: 0.38,
    metalness: 0.4,
    envMapIntensity: 0.35,
  });
  const uniforms = {
    tReflect: { value: refl.target.texture },
    uReflMatrix: { value: refl.textureMatrix },
    uReflStrength: { value: 0.6 },
  };
  mat.userData.uniforms = uniforms;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    injectWorldVaryings(shader);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform mat4 uReflMatrix;
        varying vec4 vReflUv;`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vReflUv = uReflMatrix * (modelMatrix * vec4(transformed, 1.0));`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform sampler2D tReflect;
        uniform float uReflStrength;
        varying vec4 vReflUv;
        float gSeam; float gTile;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec2 tp = vWPos.xz * 0.5;
          gTile = h12(floor(tp));
          diffuseColor.rgb *= 0.8 + 0.4 * gTile;
        }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          vec2 tp = vWPos.xz * 0.5;
          vec2 f = fract(tp);
          vec2 de = min(f, 1.0 - f);
          float e = min(de.x, de.y);
          float aa = fwidth(e) + 1e-4;
          gSeam = 1.0 - smoothstep(0.0, 0.018 + aa, e);
          vec2 f2 = fract(tp * 4.0);
          vec2 d2 = min(f2, 1.0 - f2);
          float e2 = min(d2.x, d2.y);
          float aa2 = fwidth(e2) + 1e-4;
          float sub = 1.0 - smoothstep(0.0, 0.02 + aa2, e2);
          // 格子に沿って流れるデータパルス
          float rowId = floor(tp.y + 0.5);
          float colId = floor(tp.x + 0.5);
          float onRow = 1.0 - smoothstep(0.0, 0.03 + aa, abs(fract(tp.y + 0.5) - 0.5) * 2.0 - 0.94);
          float px = fract(tp.x * 0.06 - uTime * (0.18 + 0.2 * h11(rowId)) + h11(rowId * 7.1));
          float pz = fract(tp.y * 0.06 - uTime * (0.16 + 0.2 * h11(colId + 3.3)) + h11(colId * 3.7));
          float pulse = pow(px, 30.0) * step(0.62, h11(rowId + 11.0));
          float pulseZ = pow(pz, 30.0) * step(0.62, h11(colId + 19.0));
          vec2 fr = abs(fract(tp) - 0.5);
          float nearRow = 1.0 - smoothstep(0.46, 0.5, 0.5 - fr.y);
          float nearCol = 1.0 - smoothstep(0.46, 0.5, 0.5 - fr.x);
          vec3 gcol = vec3(0.1, 0.62, 1.0);
          totalEmissiveRadiance += gcol * (gSeam * 0.22 + sub * 0.02 * (1.0 - gSeam));
          totalEmissiveRadiance += vec3(0.3, 0.85, 1.0) * gSeam * (pulse * nearRow + pulseZ * nearCol) * 1.1;
          // タイルの一部にうっすら回路パターン
          float circ = step(0.86, gTile) * (1.0 - smoothstep(0.0, 0.04, abs(fract(tp.x * 2.0 + tp.y * 2.0) - 0.5) - 0.44));
          totalEmissiveRadiance += gcol * circ * 0.035;
        }`,
      )
      .replace(
        '#include <opaque_fragment>',
        `{
          vec2 ruv = vReflUv.xy / max(vReflUv.w, 1e-4);
          vec2 texel = 1.0 / vec2(textureSize(tReflect, 0));
          float wob = vnoise(vWPos.xz * 1.7 + uTime * 0.05) - 0.5;
          ruv += vec2(wob) * 0.004;
          vec3 refl = texture2D(tReflect, ruv).rgb * 0.3;
          refl += texture2D(tReflect, ruv + vec2(texel.x * 2.0, 0.0)).rgb * 0.15;
          refl += texture2D(tReflect, ruv - vec2(texel.x * 2.0, 0.0)).rgb * 0.15;
          refl += texture2D(tReflect, ruv + vec2(0.0, texel.y * 2.5)).rgb * 0.15;
          refl += texture2D(tReflect, ruv - vec2(0.0, texel.y * 2.5)).rgb * 0.15;
          refl += texture2D(tReflect, ruv + texel * 4.0).rgb * 0.05;
          refl += texture2D(tReflect, ruv - texel * 4.0).rgb * 0.05;
          vec3 vdir = normalize(vViewPosition);
          float ndv = clamp(dot(vdir, normal), 0.0, 1.0);
          float fres = pow(1.0 - ndv, 3.0);
          float rs = uReflStrength * mix(0.55, 1.0, fres) * (1.0 - gSeam * 0.6) * (0.85 + 0.3 * gTile);
          outgoingLight += min(refl, vec3(24.0)) * rs;
        }
        #include <opaque_fragment>`,
      );
  };
  mat.customProgramCacheKey = () => 'floor-v1';
  return mat;
}

// ---------------------------------------------------------------------------
// 壁（上端の発光ライン、パネル目地、データの流れ）

export function createWallMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: 0x101a2e,
    roughness: 0.42,
    metalness: 0.65,
    envMapIntensity: 0.9,
  });
  mat.onBeforeCompile = (shader) => {
    injectWorldVaryings(shader, true);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          float isTop = step(0.5, vWNrm.y);
          float along = abs(vWNrm.x) > 0.5 ? vWPos.z : vWPos.x;
          float pan = h12(vec2(floor(along * 0.5), floor(vWPos.y * 0.6)));
          diffuseColor.rgb *= mix(0.75 + 0.35 * pan, 0.55, isTop);
          // 虚空側の土台は下にいくほど暗く
          diffuseColor.rgb *= mix(0.25, 1.0, smoothstep(-4.0, 0.0, vWPos.y));
        }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          float isTop = step(0.5, vWNrm.y);
          float side = 1.0 - isTop;
          float y = vWPos.y;
          float along = abs(vWNrm.x) > 0.5 ? vWPos.z : vWPos.x;
          float aa = fwidth(y) + 1e-4;
          vec3 cyan = vec3(0.25, 0.85, 1.0);
          // 上端のネオン
          float topBand = smoothstep(${(WALL_H - 0.11).toFixed(3)} - aa, ${(WALL_H - 0.07).toFixed(3)}, y) * side;
          float band2 = (1.0 - smoothstep(0.0, 0.012 + aa, abs(y - ${(WALL_H - 0.32).toFixed(3)}))) * side;
          // 床との境目（反射に映る）
          float baseBand = (1.0 - smoothstep(0.0, 0.03 + aa, abs(y - 0.05))) * side;
          // 縦の目地
          float fa = fract(along * 0.5);
          float aaa = fwidth(along * 0.5) + 1e-4;
          float seam = (1.0 - smoothstep(0.0, 0.012 + aaa, min(fa, 1.0 - fa))) * side * step(0.0, y);
          // データの流れ（上へ昇る光）
          float colId = floor(along * 2.0);
          float r = h11(colId * 1.37 + floor(vWNrm.x * 2.0 + vWNrm.z * 3.0) * 17.0);
          float lane = 1.0 - smoothstep(0.0, 0.06 + fwidth(along * 2.0), abs(fract(along * 2.0) - 0.5));
          float dash = fract((y - uTime * (0.35 + r * 0.9)) * 0.35 + r * 9.0);
          float stream = smoothstep(0.0, 0.03, dash) * (1.0 - smoothstep(0.03, 0.22, dash));
          stream *= step(0.84, r) * lane * side * step(0.12, y) * step(y, ${(WALL_H - 0.35).toFixed(3)});
          // 天面：縁から少し内側に暗い溝、うっすら回路
          vec2 tf = abs(fract(vWPos.xz * 0.5) - 0.5);
          float topPattern = isTop * (1.0 - smoothstep(0.0, 0.02 + fwidth(vWPos.x), 0.5 - max(tf.x, tf.y))) * 0.08;
          // 虚空側の土台の縦ライン
          float under = (1.0 - smoothstep(-0.02, 0.0, y)) * side;
          float underLines = under * (1.0 - smoothstep(0.0, 0.02 + aaa, min(fa, 1.0 - fa))) * smoothstep(-5.0, -0.5, y) * 0.35;
          totalEmissiveRadiance += cyan * (topBand * 1.7 + band2 * 0.25 + baseBand * 0.8 + seam * 0.05 + stream * 1.3 + topPattern + underLines);
        }`,
      );
  };
  mat.customProgramCacheKey = () => 'wall-v2';
  return mat;
}

// ---------------------------------------------------------------------------
// サーバーラック

export function createRackMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: 0x0c111c,
    roughness: 0.5,
    metalness: 0.7,
    envMapIntensity: 0.8,
  });
  mat.onBeforeCompile = (shader) => {
    injectWorldVaryings(shader, true);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      {
        float isTop = step(0.5, vWNrm.y);
        float side = 1.0 - isTop;
        float y = vWPos.y;
        float along = abs(vWNrm.x) > 0.5 ? vWPos.z : vWPos.x;
        float face = floor(vWNrm.x * 2.0 + vWNrm.z * 3.0);
        // サーバーユニット（横の溝）
        float unitY = fract(y * 2.2);
        float slot = 1.0 - smoothstep(0.0, 0.04 + fwidth(y * 2.2), min(unitY, 1.0 - unitY));
        // LED
        vec2 cell = vec2(along * 7.0, y * 2.2);
        vec2 ci = floor(cell);
        vec2 cf = fract(cell);
        float led = step(0.35, cf.x) * step(cf.x, 0.62) * step(0.42, cf.y) * step(cf.y, 0.58);
        float rnd = h12(ci + face * 31.0);
        float present = step(0.52, h12(ci * 1.7 + 5.0 + face));
        float speed = 0.5 + rnd * 5.0;
        float blink = step(0.35, fract(rnd * 13.0 + uTime * speed * 0.3));
        vec3 lc = mix(vec3(0.2, 1.0, 0.55), vec3(0.25, 0.75, 1.0), step(0.45, h12(ci + 3.0)));
        lc = mix(lc, vec3(1.0, 0.55, 0.15), step(0.94, h12(ci + 9.0)));
        float inBody = step(0.25, y) * step(y, ${(RACK_H - 0.25).toFixed(3)});
        totalEmissiveRadiance += lc * led * present * blink * inBody * side * 2.6;
        totalEmissiveRadiance += vec3(0.05, 0.12, 0.2) * slot * side * inBody;
        float aa = fwidth(y) + 1e-4;
        float topBand = smoothstep(${(RACK_H - 0.06).toFixed(3)} - aa, ${(RACK_H - 0.03).toFixed(3)}, y) * side;
        float baseBand = (1.0 - smoothstep(0.0, 0.03 + aa, abs(y - 0.05))) * side;
        totalEmissiveRadiance += vec3(0.25, 0.85, 1.0) * (topBand * 1.6 + baseBand * 0.6);
        // 天面の排気口
        float vent = isTop * (1.0 - smoothstep(0.0, 0.1, abs(fract(along * 4.0) - 0.5) - 0.3)) * 0.05;
        totalEmissiveRadiance += vec3(0.2, 0.6, 1.0) * vent;
      }`,
    );
  };
  mat.customProgramCacheKey = () => 'rack-v2';
  return mat;
}

// ---------------------------------------------------------------------------
// 低い遮蔽物（データクレート）

export function createCrateMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: 0x151c2b,
    roughness: 0.35,
    metalness: 0.5,
    envMapIntensity: 0.9,
  });
  mat.onBeforeCompile = (shader) => {
    injectWorldVaryings(shader);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      {
        vec2 u = vUv;
        vec2 d = min(u, 1.0 - u);
        float e = min(d.x, d.y);
        float edge = 1.0 - smoothstep(0.0, 0.035 + fwidth(e), e);
        float inner = 1.0 - smoothstep(0.0, 0.01 + fwidth(e), abs(e - 0.12));
        float stripe = step(0.5, fract((u.x + u.y) * 6.0 + uTime * 0.2)) * step(0.14, e) * step(e, 0.2) * 0.3;
        totalEmissiveRadiance += vec3(0.45, 0.85, 1.0) * (edge * 1.5 + inner * 0.25 + stripe * 0.2);
      }`,
    );
  };
  mat.customProgramCacheKey = () => 'crate-v1';
  // vUv を有効にするためにダミーのマップ定義が必要
  mat.defines = { USE_UV: '' };
  return mat;
}

// ---------------------------------------------------------------------------
// 柱・タンク

export function createPillarMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: 0x111a2c,
    roughness: 0.3,
    metalness: 0.8,
    envMapIntensity: 1.0,
  });
  mat.onBeforeCompile = (shader) => {
    injectWorldVaryings(shader, true);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      {
        float y = vWPos.y;
        float aa = fwidth(y) + 1e-4;
        float ring = 0.0;
        ring += 1.0 - smoothstep(0.0, 0.03 + aa, abs(y - 0.12));
        ring += 1.0 - smoothstep(0.0, 0.03 + aa, abs(y - ${(PILLAR_H - 0.15).toFixed(3)}));
        ring += (1.0 - smoothstep(0.0, 0.015 + aa, abs(fract(y * 0.8 - uTime * 0.25) - 0.5))) * 0.25 * step(0.3, y) * step(y, ${(PILLAR_H - 0.3).toFixed(3)});
        float slit = step(0.5, vUv.x * 12.0 - floor(vUv.x * 12.0)) * 0.0;
        totalEmissiveRadiance += vec3(0.25, 0.85, 1.0) * (ring * 1.8 + slit);
      }`,
    );
  };
  mat.defines = { USE_UV: '' };
  mat.customProgramCacheKey = () => 'pillar-v2';
  return mat;
}

// ---------------------------------------------------------------------------
// ホログラム（半透明・加算）汎用

export function createHoloMaterial(color: THREE.ColorRepresentation, opts: { opacity?: number; scan?: number; fresnel?: number } = {}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: sharedTime,
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: opts.opacity ?? 0.6 },
      uScan: { value: opts.scan ?? 1 },
      uFresnel: { value: opts.fresnel ?? 1 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vV;
      varying vec3 vW;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        #ifdef USE_INSTANCING
          wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
        #endif
        vW = wp.xyz;
        vec4 mv = viewMatrix * wp;
        vV = -mv.xyz;
        vN = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uScan;
      uniform float uFresnel;
      varying vec3 vN;
      varying vec3 vV;
      varying vec3 vW;
      void main() {
        vec3 n = normalize(vN);
        vec3 v = normalize(vV);
        float f = pow(1.0 - clamp(abs(dot(n, v)), 0.0, 1.0), 2.0);
        float scan = 0.75 + 0.25 * sin(vW.y * 40.0 - uTime * 6.0);
        float a = uOpacity * mix(1.0, (0.25 + f * 1.4), uFresnel) * mix(1.0, scan, uScan);
        gl_FragColor = vec4(uColor * (0.6 + f * 1.6), clamp(a, 0.0, 1.0));
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

// ---------------------------------------------------------------------------
// ガラス

export function createGlassMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: sharedTime },
    vertexShader: /* glsl */ `
      varying vec3 vW;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vW = wp.xyz;
        vec4 mv = viewMatrix * wp;
        vV = -mv.xyz;
        vN = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec3 vW;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        float f = pow(1.0 - clamp(abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0), 2.5);
        float lines = 1.0 - smoothstep(0.0, 0.02 + fwidth(vW.y * 3.0), abs(fract(vW.y * 3.0) - 0.5) - 0.46);
        float sweep = pow(max(0.0, sin(vW.y * 0.8 + vW.z * 0.25 - uTime * 1.2)), 16.0);
        vec3 c = vec3(0.35, 0.8, 1.0);
        float a = 0.06 + f * 0.25 + lines * 0.05 + sweep * 0.12;
        gl_FragColor = vec4(c * (0.5 + sweep * 2.0 + f), a);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

// ---------------------------------------------------------------------------
// 視界コーン

export function createConeMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: sharedTime,
      uColor: { value: new THREE.Color(0x5ce1ff) },
      uOrigin: { value: new THREE.Vector2() },
      uDir: { value: new THREE.Vector2(1, 0) },
      uHalf: { value: 0.6 },
      uRange: { value: 10 },
      uAlpha: { value: 1 },
      uLevel: { value: 0 },
      uRound: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vXZ;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vXZ = wp.xz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColor;
      uniform vec2 uOrigin;
      uniform vec2 uDir;
      uniform float uHalf;
      uniform float uRange;
      uniform float uAlpha;
      uniform float uLevel;
      uniform float uRound;
      varying vec2 vXZ;
      void main() {
        vec2 d = vXZ - uOrigin;
        float dist = length(d);
        float t = clamp(dist / max(uRange, 1e-3), 0.0, 1.0);
        vec2 nd = d / max(dist, 1e-4);
        float ang = acos(clamp(dot(nd, uDir), -1.0, 1.0));
        float side = mix(smoothstep(uHalf + 0.001, uHalf - 0.06, ang), 1.0, uRound);
        float sideLine = mix((1.0 - smoothstep(0.0, 0.03, abs(ang - uHalf + 0.03))) * step(0.05, t), 0.0, uRound);
        float body = mix(0.44, 0.17, t);
        float rim = smoothstep(0.95, 0.985, t) * (1.0 - smoothstep(0.985, 1.0, t));
        float wave = pow(fract(t - uTime * (0.55 + uLevel * 1.4)), 10.0) * (1.0 - t);
        float fill = step(t, uLevel) * 0.25;
        float a = (body + rim * 1.2 + wave * 0.35 + sideLine * 0.55 + fill) * side * uAlpha;
        a *= smoothstep(0.0, 0.06, t);
        vec3 col = uColor * (1.3 + rim * 2.4 + wave * 0.8 + fill * 1.5 + sideLine * 0.8);
        gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
      }
    `,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}

// ---------------------------------------------------------------------------
// ノイズ領域（床）

export function createNoiseFloorMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: sharedTime, uPlayerIn: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vXZ;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vXZ = wp.xz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uPlayerIn;
      varying vec2 vXZ;
      ${GLSL_UTIL}
      void main() {
        vec2 tp = vXZ * 0.5;
        vec2 cell = floor(vXZ * 10.0);
        float tf = floor(uTime * 14.0);
        float n = h12(cell + tf * 1.37);
        float n2 = h12(floor(vXZ * 3.0) + floor(uTime * 5.0));
        vec2 f = fract(tp);
        vec2 de = min(f, 1.0 - f);
        float e = min(de.x, de.y);
        float border = 1.0 - smoothstep(0.0, 0.04 + fwidth(e), e);
        float scan = pow(max(0.0, sin(vXZ.y * 1.3 - uTime * 3.0)), 12.0);
        vec3 c = mix(vec3(0.35, 0.3, 0.55), vec3(0.6, 0.9, 1.0), step(0.93, n));
        float a = 0.16 + n * 0.22 + n2 * 0.08 + scan * 0.15 + border * 0.1 * 0.0;
        c *= 0.8 + uPlayerIn * 0.6;
        gl_FragColor = vec4(c * (0.6 + scan * 1.2), a);
      }
    `,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
}

/** ノイズ領域の上で明滅する小さなボクセル */
export function createNoiseVoxelMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: sharedTime },
    vertexShader: /* glsl */ `
      uniform float uTime;
      varying float vA;
      varying float vK;
      ${GLSL_UTIL}
      void main() {
        float id = float(gl_InstanceID);
        float r = h11(id * 1.731);
        float tf = floor(uTime * (6.0 + r * 10.0) + r * 50.0);
        float on = step(0.45, h11(id + tf * 0.37));
        float s = on * (0.4 + 0.6 * h11(id * 3.1 + tf));
        vec3 p = position * s;
        vec4 ip = instanceMatrix * vec4(p, 1.0);
        ip.y += (h11(id * 5.3 + tf) - 0.5) * 0.25;
        ip.x += (h11(id * 7.1 + tf) - 0.5) * 0.12;
        vA = on;
        vK = r;
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * ip;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vA;
      varying float vK;
      void main() {
        vec3 c = mix(vec3(0.55, 0.45, 0.95), vec3(0.5, 0.95, 1.0), step(0.7, vK));
        gl_FragColor = vec4(c * 1.6, 0.55 * vA);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

// ---------------------------------------------------------------------------
// レーザー

export function createLaserMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: sharedTime,
      uOn: { value: 1 },
      uWarn: { value: 0 },
      uColor: { value: new THREE.Color(0xff2d6f) },
      uLen: { value: 4 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uOn;
      uniform float uWarn;
      uniform vec3 uColor;
      uniform float uLen;
      varying vec2 vUv;
      ${GLSL_UTIL}
      void main() {
        float lines = 0.0;
        for (int i = 0; i < 6; i++) {
          float y = 0.12 + float(i) * 0.15;
          float d = abs(vUv.y - y);
          float core = 1.0 - smoothstep(0.0, 0.008, d);
          float glow = exp(-d * 45.0) * 0.8;
          lines += core * 3.2 + glow;
        }
        float flick = 0.85 + 0.15 * h11(floor(uTime * 40.0));
        float spark = pow(vnoise(vec2(vUv.x * uLen * 3.0 - uTime * 6.0, vUv.y * 40.0)), 6.0) * 2.0;
        float warn = uWarn * step(0.5, fract(uTime * 14.0)) * 0.5;
        float a = (lines * (0.9 + spark) * flick) * max(uOn, warn);
        float haze = 0.05 * max(uOn, warn);
        gl_FragColor = vec4(uColor * (a + haze * 2.0), clamp(a * 0.6 + haze, 0.0, 1.0));
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

// ---------------------------------------------------------------------------
// スキャン波

export function createScanMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: sharedTime,
      uColor: { value: new THREE.Color(0xa46bff) },
      uAlpha: { value: 1 },
    },
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
        // vUv.x: 0 = 後方, 1 = 先端
        float lead = pow(vUv.x, 6.0);
        float edge = smoothstep(0.96, 1.0, vUv.x) * 2.0;
        float grid = 1.0 - smoothstep(0.0, 0.03, abs(fract(vW.y * 2.0 - uTime * 1.5) - 0.5) - 0.45);
        float cols = 1.0 - smoothstep(0.0, 0.04, abs(fract(vW.z * 1.0) - 0.5) - 0.44);
        float n = vnoise(vec2(vW.z * 2.0, vW.y * 3.0 - uTime * 4.0));
        float fadeTop = 1.0 - smoothstep(0.6, 1.0, vUv.y);
        float a = (lead * (0.35 + grid * 0.3 + cols * 0.25 + n * 0.3) + edge) * fadeTop * uAlpha;
        gl_FragColor = vec4(uColor * (1.2 + edge * 2.5), clamp(a, 0.0, 1.0));
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

// ---------------------------------------------------------------------------
// 光の円錐（ドローンのスポットライト、カメラの光）

export function createBeamMaterial(color: THREE.ColorRepresentation, strength = 0.35): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: sharedTime,
      uColor: { value: new THREE.Color(color) },
      uStrength: { value: strength },
    },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vV;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vV = -mv.xyz;
        vN = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColor;
      uniform float uStrength;
      varying vec3 vN;
      varying vec3 vV;
      varying vec2 vUv;
      void main() {
        float f = abs(dot(normalize(vN), normalize(vV)));
        float soft = pow(f, 1.5);
        // vUv.y: 1 = 根元, 0 = 先端
        float along = smoothstep(0.0, 0.5, vUv.y) * (0.35 + 0.65 * vUv.y);
        float stripes = 0.85 + 0.15 * sin(vUv.y * 40.0 - uTime * 5.0);
        float a = soft * along * stripes * uStrength;
        gl_FragColor = vec4(uColor * a, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

/** 床に落ちる円形のスポット（ドローン） */
export function createSpotDecalMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: sharedTime,
      uColor: { value: new THREE.Color(0x9fe8ff) },
      uLevel: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColor;
      uniform float uLevel;
      varying vec2 vUv;
      void main() {
        vec2 c = vUv - 0.5;
        float r = length(c) * 2.0;
        float disk = 1.0 - smoothstep(0.9, 1.0, r);
        float ring = smoothstep(0.86, 0.95, r) * (1.0 - smoothstep(0.95, 1.0, r));
        float ang = atan(c.y, c.x + 1e-6);
        float ticks = step(0.5, fract(ang * 6.0 / 3.14159 + uTime * 0.5)) * smoothstep(0.75, 0.8, r) * (1.0 - smoothstep(0.83, 0.86, r));
        float pulse = pow(fract(r - uTime * 0.9), 8.0) * (1.0 - r);
        float fill = step(r, uLevel) * 0.25;
        float a = disk * 0.16 + ring * 1.0 + ticks * 0.5 + pulse * 0.3 + fill * disk;
        gl_FragColor = vec4(uColor * (1.0 + ring * 2.0), clamp(a, 0.0, 1.0));
      }
    `,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  });
}

// ---------------------------------------------------------------------------
// 床に描く円形の汎用リング（チェックポイント、端末、音の波紋）

export function createRingDecalMaterial(color: THREE.ColorRepresentation): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: sharedTime,
      uColor: { value: new THREE.Color(color) },
      uAlpha: { value: 1 },
      uProgress: { value: 0 },
      uActive: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColor;
      uniform float uAlpha;
      uniform float uProgress;
      uniform float uActive;
      varying vec2 vUv;
      void main() {
        vec2 c = vUv - 0.5;
        float r = length(c) * 2.0;
        float ang = atan(c.y, c.x + 1e-6) / 6.28318 + 0.5;
        float outer = smoothstep(0.9, 0.95, r) * (1.0 - smoothstep(0.97, 1.0, r));
        float inner = smoothstep(0.62, 0.65, r) * (1.0 - smoothstep(0.67, 0.7, r));
        float dash = step(0.5, fract(ang * 24.0 + uTime * 0.3)) * inner;
        float prog = step(ang, uProgress) * smoothstep(0.72, 0.76, r) * (1.0 - smoothstep(0.84, 0.88, r));
        float glow = (1.0 - smoothstep(0.0, 1.0, r)) * 0.18 * (0.4 + uActive);
        float pulse = pow(fract(r * 0.8 - uTime * 0.6), 12.0) * (1.0 - r) * (0.3 + uActive);
        float a = (outer * 0.9 + dash * 0.5 + prog * 1.2 + glow + pulse * 0.5) * uAlpha;
        gl_FragColor = vec4(uColor * (1.2 + outer + prog * 2.0), clamp(a, 0.0, 1.0));
      }
    `,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}

// ---------------------------------------------------------------------------
// 出口ポータルの渦

export function createPortalMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: sharedTime, uOpen: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uOpen;
      varying vec2 vUv;
      ${GLSL_UTIL}
      void main() {
        vec2 c = (vUv - 0.5) * 2.0;
        float r = length(c);
        float a = atan(c.y, c.x + 1e-6);
        float swirl = a + r * 4.0 - uTime * 1.6;
        float n = vnoise(vec2(swirl * 2.0, r * 6.0 - uTime * 2.0));
        float n2 = vnoise(vec2(a * 3.0 - uTime, r * 12.0 - uTime * 4.0));
        float disk = 1.0 - smoothstep(0.85, 1.0, r);
        float core = pow(1.0 - clamp(r, 0.0, 1.0), 3.0);
        vec3 col = mix(vec3(0.15, 0.55, 1.0), vec3(1.0, 0.7, 0.35), n * n);
        col = mix(col, vec3(0.9, 0.97, 1.0), core * 0.7);
        float arms = pow(max(0.5 + 0.5 * sin(swirl * 3.0), 0.0), 3.0);
        float alpha = disk * (0.18 + n * 0.35 + n2 * 0.2 + arms * 0.35 + core * 0.8) * uOpen;
        gl_FragColor = vec4(col * (0.8 + core * 1.2 + arms * 0.8 + n2 * 0.4), clamp(alpha, 0.0, 1.0));
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

// ---------------------------------------------------------------------------
// 空のドーム

export function createSkyMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: sharedTime },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec3 vDir;
      ${GLSL_UTIL}
      void main() {
        vec3 d = normalize(vDir + vec3(0.0, 1e-6, 0.0));
        float y = d.y;
        vec3 top = vec3(0.004, 0.008, 0.02);
        vec3 hor = vec3(0.02, 0.06, 0.1);
        vec3 bot = vec3(0.0, 0.004, 0.012);
        vec3 col = mix(hor, top, smoothstep(0.0, 0.7, y));
        col = mix(col, bot, smoothstep(0.0, -0.4, y));
        // 緯度経度の格子（箱庭のドーム）
        float lon = atan(d.z, d.x + 1e-6) / 6.28318 + 0.5;
        float lat = asin(clamp(y, -1.0, 1.0)) / 3.14159 + 0.5;
        float gl = 1.0 - smoothstep(0.0, 0.002 + fwidth(lon * 48.0) * 0.8, abs(fract(lon * 48.0) - 0.5) - 0.49);
        float gt = 1.0 - smoothstep(0.0, 0.002 + fwidth(lat * 24.0) * 0.8, abs(fract(lat * 24.0) - 0.5) - 0.49);
        float grid = max(gl, gt) * smoothstep(-0.1, 0.3, y) * (1.0 - smoothstep(0.6, 0.95, y));
        col += vec3(0.05, 0.3, 0.45) * grid * 0.25;
        // 星のようなデータ点
        vec2 sp = vec2(lon * 900.0, lat * 450.0);
        float s = h12(floor(sp));
        float star = step(0.9975, s) * (0.5 + 0.5 * sin(uTime * (1.0 + s * 5.0) + s * 100.0));
        col += vec3(0.6, 0.85, 1.0) * star * smoothstep(-0.05, 0.2, y) * 1.5;
        // 地平線の光
        col += vec3(0.1, 0.35, 0.55) * pow(clamp(1.0 - abs(y), 0.0, 1.0), 18.0) * 0.5;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
  });
}

export { WALL_H, LOW_H };
