/**
 * sfx.ts — звук двигателя и шин, целиком синтезируется в Web Audio (никаких файлов).
 * Двигатель: пила + суб-гармоника, частота от оборотов, громкость от газа.
 * Скольжение: зацикленный белый шум через полосовой фильтр, громкость от угла сноса.
 */

const MUTE_KEY = "driftdemo.muted";

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}
function writeMuted(v: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, v ? "1" : "0");
  } catch {
    /* приватный режим — не страшно */
  }
}

export class CarAudio {
  muted = readMuted();
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private engineOsc: OscillatorNode | null = null;
  private engineSub: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private noiseGain: GainNode | null = null;
  private started = false;
  private disposed = false;

  /** Создаёт узлы; вызывать из жеста пользователя (клик/клавиша). */
  start(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    const ctx = new AudioContext();
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = this.muted ? 0 : 0.5;
    master.connect(ctx.destination);
    this.master = master;

    // двигатель
    const engineGain = ctx.createGain();
    engineGain.gain.value = 0.04;
    engineGain.connect(master);
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = 60;
    const sub = ctx.createOscillator();
    sub.type = "square";
    sub.frequency.value = 30;
    const subGain = ctx.createGain();
    subGain.gain.value = 0.5;
    osc.connect(engineGain);
    sub.connect(subGain).connect(engineGain);
    osc.start();
    sub.start();
    this.engineOsc = osc;
    this.engineSub = sub;
    this.engineGain = engineGain;

    // шум скольжения
    const len = ctx.sampleRate;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 900;
    filter.Q.value = 0.8;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0;
    noise.connect(filter).connect(noiseGain).connect(master);
    noise.start();
    this.noiseGain = noiseGain;
  }

  /** rpm01: 0..1 от холостых до отсечки; slip01: 0..1 интенсивность скольжения. */
  setState(rpm01: number, throttle: number, slip01: number, running: boolean): void {
    if (!this.ctx || !this.engineOsc || !this.engineSub || !this.engineGain || !this.noiseGain) return;
    const t = this.ctx.currentTime;
    const freq = 45 + rpm01 * 250;
    this.engineOsc.frequency.setTargetAtTime(freq, t, 0.05);
    this.engineSub.frequency.setTargetAtTime(freq * 0.5, t, 0.05);
    const g = running ? 0.035 + throttle * 0.075 + rpm01 * 0.02 : 0.012;
    this.engineGain.gain.setTargetAtTime(g, t, 0.08);
    this.noiseGain.gain.setTargetAtTime(slip01 * 0.22, t, 0.06);
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    writeMuted(this.muted);
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
    return this.muted;
  }

  dispose(): void {
    this.disposed = true;
    this.engineOsc?.stop();
    this.engineSub?.stop();
    this.engineOsc = null;
    this.engineSub = null;
    if (this.ctx && this.ctx.state !== "closed") void this.ctx.close();
    this.ctx = null;
    this.master = null;
  }
}
