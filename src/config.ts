// ゲーム全体の定数

export const TILE = 2;
export const WALL_H = 2.5;
export const RACK_H = 2.25;
export const LOW_H = 1.05;
export const PILLAR_H = 2.9;
export const PLATFORM_DEPTH = 5;

export const PLAYER = {
  radius: 0.42,
  walk: 5.0,
  sneak: 2.3,
  dashSpeed: 15,
  dashTime: 0.17,
  dashCooldown: 1.1,
  dashNoise: 8,
  accel: 38,
  hover: 0.95,
  sneakHover: 0.55,
  decoys: 3,
  decoyRange: 13,
};

export const OBSERVER = {
  radius: 0.4,
  speed: 2.1,
  investigateSpeed: 2.9,
  range: 10.5,
  fov: 72,
  proximity: 1.7,
  eyeHeight: 1.65,
  turnSpeed: 3.2,
  hearing: 11,
};

export const DETECT = {
  /** 近距離で満タンになるまでの秒数 */
  nearTime: 0.42,
  /** 視界の端で満タンになるまでの秒数（nearTime に加算） */
  farTime: 1.55,
  sneakMul: 0.55,
  camNear: 0.7,
  camFar: 1.1,
  droneTime: 0.55,
  decayDelay: 0.8,
  decay: 0.32,
  noiseHideDist: 2.2,
  investigateAt: 0.55,
};

export const COLORS = {
  bg: 0x03060d,
  fog: 0x050b16,
  cyan: 0x3fe0ff,
  cyanSoft: 0x1a8fb8,
  amber: 0xffa04a,
  player: 0xff8a3d,
  playerHot: 0xffd9a8,
  calm: 0x5ce1ff,
  suspicious: 0xffc53d,
  alert: 0xff2f55,
  laser: 0xff2d6f,
  scan: 0xa46bff,
  board: 0x3dffa8,
  key: 0xffd166,
  noise: 0x8f86b8,
};

export const STORAGE_PREFIX = 'ootb:v1:';
