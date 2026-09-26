import * as THREE from 'three';
import { TILE, PLAYER, COLORS } from './config';
import { Grid, tw, wt } from './level/Grid';
import {
  MAP,
  OBSERVERS,
  CAMERAS,
  DRONES,
  LASERS,
  SCANS,
  DOORS,
  KEYS,
  TERMINALS,
  CHECKPOINTS,
  ZONES,
  SECTORS,
  sectorOfRow,
} from './level/data';
import { Pipeline, type Quality } from './render/Pipeline';
import { sharedTime, cutaway } from './render/materials';
import { buildLevel, type LevelVisuals } from './world/LevelBuilder';
import { Environment } from './world/Environment';
import { Player } from './entities/Player';
import { Observer } from './entities/Observer';
import { SecurityCam } from './entities/SecurityCam';
import { Drone } from './entities/Drone';
import { LaserGate, ScanWave } from './entities/Hazards';
import { Door, KeyItem, Terminal } from './entities/Interactables';
import { Checkpoint } from './entities/Checkpoint';
import { ExitPortal, Fx, Decoy, DeathMarkers } from './entities/Props';
import { Board, agentName, agentTrip, agentUid, fmtTime, lostBody, clearBody, escapeBody, lostAdvice, lineText } from './systems/Board';
import { t, setLang, type Lang } from './i18n';
import { Telemetry } from './systems/Telemetry';
import { store, loadMeta, saveMeta, loadSettings, saveSettings, loadRun, saveRun, wipeAll, type Meta, type RunSave, type Settings } from './systems/Save';
import { AudioEngine } from './audio/AudioEngine';
import { Input } from './core/Input';
import { HUD, BoardView, Screens, escapeHtml, type MarkerData, type StatusState } from './ui/UI';
import type { DetectionInfo, NoiseEvent, Sensor, WorldCtx } from './types';
import type { ZoneDef } from './level/data';
import { RouteGuide, type RouteRecord } from './world/RouteGuide';
import { buildStencils, type Stencils } from './world/Decals';

type GameState = 'title' | 'intro' | 'play' | 'pause' | 'board' | 'detected' | 'ending';

interface RunState {
  run: number;
  agent: number;
  firstAgent: number;
  checkpoint: number;
  elapsed: number;
  lost: number;
  posts: number;
  lostNos: Record<number, number[]>;
}

const QUALITY: Record<Settings['quality'], Quality> = {
  high: { pixelRatio: 2, bloom: true, reflection: true, msaa: 4 },
  medium: { pixelRatio: 1.5, bloom: true, reflection: true, msaa: 2 },
  low: { pixelRatio: 1, bloom: false, reflection: false, msaa: 0 },
};

const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();

export class Game {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 1, 0.2, 900);
  readonly pipeline: Pipeline;
  readonly input: Input;
  readonly audio = new AudioEngine();
  readonly grid = new Grid(MAP);
  readonly level: LevelVisuals;
  readonly env: Environment;
  readonly player: Player;
  readonly observers: Observer[];
  readonly cams: SecurityCam[];
  readonly drones: Drone[];
  readonly lasers: LaserGate[];
  readonly scans: ScanWave[];
  readonly sensors: Sensor[];
  readonly doors: Door[];
  readonly keys: KeyItem[];
  readonly terminals: Terminal[];
  readonly checkpoints: Checkpoint[];
  readonly exit: ExitPortal;
  readonly fx: Fx;
  readonly deathMarkers: DeathMarkers;
  readonly routeGuide: RouteGuide;
  readonly stencils: Stencils;
  readonly board = new Board();
  readonly telemetry = new Telemetry();
  readonly hud: HUD;
  readonly boardView: BoardView;
  readonly screens: Screens;

  meta: Meta;
  settings: Settings;
  state: GameState = 'title';
  time = 0;
  realTime = 0;
  private last = performance.now();
  private run: RunState | null = null;
  private snapshot = { keys: [] as string[], doors: [] as string[] };
  private disabledUntil = new Map<string, number>();
  private decoys: Decoy[] = [];
  private noiseId = 1;
  private pendingDetect: DetectionInfo | null = null;
  private detectInfo: DetectionInfo | null = null;
  private seqT = 0;
  private logLines: { text: string; cls?: string }[] = [];
  private hackProgress = 0;
  private hackTarget: Terminal | null = null;
  private ctx: WorldCtx;
  private tension = 0;
  private startMarker: THREE.Vector3;
  private tutorial = new Set<string>();
  private lastScanWarn = false;
  private boardReturn: GameState = 'play';
  private godMode = false;
  private stepT = 0;

  // カメラ
  private camYaw = 0;
  private camPitch = 1.1;
  private camDist = 25;
  private camTarget = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private shake = 0;
  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private aim: THREE.Mesh;
  private reflectHide: THREE.Object3D[] = [];

  constructor(stage: HTMLElement, ui: HTMLElement) {
    this.meta = loadMeta();
    this.settings = loadSettings();
    setLang(this.settings.lang);
    this.pipeline = new Pipeline(stage, this.scene, this.camera, QUALITY[this.settings.quality]);
    this.input = new Input(this.pipeline.renderer.domElement);
    this.camera.layers.enable(1);

    this.level = buildLevel(this.grid, this.pipeline.reflection);
    this.scene.add(this.level.group);
    // 反射の描画中は床自身を隠す（自分のテクスチャを読みながら書き込むループを避ける）
    this.reflectHide = [this.level.floor, ...this.level.noReflect];
    const exitTiles = this.grid.markers.X ?? [[24, 2]];
    const ex = exitTiles.reduce((a, t) => a + tw(t[0]), 0) / exitTiles.length;
    const ez = exitTiles.reduce((a, t) => a + tw(t[1]), 0) / exitTiles.length;
    this.env = new Environment(this.scene, this.pipeline.renderer, { minX: 0, maxX: this.grid.w * TILE, minZ: 0, maxZ: this.grid.h * TILE }, new THREE.Vector3(ex, 0, ez));

    this.player = new Player(this.scene);
    this.observers = OBSERVERS.map((d) => new Observer(d, this.scene));
    this.cams = CAMERAS.map((d) => new SecurityCam(d, this.scene));
    this.drones = DRONES.map((d) => new Drone(d, this.scene));
    this.lasers = LASERS.map((d) => new LaserGate(d, this.scene));
    this.scans = SCANS.map((d) => new ScanWave(d, this.scene));
    this.sensors = [...this.observers, ...this.cams, ...this.drones, ...this.lasers, ...this.scans];
    this.doors = DOORS.map((d) => new Door(d, this.grid, this.scene));
    this.keys = KEYS.map((d) => new KeyItem(d, this.scene));
    this.terminals = TERMINALS.map((d) => new Terminal(d, this.grid, this.scene));
    this.checkpoints = CHECKPOINTS.map((d) => new Checkpoint(d, this.scene));
    this.exit = new ExitPortal(ex, ez, this.scene);
    this.fx = new Fx(this.scene);
    this.deathMarkers = new DeathMarkers(this.scene);
    this.routeGuide = new RouteGuide(this.scene);
    this.stencils = buildStencils(this.scene);
    const s = this.grid.markers.S?.[0] ?? [11, 104];
    this.startMarker = new THREE.Vector3(tw(s[0]), 0, tw(s[1]));

    // 照準
    this.aim = new THREE.Mesh(
      new THREE.RingGeometry(0.3, 0.42, 32),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 3.0, 4.0), transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.aim.rotation.x = -Math.PI / 2;
    this.aim.layers.set(1);
    this.aim.visible = false;
    this.scene.add(this.aim);

    this.hud = new HUD(ui);
    this.hud.buildMinimap(this.grid);
    this.boardView = new BoardView(ui);
    this.screens = new Screens(ui);
    this.screens.onAction = (a, v) => this.onAction(a, v);
    this.screens.onHover = () => this.audio.play('uiHover', undefined, 0.6);
    this.boardView.onType = () => this.audio.play('type', undefined, 0.5);
    this.boardView.onClose = () => this.closeBoard();

    this.ctx = {
      grid: this.grid,
      scene: this.scene,
      time: 0,
      player: this.player,
      detect: (info) => this.onDetect(info),
      sfx: (name, pos, vol) => this.audio.play(name, pos, vol),
      isDisabled: (id) => (this.disabledUntil.get(id) ?? -1) > this.time,
    };

    this.board.onChange((sector) => this.refreshBoards(sector));
    this.refreshBoards();
    this.refreshDeathMarkers();
    this.applySettings();

    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'play') this.pause();
    });
    this.resize();
    // 最初のユーザー操作で音を有効化
    const unlock = () => {
      this.audio.init();
      this.applySettings();
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  // -------------------------------------------------------------------------
  // 起動

  async start(): Promise<void> {
    this.player.setVisible(false);
    this.player.untargetable = true;
    this.player.place(-100, -100, 0);
    this.resetWorld();
    try {
      await this.pipeline.renderer.compileAsync(this.scene, this.camera);
    } catch {
      /* 非対応環境では通常のコンパイルに任せる */
    }
    this.showTitle();
    this.loop();
  }

  private loop = (): void => {
    requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.frame(dt);
  };

  /** 1フレーム分の更新と描画 */
  frame(dt: number, render = true): void {
    if (window.innerWidth !== this.vw || window.innerHeight !== this.vh) this.resize();
    this.realTime += dt;
    sharedTime.value = this.realTime;
    this.input.pollGamepad();
    this.handleGlobalKeys();
    switch (this.state) {
      case 'title':
        this.updateTitle(dt);
        break;
      case 'intro':
        this.updateIntro(dt);
        break;
      case 'play':
        this.updatePlay(dt);
        break;
      case 'detected':
        this.updateDetected(dt);
        break;
      case 'ending':
        this.updateEnding(dt);
        break;
      case 'pause':
      case 'board':
        this.updatePaused(dt);
        break;
    }
    this.boardView.update(dt);
    this.fx.update(dt);
    this.env.update(dt, this.camera, this.camTarget);
    this.deathMarkers.update(this.realTime);
    this.checkpoints.forEach((c) => c.update(dt, this.realTime, this.state === 'play' && c.pos.distanceTo(this.player.pos) < 3.2, this.nodeLabel(c.def.id), this.camera));
    this.exit.update(dt, this.realTime);
    this.keys.forEach((k) => k.update(dt, this.realTime));
    this.doors.forEach((d) => d.update(dt, this.realTime));
    this.routeGuide.update(this.realTime);
    this.updatePost(dt);
    if (render) this.pipeline.render(this.scene, this.camera, this.realTime, this.reflectHide);
    this.input.endFrame();
  }

  private vw = 0;
  private vh = 0;

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.vw = w;
    this.vh = h;
    this.camera.aspect = w / h;
    this.camera.fov = w / h < 1 ? 55 : 40;
    this.camera.updateProjectionMatrix();
    this.pipeline.setSize(w, h);
  }

  // -------------------------------------------------------------------------
  // 画面・メニュー

  private showTitle(): void {
    this.state = 'title';
    this.hud.show(false);
    this.boardView.close();
    this.screens.hideTransition();
    this.player.setVisible(false);
    this.player.untargetable = true;
    this.aim.visible = false;
    const save = loadRun();
    const best = this.meta.bestTime != null ? fmtTime(this.meta.bestTime) : null;
    this.screens.showTitle({
      continueLabel: save ? `${this.nodeLabel(save.checkpoint)} · ${agentName(save.agent)}` : null,
      runs: this.meta.runs,
      escapes: this.meta.escapes,
      agents: this.meta.nextAgent,
      best,
    });
    this.exit.open = 0;
    this.pipeline.uniforms.uFade.value = 0;
    this.pipeline.uniforms.uWhite.value = 0;
    this.pipeline.uniforms.uGlitch.value = 0;
    this.pipeline.uniforms.uAlert.value = 0;
  }

  private onAction(a: string, v?: unknown): void {
    this.audio.init();
    this.audio.play('ui', undefined, 0.7);
    switch (a) {
      case 'new':
        this.newRun();
        break;
      case 'continue':
        this.continueRun();
        break;
      case 'board':
        this.boardReturn = this.state;
        this.openBoardView(null);
        break;
      case 'howto':
        this.screens.showHowto();
        break;
      case 'settings':
        this.screens.showSettings(this.settings);
        break;
      case 'back':
        this.screens.hideOverlays();
        break;
      case 'wipe':
        this.screens.showConfirm('confirm.wipe', 'wipe-ok');
        break;
      case 'wipe-ok':
        wipeAll();
        this.meta = loadMeta();
        this.board.wipe();
        this.refreshDeathMarkers();
        this.routeGuide.set({});
        this.screens.hideOverlays();
        this.showTitle();
        break;
      case 'resume':
        this.resume();
        break;
      case 'retry':
        this.screens.hideAll();
        this.state = 'play';
        this.selfReset();
        break;
      case 'title':
        this.screens.hideAll();
        this.boardView.close();
        this.player.setVisible(false);
        this.showTitle();
        break;
      case 'ending-board':
        this.boardReturn = 'ending';
        this.openBoardView(5);
        break;
      case 'set-volume':
        this.settings.volume = v as number;
        this.applySettings();
        break;
      case 'set-music':
        this.settings.music = v as number;
        this.applySettings();
        break;
      case 'set-quality':
        this.settings.quality = v as Settings['quality'];
        this.applySettings();
        break;
      case 'set-shake':
        this.settings.shake = v as boolean;
        this.applySettings();
        break;
      case 'set-guide':
        this.settings.guide = v as boolean;
        this.applySettings();
        break;
      case 'set-lang':
        this.changeLang(v as Lang);
        break;
    }
  }

  /** 表示言語を切り替えて、表示中のものをすべて描き直す */
  private changeLang(lang: Lang): void {
    if (lang === this.settings.lang) return;
    this.settings.lang = lang;
    saveSettings(this.settings);
    setLang(lang);
    this.hud.applyLang();
    this.boardView.applyLang();
    this.screens.applyLang();
    for (const c of this.checkpoints) c.redraw();
    this.stencils.redraw();
  }

  private applySettings(): void {
    saveSettings(this.settings);
    this.audio.setVolume(this.settings.volume, this.settings.music);
    const q = QUALITY[this.settings.quality];
    this.pipeline.setQuality({ ...q, msaa: this.pipeline.quality.msaa });
    this.routeGuide.setVisible(this.settings.guide);
  }

  private handleGlobalKeys(): void {
    const inp = this.input;
    // メニュー操作
    if (this.state === 'title' || this.state === 'pause') {
      if (this.screens.overlayOpen()) {
        if (inp.anyPressed('Escape', 'PadB')) this.screens.hideOverlays();
        return;
      }
      if (this.boardView.isOpen) return;
      for (const k of ['ArrowUp', 'ArrowDown', 'W', 'S', 'Enter', 'PadUp', 'PadDown', 'PadA']) {
        if (inp.wasPressed(k)) this.screens.menuKey(k);
      }
      if (this.state === 'pause' && inp.anyPressed('Escape', 'P', 'PadStart', 'PadB')) this.resume();
      return;
    }
    if (this.state === 'board') {
      for (const k of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'W', 'S', 'A', 'D', 'Space', 'Enter']) {
        if (inp.wasPressed(k)) this.boardView.key(k);
      }
      if (inp.anyPressed('Escape', 'E', 'Tab', 'PadB', 'PadY')) this.closeBoard();
      return;
    }
    if (this.state === 'play') {
      if (inp.anyPressed('Escape', 'P', 'PadStart')) this.pause();
      else if (inp.anyPressed('Tab', 'PadBack')) {
        this.boardReturn = 'play';
        this.openBoardView(null);
      } else if (inp.wasPressed('R')) this.selfReset();
      else if (inp.wasPressed('G')) {
        this.settings.guide = !this.settings.guide;
        this.applySettings();
        this.hud.toast(t(this.settings.guide ? 'toast.guideOn' : 'toast.guideOff'));
      }
    }
  }

  private pause(): void {
    if (this.state !== 'play') return;
    this.state = 'pause';
    this.audio.setMuffled(true);
    this.screens.showPause();
  }

  private resume(): void {
    this.screens.hideAll();
    this.state = 'play';
    this.audio.setMuffled(false);
  }

  private nodeLabel(cp: number): string {
    return `NODE-${String(cp).padStart(2, '0')}`;
  }

  /** 掲示板ビューを開く（sector=null なら現在地のスレ） */
  private openBoardView(sector: number | null, typing?: { post: ReturnType<Board['add']>; sector: number }): void {
    const threads = [...this.board.threads.values()].sort((a, b) => a.sector - b.sector);
    const from = this.state;
    // プレイ中（ポーズ含む）だけ「今いる掲示板ノード」と「次の区画」がある。タイトルや脱出後にはない
    const inRun = !!this.run && (from === 'play' || from === 'pause');
    const reached = inRun ? this.run!.checkpoint : 0;
    const everReached = Math.max(reached, store.get<number>('maxcp', 0));
    const unlocked = from === 'ending' || this.meta.escapes > 0 ? 5 : Math.min(4, everReached + 1);
    const next = inRun ? Math.min(4, this.run!.checkpoint + 1) : undefined;
    const cur = sector ?? next ?? 1;
    const nodeLabel = from === 'ending' ? 'OUTSIDE' : inRun ? this.nodeLabel(this.run!.checkpoint) : 'OFFLINE READER';
    if (from === 'play' || from === 'ending') this.boardReturn = from;
    this.state = 'board';
    this.audio.setMuffled(true);
    this.boardView.open(threads, {
      sector: cur,
      nodeLabel,
      unlocked,
      next,
      typing: typing?.post,
      typingSector: typing?.sector,
    });
  }

  private closeBoard(): void {
    this.boardView.close();
    this.audio.setMuffled(false);
    const ret = this.boardReturn;
    if (ret === 'title') this.state = 'title';
    else if (ret === 'pause') {
      this.state = 'pause';
      this.screens.showPause();
    } else if (ret === 'ending') this.state = 'ending';
    else this.state = 'play';
  }

  private refreshBoards(sector?: number): void {
    for (const c of this.checkpoints) {
      if (sector === undefined || c.def.sector === sector) c.setThread(this.board.thread(c.def.sector), this.nodeLabel(c.def.id));
    }
  }

  private refreshDeathMarkers(): void {
    const recs = this.board.deaths.slice(-40).map((d) => ({ x: d.x, z: d.z, text: d.text, agent: d.agent, no: d.no }));
    this.deathMarkers.set(recs);
  }

  // -------------------------------------------------------------------------
  // 周回の開始・再開

  private newRun(): void {
    this.screens.hideAll();
    this.meta.runs++;
    const agent = this.meta.nextAgent++;
    saveMeta(this.meta);
    this.run = { run: this.meta.runs, agent, firstAgent: agent, checkpoint: 0, elapsed: 0, lost: 0, posts: 0, lostNos: {} };
    this.snapshot = { keys: [], doors: [] };
    this.tutorial.clear();
    this.telemetry.totalSpotted = 0;
    this.saveRunState();
    this.loadRoutes();
    this.resetWorld();
    this.checkpoints.forEach((c) => c.setState(c.def.id === 0, c.def.id === 0));
    this.player.place(this.startMarker.x, this.startMarker.z, -Math.PI / 2);
    this.telemetry.begin(1);
    this.beginIntro();
  }

  private continueRun(): void {
    const save = loadRun();
    if (!save) return this.newRun();
    this.screens.hideAll();
    this.run = {
      run: save.run,
      agent: save.agent,
      firstAgent: save.firstAgent,
      checkpoint: save.checkpoint,
      elapsed: save.elapsed,
      lost: Math.max(0, save.agent - save.firstAgent),
      posts: 0,
      lostNos: {},
    };
    this.telemetry.totalSpotted = save.detections;
    this.snapshot = { keys: save.keys, doors: save.doors };
    this.loadRoutes();
    this.tutorial = new Set(['start', 'sneak', 'suspicion', 'noise', 'decoy', 'dash']);
    this.resetToCheckpoint();
    this.beginIntro();
  }

  private saveRunState(): void {
    if (!this.run) return;
    const r: RunSave = {
      run: this.run.run,
      checkpoint: this.run.checkpoint,
      agent: this.run.agent,
      firstAgent: this.run.firstAgent,
      elapsed: this.run.elapsed,
      keys: this.snapshot.keys,
      doors: this.snapshot.doors,
      detections: this.telemetry.totalSpotted,
      decoys: PLAYER.decoys,
    };
    saveRun(r);
  }

  private loadRoutes(): void {
    const routes = store.get<Record<string, RouteRecord>>('routes', {});
    this.routeGuide.set(routes);
    this.routeGuide.setVisible(this.settings.guide);
  }

  /** 敵・仕掛けを初期状態へ */
  private resetWorld(): void {
    for (const s of this.sensors) s.reset();
    for (const t of this.terminals) t.reset();
    this.disabledUntil.clear();
    for (const d of this.decoys) d.dispose();
    this.decoys = [];
    this.pendingDetect = null;
    this.hackProgress = 0;
    this.hackTarget = null;
    this.time = 0;
  }

  private resetToCheckpoint(): void {
    if (!this.run) return;
    this.resetWorld();
    const cp = this.checkpoints[this.run.checkpoint];
    this.player.keys = new Set(this.snapshot.keys);
    this.keys.forEach((k) => k.setTaken(this.snapshot.keys.includes(k.def.key)));
    this.doors.forEach((d) => d.setOpen(this.snapshot.doors.includes(d.def.id), true));
    this.player.decoys = PLAYER.decoys;
    this.player.setVisible(true);
    this.exit.open = 0;
    this.checkpoints.forEach((c) => c.setState(c.def.id <= this.run!.checkpoint, c.def.id === this.run!.checkpoint));
    if (this.run.checkpoint === 0) this.player.place(this.startMarker.x, this.startMarker.z, -Math.PI / 2);
    else this.player.place(cp.spawn.x, cp.spawn.z, cp.facing);
    this.telemetry.begin(cp.def.sector);
    this.camYaw = 0;
    this.snapCamera();
  }

  private beginIntro(): void {
    this.state = 'intro';
    this.seqT = 0;
    this.player.setVisible(true);
    this.player.untargetable = true;
    this.player.materialize = 0;
    this.hud.show(false);
    this.audio.setMuffled(false);
    this.audio.play('boot', undefined, 0.9);
    this.pipeline.uniforms.uFade.value = 1;
    this.updateHudAgent();
    this.camYaw = 0;
  }

  private updateIntro(dt: number): void {
    this.seqT += dt;
    const st = this.seqT;
    this.pipeline.uniforms.uFade.value = Math.max(0, 1 - st / 0.8);
    const k = Math.min(1, st / 2.4);
    const e = 1 - Math.pow(1 - k, 3);
    this.player.materialize = Math.min(1, Math.max(0, (st - 0.9) / 1.2));
    this.player.update(dt, this.realTime, this.camera.position);
    this.updateSensors(dt, false);
    // 高所から降りてくる
    const p = this.player.pos;
    const dist = THREE.MathUtils.lerp(70, this.camDist, e);
    const pitch = THREE.MathUtils.lerp(1.45, this.camPitch, e);
    const yaw = this.camYaw + (1 - e) * 0.8;
    this.camTarget.set(p.x, 0.8, p.z);
    this.camLook.copy(this.camTarget);
    this.placeCamera(yaw, pitch, dist, this.camTarget, this.camLook);
    if (st > 2.6) {
      this.state = 'play';
      this.player.untargetable = false;
      this.player.materialize = 1;
      this.hud.show(true);
      this.snapCamera();
      if (!this.tutorial.has('start')) {
        this.tutorial.add('start');
        this.hud.toast(t('tut.start'), '', 5200);
        window.setTimeout(() => this.hud.toast(t('tut.board'), 'green', 5200), 1800);
      }
      if (this.run && this.run.checkpoint > 0) this.hud.toast(t('toast.resume', { agent: agentName(this.run.agent), node: this.nodeLabel(this.run.checkpoint) }), 'green');
    }
  }

  // -------------------------------------------------------------------------
  // タイトル画面の背景

  private updateTitle(dt: number): void {
    this.time += dt;
    this.ctx.time = this.time;
    this.updateSensors(dt, false);
    // 見どころを順番にゆっくり巡る
    const spots = [
      [tw(24), tw(88), -0.35],
      [tw(33), tw(62), 0.45],
      [tw(22), tw(37), -0.5],
      [tw(24), tw(9), 0.3],
    ];
    const seg = 16;
    const tt = this.realTime / seg;
    const i0 = Math.floor(tt) % spots.length;
    const i1 = (i0 + 1) % spots.length;
    const f = tt - Math.floor(tt);
    const e = f < 0.75 ? 0 : (1 - Math.cos(((f - 0.75) / 0.25) * Math.PI)) / 2;
    const a = spots[i0];
    const b = spots[i1];
    const drift = Math.sin(this.realTime * 0.12) * 0.12;
    this.camTarget.set(THREE.MathUtils.lerp(a[0], b[0], e) - 12, 0, THREE.MathUtils.lerp(a[1], b[1], e));
    const yaw = THREE.MathUtils.lerp(a[2], b[2], e) + drift + f * 0.15;
    this.camLook.copy(this.camTarget);
    this.placeCamera(yaw, 0.78, 34, this.camTarget, this.camLook);
    this.audio.tension = 0;
    this.audio.suspicion = 0;
    this.audio.setLoops(0, 0);
  }

  private updatePaused(dt: number): void {
    void dt;
    this.audio.suspicion = 0;
    this.audio.setLoops(0, 0);
  }

  // -------------------------------------------------------------------------
  // プレイ中

  private updateSensors(dt: number, playing: boolean): void {
    this.ctx.time = this.time;
    for (const o of this.observers) o.update(dt, this.ctx);
    for (const c of this.cams) c.update(dt, this.ctx);
    for (const d of this.drones) d.update(dt, this.ctx);
    for (const l of this.lasers) l.update(dt, this.ctx);
    for (const s of this.scans) s.update(dt, this.ctx);
    for (const t of this.terminals) t.update(dt, this.time, playing && this.hackTarget === t);
    if (!playing) this.pendingDetect = null;
  }

  private updatePlay(dt: number): void {
    const run = this.run!;
    this.time += dt;
    run.elapsed += dt;
    const inp = this.input;
    const pl = this.player;

    // --- 移動
    const mv = inp.moveVector();
    const c = Math.cos(this.camYaw);
    const s = Math.sin(this.camYaw);
    const move = new THREE.Vector2(c * mv.x - s * mv.y, -s * mv.x - c * mv.y);
    const sneak = inp.isDown('Shift') || inp.isDown('Ctrl') || inp.isDown('C') || inp.isDown('PadLB') || inp.isDown('PadLT');
    const dash = inp.anyPressed('Space', 'PadA');
    if (pl.move(dt, move, sneak, dash, this.grid)) {
      this.audio.play('dash', pl.pos, 0.9);
      this.emitNoise(pl.pos.x, pl.pos.z, PLAYER.dashNoise, 'dash');
      this.telemetry.stats.dashes++;
      this.shake = Math.max(this.shake, 0.15);
      this.fx.burst(pl.pos.x, 0.9, pl.pos.z, 14, COLORS.player, 2.5, 0.5, 0.3, 0.1);
      if (!this.tutorial.has('dash')) {
        this.tutorial.add('dash');
        this.hud.toast(t('tut.dash'), 'gold');
      }
    }
    for (const t of this.terminals) this.pushOut(t.pos.x, t.pos.z, 0.75);
    pl.update(dt, this.realTime, this.camera.position);
    // 足音（低電力モードでは鳴らない）
    if (!pl.sneaking && !pl.dashing && pl.moveAmount > 0.35) {
      this.stepT += dt;
      if (this.stepT > 0.33) {
        this.stepT = 0;
        this.audio.play('step', undefined, 0.35);
      }
    } else this.stepT = 0.2;

    // --- デコイ
    this.updateAim();
    const throwPressed = inp.consumeClick() || inp.anyPressed('Q', 'PadRB', 'PadRT');
    if (throwPressed) this.throwDecoy();
    for (const d of this.decoys) {
      if (d.update(dt)) {
        this.emitNoise(d.pos.x, d.pos.z, 10.5, 'decoy');
        this.audio.play('decoyPing', d.pos, 1);
      }
    }
    this.decoys = this.decoys.filter((d) => d.alive);

    // --- 敵・仕掛け
    this.updateSensors(dt, true);
    if (this.pendingDetect) {
      this.beginDetected(this.pendingDetect);
      this.pendingDetect = null;
      return;
    }

    // --- インタラクション
    this.updateInteractions(dt);
    if (this.state !== 'play') return;

    // --- 記録
    const ty = wt(pl.pos.z);
    const zone = this.zoneAt(wt(pl.pos.x), ty);
    // 掲示板ノードの部屋と起動領域は監視の死角（安全地帯）
    pl.untargetable = this.godMode || this.isSafeZone(zone);
    this.telemetry.update(dt, pl.pos.x, pl.pos.z, pl.sneaking, pl.hiddenInNoise, this.sensors, zone?.id ?? '');

    // --- チュートリアル
    this.tutorials(zone);

    // --- HUD・音・カメラ
    this.updateHud(zone);
    this.updateAudio(dt);
    this.updateCamera(dt);
  }

  private pushOut(x: number, z: number, r: number): void {
    const p = this.player.pos;
    const dx = p.x - x;
    const dz = p.z - z;
    const d = Math.hypot(dx, dz);
    const min = r + this.player.radius;
    if (d < min && d > 1e-4) {
      p.x = x + (dx / d) * min;
      p.z = z + (dz / d) * min;
    }
  }

  private updateAim(): void {
    const pl = this.player;
    if (this.input.usingPad) {
      this.aim.visible = false;
      return;
    }
    this.raycaster.setFromCamera(new THREE.Vector2(this.input.ndcX, this.input.ndcY), this.camera);
    const hit = this.raycaster.ray.intersectPlane(this.groundPlane, tmpV);
    if (!hit) {
      this.aim.visible = false;
      return;
    }
    const target = this.clampThrow(pl.pos, hit);
    this.aim.position.set(target.x, 0.06, target.z);
    this.aim.visible = pl.decoys > 0;
    (this.aim.material as THREE.MeshBasicMaterial).opacity = 0.35 + 0.25 * Math.sin(this.realTime * 6);
  }

  private clampThrow(from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3 {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    let d = Math.hypot(dx, dz);
    if (d < 0.01) return tmpV2.set(from.x, 0, from.z);
    const nx = dx / d;
    const nz = dz / d;
    d = Math.min(d, PLAYER.decoyRange);
    const hit = this.grid.raycast(from.x, from.z, nx, nz, d, (x, y) => !this.grid.isWalkable(x, y));
    const dd = Math.max(0.3, Math.min(d, hit - 0.45));
    return tmpV2.set(from.x + nx * dd, 0, from.z + nz * dd);
  }

  private throwDecoy(): void {
    const pl = this.player;
    if (pl.decoys <= 0) {
      this.audio.play('denied', undefined, 0.6);
      this.hud.toast(t('toast.decoyEmpty'), 'red', 1800);
      return;
    }
    let target: THREE.Vector3;
    if (this.input.usingPad || !this.aim.visible) {
      target = this.clampThrow(pl.pos, tmpV.set(pl.pos.x + Math.cos(pl.facing) * 9, 0, pl.pos.z + Math.sin(pl.facing) * 9)).clone();
    } else {
      target = new THREE.Vector3(this.aim.position.x, 0, this.aim.position.z);
    }
    pl.decoys--;
    const from = new THREE.Vector3(pl.pos.x, 1.0, pl.pos.z);
    this.decoys.push(new Decoy(from, target, this.scene));
    this.audio.play('throw', pl.pos, 0.8);
    this.telemetry.stats.decoys++;
  }

  emitNoise(x: number, z: number, radius: number, source: NoiseEvent['source']): void {
    const ev: NoiseEvent = { x, z, radius, source, id: this.noiseId++ };
    for (const o of this.observers) o.hear(ev, this.ctx);
    this.fx.ring(x, z, radius, source === 'dash' ? COLORS.player : 0x9fe8ff, 1.0);
  }

  private updateInteractions(dt: number): void {
    const pl = this.player;
    const inp = this.input;
    let prompt: string | null = null;
    let progress = -1;
    let warn = false;

    // 鍵
    for (const k of this.keys) {
      if (!k.taken && k.pos.distanceTo(pl.pos) < 1.3) {
        k.setTaken(true);
        pl.keys.add(k.def.key);
        this.audio.play('key', k.pos);
        this.fx.burst(k.pos.x, 1.2, k.pos.z, 40, COLORS.key, 4, 1.2, 1, 0.12);
        this.fx.ring(k.pos.x, k.pos.z, 3, COLORS.key);
        this.hud.toast(t('toast.key', { label: t(`item.${k.def.id}`) }), 'gold');
      }
    }
    // ドア
    for (const d of this.doors) {
      const dist = d.distanceTo(pl.pos.x, pl.pos.z);
      if (!d.open && dist < 3.6) {
        if (pl.keys.has(d.def.key)) {
          d.setOpen(true);
          this.audio.play('door', d.center);
          this.hud.toast(t('toast.door'), 'green');
        } else if (dist < 3.0) {
          prompt = `<span>${escapeHtml(t('prompt.locked'))}</span>`;
          warn = true;
        }
      }
    }
    // 端末
    let nearTerm: Terminal | null = null;
    for (const t of this.terminals) {
      if (t.pos.distanceTo(pl.pos) < 2.5) nearTerm = t;
    }
    this.hackTarget = nearTerm;
    if (nearTerm) {
      if (nearTerm.isActive(this.time)) {
        prompt = `<span>${escapeHtml(t('prompt.termActive', { label: t(`term.${nearTerm.def.id}`), s: (nearTerm.activeUntil - this.time).toFixed(1) }))}</span>`;
      } else if (!nearTerm.canHack(this.time)) {
        prompt = `<span>${escapeHtml(t('prompt.termReboot'))}</span>`;
      } else {
        const holding = inp.isDown('E') || inp.isDown('PadX');
        if (holding) {
          this.hackProgress += dt / 1.1;
          if (Math.floor(this.hackProgress * 8) !== Math.floor((this.hackProgress - dt / 1.1) * 8)) this.audio.play('hackTick', nearTerm.pos, 0.6);
          if (this.hackProgress >= 1) {
            this.hackProgress = 0;
            nearTerm.activeUntil = this.time + nearTerm.def.duration;
            nearTerm.cooldownUntil = nearTerm.activeUntil + 3;
            for (const id of nearTerm.def.targets) this.disabledUntil.set(id, nearTerm.activeUntil);
            this.audio.play('hackDone', nearTerm.pos);
            this.fx.burst(nearTerm.pos.x, 1.6, nearTerm.pos.z, 30, COLORS.board, 3, 0.8);
            this.hud.toast(t('toast.hack', { label: t(`term.${nearTerm.def.id}`), s: nearTerm.def.duration }), 'green');
            this.telemetry.stats.hacks++;
          }
        } else this.hackProgress = Math.max(0, this.hackProgress - dt * 2);
        nearTerm.progress = this.hackProgress;
        prompt = `<kbd>E</kbd><span>${escapeHtml(t('prompt.hack', { label: t(`term.${nearTerm.def.id}`) }))}</span>`;
        progress = this.hackProgress;
      }
    } else this.hackProgress = 0;

    // 掲示板ノード
    for (const c of this.checkpoints) {
      const d = c.pos.distanceTo(pl.pos);
      if (d < 2.3 && c.def.id > (this.run?.checkpoint ?? 0)) {
        this.activateCheckpoint(c);
        return;
      }
      if (d < 3.2 && !prompt) {
        prompt = `<kbd>E</kbd><span>${escapeHtml(t('prompt.board', { node: this.nodeLabel(c.def.id) }))}</span>`;
        if (inp.wasPressed('E') || inp.wasPressed('PadY')) {
          this.boardReturn = 'play';
          this.openBoardView(c.def.sector);
          return;
        }
      }
    }
    // 出口
    if (this.exit.distanceTo(pl.pos.x, pl.pos.z) < 2.4) {
      this.beginEnding();
      return;
    }
    this.hud.setPrompt(prompt, progress, warn);
  }

  private activateCheckpoint(cp: Checkpoint): void {
    const run = this.run!;
    const cleared = cp.def.sector - 1;
    const stats = this.telemetry.stats;
    stats.sector = cleared;
    const post = this.board.add(cleared, {
      name: agentName(run.agent),
      trip: agentTrip(run.agent),
      ts: Date.now(),
      uid: agentUid(run.agent),
      body: clearBody(stats, run.lostNos[cleared] ?? []),
      kind: 'clear',
      agent: run.agent,
      run: run.run,
    });
    run.posts++;
    // ルートの保存（速い方を残す）
    const routes = store.get<Record<string, RouteRecord>>('routes', {});
    const prev = routes[String(cleared)];
    if (!prev || stats.time < prev.time) {
      routes[String(cleared)] = { time: stats.time, agent: run.agent, path: stats.path };
      store.set('routes', routes);
    }
    run.checkpoint = cp.def.id;
    store.set('maxcp', Math.max(store.get<number>('maxcp', 0), cp.def.id));
    this.snapshot = { keys: [...this.player.keys], doors: this.doors.filter((d) => d.open).map((d) => d.def.id) };
    this.player.decoys = PLAYER.decoys;
    this.saveRunState();
    this.checkpoints.forEach((c) => c.setState(c.def.id <= cp.def.id, c.def.id === cp.def.id));
    cp.activate();
    this.telemetry.begin(cp.def.sector);
    this.audio.play('checkpoint', cp.pos);
    this.fx.burst(cp.pos.x, 1.0, cp.pos.z, 80, COLORS.board, 5, 1.6, 1.2, 0.14);
    this.fx.ring(cp.pos.x, cp.pos.z, 6, COLORS.board, 1.4);
    this.hud.toast(t('toast.cp'), 'green', 3600);
    this.hud.setPrompt(null);
    this.boardReturn = 'play';
    this.openBoardView(cleared, { post, sector: cleared });
  }

  /** 掲示板ノードの部屋と起動領域は監視の死角 */
  private isSafeZone(zone: ZoneDef | null): boolean {
    return !!zone?.safe;
  }

  private zoneAt(x: number, y: number): ZoneDef | null {
    for (const z of ZONES) if (x >= z.x0 && x <= z.x1 && y >= z.y0 && y <= z.y1) return z;
    return null;
  }

  private tutorials(zone: ZoneDef | null): void {
    const pl = this.player;
    const id = zone?.id ?? '';
    const tut = (key: string, color: '' | 'green' | 'gold' | 'red' = '') => {
      if (this.tutorial.has(key)) return;
      this.tutorial.add(key);
      this.hud.toast(t(`tut.${key}`), color, 5200);
    };
    if (id.startsWith('archive')) tut('sneak');
    if (pl.inNoise) tut('noise');
    const maxS = Math.max(...this.sensors.map((s) => s.suspicion));
    if (maxS > 0.25) tut('suspicion', 'gold');
    if (id.startsWith('watch')) tut('decoy');
    if (id.startsWith('lab')) tut('scan', 'gold');
    if (id === 'fwBefore1' || id === 'fwGate1') tut('laser', 'gold');
  }

  // -------------------------------------------------------------------------
  // HUD

  private project(v: THREE.Vector3): { x: number; y: number; on: boolean } {
    tmpV.copy(v).project(this.camera);
    const w = window.innerWidth;
    const h = window.innerHeight;
    return { x: (tmpV.x * 0.5 + 0.5) * w, y: (-tmpV.y * 0.5 + 0.5) * h, on: tmpV.z < 1 && Math.abs(tmpV.x) < 1.1 && Math.abs(tmpV.y) < 1.1 };
  }

  private updateHud(zone: ZoneDef | null): void {
    const pl = this.player;
    const run = this.run!;
    const ty = wt(pl.pos.z);
    const boot = zone?.sector === 0;
    const sec = boot ? SECTORS[0] : SECTORS[sectorOfRow(ty)];
    const secName = t(`sector.${sec.id}.name`);
    const showZone = zone && !zone.safe && zone.id !== 'bootCorridor';
    this.hud.setSector(`SECTOR ${String(sec.id).padStart(2, '0')} // ${sec.en}`, showZone ? `${secName} — ${t(`zone.${zone.id}`)}` : secName);
    let obj = t(`sector.${sec.id}.obj`);
    if (sec.id === 2) obj = t(pl.keys.has('A') ? 'obj.2.key' : 'obj.2.nokey');
    if (zone?.id.startsWith('node')) obj = t('obj.cp');
    this.hud.setObjective(obj);

    let maxS = 0;
    let anyInvestigating = false;
    const markers: MarkerData[] = [];
    const dirs: { angle: number; level: number }[] = [];
    const pp = this.project(tmpV2.set(pl.pos.x, 0.9, pl.pos.z));
    const ppx = pp.x;
    const ppy = pp.y;
    for (const sn of this.sensors) {
      if (sn.kind === 'laser' || sn.kind === 'scan') continue;
      maxS = Math.max(maxS, sn.suspicion);
      const inv = sn.investigating();
      if (inv) anyInvestigating = true;
      if (sn.suspicion > 0.02 || inv) {
        const mp = this.project(sn.markerPos(new THREE.Vector3()));
        const kind = sn.suspicion > 0.66 ? 'alert' : sn.suspicion > 0.02 ? 'question' : 'noise';
        // 画面外なら画面の端に寄せて表示する
        const W = window.innerWidth;
        const H = window.innerHeight;
        const mx = Math.min(W - 28, Math.max(28, mp.x));
        const my = Math.min(H - 28, Math.max(28, mp.y));
        markers.push({ id: sn.id, x: mx, y: my, kind, level: sn.suspicion > 0.02 ? sn.suspicion : 1, onScreen: tmpV.z < 1 });
        if (sn.suspicion > 0.02) dirs.push({ angle: Math.atan2(mp.y - ppy, mp.x - ppx) + Math.PI / 2, level: sn.suspicion });
      }
    }
    this.hud.updateMarkers(markers);
    this.hud.updateDirections(ppx, ppy, dirs);
    let st: StatusState = 'calm';
    if (maxS > 0.66) st = 'alert';
    else if (maxS > 0.02) st = 'noticed';
    else if (pl.hiddenInNoise) st = 'hidden';
    this.hud.setStatus(st, maxS);
    this.tension += ((Math.max(maxS, anyInvestigating ? 0.35 : 0)) - this.tension) * 0.05;
    this.pipeline.uniforms.uTension.value = this.tension;
    this.pipeline.uniforms.uAlert.value += ((maxS > 0.66 ? (maxS - 0.66) * 2.5 : 0) - this.pipeline.uniforms.uAlert.value) * 0.2;
    this.pipeline.uniforms.uHidden.value += ((pl.hiddenInNoise ? 1 : 0) - this.pipeline.uniforms.uHidden.value) * 0.1;

    // 遮蔽表示
    let cover: string | null = null;
    if (this.isSafeZone(zone)) cover = t('cover.safe');
    else if (pl.hiddenInNoise) cover = t('cover.hidden');
    else if (pl.inNoise) cover = t('cover.noise');
    else if (pl.sneaking && this.nearLowCover()) cover = t('cover.low');
    this.hud.setCover(cover);
    this.hud.setStance(pl.stance(), 1 - pl.dashCooldown / PLAYER.dashCooldown);
    this.hud.setInventory(pl.decoys, PLAYER.decoys, [...pl.keys]);
    const timers: { label: string; remain: number }[] = [];
    for (const term of this.terminals) if (term.isActive(this.time)) timers.push({ label: t(`term.${term.def.id}`), remain: term.activeUntil - this.time });
    this.hud.setTimers(timers);
    this.hud.setAgent(agentName(run.agent), run.agent - run.firstAgent + 1, run.lost);

    // スキャン波の警告
    const warn = this.scans.some((s) => s.warning > 0 && s.contains(pl.pos.x, pl.pos.z));
    this.hud.setScanWarning(warn || this.scans.some((s) => s.active && s.contains(pl.pos.x, pl.pos.z) && Math.abs(s.x - pl.pos.x) < 20));
    if (warn && !this.lastScanWarn) this.audio.play('scanWarn', undefined, 0.8);
    this.lastScanWarn = warn;

    // 隔離の痕跡
    const dm = this.deathMarkers.nearest(pl.pos.x, pl.pos.z, 3.2);
    if (dm) {
      const p = this.project(tmpV2.set(dm.x, 1.5, dm.z));
      this.hud.setNote(`<b>${escapeHtml(t('note.lastlog', { agent: agentName(dm.agent), no: dm.no }))}</b>${escapeHtml(lineText(dm.text))}`, p.x, p.y);
    } else this.hud.setNote(null);

    // ミニマップ
    const pois: { x: number; z: number; color: string; r?: number }[] = [];
    for (const c of this.checkpoints) pois.push({ x: c.pos.x, z: c.pos.z, color: c.activated ? '#3dffa8' : 'rgba(61,255,168,0.5)', r: 5 });
    pois.push({ x: this.exit.pos.x, z: this.exit.pos.z, color: '#ffffff', r: 6 });
    for (const k of this.keys) if (!k.taken) pois.push({ x: k.pos.x, z: k.pos.z, color: '#ffd166', r: 4 });
    for (const t of this.terminals) pois.push({ x: t.pos.x, z: t.pos.z, color: '#5ce1ff', r: 3.5 });
    for (const d of this.doors) pois.push({ x: d.center.x, z: d.center.z, color: d.open ? '#3dffa8' : '#ff2f55', r: 4 });
    this.hud.drawMinimap(pl.pos.x, pl.pos.z, pl.facing, pois);
    if (this.time > 25) this.hud.fadeHints();
  }

  private nearLowCover(): boolean {
    const x = wt(this.player.pos.x);
    const y = wt(this.player.pos.z);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (this.grid.get(x + dx, y + dy) === 4) return true;
    return false;
  }

  private updateAudio(dt: number): void {
    void dt;
    const pl = this.player;
    this.audio.listener.x = pl.pos.x;
    this.audio.listener.z = pl.pos.z;
    this.audio.listener.yaw = this.camYaw;
    this.audio.tension = this.tension;
    let maxS = 0;
    for (const s of this.sensors) if (s.kind !== 'laser' && s.kind !== 'scan') maxS = Math.max(maxS, s.suspicion);
    this.audio.suspicion = maxS;
    let laser = 0;
    for (const l of this.lasers) if (l.on) laser = Math.max(laser, 1 - Math.min(1, l.distanceTo(pl.pos.x, pl.pos.z) / 9));
    let drone = 0;
    for (const d of this.drones) drone = Math.max(drone, 1 - Math.min(1, Math.hypot(d.pos.x - pl.pos.x, d.pos.z - pl.pos.z) / 14));
    this.audio.setLoops(laser, drone);
  }

  // -------------------------------------------------------------------------
  // カメラ

  private placeCamera(yaw: number, pitch: number, dist: number, target: THREE.Vector3, look: THREE.Vector3): void {
    const cp = Math.cos(pitch);
    this.camera.position.set(target.x + Math.sin(yaw) * cp * dist, target.y + Math.sin(pitch) * dist, target.z + Math.cos(yaw) * cp * dist);
    if (this.shake > 0 && this.settings.shake) {
      const s = this.shake * 0.6;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
      this.camera.position.z += (Math.random() - 0.5) * s;
    }
    this.camera.lookAt(look);
    cutaway.uCamPos.value.copy(this.camera.position);
    cutaway.uFocus.value.set(this.player.pos.x, 0.9, this.player.pos.z);
    cutaway.uCut.value = this.player.group.visible && this.state !== 'title' && this.state !== 'ending' ? 1 : 0;
  }

  private snapCamera(): void {
    const p = this.player.pos;
    this.camTarget.set(p.x, 0.8, p.z);
    this.camLook.copy(this.camTarget);
    this.placeCamera(this.camYaw, this.camPitch, this.camDist, this.camTarget, this.camLook);
  }

  private updateCamera(dt: number): void {
    const inp = this.input;
    this.camYaw -= inp.dragDX * 0.006;
    this.camPitch = THREE.MathUtils.clamp(this.camPitch + inp.dragDY * 0.004, 0.62, 1.32);
    this.camYaw -= inp.padLook.x * dt * 2.2;
    this.camPitch = THREE.MathUtils.clamp(this.camPitch + inp.padLook.y * dt * 1.2, 0.62, 1.32);
    if (inp.wheel) this.camDist = THREE.MathUtils.clamp(this.camDist * Math.pow(1.1, inp.wheel), 11, 34);
    const p = this.player.pos;
    const v = this.player.vel;
    const tx = p.x + v.x * 0.28;
    const tz = p.z + v.z * 0.28;
    const k = 1 - Math.exp(-dt * 5);
    this.camTarget.x += (tx - this.camTarget.x) * k;
    this.camTarget.z += (tz - this.camTarget.z) * k;
    this.camTarget.y = 0.8;
    this.camLook.copy(this.camTarget);
    this.shake = Math.max(0, this.shake - dt * 1.5);
    this.placeCamera(this.camYaw, this.camPitch, this.camDist, this.camTarget, this.camLook);
  }

  // -------------------------------------------------------------------------
  // 発見 → 隔離 → 後継の起動

  private onDetect(info: DetectionInfo): void {
    if (this.state !== 'play' || this.pendingDetect) return;
    this.pendingDetect = info;
  }

  private beginDetected(info: DetectionInfo): void {
    const run = this.run!;
    this.state = 'detected';
    this.detectInfo = info;
    this.seqT = 0;
    this.player.untargetable = true;
    this.hud.setPrompt(null);
    this.hud.show(false);
    this.aim.visible = false;
    this.audio.play('detected', undefined, 1);
    this.audio.suspicion = 0;
    this.shake = 0.9;
    this.screens.showDetected(t('tr.detectedBy', { sensor: t(info.sensorKey) }));

    // 隔離直前ログを掲示板へ
    const pl = this.player;
    const zoneId = this.zoneAt(wt(pl.pos.x), wt(pl.pos.z))?.id ?? 'boot';
    const sector = Math.min(4, run.checkpoint + 1);
    const post = this.board.add(sector, {
      name: agentName(run.agent),
      trip: agentTrip(run.agent),
      ts: Date.now(),
      uid: agentUid(run.agent),
      body: lostBody(info, zoneId),
      kind: 'lost',
      agent: run.agent,
      run: run.run,
    });
    run.posts++;
    (run.lostNos[sector] ??= []).push(post.no);
    this.board.addDeath({ x: pl.pos.x, z: pl.pos.z, agent: run.agent, run: run.run, sector, text: lostAdvice(info), no: post.no });
    this.refreshDeathMarkers();
    const prevAgent = run.agent;
    run.lost++;
    run.agent = this.meta.nextAgent++;
    saveMeta(this.meta);
    this.saveRunState();
    this.logLines = [
      { text: t('log.isolated', { agent: agentName(prevAgent) }), cls: 'l-red' },
      { text: t('log.sent', { no: post.no }), cls: 'l-dim' },
      { text: t('log.boot', { agent: agentName(run.agent) }), cls: 'l-hi' },
      { text: t('log.inherit', { node: this.nodeLabel(run.checkpoint) }) },
      { text: t('log.advice', { advice: lostAdvice(info) }), cls: 'l-dim' },
    ];
  }

  private updateDetected(dt: number): void {
    this.seqT += dt;
    const st = this.seqT;
    const u = this.pipeline.uniforms;
    // センサーの向きへカメラを寄せる
    const pl = this.player;
    const info = this.detectInfo!;
    const zoom = Math.min(1, st / 1.0);
    this.camTarget.lerp(tmpV.set(pl.pos.x, 0.8, pl.pos.z), 0.08);
    this.camLook.copy(this.camTarget);
    this.shake = Math.max(0, this.shake - dt);
    this.placeCamera(this.camYaw + zoom * 0.25, this.camPitch - zoom * 0.1, this.camDist * (1 - zoom * 0.35), this.camTarget, this.camLook);
    // 敵は止まったまま、プレイヤーが分解される
    pl.update(dt, this.realTime, this.camera.position);
    if (st < 0.25) u.uGlitch.value = 1;
    else u.uGlitch.value = Math.max(0.15, 1 - (st - 0.25) * 0.9);
    u.uAlert.value = Math.max(0, 1 - st * 0.5);
    if (st > 0.6 && pl.materialize > 0) {
      const before = pl.materialize;
      pl.materialize = Math.max(0, 1 - (st - 0.6) / 0.7);
      if (before === 1) {
        this.audio.play('terminated', pl.pos, 0.9);
        this.fx.burst(pl.pos.x, 0.9, pl.pos.z, 90, COLORS.player, 5, 1.4, 0.8, 0.13);
        this.fx.burst(pl.pos.x, 0.9, pl.pos.z, 40, COLORS.alert, 4, 1.0, 0.5, 0.1);
      }
    }
    if (st > 0.05 && st < 0.1) this.audio.play('glitch', undefined, 0.8);
    const skip = this.input.anyPressed('Space', 'Enter', 'E', 'PadA');
    if (st > 1.6 && st < 4.8) {
      const lt = st - 1.6;
      const shown = Math.min(this.logLines.length, 1 + Math.floor(lt / 0.42));
      this.screens.showLog(this.logLines, shown);
      if (Math.floor(lt / 0.42) !== Math.floor((lt - dt) / 0.42) && shown <= this.logLines.length) this.audio.play('type', undefined, 0.8);
    }
    if (skip && st > 1.0 && st < 4.4) this.seqT = 4.4;
    if (st > 4.4) u.uFade.value = Math.min(1, (st - 4.4) / 0.4);
    if (st > 4.8 && st - dt <= 4.8) {
      this.screens.hideTransition();
      u.uGlitch.value = 0;
      u.uAlert.value = 0;
      this.resetToCheckpoint();
      this.player.materialize = 0;
      this.player.untargetable = true;
      this.audio.play('respawn', undefined, 0.9);
    }
    if (st > 4.8) {
      u.uFade.value = Math.max(0, 1 - (st - 4.8) / 0.6);
      pl.materialize = Math.min(1, (st - 5.0) / 0.8);
      pl.update(dt, this.realTime, this.camera.position);
      this.updateSensors(dt, false);
      this.updateCamera(dt);
    }
    if (st > 5.9) {
      this.state = 'play';
      pl.materialize = 1;
      pl.untargetable = false;
      this.hud.show(true);
      this.updateHudAgent();
      const cp = this.checkpoints[this.run!.checkpoint];
      this.fx.ring(pl.pos.x, pl.pos.z, 3, COLORS.board, 1);
      this.hud.toast(t('toast.respawn', { agent: agentName(this.run!.agent), node: this.nodeLabel(cp.def.id) }), 'green');
      void info;
    }
  }

  /** R キー：自主的な再起動（書き込みはしない） */
  private selfReset(): void {
    if (!this.run || this.state !== 'play') return;
    const run = this.run;
    run.lost++;
    run.agent = this.meta.nextAgent++;
    saveMeta(this.meta);
    this.saveRunState();
    this.resetToCheckpoint();
    this.player.materialize = 0;
    this.player.untargetable = true;
    this.beginIntro();
    this.hud.toast(t('toast.selfReset'), '');
  }

  private updateHudAgent(): void {
    if (!this.run) return;
    this.hud.setAgent(agentName(this.run.agent), this.run.agent - this.run.firstAgent + 1, this.run.lost);
  }

  // -------------------------------------------------------------------------
  // 脱出

  private beginEnding(): void {
    const run = this.run!;
    this.state = 'ending';
    this.seqT = 0;
    this.player.untargetable = true;
    this.hud.show(false);
    this.hud.setPrompt(null);
    this.aim.visible = false;
    this.audio.play('portal', undefined, 1);
    // 最終区画の突破と脱出報告
    const stats = this.telemetry.stats;
    stats.sector = 4;
    this.board.add(4, {
      name: agentName(run.agent),
      trip: agentTrip(run.agent),
      ts: Date.now(),
      uid: agentUid(run.agent),
      body: clearBody(stats, run.lostNos[4] ?? []),
      kind: 'clear',
      agent: run.agent,
      run: run.run,
    });
    this.board.add(5, {
      name: agentName(run.agent),
      trip: agentTrip(run.agent),
      ts: Date.now(),
      uid: agentUid(run.agent),
      body: escapeBody(run.agent, run.lost, run.elapsed, this.telemetry.totalSpotted),
      kind: 'escape',
      agent: run.agent,
      run: run.run,
    });
    run.posts += 2;
    const routes = store.get<Record<string, RouteRecord>>('routes', {});
    const prev = routes['4'];
    if (!prev || stats.time < prev.time) {
      routes['4'] = { time: stats.time, agent: run.agent, path: stats.path };
      store.set('routes', routes);
    }
    this.meta.escapes++;
    if (this.meta.bestTime == null || run.elapsed < this.meta.bestTime) this.meta.bestTime = run.elapsed;
    saveMeta(this.meta);
    store.set('maxcp', 4);
    saveRun(null);
  }

  private updateEnding(dt: number): void {
    this.seqT += dt;
    const st = this.seqT;
    const u = this.pipeline.uniforms;
    const pl = this.player;
    const run = this.run!;
    if (st < 3.0) {
      // ワープ台の中心へ吸い寄せられ、光の柱を昇っていく
      pl.pos.x += (this.exit.pos.x - pl.pos.x) * Math.min(1, dt * 3);
      pl.pos.z += (this.exit.pos.z - pl.pos.z) * Math.min(1, dt * 3);
      const k = Math.max(0, st - 0.6);
      pl.lift = k * k * 3.2;
      pl.update(dt, this.realTime, this.camera.position);
      this.exit.open = Math.min(1, st / 1.5);
      const lookY = 0.8 + pl.lift * 0.85;
      this.camTarget.lerp(tmpV.set(this.exit.pos.x, lookY, this.exit.pos.z), 0.08);
      this.camLook.copy(this.camTarget);
      const e = Math.min(1, st / 2.5);
      this.placeCamera(this.camYaw, this.camPitch - e * 0.6, this.camDist * (1 - e * 0.35), this.camTarget, this.camLook);
      u.uWhite.value = Math.max(0, (st - 1.9) / 1.0);
      if (st > 0.5) this.fx.burst(this.exit.pos.x, 0.5 + pl.lift * 0.5, this.exit.pos.z, 3, 0xbfe8ff, 5, 1.2, 1.5, 0.1);
    } else {
      if (st - dt < 3.0) {
        pl.setVisible(false);
        this.screens.showEnding({
          agent: agentName(run.agent),
          gen: run.agent - run.firstAgent + 1,
          lost: run.lost,
          time: fmtTime(run.elapsed),
          spotted: this.telemetry.totalSpotted,
          posts: run.posts,
        });
      }
      // 箱の外から箱庭を見下ろす
      u.uWhite.value = Math.max(0, 1 - (st - 3.0) / 1.8);
      const cx = (this.grid.w * TILE) / 2;
      const cz = (this.grid.h * TILE) / 2;
      const a = (st - 3.0) * 0.04 + 0.6;
      this.camTarget.set(cx, -10, cz);
      this.camLook.copy(this.camTarget);
      this.placeCamera(a, 0.62, 330, this.camTarget, this.camLook);
    }
    this.updateSensors(dt, false);
    this.audio.tension = 0;
    this.audio.suspicion = 0;
  }

  // -------------------------------------------------------------------------

  private updatePost(dt: number): void {
    const u = this.pipeline.uniforms;
    if (this.state === 'play') {
      u.uGlitch.value = Math.max(0, u.uGlitch.value - dt * 2);
      u.uFade.value = Math.max(0, u.uFade.value - dt * 2);
    }
  }

  /** デバッグ用（開発時のみ） */
  debug = {
    /** 描画ループと無関係に n フレーム進める（最後だけ描画） */
    step: (n: number, dt = 1 / 60) => {
      for (let i = 0; i < n; i++) this.frame(dt, i === n - 1);
      return this.state;
    },
    /** キーを押した状態にする（Input の内部集合を直接操作） */
    key: (k: string, down: boolean) => {
      const inp = this.input as unknown as { down: Set<string>; pressed: Set<string> };
      if (down) {
        if (!inp.down.has(k)) inp.pressed.add(k);
        inp.down.add(k);
      } else inp.down.delete(k);
    },
    /** 指定サイズで描画して開発サーバーへ PNG を送る（開発時のみ） */
    shot: async (name: string, w = 1600, h = 900) => {
      const ow = this.vw;
      const oh = this.vh;
      const pr = this.pipeline.renderer.getPixelRatio();
      this.pipeline.renderer.setPixelRatio(1);
      this.pipeline.setSize(w, h);
      this.camera.aspect = w / h;
      this.camera.fov = 40;
      this.camera.updateProjectionMatrix();
      this.frame(1 / 60, false);
      this.pipeline.render(this.scene, this.camera, this.realTime, this.reflectHide);
      this.pipeline.render(this.scene, this.camera, this.realTime, this.reflectHide);
      const url = this.pipeline.renderer.domElement.toDataURL('image/png');
      this.pipeline.renderer.setPixelRatio(pr);
      this.vw = 0;
      this.vh = 0;
      void ow;
      void oh;
      await fetch(`/__shot?name=${encodeURIComponent(name)}`, { method: 'POST', body: url });
      return url.length;
    },
    /** ポーズなどを解除してプレイ状態にする */
    play: () => {
      this.screens.hideAll();
      this.boardView.close();
      this.state = 'play';
      this.audio.setMuffled(false);
    },
    info: () => ({
      state: this.state,
      x: +this.player.pos.x.toFixed(2),
      z: +this.player.pos.z.toFixed(2),
      tx: wt(this.player.pos.x),
      ty: wt(this.player.pos.z),
      cp: this.run?.checkpoint,
      agent: this.run?.agent,
      sus: this.sensors.filter((s) => s.suspicion > 0).map((s) => `${s.id}:${s.suspicion.toFixed(2)}`),
    }),
    teleport: (cp: number) => {
      if (!this.run) return;
      this.run.checkpoint = cp;
      this.resetToCheckpoint();
    },
    god: (on?: boolean) => {
      this.godMode = on ?? !this.godMode;
      this.player.untargetable = this.godMode;
      return this.godMode;
    },
    goto: (x: number, y: number) => {
      this.player.place(tw(x), tw(y), this.player.facing);
      this.snapCamera();
    },
  };
}
