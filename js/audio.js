// Tiny chiptune engine: square/triangle/noise voices via Web Audio, no assets.
// Everything is synthesised so the whole game stays a few files with zero deps.

export class Chiptune {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.enabled = true;
    this.musicTimer = null;
    this.step = 0;
    this.noiseBuffer = null;
  }

  ensure() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return false;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.28;
      this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.35;
      this.musicGain.connect(this.master);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return true;
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.value = on ? 0.28 : 0;
    if (!on) {
      this.stopMusic();
      if (window.speechSynthesis) window.speechSynthesis.cancel();
    }
  }

  /**
   * Say something out loud. Speech synthesis is unavailable or voiceless in
   * plenty of environments, so every failure here is silent by design.
   */
  speak(text, { rate = 0.9, pitch = 0.6 } = {}) {
    if (!this.enabled) return;
    const synth = window.speechSynthesis;
    if (!synth || typeof window.SpeechSynthesisUtterance !== 'function') return;
    try {
      synth.cancel();
      const utter = new window.SpeechSynthesisUtterance(text);
      utter.rate = rate;
      utter.pitch = pitch;
      utter.volume = 1;
      synth.speak(utter);
    } catch {
      /* no voice, no problem */
    }
  }

  noise() {
    if (!this.noiseBuffer) {
      const len = this.ctx.sampleRate * 1.2;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBuffer = buf;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    return src;
  }

  blip({ freq = 440, dur = 0.09, type = 'square', vol = 0.5, slide = 0, dest = null, delay = 0 } = {}) {
    if (!this.enabled || !this.ensure()) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t0 + dur);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(dest || this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  burst({ dur = 0.35, vol = 0.6, startFreq = 1400, endFreq = 60, delay = 0 } = {}) {
    if (!this.enabled || !this.ensure()) return;
    const t0 = this.ctx.currentTime + delay;
    const src = this.noise();
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(startFreq, t0);
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, endFreq), t0 + dur);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  // --- named cues -------------------------------------------------------
  uiMove() {
    this.blip({ freq: 320, dur: 0.05, vol: 0.3 });
  }

  uiSelect() {
    this.blip({ freq: 540, dur: 0.07, vol: 0.4 });
    this.blip({ freq: 810, dur: 0.09, vol: 0.35, delay: 0.06 });
  }

  denied() {
    this.blip({ freq: 150, dur: 0.16, type: 'sawtooth', vol: 0.4, slide: -70 });
  }

  launch() {
    this.blip({ freq: 900, dur: 0.3, type: 'sawtooth', vol: 0.3, slide: -700 });
  }

  splash() {
    this.burst({ dur: 0.3, vol: 0.35, startFreq: 900, endFreq: 200 });
    this.blip({ freq: 220, dur: 0.14, type: 'sine', vol: 0.25, slide: 120, delay: 0.02 });
  }

  explode() {
    this.burst({ dur: 0.55, vol: 0.8, startFreq: 2200, endFreq: 50 });
    this.blip({ freq: 110, dur: 0.4, type: 'square', vol: 0.4, slide: -80 });
  }

  sink() {
    this.explode();
    [440, 330, 247, 165, 110].forEach((f, i) =>
      this.blip({ freq: f, dur: 0.18, type: 'square', vol: 0.4, delay: 0.12 + i * 0.1 })
    );
  }

  fanfare() {
    [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) =>
      this.blip({ freq: f, dur: 0.16, type: 'square', vol: 0.45, delay: i * 0.12 })
    );
  }

  lament() {
    [392, 370, 349, 330, 294, 262, 196].forEach((f, i) =>
      this.blip({ freq: f, dur: 0.24, type: 'triangle', vol: 0.45, delay: i * 0.18 })
    );
  }

  // --- looping bass line ------------------------------------------------
  startMusic(pattern = 'menu') {
    if (!this.enabled || !this.ensure()) return;
    this.stopMusic();
    const lines = {
      menu: [55, 0, 82, 0, 65, 0, 98, 0, 55, 0, 82, 0, 73, 0, 62, 0],
      battle: [73, 73, 0, 98, 73, 0, 110, 0, 65, 65, 0, 87, 65, 0, 98, 0]
    };
    const line = lines[pattern] || lines.menu;
    const lead = {
      menu: [0, 0, 440, 0, 0, 0, 523, 0, 0, 0, 659, 0, 0, 0, 494, 0],
      battle: [587, 0, 0, 440, 0, 587, 0, 698, 0, 0, 523, 0, 440, 0, 0, 0]
    }[pattern] || [];
    this.step = 0;
    const tick = () => {
      const i = this.step % line.length;
      if (line[i]) this.blip({ freq: line[i], dur: 0.16, type: 'triangle', vol: 0.5, dest: this.musicGain });
      if (lead[i]) this.blip({ freq: lead[i], dur: 0.1, type: 'square', vol: 0.12, dest: this.musicGain });
      if (i % 4 === 0) this.burst({ dur: 0.05, vol: 0.12, startFreq: 5000, endFreq: 2000 });
      this.step++;
    };
    tick();
    this.musicTimer = setInterval(tick, 190);
  }

  stopMusic() {
    if (this.musicTimer) clearInterval(this.musicTimer);
    this.musicTimer = null;
  }
}
