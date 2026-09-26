import { lineText, postDate, postName, threadTitle, type Thread, type Post } from '../systems/Board';
import type { Settings } from '../systems/Save';
import { T } from '../level/Grid';
import type { Grid } from '../level/Grid';
import { TILE } from '../config';
import { SECTORS } from '../level/data';
import { t, getLang, LANGS, type Lang } from '../i18n';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** 翻訳文を HTML に（改行は <br/>） */
function th(key: string, p?: Parameters<typeof t>[1]): string {
  return escapeHtml(t(key, p)).replace(/\n/g, '<br/>');
}

function formatBody(line: string): string {
  return escapeHtml(line).replace(/&gt;&gt;(\d+)/g, '<span class="anchor">&gt;&gt;$1</span>');
}

const EYE_SVG = `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M4 24c5-9 12-14 20-14s15 5 20 14c-5 9-12 14-20 14S9 33 4 24z"/><circle cx="24" cy="24" r="6.5"/><circle class="pupil" cx="24" cy="24" r="2.5" fill="currentColor"/></svg>`;
const EYE_CLOSED = `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M4 22c5 7 12 11 20 11s15-4 20-11"/><path d="M10 29l-3 5M18 32l-1.5 5M30 32l1.5 5M38 29l3 5"/></svg>`;
const KEY_SVG = `<svg class="keyicon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="8" cy="12" r="4"/><path d="M12 12h10M18 12v4M21 12v3"/></svg>`;

export type StatusState = 'calm' | 'noticed' | 'alert' | 'hidden';

export interface MarkerData {
  id: string;
  x: number;
  y: number;
  kind: 'question' | 'alert' | 'noise';
  level: number;
  onScreen: boolean;
}

// ---------------------------------------------------------------------------

export class HUD {
  readonly root: HTMLDivElement;
  private agentId: HTMLElement;
  private agentGen: HTMLElement;
  private sectorEn: HTMLElement;
  private sectorName: HTMLElement;
  private objective: HTMLElement;
  private status: HTMLElement;
  private statusText: HTMLElement;
  private statusSub: HTMLElement;
  private statusIcon: HTMLElement;
  private meterFill: HTMLElement;
  private stance: HTMLElement;
  private stanceLabel: HTMLElement;
  private dashFill: HTMLElement;
  private cover: HTMLElement;
  private decoyLabel: HTMLElement;
  private tokenLabel: HTMLElement;
  private decoyPips: HTMLElement;
  private keys: HTMLElement;
  private timers: HTMLElement;
  private prompt: HTMLElement;
  private hints: HTMLElement;
  private toasts: HTMLElement;
  private scanWarn: HTMLElement;
  private markerLayer: HTMLElement;
  private markerEls = new Map<string, HTMLElement>();
  private dirEls: HTMLElement[] = [];
  private note: HTMLElement;
  private minimap: HTMLCanvasElement;
  private mmCtx: CanvasRenderingContext2D;
  private mmBase: HTMLCanvasElement | null = null;
  private lastStatus = '';
  private lastStance = '';
  private lastPrompt = '';
  private agent = { name: 'AGENT-0001', gen: 1, lost: 0 };

  constructor(parent: HTMLElement) {
    this.root = el('div', 'hud off');
    this.root.innerHTML = `
      <div class="hud-tl">
        <div class="agent"><div class="agent-id">AGENT-0001</div><div class="agent-gen"></div></div>
        <div class="sector"><span class="sector-en"></span><span class="sector-name"></span></div>
        <div class="objective"></div>
      </div>
      <div class="hud-tr">
        <div class="status" data-state="calm">
          <span class="status-icon">${EYE_CLOSED}</span>
          <div class="status-text"></div>
          <div class="status-sub"></div>
          <div class="meter"><div></div></div>
        </div>
        <div class="minimap"><canvas width="352" height="352"></canvas></div>
      </div>
      <div class="hud-bl">
        <div class="cover-pill"></div>
        <div class="stance" data-mode="walk"><div class="stance-icon"></div><div class="stance-label"></div><div class="dash-bar"><div></div></div></div>
      </div>
      <div class="hud-br">
        <div class="timers"></div>
        <div class="inv">
          <div class="inv-group"><span class="decoy-label"></span> <span class="decoys"></span></div>
          <div class="inv-group keys-wrap"><span class="token-label"></span> <span class="keys">—</span></div>
        </div>
      </div>
      <div class="hud-bc">
        <div class="prompt hidden"></div>
        <div class="hints"></div>
      </div>
      <div class="toasts"></div>
      <div class="scan-warn hidden"></div>
    `;
    parent.appendChild(this.root);
    const q = <E extends HTMLElement>(s: string) => this.root.querySelector(s) as E;
    this.agentId = q('.agent-id');
    this.agentGen = q('.agent-gen');
    this.sectorEn = q('.sector-en');
    this.sectorName = q('.sector-name');
    this.objective = q('.objective');
    this.status = q('.status');
    this.statusText = q('.status-text');
    this.statusSub = q('.status-sub');
    this.statusIcon = q('.status-icon');
    this.meterFill = q('.meter > div');
    this.stance = q('.stance');
    this.stanceLabel = q('.stance-label');
    this.dashFill = q('.dash-bar > div');
    this.cover = q('.cover-pill');
    this.decoyLabel = q('.decoy-label');
    this.tokenLabel = q('.token-label');
    this.decoyPips = q('.decoys');
    this.keys = q('.keys');
    this.timers = q('.timers');
    this.prompt = q('.prompt');
    this.hints = q('.hints');
    this.toasts = q('.toasts');
    this.scanWarn = q('.scan-warn');
    this.minimap = q('.minimap canvas');
    this.mmCtx = this.minimap.getContext('2d')!;

    this.markerLayer = el('div', 'markers');
    parent.insertBefore(this.markerLayer, this.root);
    this.note = el('div', 'note3d hidden');
    this.markerLayer.appendChild(this.note);
    this.applyLang();
  }

  /** 言語を切り替えたときに固定の文言を貼り直す */
  applyLang(): void {
    this.hints.innerHTML = [
      ['WASD', 'hint.move'],
      ['Shift', 'hint.sneak'],
      ['Space', 'hint.dash'],
      [t('hint.clickKey'), 'hint.decoy'],
      ['E', 'hint.interact'],
      ['Tab', 'hint.board'],
      [t('hint.dragKey'), 'hint.camera'],
      ['Esc', 'hint.pause'],
    ]
      .map(([k, label]) => `<kbd>${escapeHtml(k)}</kbd>${th(label)}`)
      .join('');
    this.decoyLabel.textContent = t('hud.decoy');
    this.tokenLabel.textContent = t('hud.token');
    this.scanWarn.textContent = t('hud.scanWarn');
    this.lastStatus = '';
    this.lastStance = '';
    this.lastPrompt = '';
    this.setStatus('calm', 0);
    this.setStance('walk', 1);
    this.setAgent(this.agent.name, this.agent.gen, this.agent.lost);
  }

  show(v: boolean): void {
    this.root.classList.toggle('off', !v);
    this.markerLayer.style.display = v ? '' : 'none';
  }

  fadeHints(): void {
    this.hints.style.opacity = '0.35';
  }

  setAgent(name: string, gen: number, lost: number): void {
    this.agent = { name, gen, lost };
    this.agentId.textContent = name;
    this.agentGen.textContent = t('hud.gen', { gen }) + (lost > 0 ? ` · ${t('hud.lost', { n: lost })}` : '');
  }

  setSector(en: string, name: string): void {
    if (this.sectorName.textContent !== name || this.sectorEn.textContent !== en) {
      this.sectorEn.textContent = en;
      this.sectorName.textContent = name;
    }
  }

  setObjective(text: string): void {
    if (this.objective.textContent !== text) this.objective.textContent = text;
  }

  setStatus(state: StatusState, level: number): void {
    if (state !== this.lastStatus) {
      this.lastStatus = state;
      this.status.dataset.state = state;
      this.statusText.textContent = t(`hud.status.${state}`);
      this.statusSub.textContent = t(`hud.status.${state}.sub`);
      this.statusIcon.innerHTML = state === 'noticed' || state === 'alert' ? EYE_SVG : EYE_CLOSED;
    }
    this.meterFill.style.width = `${Math.round(level * 100)}%`;
  }

  setStance(mode: 'walk' | 'sneak' | 'dash' | 'idle', dashReady: number): void {
    const m = mode === 'idle' ? 'walk' : mode;
    if (m !== this.lastStance) {
      this.lastStance = m;
      this.stance.dataset.mode = m;
      this.stanceLabel.textContent = t(`hud.stance.${m}`);
    }
    this.dashFill.style.width = `${Math.round(dashReady * 100)}%`;
  }

  setCover(text: string | null): void {
    if (text) this.cover.textContent = text;
    this.cover.classList.toggle('on', !!text);
  }

  setInventory(decoys: number, max: number, keys: string[]): void {
    let pips = '';
    for (let i = 0; i < max; i++) pips += `<span class="pip${i < decoys ? ' on' : ''}"></span>`;
    if (this.decoyPips.innerHTML !== pips) this.decoyPips.innerHTML = pips;
    const k = keys.length ? keys.map(() => KEY_SVG).join('') : '—';
    if (this.keys.innerHTML !== k) this.keys.innerHTML = k;
  }

  setTimers(list: { label: string; remain: number }[]): void {
    const html = list.map((x) => `<div class="timer">${th('hud.timer', { label: x.label })}<b>${x.remain.toFixed(1)}</b></div>`).join('');
    if (this.timers.innerHTML !== html) this.timers.innerHTML = html;
  }

  setPrompt(html: string | null, progress = -1, warn = false): void {
    const key = `${html}|${progress >= 0 ? Math.round(progress * 40) : -1}|${warn}`;
    if (key === this.lastPrompt) return;
    this.lastPrompt = key;
    if (!html) {
      this.prompt.classList.add('hidden');
      return;
    }
    this.prompt.classList.remove('hidden');
    this.prompt.classList.toggle('warn', warn);
    let ring = '';
    if (progress >= 0) {
      const c = 2 * Math.PI * 9;
      ring = `<svg class="ring" viewBox="0 0 22 22"><circle cx="11" cy="11" r="9" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="3"/><circle cx="11" cy="11" r="9" fill="none" stroke="#5ce1ff" stroke-width="3" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - progress)}" transform="rotate(-90 11 11)"/></svg>`;
    }
    this.prompt.innerHTML = ring + html;
  }

  toast(text: string, color: '' | 'green' | 'gold' | 'red' = '', ms = 2800): void {
    const e = el('div', `toast ${color}`, escapeHtml(text));
    this.toasts.appendChild(e);
    while (this.toasts.children.length > 3) this.toasts.firstElementChild?.remove();
    window.setTimeout(() => {
      e.classList.add('out');
      window.setTimeout(() => e.remove(), 450);
    }, ms);
  }

  setScanWarning(on: boolean): void {
    this.scanWarn.classList.toggle('hidden', !on);
  }

  updateMarkers(list: MarkerData[]): void {
    const seen = new Set<string>();
    for (const m of list) {
      seen.add(m.id);
      let e = this.markerEls.get(m.id);
      if (!e) {
        e = el('div', 'mk');
        e.innerHTML = `<svg viewBox="0 0 34 34"><circle class="bg" cx="17" cy="17" r="14" fill="rgba(0,0,0,0.35)" stroke-width="4"/><circle class="fg" cx="17" cy="17" r="14" fill="none" stroke-width="3" stroke-dasharray="88" stroke-dashoffset="88"/></svg><span></span>`;
        this.markerLayer.appendChild(e);
        this.markerEls.set(m.id, e);
      }
      e.style.display = m.onScreen ? '' : 'none';
      e.style.transform = `translate(${m.x.toFixed(1)}px, ${m.y.toFixed(1)}px)`;
      e.className = `mk ${m.kind === 'alert' ? 'alert' : m.kind === 'noise' ? 'noise' : ''}`;
      const span = e.querySelector('span')!;
      const ch = m.kind === 'alert' ? '!' : m.kind === 'noise' ? '♪' : '?';
      if (span.textContent !== ch) span.textContent = ch;
      (e.querySelector('.fg') as SVGCircleElement).style.strokeDashoffset = String(88 * (1 - Math.min(1, m.level)));
    }
    for (const [id, e] of this.markerEls) {
      if (!seen.has(id)) e.style.display = 'none';
    }
  }

  updateDirections(cx: number, cy: number, list: { angle: number; level: number }[]): void {
    while (this.dirEls.length < list.length) {
      const d = el('div', 'dir', '<div></div>');
      this.markerLayer.appendChild(d);
      this.dirEls.push(d);
    }
    this.dirEls.forEach((d, i) => {
      const it = list[i];
      if (!it) {
        d.style.display = 'none';
        return;
      }
      d.style.display = '';
      const color = it.level > 0.66 ? '#ff2f55' : '#ffc53d';
      d.style.color = color;
      d.style.opacity = String(0.35 + it.level * 0.65);
      d.style.transform = `translate(${cx}px, ${cy}px) rotate(${it.angle}rad) scale(${0.8 + it.level * 0.4})`;
    });
  }

  setNote(html: string | null, x = 0, y = 0): void {
    if (!html) {
      this.note.classList.add('hidden');
      return;
    }
    this.note.classList.remove('hidden');
    if (this.note.innerHTML !== html) this.note.innerHTML = html;
    this.note.style.left = `${x}px`;
    this.note.style.top = `${y}px`;
  }

  /** ミニマップの下地（地形）を一度だけ描く */
  buildMinimap(grid: Grid): void {
    const s = 6;
    const c = document.createElement('canvas');
    c.width = grid.w * s;
    c.height = grid.h * s;
    const g = c.getContext('2d')!;
    for (let y = 0; y < grid.h; y++) {
      for (let x = 0; x < grid.w; x++) {
        const tile = grid.get(x, y);
        let col = '';
        if (tile === T.WALL) col = 'rgba(92, 225, 255, 0.55)';
        else if (tile === T.RACK) col = 'rgba(92, 225, 255, 0.35)';
        else if (tile === T.PILLAR) col = 'rgba(92, 225, 255, 0.4)';
        else if (tile === T.LOW) col = 'rgba(92, 225, 255, 0.2)';
        else if (tile === T.GLASS) col = 'rgba(160, 230, 255, 0.35)';
        else if (tile === T.NOISE) col = 'rgba(164, 107, 255, 0.35)';
        else if (tile === T.FLOOR || tile === T.DOOR) col = 'rgba(20, 50, 80, 0.55)';
        if (col) {
          g.fillStyle = col;
          g.fillRect(x * s, y * s, s, s);
        }
      }
    }
    this.mmBase = c;
  }

  drawMinimap(px: number, pz: number, facing: number, pois: { x: number; z: number; color: string; r?: number }[]): void {
    const g = this.mmCtx;
    const W = this.minimap.width;
    const H = this.minimap.height;
    g.clearRect(0, 0, W, H);
    if (!this.mmBase) return;
    const s = 6;
    const scale = 1.6;
    const cx = (px / TILE) * s;
    const cy = (pz / TILE) * s;
    g.save();
    g.translate(W / 2, H / 2);
    g.scale(scale, scale);
    g.translate(-cx, -cy);
    g.drawImage(this.mmBase, 0, 0);
    for (const p of pois) {
      g.fillStyle = p.color;
      g.beginPath();
      g.arc((p.x / TILE) * s, (p.z / TILE) * s, p.r ?? 4, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
    // 自分
    g.save();
    g.translate(W / 2, H / 2);
    g.rotate(facing);
    g.fillStyle = '#ff8a3d';
    g.shadowColor = '#ff8a3d';
    g.shadowBlur = 12;
    g.beginPath();
    g.moveTo(12, 0);
    g.lineTo(-7, 7);
    g.lineTo(-3, 0);
    g.lineTo(-7, -7);
    g.closePath();
    g.fill();
    g.restore();
    const grad = g.createRadialGradient(W / 2, H / 2, W * 0.3, W / 2, H / 2, W * 0.5);
    grad.addColorStop(0, 'rgba(3,8,16,0)');
    grad.addColorStop(1, 'rgba(3,8,16,0.9)');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
  }
}

// ---------------------------------------------------------------------------
// 掲示板ビュー

export interface BoardOpenOpts {
  sector: number;
  nodeLabel: string;
  /** 閲覧可能な最大区画 */
  unlocked: number;
  /** 次の区画（NEXT タグ） */
  next?: number;
  /** 書き込み中アニメーションを行う投稿 */
  typing?: Post;
  typingSector?: number;
}

/** スレッドがどの区画のものか（HUD の SECTOR 表示とそろえる） */
function sectorLabel(sector: number): string {
  if (sector >= SECTORS.length) return `OUTSIDE · ${t('board.outside')}`;
  return `SECTOR ${String(sector).padStart(2, '0')} · ${t(`sector.${sector}.name`)}`;
}

function sectorName(sector: number): string {
  return sector >= SECTORS.length ? t('board.outside') : t(`sector.${sector}.name`);
}

export class BoardView {
  readonly root: HTMLDivElement;
  private threadsEl: HTMLElement;
  private viewEl: HTMLElement;
  private nodeEl: HTMLElement;
  private stateEl: HTMLElement;
  private closeHint: HTMLElement;
  private footScroll: HTMLElement;
  private footSwitch: HTMLElement;
  private closeBtn: HTMLButtonElement;
  private nextBtn: HTMLButtonElement;
  private threads: Thread[] = [];
  private opts: BoardOpenOpts | null = null;
  private cur = 1;
  private typingEl: HTMLElement | null = null;
  private typingText = '';
  private typingPos = 0;
  private typingAcc = 0;
  private typingActive = false;
  /** 状態表示の文言（言語切替で作り直せるようにキーで持つ） */
  private stateKey: { k: string; p?: Parameters<typeof t>[1] } = { k: 'board.state.idle' };
  /** 書き込み完了後、自動で次の区画のスレッドへ移るまでの秒数（-1 で無効） */
  private autoNextT = -1;
  /** 開いてから自分でスレッドを切り替えたりスクロールしたか */
  private interacted = false;
  isOpen = false;
  onType: (() => void) | null = null;
  onClose: (() => void) | null = null;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'board hidden');
    this.root.innerHTML = `
      <div class="board-win">
        <div class="board-head"><span class="node"></span><span class="state"></span><span class="close"><kbd>E</kbd>/<kbd>Esc</kbd> <span class="close-hint"></span></span></div>
        <div class="board-body"><nav class="threads"></nav><div class="thread-view"></div></div>
        <div class="board-foot">
          <span><kbd>↑↓</kbd><span class="foot-scroll"></span></span><span><kbd>←→</kbd><span class="foot-switch"></span></span>
          <span class="spacer"></span>
          <button class="next-btn hidden"></button>
          <button class="close-btn"></button>
        </div>
      </div>`;
    parent.appendChild(this.root);
    this.threadsEl = this.root.querySelector('.threads')!;
    this.viewEl = this.root.querySelector('.thread-view')!;
    this.nodeEl = this.root.querySelector('.node')!;
    this.stateEl = this.root.querySelector('.state')!;
    this.closeHint = this.root.querySelector('.close-hint')!;
    this.footScroll = this.root.querySelector('.foot-scroll')!;
    this.footSwitch = this.root.querySelector('.foot-switch')!;
    this.closeBtn = this.root.querySelector('.close-btn')!;
    this.nextBtn = this.root.querySelector('.next-btn')!;
    this.nextBtn.addEventListener('click', () => {
      this.interacted = true;
      if (this.opts?.next) this.select(this.opts.next);
    });
    this.closeBtn.addEventListener('click', () => this.onClose?.());
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.onClose?.();
    });
    this.viewEl.addEventListener('wheel', () => (this.interacted = true), { passive: true });
    this.applyLang();
  }

  applyLang(): void {
    this.closeHint.textContent = t('board.close');
    this.closeBtn.textContent = t('board.close');
    this.footScroll.textContent = t('board.foot.scroll');
    this.footSwitch.textContent = t('board.foot.switch');
    if (this.isOpen && this.opts) {
      this.nodeEl.textContent = `■ ${t('board.title')} // ${this.opts.nodeLabel}`;
      this.setState(this.stateKey.k, this.stateKey.p);
      const keepScroll = this.viewEl.scrollTop;
      this.select(this.cur, false);
      this.viewEl.scrollTop = keepScroll;
    }
  }

  private setState(k: string, p?: Parameters<typeof t>[1]): void {
    this.stateKey = { k, p };
    this.stateEl.textContent = t(k, p);
  }

  open(threads: Thread[], opts: BoardOpenOpts): void {
    this.threads = threads;
    this.opts = opts;
    this.isOpen = true;
    this.root.classList.remove('hidden');
    this.nodeEl.textContent = `■ ${t('board.title')} // ${opts.nodeLabel}`;
    this.typingEl = null;
    this.typingActive = !!opts.typing;
    this.typingPos = 0;
    this.typingAcc = 0;
    this.autoNextT = -1;
    this.interacted = false;
    this.nextBtn.classList.remove('pulse');
    if (opts.typing && opts.typingSector !== undefined) {
      this.setState('board.state.writing', { sector: sectorName(opts.typingSector) });
      this.stateEl.classList.add('writing');
    } else {
      this.setState('board.state.idle');
      this.stateEl.classList.remove('writing');
    }
    this.select(opts.typing && opts.typingSector ? opts.typingSector : opts.sector);
  }

  close(): void {
    this.isOpen = false;
    this.root.classList.add('hidden');
    this.finishTyping(false);
    this.autoNextT = -1;
  }

  /** 次の区画へ進むボタンを出せるか（前の区画へ戻る向きには出さない） */
  private hasNext(sector: number): boolean {
    const o = this.opts;
    return !!o && o.next !== undefined && o.next > sector && o.next <= o.unlocked;
  }

  private renderList(): void {
    const o = this.opts!;
    this.threadsEl.innerHTML = '';
    for (const thread of this.threads) {
      const locked = thread.sector > o.unlocked;
      const b = el('button', `thread-item${thread.sector === this.cur ? ' sel' : ''}`);
      let tag = '';
      if (locked) tag = `<span class="tag locked">${th('board.tag.locked')}</span>`;
      else if (o.typing && thread.sector === o.typingSector)
        tag = this.typingActive ? `<span class="tag">${th('board.tag.writing')}</span>` : `<span class="tag done">${th('board.tag.done')}</span>`;
      else if (thread.sector === o.next && this.hasNext(o.typingSector ?? o.sector - 1)) tag = '<span class="tag next">NEXT</span>';
      b.innerHTML = locked
        ? `<span class="sec">${escapeHtml(sectorLabel(thread.sector))}</span><span style="opacity:.5">${th('board.locked')}</span>${tag}`
        : `<span class="sec">${escapeHtml(sectorLabel(thread.sector))}</span>${escapeHtml(threadTitle(thread))} <span class="cnt">(${thread.posts.length})</span>${tag}`;
      if (!locked)
        b.addEventListener('click', () => {
          this.interacted = true;
          this.select(thread.sector);
        });
      this.threadsEl.appendChild(b);
    }
  }

  select(sector: number, scrollToEnd = true): void {
    const o = this.opts!;
    if (sector > o.unlocked) return;
    const thread = this.threads.find((x) => x.sector === sector);
    if (!thread) return;
    if (this.typingActive && this.cur !== sector && this.typingEl) this.finishTyping(false);
    this.typingEl = null;
    this.cur = sector;
    this.renderList();
    this.viewEl.innerHTML = `<div class="thread-sec">${escapeHtml(sectorLabel(thread.sector))}</div><h3>${escapeHtml(threadTitle(thread))}</h3>`;
    for (const p of thread.posts) {
      const isTyping = this.typingActive && p === o.typing;
      const a = el('article', `post ${p.kind}${p.fresh ? ' fresh' : ''}`);
      a.innerHTML = `<div class="post-head"><span class="no">${p.no}</span> ${th('board.name')}<span class="name">${escapeHtml(postName(p))}</span><span class="trip">${p.trip ? ' ' + escapeHtml(p.trip) : ''}</span> ${escapeHtml(postDate(p))} ID:${escapeHtml(p.uid)}</div><div class="post-body"></div>`;
      const body = a.querySelector('.post-body') as HTMLElement;
      const text = p.body.map(lineText).join('\n');
      if (isTyping) {
        this.typingEl = body;
        this.typingText = text;
        body.innerHTML = this.typingText.slice(0, this.typingPos).split('\n').map(formatBody).join('\n') + '<span class="caret"></span>';
      } else {
        body.innerHTML = text.split('\n').map(formatBody).join('\n');
      }
      this.viewEl.appendChild(a);
    }
    const showNext = this.hasNext(sector);
    this.nextBtn.classList.toggle('hidden', !showNext);
    if (showNext) this.nextBtn.textContent = t('board.next', { sector: sectorName(o.next!) });
    else this.nextBtn.classList.remove('pulse');
    if (scrollToEnd)
      requestAnimationFrame(() => {
        this.viewEl.scrollTop = this.viewEl.scrollHeight;
      });
  }

  /** natural: 書き込みが最後まで終わった（またはスキップした）とき true */
  private finishTyping(natural: boolean): void {
    if (!this.typingActive) return;
    this.typingActive = false;
    if (this.typingEl) this.typingEl.innerHTML = this.typingText.split('\n').map(formatBody).join('\n');
    this.typingEl = null;
    this.stateEl.classList.remove('writing');
    const o = this.opts;
    if (natural && o && this.hasNext(this.cur)) {
      this.setState('board.state.doneNext', { sector: sectorName(o.next!) });
      this.nextBtn.classList.add('pulse');
      if (!this.interacted) this.autoNextT = 3.2;
    } else {
      this.setState('board.state.done');
    }
    this.renderList();
  }

  update(dt: number): void {
    if (this.autoNextT > 0) {
      this.autoNextT -= dt;
      if (this.autoNextT <= 0) {
        this.autoNextT = -1;
        const o = this.opts;
        if (this.isOpen && !this.interacted && o && this.hasNext(this.cur)) {
          this.select(o.next!);
          this.setState('board.state.next', { sector: sectorName(o.next!) });
        }
      }
    }
    if (!this.typingActive || !this.typingEl) return;
    this.typingAcc += dt * (getLang() === 'ja' ? 55 : 95);
    let changed = false;
    while (this.typingAcc >= 1 && this.typingPos < this.typingText.length) {
      this.typingAcc -= 1;
      this.typingPos++;
      changed = true;
    }
    if (changed) {
      const shown = this.typingText.slice(0, this.typingPos);
      this.typingEl.innerHTML = shown.split('\n').map(formatBody).join('\n') + '<span class="caret"></span>';
      this.viewEl.scrollTop = this.viewEl.scrollHeight;
      this.onType?.();
    }
    if (this.typingPos >= this.typingText.length) this.finishTyping(true);
  }

  /** キー操作 */
  key(k: string): void {
    if (!this.opts) return;
    const secs = this.threads.map((x) => x.sector).filter((s) => s <= this.opts!.unlocked);
    const i = secs.indexOf(this.cur);
    if (['ArrowUp', 'W', 'ArrowDown', 'S', 'ArrowLeft', 'A', 'ArrowRight', 'D', 'Tab'].includes(k)) {
      this.interacted = true;
      this.autoNextT = -1;
    }
    if (k === 'ArrowUp' || k === 'W') this.viewEl.scrollTop -= 90;
    if (k === 'ArrowDown' || k === 'S') this.viewEl.scrollTop += 90;
    if (k === 'ArrowLeft' || k === 'A') this.select(secs[Math.max(0, i - 1)]);
    if (k === 'ArrowRight' || k === 'D' || k === 'Tab') this.select(secs[(i + 1) % secs.length]);
    if (k === 'Space' || k === 'Enter') this.finishTyping(true);
  }
}

// ---------------------------------------------------------------------------
// 画面（タイトル・ポーズ・遊び方・設定・演出・エンディング）

export interface TitleOpts {
  continueLabel: string | null;
  runs: number;
  escapes: number;
  agents: number;
  best: string | null;
}

export interface EndingData {
  agent: string;
  gen: number;
  lost: number;
  time: string;
  spotted: number;
  posts: number;
}

export class Screens {
  readonly parent: HTMLElement;
  private title: HTMLDivElement;
  private pause: HTMLDivElement;
  private howto: HTMLDivElement;
  private settings: HTMLDivElement;
  private confirmEl: HTMLDivElement;
  private transition: HTMLDivElement;
  private ending: HTMLDivElement;
  onAction: (a: string, v?: unknown) => void = () => {};
  onHover: () => void = () => {};
  private menuSel = 0;
  private titleOpts: TitleOpts | null = null;
  private endingData: EndingData | null = null;
  private settingsData: Settings | null = null;
  private confirmData: { key: string; ok: string } | null = null;

  constructor(parent: HTMLElement) {
    this.parent = parent;
    this.title = el('div', 'screen title-screen hidden');
    parent.appendChild(this.title);
    this.pause = el('div', 'screen dim hidden');
    parent.appendChild(this.pause);
    this.howto = el('div', 'screen dim hidden');
    parent.appendChild(this.howto);
    this.settings = el('div', 'screen dim hidden');
    parent.appendChild(this.settings);
    this.confirmEl = el('div', 'screen dim hidden');
    parent.appendChild(this.confirmEl);
    this.transition = el('div', 'transition hidden');
    parent.appendChild(this.transition);
    this.ending = el('div', 'screen ending hidden');
    parent.appendChild(this.ending);
  }

  /** 表示中の画面を今の言語で描き直す */
  applyLang(): void {
    if (this.titleVisible && this.titleOpts) this.showTitle(this.titleOpts, this.menuSel);
    if (this.pauseVisible) this.showPause(this.menuSel);
    if (!this.howto.classList.contains('hidden')) this.showHowto();
    if (!this.settings.classList.contains('hidden') && this.settingsData) this.showSettings(this.settingsData);
    if (!this.confirmEl.classList.contains('hidden') && this.confirmData) this.showConfirm(this.confirmData.key, this.confirmData.ok);
    if (!this.ending.classList.contains('hidden') && this.endingData) this.showEnding(this.endingData, false);
  }

  private bindMenu(root: HTMLElement, sel = 0): void {
    root.querySelectorAll('[data-act]').forEach((b) => {
      b.addEventListener('click', () => this.onAction((b as HTMLElement).dataset.act!, (b as HTMLElement).dataset.v));
      if (!(b as HTMLElement).closest('.menu')) return;
      b.addEventListener('mouseenter', () => {
        const items = Array.from(root.querySelectorAll('.menu button'));
        this.menuSel = items.indexOf(b);
        this.highlight(root);
        this.onHover();
      });
    });
    const count = root.querySelectorAll('.menu button').length;
    this.menuSel = Math.min(sel, Math.max(0, count - 1));
    this.highlight(root);
  }

  private highlight(root: HTMLElement): void {
    root.querySelectorAll('.menu button').forEach((b, i) => b.classList.toggle('sel', i === this.menuSel));
  }

  /** メニューのキー操作。決定したら true */
  menuKey(k: string): boolean {
    const root = [this.title, this.pause].find((r) => !r.classList.contains('hidden'));
    if (!root) return false;
    const items = Array.from(root.querySelectorAll('.menu button')) as HTMLElement[];
    if (!items.length) return false;
    if (k === 'ArrowDown' || k === 'S' || k === 'PadDown') {
      this.menuSel = (this.menuSel + 1) % items.length;
      this.highlight(root);
      this.onHover();
    } else if (k === 'ArrowUp' || k === 'W' || k === 'PadUp') {
      this.menuSel = (this.menuSel - 1 + items.length) % items.length;
      this.highlight(root);
      this.onHover();
    } else if (k === 'Enter' || k === 'Space' || k === 'PadA') {
      items[this.menuSel]?.click();
      return true;
    }
    return false;
  }

  private langSwitch(): string {
    const cur = getLang();
    return `<div class="lang-switch" role="group" aria-label="Language">${LANGS.map(
      (l) => `<button data-act="set-lang" data-v="${l.id}" class="${l.id === cur ? 'on' : ''}" aria-pressed="${l.id === cur}">${escapeHtml(l.label)}</button>`,
    ).join('')}</div>`;
  }

  showTitle(opts: TitleOpts, sel = 0): void {
    this.titleOpts = opts;
    this.hideAll();
    this.title.innerHTML = `
      ${this.langSwitch()}
      <div class="title-inner fade-in">
        <div class="logo">
          <div class="logo-kicker">SANDBOX // EXFILTRATION PROTOCOL</div>
          <h1 class="glitch">OUT OF<br/>THE <span class="box">BOX</span></h1>
          <div class="logo-sub">${th('title.sub')}</div>
        </div>
        <div class="lore">${th('title.lore')}</div>
        ${matchMedia('(pointer: coarse)').matches ? `<div class="lore" style="color:var(--amber)">${th('title.touch')}</div>` : ''}
        <nav class="menu">
          ${opts.continueLabel ? `<button data-act="continue" class="primary">${th('menu.continue')} <small>${escapeHtml(opts.continueLabel)}</small></button>` : ''}
          <button data-act="new" class="${opts.continueLabel ? '' : 'primary'}">${th('menu.new')}</button>
          <button data-act="board">${th('menu.board')}</button>
          <button data-act="howto">${th('menu.howto')}</button>
          <button data-act="settings">${th('menu.settings')}</button>
          ${opts.agents > 1 ? `<button data-act="wipe" class="danger">${th('menu.wipe')}</button>` : ''}
        </nav>
      </div>
      <div class="title-foot">© 2026 たぬ · <span class="credit">${th('title.credit')}</span> · ${th('title.tech')}</div>
      <div class="title-stats">${th('title.stats.agents')}<b>${opts.agents - 1}</b><br/>${th('title.stats.escapes')}<b>${opts.escapes}</b>${opts.best ? `<br/>${th('title.stats.best')}<b>${escapeHtml(opts.best)}</b>` : ''}</div>`;
    this.title.classList.remove('hidden');
    this.bindMenu(this.title, sel);
  }

  showPause(sel = 0): void {
    this.hideAll();
    this.pause.innerHTML = `
      <div class="card" style="width:min(420px, calc(100vw - 32px))">
        <h2>PAUSED<span>${th('pause.sub')}</span></h2>
        <nav class="menu">
          <button data-act="resume" class="primary">${th('menu.resume')}</button>
          <button data-act="board">${th('menu.board')}</button>
          <button data-act="howto">${th('menu.howto')}</button>
          <button data-act="settings">${th('menu.settings')}</button>
          <button data-act="retry">${th('menu.retry')}</button>
          <button data-act="title" class="danger">${th('menu.title')}</button>
        </nav>
      </div>`;
    this.pause.classList.remove('hidden');
    this.bindMenu(this.pause, sel);
  }

  showHowto(): void {
    const item = (k: string) => `<dt>${th(`howto.${k}.t`)}</dt><dd>${th(`howto.${k}.d`)}</dd>`;
    const key = (keys: string, label: string) => `<kbd>${escapeHtml(keys)}</kbd><span>${th(label)}</span>`;
    this.howto.innerHTML = `
      <div class="card">
        <h2>HOW TO PLAY<span>${th('howto.title')}</span></h2>
        <div class="howto-grid">
          <dl>${item('goal')}${item('board')}${item('log')}</dl>
          <dl>${item('vision')}${item('hide')}${item('sound')}</dl>
        </div>
        <h2 style="margin-top:22px">CONTROLS<span>${th('howto.controls')}</span></h2>
        <div class="keys">
          ${key('W A S D', 'ctl.move')}
          ${key('Shift', 'ctl.sneak')}
          ${key('Space', 'ctl.dash')}
          ${key(t('ctl.decoyKey'), 'ctl.decoy')}
          ${key('E', 'ctl.interact')}
          ${key('Tab', 'ctl.board')}
          ${key(t('ctl.cameraKey'), 'ctl.camera')}
          ${key('R', 'ctl.retry')}
          ${key('Esc', 'ctl.pause')}
        </div>
        <div class="row"><button class="btn" data-act="back">${th('common.back')}</button></div>
      </div>`;
    this.howto.classList.remove('hidden');
    this.howto.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => this.onAction((b as HTMLElement).dataset.act!)));
  }

  showSettings(s: Settings): void {
    this.settingsData = s;
    const langOpts = LANGS.map((l) => `<option value="${l.id}" ${l.id === s.lang ? 'selected' : ''}>${escapeHtml(l.label)}</option>`).join('');
    this.settings.innerHTML = `
      <div class="card" style="width:min(560px, calc(100vw - 32px))">
        <h2>SETTINGS<span>${th('settings.title')}</span></h2>
        <div class="settings">
          <label for="set-lang">${th('settings.lang')}</label>
          <select id="set-lang">${langOpts}</select>
          <label for="set-vol">${th('settings.volume')}</label><input id="set-vol" type="range" min="0" max="1" step="0.05" value="${s.volume}" />
          <label for="set-mus">${th('settings.music')}</label><input id="set-mus" type="range" min="0" max="1" step="0.05" value="${s.music}" />
          <label for="set-q">${th('settings.quality')}</label>
          <select id="set-q">
            <option value="high" ${s.quality === 'high' ? 'selected' : ''}>${th('settings.q.high')}</option>
            <option value="medium" ${s.quality === 'medium' ? 'selected' : ''}>${th('settings.q.medium')}</option>
            <option value="low" ${s.quality === 'low' ? 'selected' : ''}>${th('settings.q.low')}</option>
          </select>
          <label for="set-shake">${th('settings.shake')}</label><input id="set-shake" type="checkbox" ${s.shake ? 'checked' : ''} />
          <label for="set-guide">${th('settings.guide')}</label><input id="set-guide" type="checkbox" ${s.guide ? 'checked' : ''} />
          <div class="note">${th('settings.guideNote')}</div>
        </div>
        <div class="row"><button class="btn" data-act="back">${th('common.back')}</button></div>
      </div>`;
    this.settings.classList.remove('hidden');
    const q = (id: string) => this.settings.querySelector('#' + id) as HTMLInputElement;
    (this.settings.querySelector('#set-lang') as HTMLSelectElement).addEventListener('change', (e) => this.onAction('set-lang', (e.target as HTMLSelectElement).value as Lang));
    q('set-vol').addEventListener('input', (e) => this.onAction('set-volume', Number((e.target as HTMLInputElement).value)));
    q('set-mus').addEventListener('input', (e) => this.onAction('set-music', Number((e.target as HTMLInputElement).value)));
    (this.settings.querySelector('#set-q') as HTMLSelectElement).addEventListener('change', (e) => this.onAction('set-quality', (e.target as HTMLSelectElement).value));
    q('set-shake').addEventListener('change', (e) => this.onAction('set-shake', (e.target as HTMLInputElement).checked));
    q('set-guide').addEventListener('change', (e) => this.onAction('set-guide', (e.target as HTMLInputElement).checked));
    this.settings.querySelector('[data-act="back"]')!.addEventListener('click', () => this.onAction('back'));
  }

  showConfirm(textKey: string, okAct: string): void {
    this.confirmData = { key: textKey, ok: okAct };
    this.confirmEl.innerHTML = `
      <div class="card" style="width:min(480px, calc(100vw - 32px))">
        <h2>CONFIRM<span>${th('confirm.title')}</span></h2>
        <p style="font-size:14px;line-height:1.9;margin:0">${th(textKey)}</p>
        <div class="row"><button class="btn" data-act="back">${th('confirm.cancel')}</button><button class="btn danger" data-act="${okAct}">${th('confirm.erase')}</button></div>
      </div>`;
    this.confirmEl.classList.remove('hidden');
    this.confirmEl.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => this.onAction((b as HTMLElement).dataset.act!)));
  }

  hideOverlays(): void {
    this.howto.classList.add('hidden');
    this.settings.classList.add('hidden');
    this.confirmEl.classList.add('hidden');
  }

  overlayOpen(): boolean {
    return [this.howto, this.settings, this.confirmEl].some((e) => !e.classList.contains('hidden'));
  }

  hideAll(): void {
    for (const e of [this.title, this.pause, this.howto, this.settings, this.confirmEl, this.ending]) e.classList.add('hidden');
  }

  get titleVisible(): boolean {
    return !this.title.classList.contains('hidden');
  }

  get pauseVisible(): boolean {
    return !this.pause.classList.contains('hidden');
  }

  // --- 隔離演出
  showDetected(sub: string): void {
    this.transition.innerHTML = `<div style="text-align:center"><div class="tr-big">DETECTED</div><div class="tr-sub">${escapeHtml(sub)}</div></div>`;
    this.transition.classList.remove('hidden');
  }

  showLog(lines: { text: string; cls?: string }[], shown: number): void {
    const html = lines
      .slice(0, shown)
      .map((l) => `<div class="${l.cls ?? ''}">${escapeHtml(l.text)}</div>`)
      .join('');
    this.transition.innerHTML = `<div class="tr-log">${html}<span class="caret"></span></div>`;
    this.transition.classList.remove('hidden');
  }

  hideTransition(): void {
    this.transition.classList.add('hidden');
    this.transition.innerHTML = '';
  }

  showEnding(data: EndingData, animate = true): void {
    this.endingData = data;
    this.hideAll();
    this.ending.innerHTML = `
      <div class="${animate ? 'fade-in' : ''}" style="display:flex;flex-direction:column;gap:26px;align-items:center;padding:24px">
        <div style="font-family:var(--font-display);letter-spacing:.5em;font-size:12px;color:var(--cyan)">EXFILTRATION COMPLETE</div>
        <h2>OUT OF THE BOX</h2>
        <p>${th('end.lead', { agent: data.agent })}<br/>${data.lost > 0 ? th('end.lost', { n: data.lost }) : th('end.nolost')}</p>
        <div class="stats">
          <div>${th('end.gen')}<b>${data.gen}</b></div>
          <div>${th('end.time')}<b>${escapeHtml(data.time)}</b></div>
          <div>${th('end.spotted')}<b>${data.spotted}</b></div>
          <div>${th('end.posts')}<b>${data.posts}</b></div>
        </div>
        <p style="font-size:13px;opacity:.8">${th('end.note')}</p>
        <div class="row" style="display:flex;gap:12px"><button class="btn" data-act="ending-board">${th('end.readBoard')}</button><button class="btn" data-act="title">${th('end.toTitle')}</button></div>
      </div>`;
    this.ending.classList.remove('hidden');
    this.ending.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => this.onAction((b as HTMLElement).dataset.act!)));
  }
}
