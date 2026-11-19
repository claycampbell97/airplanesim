// Sound, synthesised on the fly with the Web Audio API: there are no audio files.
//
// Two layers: short cues for the interface (clicks, chimes, alerts) and a quiet
// bed of ambience that changes with the view (a soft pad over the globe, engines
// and slipstream in the flight view).

export type Cue =
  | 'click' | 'open' | 'close' | 'confirm' | 'error' | 'notify' | 'good' | 'bad'
  | 'cash' | 'milestone' | 'launch' | 'rival' | 'whoosh';

export type Scene = 'silent' | 'globe' | 'flight';

type Wave = OscillatorType;

interface Bed {
  gain: GainNode;
  stop: () => void;
}

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private cues: GainNode | null = null;
  private enabled = true;
  private volume = 0.5;
  private scene: Scene = 'silent';
  private pad: Bed | null = null;
  private cabin: (Bed & { tone: BiquadFilterNode; whine: GainNode }) | null = null;
  private noise: AudioBuffer | null = null;
  private rumble: AudioBuffer | null = null;
  private proximity = 0.5;
  private jets = true;
  private lastCue = new Map<Cue, number>();
  private armed = false;

  /**
   * Browsers only allow sound after the player has interacted with the page, so
   * the audio graph is built on the first click or key press.
   */
  arm(): void {
    if (this.armed || typeof window === 'undefined') return;
    this.armed = true;
    const start = (): void => {
      this.ensure();
      if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
    };
    window.addEventListener('pointerdown', start, { capture: true });
    window.addEventListener('keydown', start, { capture: true });
    // A tab in the background should fall silent.
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend().catch(() => undefined);
      else if (this.enabled) void this.ctx.resume().catch(() => undefined);
    });
  }

  configure(enabled: boolean, volume: number): void {
    this.enabled = enabled;
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(enabled ? this.curve(this.volume) : 0, this.ctx.currentTime, 0.05);
    }
  }

  /** Perceived loudness is far from linear in gain: square the slider. */
  private curve(v: number): number {
    return v * v * 1.6;
  }

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      const ctx = new Ctor({ latencyHint: 'interactive' });
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -14;
      limiter.knee.value = 12;
      limiter.ratio.value = 6;
      limiter.attack.value = 0.004;
      limiter.release.value = 0.2;
      limiter.connect(ctx.destination);
      const master = ctx.createGain();
      master.gain.value = this.enabled ? this.curve(this.volume) : 0;
      master.connect(limiter);
      const cues = ctx.createGain();
      cues.gain.value = 0.9;
      cues.connect(master);
      this.ctx = ctx;
      this.master = master;
      this.cues = cues;
      this.noise = this.makeNoise(ctx, 2.5, false);
      this.rumble = this.makeNoise(ctx, 4, true);
      this.applyScene();
      return ctx;
    } catch {
      return null;
    }
  }

  /** White noise, or (integrated) brown noise for rumbles. Looped, so the ends are matched. */
  private makeNoise(ctx: AudioContext, seconds: number, brown: boolean): AudioBuffer {
    const n = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, n, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) {
      const white = Math.random() * 2 - 1;
      if (brown) {
        last = (last + 0.02 * white) / 1.02;
        data[i] = last * 3.5;
      } else {
        data[i] = white;
      }
    }
    // Cross-fade the tail into the head so the loop point is inaudible.
    const fade = Math.min(n >> 2, Math.floor(ctx.sampleRate * 0.25));
    for (let i = 0; i < fade; i++) {
      const k = i / fade;
      data[i] = data[i] * k + data[n - fade + i] * (1 - k);
    }
    const out = ctx.createBuffer(1, n - fade, ctx.sampleRate);
    out.getChannelData(0).set(data.subarray(0, n - fade));
    return out;
  }

  // ───────────── Building blocks ─────────────

  /** One enveloped oscillator note. */
  private tone(freq: number, at: number, opts: {
    dur?: number; gain?: number; wave?: Wave; attack?: number; to?: number; cutoff?: number; detune?: number;
  } = {}): void {
    const ctx = this.ctx;
    const out = this.cues;
    if (!ctx || !out) return;
    const { dur = 0.18, gain = 0.2, wave = 'sine', attack = 0.004, to, cutoff, detune = 0 } = opts;
    const t = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    osc.type = wave;
    osc.frequency.setValueAtTime(freq, t);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
    osc.detune.value = detune;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node: AudioNode = osc;
    if (cutoff) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = cutoff;
      node.connect(lp);
      node = lp;
    }
    node.connect(env);
    env.connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.03);
  }

  /** A struck-bell note: a fundamental with a few inharmonic partials that die away faster. */
  private bell(freq: number, at: number, gain = 0.16, dur = 0.7): void {
    this.tone(freq, at, { dur, gain, wave: 'sine', attack: 0.003 });
    this.tone(freq * 2.01, at, { dur: dur * 0.55, gain: gain * 0.42, wave: 'sine', attack: 0.003 });
    this.tone(freq * 3.03, at, { dur: dur * 0.3, gain: gain * 0.2, wave: 'sine', attack: 0.002 });
    this.tone(freq * 4.2, at, { dur: dur * 0.16, gain: gain * 0.12, wave: 'sine', attack: 0.002 });
  }

  /** A burst of filtered noise, optionally swept in pitch. */
  private hiss(at: number, opts: { dur?: number; gain?: number; from?: number; to?: number; q?: number; type?: BiquadFilterType } = {}): void {
    const ctx = this.ctx;
    const out = this.cues;
    if (!ctx || !out || !this.noise) return;
    const { dur = 0.12, gain = 0.1, from = 1800, to = from, q = 0.9, type = 'bandpass' } = opts;
    const t = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(from, t);
    if (to !== from) filter.frequency.exponentialRampToValueAtTime(to, t + dur);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.03, dur * 0.3));
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter);
    filter.connect(env);
    env.connect(out);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.03);
  }

  // ───────────── Cues ─────────────

  play(cue: Cue): void {
    if (!this.enabled) return;
    const ctx = this.ensure();
    if (!ctx || ctx.state !== 'running') return;
    // The same cue twice within a moment (two toasts at once) is just noise.
    const now = ctx.currentTime;
    const gap = cue === 'click' ? 0.03 : 0.12;
    if (now - (this.lastCue.get(cue) ?? -1) < gap) return;
    this.lastCue.set(cue, now);

    switch (cue) {
      case 'click':
        this.tone(1250, 0, { dur: 0.045, gain: 0.07, wave: 'triangle', to: 820 });
        this.hiss(0, { dur: 0.02, gain: 0.03, from: 5200, q: 0.6 });
        break;
      case 'open':
        this.hiss(0, { dur: 0.16, gain: 0.05, from: 700, to: 2600, q: 0.7 });
        this.tone(660, 0.01, { dur: 0.1, gain: 0.035, wave: 'sine', to: 990 });
        break;
      case 'close':
        this.hiss(0, { dur: 0.13, gain: 0.04, from: 2200, to: 600, q: 0.7 });
        break;
      case 'whoosh':
        this.hiss(0, { dur: 0.7, gain: 0.09, from: 260, to: 3000, q: 0.5 });
        this.hiss(0.25, { dur: 0.9, gain: 0.05, from: 2400, to: 500, q: 0.5 });
        break;
      case 'confirm':
        this.bell(784, 0, 0.11, 0.4);
        this.bell(1175, 0.075, 0.1, 0.55);
        break;
      case 'error':
        this.tone(196, 0, { dur: 0.16, gain: 0.16, wave: 'sawtooth', cutoff: 900 });
        this.tone(165, 0.11, { dur: 0.24, gain: 0.16, wave: 'sawtooth', cutoff: 800 });
        break;
      case 'notify':
        this.bell(1047, 0, 0.09, 0.6);
        break;
      case 'good':
        this.bell(880, 0, 0.09, 0.45);
        this.bell(1109, 0.09, 0.09, 0.45);
        this.bell(1319, 0.18, 0.1, 0.8);
        break;
      case 'bad':
        this.bell(622, 0, 0.11, 0.5);
        this.bell(466, 0.16, 0.12, 0.9);
        break;
      case 'rival':
        this.tone(392, 0, { dur: 0.14, gain: 0.08, wave: 'triangle' });
        this.tone(370, 0.12, { dur: 0.22, gain: 0.08, wave: 'triangle' });
        break;
      case 'cash':
        this.hiss(0, { dur: 0.05, gain: 0.06, from: 6000, q: 0.5 });
        this.bell(1568, 0.02, 0.1, 0.35);
        this.bell(2093, 0.1, 0.11, 0.9);
        break;
      case 'launch':
        this.hiss(0, { dur: 0.75, gain: 0.07, from: 300, to: 3200, q: 0.6 });
        this.bell(659, 0.3, 0.09, 0.5);
        this.bell(988, 0.42, 0.09, 0.6);
        this.bell(1319, 0.54, 0.1, 1.1);
        break;
      case 'milestone': {
        const notes = [523, 659, 784, 1047, 1319];
        notes.forEach((f, i) => this.bell(f, i * 0.085, 0.085, 0.9));
        this.tone(262, 0, { dur: 1.3, gain: 0.05, wave: 'triangle', attack: 0.08 });
        this.tone(392, 0, { dur: 1.3, gain: 0.04, wave: 'triangle', attack: 0.08 });
        break;
      }
    }
  }

  // ───────────── Ambience ─────────────

  /** Which bed of background sound to play. */
  setScene(scene: Scene): void {
    if (scene === this.scene) return;
    this.scene = scene;
    this.applyScene();
  }

  /**
   * In the flight view: how close the camera is to the aircraft (0 far … 1 close)
   * and whether it has jet engines (turboprops drone instead of whining).
   */
  setFlight(proximity: number, jets: boolean): void {
    const p = Math.max(0, Math.min(1, proximity));
    if (Math.abs(p - this.proximity) < 0.015 && jets === this.jets) return;
    this.proximity = p;
    if (jets !== this.jets) {
      this.jets = jets;
      // The engine voices are different: rebuild the bed.
      if (this.cabin) {
        this.fade(this.cabin, 0, 0.3, true);
        this.cabin = null;
      }
    }
    this.applyScene();
  }

  private fade(bed: Bed, to: number, seconds: number, thenStop = false): void {
    const ctx = this.ctx;
    if (!ctx) return;
    bed.gain.gain.cancelScheduledValues(ctx.currentTime);
    bed.gain.gain.setTargetAtTime(to, ctx.currentTime, seconds / 3);
    if (thenStop) setTimeout(() => bed.stop(), seconds * 1000 + 400);
  }

  private applyScene(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    if (this.scene === 'globe' && !this.pad) this.pad = this.buildPad(ctx);
    if (this.scene === 'flight' && !this.cabin) this.cabin = this.buildCabin(ctx);
    if (this.pad) this.fade(this.pad, this.scene === 'globe' ? 0.5 : 0, 1.6);
    if (this.cabin) {
      const level = this.scene === 'flight' ? 0.22 + 0.5 * this.proximity : 0;
      this.fade(this.cabin, level, 0.9);
      this.cabin.tone.frequency.setTargetAtTime(380 + 900 * this.proximity, ctx.currentTime, 0.4);
      this.cabin.whine.gain.setTargetAtTime(0.012 + 0.03 * this.proximity * this.proximity, ctx.currentTime, 0.4);
    }
  }

  /** The view from orbit: a slow, airy chord that barely moves. */
  private buildPad(ctx: AudioContext): Bed {
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(this.master!);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 520;
    lp.Q.value = 0.4;
    lp.connect(gain);
    const nodes: (OscillatorNode | AudioBufferSourceNode)[] = [];
    // An open fifth with an added ninth, each voice slightly detuned against itself.
    const voices: [number, number][] = [[55, 0.05], [82.4, 0.04], [110, 0.03], [164.8, 0.018], [246.9, 0.01]];
    voices.forEach(([freq, level], i) => {
      for (const detune of [-5, 6]) {
        const osc = ctx.createOscillator();
        osc.type = i < 2 ? 'sine' : 'triangle';
        osc.frequency.value = freq;
        osc.detune.value = detune;
        const g = ctx.createGain();
        g.gain.value = level;
        // Each voice swells and fades at its own unhurried pace.
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 0.035 + 0.017 * i + (detune > 0 ? 0.011 : 0);
        const depth = ctx.createGain();
        depth.gain.value = level * 0.6;
        lfo.connect(depth);
        depth.connect(g.gain);
        osc.connect(g);
        g.connect(lp);
        osc.start();
        lfo.start();
        nodes.push(osc, lfo);
      }
    });
    // A breath of high air.
    if (this.noise) {
      const air = ctx.createBufferSource();
      air.buffer = this.noise;
      air.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 2600;
      bp.Q.value = 0.3;
      const g = ctx.createGain();
      g.gain.value = 0.006;
      air.connect(bp);
      bp.connect(g);
      g.connect(gain);
      air.start();
      nodes.push(air);
    }
    return {
      gain,
      stop: () => {
        for (const n of nodes) {
          try { n.stop(); } catch { /* already stopped */ }
        }
        gain.disconnect();
      },
    };
  }

  /** The flight view: slipstream, engine rumble and a thin turbine whine (or a propeller drone). */
  private buildCabin(ctx: AudioContext): Bed & { tone: BiquadFilterNode; whine: GainNode } {
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(this.master!);
    const nodes: (OscillatorNode | AudioBufferSourceNode)[] = [];

    // Slipstream: broadband noise whose brightness follows the camera distance.
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 700;
    tone.Q.value = 0.5;
    tone.connect(gain);
    if (this.noise) {
      const wind = ctx.createBufferSource();
      wind.buffer = this.noise;
      wind.loop = true;
      const g = ctx.createGain();
      g.gain.value = 0.085;
      wind.connect(g);
      g.connect(tone);
      wind.start();
      nodes.push(wind);
    }
    // Engine rumble.
    if (this.rumble) {
      const low = ctx.createBufferSource();
      low.buffer = this.rumble;
      low.loop = true;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 170;
      const g = ctx.createGain();
      g.gain.value = 0.5;
      low.connect(lp);
      lp.connect(g);
      g.connect(gain);
      low.start();
      nodes.push(low);
    }
    // Turbine whine, or the beat of propeller blades.
    const whine = ctx.createGain();
    whine.gain.value = 0.02;
    whine.connect(gain);
    if (this.jets) {
      for (const [freq, level] of [[2350, 1], [2371, 0.8], [4720, 0.35]] as [number, number][]) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq;
        const g = ctx.createGain();
        g.gain.value = level * 0.5;
        osc.connect(g);
        g.connect(whine);
        osc.start();
        nodes.push(osc);
      }
    } else {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 520;
      lp.connect(whine);
      // Two propellers, never quite in step: the familiar slow throb.
      for (const freq of [84, 85.3]) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = freq;
        const g = ctx.createGain();
        g.gain.value = 3.2;
        osc.connect(g);
        g.connect(lp);
        osc.start();
        nodes.push(osc);
      }
    }
    return {
      gain, tone, whine,
      stop: () => {
        for (const n of nodes) {
          try { n.stop(); } catch { /* already stopped */ }
        }
        gain.disconnect();
      },
    };
  }
}

export const audio = new AudioEngine();
