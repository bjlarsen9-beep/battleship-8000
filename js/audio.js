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

  burst({ dur = 0.35, vol = 0.6, startFreq = 1400, endFreq = 60, delay = 0, dest = null } = {}) {
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
    src.connect(filter).connect(gain).connect(dest || this.master);
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

  // --- soundtrack ------------------------------------------------------
  // Two original naval marches, sequenced in eighth notes:
  //   menu   — "Anchors Up": bugle-call fanfare over an oom-pah march in C.
  //   battle — "Depth Charge": a driving A-minor gallop with sonar pings.
  startMusic(pattern = 'menu') {
    if (!this.enabled || !this.ensure()) return;
    this.stopMusic();
    const song = SONGS[pattern] || SONGS.menu;
    const lead = parseLine(song.lead);
    const bass = song.bass;
    const len = lead.length;
    const m = this.musicGain;
    this.step = 0;
    const tick = () => {
      const i = this.step % len;
      const beat = i % 8;
      const bar = Math.floor(i / 8);
      if (lead[i]) {
        this.blip({ freq: lead[i], dur: song.leadDur, type: 'square', vol: 0.16, dest: m });
        this.blip({ freq: lead[i] * 2, dur: song.leadDur * 0.6, type: 'triangle', vol: 0.05, dest: m });
      }
      const root = bass.roots[bar % bass.roots.length];
      const off = bass.pattern[beat];
      if (off !== null) this.blip({ freq: midi(root + off), dur: 0.14, type: 'triangle', vol: 0.55, dest: m });
      if (beat === 0 || beat === 4) this.blip({ freq: 130, dur: 0.12, type: 'sine', vol: 0.6, slide: -90, dest: m });
      const roll = song.rolls && bar % 4 === 3 && beat >= 4;
      if (beat === 2 || beat === 6 || roll) {
        this.burst({ dur: roll ? 0.06 : 0.1, vol: roll ? 0.18 : 0.28, startFreq: 3200, endFreq: 900, dest: m });
      }
      if (song.hats && beat % 2 === 1) this.burst({ dur: 0.03, vol: 0.08, startFreq: 8000, endFreq: 5000, dest: m });
      if (song.sonar && i % 32 === 0) {
        this.blip({ freq: 1320, dur: 0.9, type: 'sine', vol: 0.14, dest: m });
        this.blip({ freq: 1320, dur: 0.7, type: 'sine', vol: 0.05, delay: 0.45, dest: m });
      }
      this.step++;
    };
    tick();
    this.musicTimer = setInterval(tick, song.stepMs);
  }

  stopMusic() {
    if (this.musicTimer) clearInterval(this.musicTimer);
    this.musicTimer = null;
  }
}

const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function midi(n) {
  return 440 * 2 ** ((n - 69) / 12);
}

/** "G4 . C#5 ." -> [freq, 0, freq, 0]; bar lines ("|") are ignored. */
function parseLine(text) {
  return text.split(/\s+/).filter((t) => t && t !== '|').map((t) => {
    const m = /^([A-G])(#?)(\d)$/.exec(t);
    if (!m) return 0;
    return midi(12 * (Number(m[3]) + 1) + NOTE[m[1]] + (m[2] ? 1 : 0));
  });
}

const C3 = 48, F2 = 41, G2 = 43, A2 = 45, E2 = 40;

const SONGS = {
  menu: {
    stepMs: 200,
    leadDur: 0.16,
    rolls: true,
    lead: `G4 . C5 . E5 . G5 . | E5 . C5 . D5 E5 F5 . | E5 . D5 . C5 . A4 . | G4 . . . G4 A4 B4 .
           C5 . E5 . G5 . C6 . | A5 . F5 . G5 . E5 . | F5 . D5 . E5 . C5 . | D5 . B4 . C5 . . .`,
    bass: { roots: [C3, C3, A2, G2, C3, F2, F2, G2], pattern: [0, null, 7, null, 0, null, 7, null] }
  },
  battle: {
    stepMs: 170,
    leadDur: 0.12,
    hats: true,
    sonar: true,
    lead: `A4 . . E5 . . A5 G5 | F5 . E5 . D5 . E5 . | A4 . . C5 . . E5 D5 | C5 . B4 . G#4 . . .
           A5 . . G5 . . F5 E5 | F5 . . E5 . . D5 C5 | D5 . C5 . B4 . C5 D5 | E5 . . . E4 . G#4 B4`,
    bass: { roots: [A2, F2, A2, E2, A2, F2, G2, E2], pattern: [0, 0, 12, 0, 0, 12, 0, 0] }
  }
};
