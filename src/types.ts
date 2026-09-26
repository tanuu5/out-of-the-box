import type * as THREE from 'three';
import type { Grid } from './level/Grid';

export type SensorKind = 'observer' | 'camera' | 'drone' | 'laser' | 'scan';

export interface DetectionInfo {
  sensorId: string;
  /** 表示名の翻訳キー（sensor.<id> など） */
  sensorKey: string;
  kind: SensorKind;
  /** 見られていた秒数 */
  exposure: number;
  distance: number;
  /** 捕まったときの状態 */
  stance: 'walk' | 'sneak' | 'dash' | 'idle';
  /** 音で呼び寄せていたか */
  lured: boolean;
  /** 回転カメラか */
  rotating?: boolean;
  pos: { x: number; z: number };
}

/** 検知装置の共通インターフェース */
export interface Sensor {
  readonly id: string;
  /** 表示名の翻訳キー */
  readonly nameKey: string;
  readonly kind: SensorKind;
  readonly sector: number;
  /** 0..1 */
  suspicion: number;
  /** 今プレイヤーを見ているか */
  seeing: boolean;
  /** HUD 表示用の頭上位置 */
  markerPos(out: THREE.Vector3): THREE.Vector3;
  /** 音を聞いて調べに来ている等 */
  investigating(): boolean;
  reset(): void;
}

export interface PlayerView {
  readonly pos: THREE.Vector3;
  readonly vel: THREE.Vector3;
  readonly radius: number;
  sneaking: boolean;
  dashing: boolean;
  inNoise: boolean;
  /** ノイズ領域 + 低電力 */
  hiddenInNoise: boolean;
  /** 検知対象外（隔離中など） */
  untargetable: boolean;
  stance(): 'walk' | 'sneak' | 'dash' | 'idle';
}

export interface NoiseEvent {
  x: number;
  z: number;
  radius: number;
  source: 'dash' | 'decoy';
  id: number;
}

export interface WorldCtx {
  grid: Grid;
  scene: THREE.Scene;
  time: number;
  player: PlayerView;
  /** 検知ゲージが満タンになったとき */
  detect(info: DetectionInfo): void;
  /** 効果音（ワールド座標付き） */
  sfx(name: string, pos?: { x: number; z: number }, vol?: number): void;
  isDisabled(id: string): boolean;
}
