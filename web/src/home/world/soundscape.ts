// Generative ambience for the landing world. Nothing is sampled; nothing plays until the visitor asks.
// Vacuum is near-silence and a deep drone; air worlds carry wind; a slow pad ties the chapters together.
// AI-assisted implementation; human review pending.

type Mix = { vacuum: number; mars: number; earth: number };

function noiseBuffer(ctx: AudioContext, seconds: number, brown: boolean) {
  const len = Math.floor(ctx.sampleRate * seconds); const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch); let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) { last = (last + .02 * w) / 1.02; d[i] = last * 3.2; } else d[i] = w;
    }
  }
  return buf;
}

export class Soundscape {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private vacuum!: GainNode; private wind!: GainNode; private air!: GainNode; private pad!: GainNode;
  private windFilter!: BiquadFilterNode;
  on = false;

  private build() {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx(); this.ctx = ctx;
    this.master = ctx.createGain(); this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 3;
    this.master.connect(comp).connect(ctx.destination);
    const brown = noiseBuffer(ctx, 6, true), white = noiseBuffer(ctx, 4, false);
    const loop = (buf: AudioBuffer) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(); return s; };

    // vacuum: two low sines a fifth apart, breathing slowly, under a whisper of filtered noise
    this.vacuum = ctx.createGain(); this.vacuum.gain.value = 0; this.vacuum.connect(this.master);
    for (const [f, g] of [[41.2, .32], [61.7, .18], [82.4, .06]] as const) {
      const o = ctx.createOscillator(); o.frequency.value = f; const og = ctx.createGain(); og.gain.value = g;
      const lfo = ctx.createOscillator(); lfo.frequency.value = .03 + f * .0004; const lg = ctx.createGain(); lg.gain.value = g * .5;
      lfo.connect(lg).connect(og.gain); o.connect(og).connect(this.vacuum); o.start(); lfo.start();
    }
    const hiss = loop(brown); const hf = ctx.createBiquadFilter(); hf.type = 'lowpass'; hf.frequency.value = 160;
    const hg = ctx.createGain(); hg.gain.value = .12; hiss.connect(hf).connect(hg).connect(this.vacuum);

    // wind: brown noise through a moving band, with slow gusts
    this.wind = ctx.createGain(); this.wind.gain.value = 0; this.wind.connect(this.master);
    const wsrc = loop(brown); this.windFilter = ctx.createBiquadFilter(); this.windFilter.type = 'bandpass'; this.windFilter.Q.value = .7; this.windFilter.frequency.value = 420;
    const gust = ctx.createGain(); gust.gain.value = .55;
    const glfo = ctx.createOscillator(); glfo.frequency.value = .07; const glg = ctx.createGain(); glg.gain.value = .35; glfo.connect(glg).connect(gust.gain); glfo.start();
    const flfo = ctx.createOscillator(); flfo.frequency.value = .045; const flg = ctx.createGain(); flg.gain.value = 220; flfo.connect(flg).connect(this.windFilter.frequency); flfo.start();
    wsrc.connect(this.windFilter).connect(gust).connect(this.wind);

    // air: a faint bright layer for Earth's thicker atmosphere
    this.air = ctx.createGain(); this.air.gain.value = 0; this.air.connect(this.master);
    const asrc = loop(white); const af = ctx.createBiquadFilter(); af.type = 'highpass'; af.frequency.value = 2400;
    const ag = ctx.createGain(); ag.gain.value = .025; asrc.connect(af).connect(ag).connect(this.air);

    // pad: detuned triangles on A–E–B, low-passed and swelling very slowly
    this.pad = ctx.createGain(); this.pad.gain.value = .0; this.pad.connect(this.master);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520; lp.Q.value = .3; lp.connect(this.pad);
    for (const f of [110, 164.8, 246.9, 220.4]) for (const det of [-4, 5]) {
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f; o.detune.value = det;
      const g = ctx.createGain(); g.gain.value = .022; o.connect(g).connect(lp); o.start();
    }
    const plfo = ctx.createOscillator(); plfo.frequency.value = .018; const plg = ctx.createGain(); plg.gain.value = .35;
    plfo.connect(plg).connect(this.pad.gain); plfo.start();
  }

  async enable() {
    if (!this.ctx) this.build();
    await this.ctx!.resume();
    this.on = true;
    this.master.gain.cancelScheduledValues(this.ctx!.currentTime);
    this.master.gain.setTargetAtTime(.55, this.ctx!.currentTime, 1.2);
  }
  disable() {
    if (!this.ctx) return; this.on = false;
    this.master.gain.cancelScheduledValues(this.ctx.currentTime);
    this.master.gain.setTargetAtTime(0, this.ctx.currentTime, .35);
  }
  setMix(m: Mix) {
    if (!this.ctx || !this.on) return; const t = this.ctx.currentTime;
    this.vacuum.gain.setTargetAtTime(.9 * m.vacuum, t, .8);
    this.wind.gain.setTargetAtTime(.5 * m.mars + .32 * m.earth, t, .8);
    this.air.gain.setTargetAtTime(m.earth, t, .8);
    this.pad.gain.setTargetAtTime(.55 + .2 * m.vacuum, t, 2);
    this.windFilter.Q.setTargetAtTime(.6 + .8 * m.mars, t, 1);
  }
  /** A soft, low pulse with a rising partial: used when a probe opens. */
  cue() {
    if (!this.ctx || !this.on) return; const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(140, t + 1.4);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.16, t + .08); g.gain.exponentialRampToValueAtTime(.0001, t + 1.8);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + 1.9);
  }
  dispose() { this.ctx?.close(); this.ctx = null; }
}
