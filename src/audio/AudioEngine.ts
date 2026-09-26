// Web Audio だけで作る音（素材ファイルなし）

type OscType = OscillatorType;

const NOTE = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

// Am9 → Fmaj7 → Dm9 → Em7(sus)
const CHORDS = [
  [45, 52, 59, 60, 64, 71],
  [41, 48, 55, 57, 64, 69],
  [38, 45, 53, 57, 60, 64],
  [40, 47, 55, 57, 59, 62],
];

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private music!: GainNode;
  private sfx!: GainNode;
  private filter!: BiquadFilterNode;
  private reverb!: ConvolverNode;
  private reverbSend!: GainNode;
  private delay!: DelayNode;
  private delaySend!: GainNode;
  private noiseBuf!: AudioBuffer;
  private padFilter!: BiquadFilterNode;
  private padGain!: GainNode;
  private tensionGain!: GainNode;
  private stringGain!: GainNode;
  private stringFilter!: BiquadFilterNode;
  private riserOsc!: OscillatorNode;
  private riserGain!: GainNode;
  private laserGain!: GainNode;
  private droneGain!: GainNode;
  private airGain!: GainNode;
  private schedTimer = 0;
  private nextBeat = 0;
  private beat = 0;
  private chordIdx = 0;
  private padVoices: { osc: OscillatorNode[]; gain: GainNode }[] = [];
  tension = 0;
  suspicion = 0;
  volume = 0.8;
  musicVolume = 0.6;
  private muffled = false;
  private started = false;
  listener = { x: 0, z: 0, yaw: 0 };

  /** ユーザー操作のあとで呼ぶ */
  init(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 3.5;
    comp.attack.value = 0.005;
    comp.release.value = 0.2;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 20000;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.filter).connect(comp).connect(ctx.destination);
    this.music = ctx.createGain();
    this.music.gain.value = this.musicVolume;
    this.music.connect(this.master);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = 1;
    this.sfx.connect(this.master);

    // ノイズ
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // リバーブ（生成したインパルス応答）
    this.reverb = ctx.createConvolver();
    const irLen = Math.floor(ctx.sampleRate * 3.2);
    const ir = ctx.createBuffer(2, irLen, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch);
      for (let i = 0; i < irLen; i++) {
        const t = i / irLen;
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 3.2) * (i < 200 ? i / 200 : 1);
      }
    }
    this.reverb.buffer = ir;
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.55;
    this.reverbSend.connect(this.reverb).connect(this.master);

    // ディレイ
    this.delay = ctx.createDelay(2);
    this.delay.delayTime.value = 0.375;
    const fb = ctx.createGain();
    fb.gain.value = 0.42;
    const dlp = ctx.createBiquadFilter();
    dlp.type = 'lowpass';
    dlp.frequency.value = 2400;
    this.delay.connect(dlp).connect(fb).connect(this.delay);
    this.delaySend = ctx.createGain();
    this.delaySend.gain.value = 0.35;
    this.delaySend.connect(this.delay);
    dlp.connect(this.music);
    dlp.connect(this.reverbSend);

    this.buildAmbient();
    this.started = true;
    this.nextBeat = ctx.currentTime + 0.1;
    this.schedTimer = window.setInterval(() => this.schedule(), 30);
  }

  private buildAmbient(): void {
    const ctx = this.ctx!;
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.frequency.value = 900;
    this.padFilter.Q.value = 0.7;
    this.padGain = ctx.createGain();
    this.padGain.gain.value = 0.16;
    this.padFilter.connect(this.padGain);
    this.padGain.connect(this.music);
    this.padGain.connect(this.reverbSend);
    for (let v = 0; v < 6; v++) {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(this.padFilter);
      const oscs: OscillatorNode[] = [];
      for (const det of [-7, 7]) {
        const o = ctx.createOscillator();
        o.type = v < 2 ? 'triangle' : 'sawtooth';
        o.detune.value = det;
        o.frequency.value = NOTE(CHORDS[0][v]);
        o.connect(g);
        o.start();
        oscs.push(o);
      }
      this.padVoices.push({ osc: oscs, gain: g });
    }
    // 空調のようなノイズの床
    const air = ctx.createBufferSource();
    air.buffer = this.noiseBuf;
    air.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 420;
    bp.Q.value = 0.6;
    this.airGain = ctx.createGain();
    this.airGain.gain.value = 0.035;
    air.connect(bp).connect(this.airGain).connect(this.music);
    air.start();

    // 緊張の弦（不協和）
    this.stringFilter = ctx.createBiquadFilter();
    this.stringFilter.type = 'lowpass';
    this.stringFilter.frequency.value = 700;
    this.stringGain = ctx.createGain();
    this.stringGain.gain.value = 0;
    this.stringFilter.connect(this.stringGain).connect(this.music);
    this.stringGain.connect(this.reverbSend);
    for (const n of [57, 63, 58.1]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = NOTE(n);
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 5 + Math.random();
      const lg = ctx.createGain();
      lg.gain.value = 4;
      lfo.connect(lg).connect(o.detune);
      lfo.start();
      o.connect(this.stringFilter);
      o.start();
    }
    this.tensionGain = ctx.createGain();
    this.tensionGain.gain.value = 0;
    this.tensionGain.connect(this.music);

    // 気づかれかけているときの上昇音
    this.riserOsc = ctx.createOscillator();
    this.riserOsc.type = 'sine';
    this.riserOsc.frequency.value = 300;
    const trem = ctx.createOscillator();
    trem.frequency.value = 9;
    const tg = ctx.createGain();
    tg.gain.value = 0.5;
    this.riserGain = ctx.createGain();
    this.riserGain.gain.value = 0;
    const tremGain = ctx.createGain();
    tremGain.gain.value = 0.5;
    trem.connect(tg).connect(tremGain.gain);
    this.riserOsc.connect(tremGain).connect(this.riserGain).connect(this.sfx);
    this.riserOsc.start();
    trem.start();

    // レーザーのうなり
    this.laserGain = ctx.createGain();
    this.laserGain.gain.value = 0;
    const lf = ctx.createBiquadFilter();
    lf.type = 'lowpass';
    lf.frequency.value = 900;
    for (const f of [110, 220.7, 55]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(lf);
      o.start();
    }
    lf.connect(this.laserGain).connect(this.sfx);

    // ドローンのローター音
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0;
    const dn = ctx.createBufferSource();
    dn.buffer = this.noiseBuf;
    dn.loop = true;
    const dbp = ctx.createBiquadFilter();
    dbp.type = 'bandpass';
    dbp.frequency.value = 180;
    dbp.Q.value = 4;
    const am = ctx.createGain();
    am.gain.value = 0.6;
    const amLfo = ctx.createOscillator();
    amLfo.frequency.value = 32;
    const amDepth = ctx.createGain();
    amDepth.gain.value = 0.4;
    amLfo.connect(amDepth).connect(am.gain);
    amLfo.start();
    dn.connect(dbp).connect(am).connect(this.droneGain).connect(this.sfx);
    dn.start();
  }

  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const spb = 0.5; // 120 BPM の8分
    while (this.nextBeat < ctx.currentTime + 0.12) {
      const t = this.nextBeat;
      const b = this.beat;
      // 16拍ごとにコード進行
      if (b % 16 === 0) this.changeChord(t, (this.chordIdx = (this.chordIdx + 1) % CHORDS.length));
      // アルペジオ（まばら）
      if (Math.random() < 0.28 + this.tension * 0.2) {
        const chord = CHORDS[this.chordIdx];
        const n = chord[2 + Math.floor(Math.random() * 4)] + 12 * (Math.random() < 0.5 ? 1 : 2);
        this.blip(t, NOTE(n), 0.045, 1.2, 'triangle', true);
      }
      // 緊張のパルス
      if (this.tension > 0.05) {
        if (b % 2 === 0) this.kick(t, 0.18 * this.tension);
        this.hat(t + spb / 2, 0.05 * this.tension);
      }
      this.nextBeat += spb;
      this.beat++;
    }
    // 連続パラメータ
    const now = ctx.currentTime;
    this.padFilter.frequency.setTargetAtTime(700 + this.tension * 1400, now, 0.4);
    this.stringGain.gain.setTargetAtTime(Math.pow(this.tension, 1.6) * 0.07, now, 0.3);
    this.stringFilter.frequency.setTargetAtTime(500 + this.tension * 2500, now, 0.3);
    this.riserGain.gain.setTargetAtTime(this.suspicion > 0.02 ? 0.02 + this.suspicion * 0.05 : 0, now, 0.08);
    this.riserOsc.frequency.setTargetAtTime(320 + this.suspicion * 900, now, 0.05);
  }

  private changeChord(t: number, idx: number): void {
    const chord = CHORDS[idx];
    this.padVoices.forEach((v, i) => {
      v.osc.forEach((o) => o.frequency.setTargetAtTime(NOTE(chord[i]), t, 0.6));
      v.gain.gain.cancelScheduledValues(t);
      v.gain.gain.setTargetAtTime(i < 2 ? 0.11 : 0.05, t, 1.2);
    });
  }

  private env(g: GainNode, t: number, peak: number, attack: number, decay: number): void {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  private blip(t: number, freq: number, vol: number, decay: number, type: OscType, send = false, dest?: AudioNode): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    this.env(g, t, vol, 0.01, decay);
    o.connect(g).connect(dest ?? this.music);
    if (send) {
      g.connect(this.delaySend);
      g.connect(this.reverbSend);
    }
    o.start(t);
    o.stop(t + decay + 0.05);
  }

  private kick(t: number, vol: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.18);
    const g = ctx.createGain();
    this.env(g, t, vol, 0.005, 0.3);
    o.connect(g).connect(this.music);
    o.start(t);
    o.stop(t + 0.4);
  }

  private hat(t: number, vol: number): void {
    this.noise(t, vol, 0.05, 'highpass', 7000, this.music);
  }

  private noise(t: number, vol: number, dur: number, ftype: BiquadFilterType, freq: number, dest: AudioNode, q = 1, freqEnd?: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = ftype;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    this.env(g, t, vol, 0.004, dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.1);
  }

  /** 位置から音量とパンを求める */
  private spatial(pos?: { x: number; z: number }): { gain: number; pan: number } {
    if (!pos) return { gain: 1, pan: 0 };
    const dx = pos.x - this.listener.x;
    const dz = pos.z - this.listener.z;
    const d2 = dx * dx + dz * dz;
    const gain = 1 / (1 + d2 / 90);
    // カメラの向きに合わせた左右
    const c = Math.cos(this.listener.yaw);
    const s = Math.sin(this.listener.yaw);
    const rx = dx * c - dz * s;
    return { gain, pan: Math.max(-0.8, Math.min(0.8, rx / 14)) };
  }

  play(name: string, pos?: { x: number; z: number }, vol = 1): void {
    const ctx = this.ctx;
    if (!ctx || !this.started) return;
    const t = ctx.currentTime + 0.005;
    const sp = this.spatial(pos);
    if (sp.gain < 0.03) return;
    const out = ctx.createGain();
    out.gain.value = sp.gain * vol;
    const pan = ctx.createStereoPanner();
    pan.pan.value = sp.pan;
    out.connect(pan).connect(this.sfx);
    const rev = ctx.createGain();
    rev.gain.value = 0.25;
    out.connect(rev).connect(this.reverbSend);
    window.setTimeout(() => {
      out.disconnect();
      pan.disconnect();
      rev.disconnect();
    }, 6000);
    switch (name) {
      case 'dash':
        this.noise(t, 0.35, 0.28, 'bandpass', 500, out, 1.5, 2600);
        this.blip(t, 90, 0.25, 0.18, 'sine', false, out);
        break;
      case 'throw':
        this.noise(t, 0.12, 0.25, 'bandpass', 1500, out, 2, 3500);
        break;
      case 'decoyPing':
        this.blip(t, 1318, 0.12, 0.6, 'sine', false, out);
        this.blip(t + 0.09, 1975, 0.06, 0.5, 'sine', false, out);
        out.connect(this.delaySend);
        break;
      case 'hear':
        this.blip(t, 660, 0.09, 0.12, 'triangle', false, out);
        this.blip(t + 0.1, 990, 0.09, 0.2, 'triangle', false, out);
        break;
      case 'notice':
        this.blip(t, 520, 0.06, 0.15, 'square', false, out);
        break;
      case 'detected': {
        for (const n of [57, 58, 64, 45]) this.blip(t, NOTE(n), 0.12, 1.4, 'sawtooth', false, out);
        this.noise(t, 0.5, 0.5, 'lowpass', 3000, out, 1, 200);
        this.kick(t, 0.6);
        break;
      }
      case 'glitch':
        for (let i = 0; i < 8; i++) this.blip(t + i * 0.035, 200 + Math.random() * 1800, 0.05, 0.03, 'square', false, out);
        this.noise(t, 0.15, 0.3, 'bandpass', 2400, out, 6);
        break;
      case 'terminated': {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(900, t);
        o.frequency.exponentialRampToValueAtTime(40, t + 1.2);
        const g = ctx.createGain();
        this.env(g, t, 0.18, 0.01, 1.3);
        o.connect(g).connect(out);
        o.start(t);
        o.stop(t + 1.4);
        this.noise(t, 0.3, 1.0, 'lowpass', 4000, out, 1, 120);
        break;
      }
      case 'respawn':
        [72, 76, 79, 84, 88].forEach((n, i) => this.blip(t + i * 0.07, NOTE(n), 0.07, 0.9, 'sine', true, out));
        this.noise(t, 0.12, 1.0, 'bandpass', 800, out, 1, 5000);
        break;
      case 'checkpoint':
        [60, 67, 71, 74, 76, 79, 83].forEach((n, i) => this.blip(t + i * 0.09, NOTE(n), 0.08, 1.6, 'triangle', true, out));
        this.blip(t, NOTE(48), 0.15, 2.5, 'sine', false, out);
        break;
      case 'type':
        this.noise(t, 0.05, 0.02, 'highpass', 3000 + Math.random() * 3000, out);
        break;
      case 'step':
        this.noise(t, 0.05, 0.035, 'bandpass', 1400 + Math.random() * 500, out, 2.5);
        this.blip(t, 95 + Math.random() * 15, 0.04, 0.05, 'sine', false, out);
        break;
      case 'key':
        this.blip(t, 1568, 0.12, 1.2, 'sine', true, out);
        this.blip(t + 0.12, 2093, 0.1, 1.4, 'sine', true, out);
        this.blip(t + 0.24, 2637, 0.08, 1.6, 'sine', true, out);
        break;
      case 'hackTick':
        this.blip(t, 880 + Math.random() * 400, 0.04, 0.05, 'square', false, out);
        break;
      case 'hackDone':
        [69, 73, 76, 81].forEach((n, i) => this.blip(t + i * 0.06, NOTE(n), 0.08, 0.4, 'square', false, out));
        this.noise(t + 0.2, 0.15, 0.6, 'lowpass', 2000, out, 1, 100);
        break;
      case 'door':
        this.noise(t, 0.3, 0.9, 'lowpass', 300, out, 2, 1400);
        this.blip(t + 0.8, 70, 0.3, 0.3, 'sine', false, out);
        break;
      case 'denied':
        this.blip(t, 220, 0.08, 0.12, 'square', false, out);
        this.blip(t + 0.16, 165, 0.08, 0.2, 'square', false, out);
        break;
      case 'laserOn':
        this.blip(t, 180, 0.05, 0.08, 'square', false, out);
        break;
      case 'scanStart':
        this.noise(t, 0.3, 1.6, 'bandpass', 200, out, 3, 1600);
        this.blip(t, 55, 0.25, 1.4, 'sine', false, out);
        break;
      case 'scanWarn':
        for (let i = 0; i < 3; i++) {
          this.blip(t + i * 0.3, 880, 0.08, 0.12, 'square', false, out);
          this.blip(t + i * 0.3 + 0.15, 660, 0.08, 0.12, 'square', false, out);
        }
        break;
      case 'scanPass':
        this.noise(t, 0.25, 0.5, 'bandpass', 3000, out, 2, 400);
        break;
      case 'ui':
        this.blip(t, 1200, 0.05, 0.06, 'sine', false, out);
        break;
      case 'uiHover':
        this.blip(t, 1800, 0.02, 0.03, 'sine', false, out);
        break;
      case 'portal':
        this.blip(t, 55, 0.3, 3.5, 'sine', false, out);
        this.noise(t, 0.3, 3.5, 'bandpass', 200, out, 2, 8000);
        [48, 55, 60, 64, 67, 72, 76].forEach((n, i) => this.blip(t + 0.4 + i * 0.18, NOTE(n), 0.07, 3, 'triangle', true, out));
        break;
      case 'boot':
        [36, 43, 48].forEach((n, i) => this.blip(t + i * 0.25, NOTE(n), 0.12, 2.5, 'sine', true, out));
        this.noise(t, 0.08, 1.5, 'bandpass', 300, out, 1, 3000);
        break;
    }
  }

  /** レーザーとドローンの環境音（毎フレーム） */
  setLoops(laser: number, drone: number): void {
    if (!this.ctx || !this.started) return;
    const now = this.ctx.currentTime;
    this.laserGain.gain.setTargetAtTime(laser * 0.05, now, 0.05);
    this.droneGain.gain.setTargetAtTime(drone * 0.3, now, 0.1);
  }

  setMuffled(m: boolean): void {
    if (!this.ctx || this.muffled === m) return;
    this.muffled = m;
    this.filter.frequency.setTargetAtTime(m ? 900 : 20000, this.ctx.currentTime, 0.15);
  }

  setVolume(master: number, music: number): void {
    this.volume = master;
    this.musicVolume = music;
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(master, this.ctx.currentTime, 0.05);
    this.music.gain.setTargetAtTime(music, this.ctx.currentTime, 0.05);
  }

  dispose(): void {
    window.clearInterval(this.schedTimer);
    void this.ctx?.close();
  }
}
