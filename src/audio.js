/**
 * Procedural WebAudio: no audio files to download or cache. SFX (whoosh, jump, splash, countdown, fanfare)
 * and a tiny looping "beach" arpeggio. The AudioContext is created on the first user gesture.
 */
export class AudioFX {
  constructor() {
    this.ctx = null;
    this.sfxOn = true;
    this.musicOn = true;
    this.musicTimer = 0;
    this.step = 0;
    this.playingMusic = false;
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.8;
      this.master.connect(this.ctx.destination);
      this.sfxBus = this.ctx.createGain();
      this.sfxBus.connect(this.master);
      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = 0.16;
      this.musicBus.connect(this.master);
      // whoosh: looped filtered noise whose gain follows speed
      const len = this.ctx.sampleRate * 2;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) { last = last * 0.96 + (Math.random() * 2 - 1) * 0.28; d[i] = last; }
      this.noiseBuf = buf;
      this.whooshSrc = this.ctx.createBufferSource();
      this.whooshSrc.buffer = buf;
      this.whooshSrc.loop = true;
      this.whooshFilter = this.ctx.createBiquadFilter();
      this.whooshFilter.type = 'bandpass';
      this.whooshFilter.frequency.value = 500;
      this.whooshFilter.Q.value = 0.7;
      this.whooshGain = this.ctx.createGain();
      this.whooshGain.gain.value = 0;
      this.whooshSrc.connect(this.whooshFilter).connect(this.whooshGain).connect(this.sfxBus);
      this.whooshSrc.start();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setEnabled(sfx, music) {
    this.sfxOn = sfx;
    this.musicOn = music;
    if (this.sfxBus) this.sfxBus.gain.value = sfx ? 1 : 0;
    if (this.musicBus) this.musicBus.gain.value = music ? 0.16 : 0;
    if (!sfx && this.whooshGain) this.whooshGain.gain.value = 0;
  }

  suspend() { this.ctx?.suspend?.(); }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  _tone(freq, dur, type = 'sine', vol = 0.3, slide = 0, delay = 0, bus = this.sfxBus) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(bus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  _noise(dur, freq, vol = 0.4, q = 0.8) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(freq, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(120, freq * 0.25), t + dur);
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(this.sfxBus);
    s.start(t, Math.random());
    s.stop(t + dur + 0.05);
  }

  tick(go = false) { go ? (this._tone(880, 0.5, 'square', 0.22), this._tone(1320, 0.5, 'triangle', 0.18)) : this._tone(520, 0.16, 'square', 0.18); }
  jump() { this._tone(330, 0.22, 'triangle', 0.3, 420); }
  boost() { this._tone(520, 0.3, 'sawtooth', 0.14, 700); this._tone(780, 0.35, 'triangle', 0.16, 900, 0.05); }
  land(strength = 0.5) { this._noise(0.22, 1800, 0.25 + strength * 0.3); this._tone(140, 0.14, 'sine', 0.3 * strength + 0.1, -60); }
  splash() { this._noise(0.7, 2600, 0.55); this._tone(220, 0.4, 'sine', 0.2, -150); }
  bump() { this._tone(180, 0.09, 'square', 0.12, -40); }
  checkpoint() { this._tone(660, 0.12, 'triangle', 0.2); this._tone(990, 0.16, 'triangle', 0.2, 0, 0.09); }
  finish(good = true) {
    if (good) [523, 659, 784, 1046].forEach((f, i) => this._tone(f, 0.28, 'triangle', 0.26, 0, i * 0.11));
    else [392, 330, 262].forEach((f, i) => this._tone(f, 0.3, 'triangle', 0.22, 0, i * 0.14));
  }
  click() { this._tone(700, 0.05, 'triangle', 0.12); }

  /** speed01 in [0,1]; call every frame while racing (0 to fade out). */
  whoosh(speed01, airborne = false) {
    if (!this.ctx || !this.whooshGain) return;
    const t = this.ctx.currentTime;
    const v = this.sfxOn ? Math.min(0.5, speed01 * 0.5) * (airborne ? 0.5 : 1) : 0;
    this.whooshGain.gain.setTargetAtTime(v, t, 0.08);
    this.whooshFilter.frequency.setTargetAtTime(350 + speed01 * 1300, t, 0.1);
  }

  startMusic() { this.playingMusic = true; }
  stopMusic() { this.playingMusic = false; }

  /** Call each frame; schedules a bouncy pentatonic loop (~124 bpm) while enabled. */
  tickMusic(dt) {
    if (!this.ctx || !this.playingMusic || !this.musicOn || this.ctx.state !== 'running') return;
    this.musicTimer -= dt;
    if (this.musicTimer > 0) return;
    this.musicTimer += 60 / 124 / 2;
    const scale = [0, 2, 4, 7, 9, 12, 14, 16];
    const pattern = [0, 2, 4, 2, 5, 4, 2, 1, 0, 3, 5, 3, 6, 5, 3, 2];
    const bass = [0, 0, 5, 5, 3, 3, 4, 4];
    const i = this.step++;
    const root = 261.63; // C4
    const n = scale[pattern[i % pattern.length]];
    this._tone(root * Math.pow(2, n / 12), 0.22, 'triangle', 0.5, 0, 0, this.musicBus);
    if (i % 2 === 0) this._tone(root * 0.5 * Math.pow(2, bass[Math.floor(i / 2) % bass.length] / 12), 0.4, 'sine', 0.7, 0, 0, this.musicBus);
    if (i % 4 === 2) this._tone(1800, 0.05, 'square', 0.08, 0, 0, this.musicBus);
  }
}
