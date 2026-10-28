// Audio di JARVIS: voce in uscita (TTS neurale), ascolto (STT) con anti-eco, effetti sonori.

export const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const master = audioCtx.createGain();
master.gain.value = 1;
master.connect(audioCtx.destination);

// ======================= VOCE =======================
export class Mouth {
  constructor({ onLevel, onSentence, onIdle }) {
    Object.assign(this, { onLevel, onSentence, onIdle });
    this.queue = []; // {text, meta, audio: Promise<AudioBuffer|null>}
    this.playing = null;
    this.generation = 0;
    this.open = false; // true finché uno stream sta ancora producendo frasi
    this.analyser = audioCtx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.5;
    this.gain = audioCtx.createGain();
    this.gain.gain.value = 1.5; // voce più presente sopra la musica
    const comp = audioCtx.createDynamicsCompressor(); // evita distorsioni col guadagno alto
    comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.2;
    this.gain.connect(comp).connect(this.analyser);
    this.analyser.connect(master);
    this.samples = new Float32Array(this.analyser.fftSize);
    this.fakeLevel = 0;
    this.meter();
  }
  get busy() { return !!this.playing || this.queue.length > 0 || this.open; }

  // quality "high": frasi fisse (voce migliore, generate una volta e salvate); "fast": risposte al momento
  fetchAudio(text, quality = "fast") {
    this.cache ??= new Map();
    if (this.cache.has(text)) return this.cache.get(text);
    const p = this.rawAudio(text, quality);
    this.cache.set(text, p);
    p.then((b) => b || this.cache.delete(text));
    return p;
  }
  rawAudio(text, quality) {
    return fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, quality }) })
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`TTS ${r.status}`))))
      .then((buf) => audioCtx.decodeAudioData(buf))
      .catch((e) => { console.warn("[voice] TTS neurale non disponibile, uso la voce del browser", e); return null; });
  }
  // Pre-carica senza riprodurre (es. briefing)
  preload(texts) { return Promise.all(texts.map((t) => this.fetchAudio(t, "high"))); }

  say(text, meta = {}, audio = null) {
    const clean = text.replace(/[*_#`>\[\]()]/g, "").replace(/\s+/g, " ").trim();
    if (!clean) return;
    this.queue.push({ text: clean, meta, audio: audio ? Promise.resolve(audio) : this.fetchAudio(clean) });
    this.next();
  }
  async next() {
    if (this.playing || !this.queue.length) {
      if (!this.playing && !this.queue.length && !this.open) this.onIdle?.();
      return;
    }
    const gen = this.generation;
    const item = this.queue.shift();
    this.playing = item;
    const buffer = await item.audio;
    if (gen !== this.generation) return;
    if (audioCtx.state !== "running") await audioCtx.resume().catch(() => {});
    if (buffer) {
      const src = audioCtx.createBufferSource();
      src.buffer = buffer;
      src.connect(this.gain);
      item.src = src;
      this.onSentence?.(item.text, buffer.duration, item.meta);
      src.onended = () => { if (gen === this.generation) this.finish(); };
      src.start();
    } else {
      this.browserSpeak(item, gen);
    }
  }
  finish() {
    this.playing = null;
    this.next();
  }
  browserSpeak(item, gen) {
    const u = new SpeechSynthesisUtterance(item.text);
    u.lang = "it-IT";
    u.rate = 1.02;
    const voices = speechSynthesis.getVoices().filter((v) => v.lang.startsWith("it"));
    u.voice = voices.find((v) => /natural|online|neural/i.test(v.name) && /diego|giuseppe|male|uomo/i.test(v.name)) || voices.find((v) => /natural|online|neural/i.test(v.name)) || voices.find((v) => /google/i.test(v.name)) || voices[0] || null;
    const est = item.text.split(/\s+/).length / 2.6;
    this.onSentence?.(item.text, est, item.meta);
    this.fake = true;
    const done = () => { this.fake = false; if (gen === this.generation) this.finish(); };
    u.onend = done;
    u.onerror = done;
    speechSynthesis.speak(u);
  }
  stop() {
    this.generation++;
    this.queue.length = 0;
    this.open = false;
    try { this.playing?.src?.stop(); } catch {}
    speechSynthesis.cancel();
    this.fake = false;
    this.playing = null;
  }
  meter() {
    const loop = () => {
      let level = 0;
      if (this.fake) {
        this.fakeLevel += (Math.random() * 0.9 - this.fakeLevel) * 0.25;
        level = this.fakeLevel;
      } else if (this.playing) {
        this.analyser.getFloatTimeDomainData(this.samples);
        let sum = 0;
        for (let i = 0; i < this.samples.length; i++) sum += this.samples[i] * this.samples[i];
        level = Math.min(1, Math.sqrt(sum / this.samples.length) * 4.2);
      }
      this.onLevel?.(level);
      requestAnimationFrame(loop);
    };
    loop();
  }
}

// ======================= MUSICA =======================
export class Music {
  constructor(cfg) {
    this.cfg = cfg;
    this.gain = audioCtx.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(master);
    this.src = null;
    this.buffer = null;
    this.ready = fetch(cfg.file)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error("nessun file musica"))))
      .then((b) => audioCtx.decodeAudioData(b))
      .then((buf) => (this.buffer = buf))
      .catch(() => null);
  }
  get playing() { return !!this.src; }
  fade(volume, seconds = 0.8) {
    const t = audioCtx.currentTime, g = this.gain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(volume, t + seconds);
  }
  async play(volume = this.cfg.intro) {
    await this.ready;
    if (!this.buffer) return false;
    if (!this.src) {
      const src = audioCtx.createBufferSource();
      src.buffer = this.buffer;
      src.loop = this.cfg.loop !== false;
      src.loopStart = this.cfg.start || 0;
      src.loopEnd = this.buffer.duration;
      src.onended = () => { if (this.src === src) this.src = null; };
      src.connect(this.gain);
      src.start(0, this.cfg.start || 0);
      this.src = src;
    }
    this.fade(volume, 0.35);
    return true;
  }
  stop(seconds = 2.5) {
    if (!this.src) return;
    const src = this.src;
    this.src = null;
    this.fade(0, seconds);
    setTimeout(() => { try { src.stop(); } catch {} }, seconds * 1000 + 100);
  }
}

// ======================= ASCOLTO =======================
// Strategia: un SOLO motore alla volta.
//  - "browser": riconoscimento vocale di Chrome/Edge (veloce, nessuna allucinazione sul rumore)
//  - "whisper": fallback locale con VAD (registra solo quando rileva voce vera)
// Mentre JARVIS parla, il riconoscimento viene azzerato così la sua stessa voce non viene presa come domanda.
export class Ears {
  constructor({ onFinal, onInterim, onMic, onState, onError }) {
    Object.assign(this, { onFinal, onInterim, onMic, onState, onError });
    this.engine = null;
    this.muted = false;
    this.paused = false;
    this.mutedAt = 0;
    this.unmutedAt = 0;
  }
  async start(preferred = new URLSearchParams(location.search).get("stt") || "auto") {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    this.micLabel = this.stream.getAudioTracks()[0]?.label || "microfono";
    this.analyser = audioCtx.createAnalyser();
    this.analyser.fftSize = 1024;
    audioCtx.createMediaStreamSource(this.stream).connect(this.analyser);
    this.buf = new Float32Array(this.analyser.fftSize);
    this.noiseFloor = 0.01;
    this.level = 0;
    this.meterLoop();
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (preferred !== "whisper" && SR) this.startBrowser(SR);
    else this.startWhisper();
  }
  meterLoop() {
    const tick = () => {
      if (this.analyser) {
        this.analyser.getFloatTimeDomainData(this.buf);
        let s = 0;
        for (let i = 0; i < this.buf.length; i++) s += this.buf[i] * this.buf[i];
        this.rms = Math.sqrt(s / this.buf.length);
        this.level += (Math.min(1, this.rms * 9) - this.level) * 0.3;
        this.onMic?.(this.muted || this.paused ? 0 : this.level, this.rms);
      }
      requestAnimationFrame(tick);
    };
    tick();
  }

  // ---------- motore browser ----------
  startBrowser(SR) {
    this.engine = "browser";
    this.onState?.("BROWSER STT");
    const r = (this.rec = new SR());
    r.lang = "it-IT";
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;
    this.recRunning = false;
    this.browserFailures = 0;
    r.onstart = () => { this.recRunning = true; this.onState?.(this.muted ? "ECHO GUARD" : "LISTENING"); };
    r.onresult = (e) => {
      this.browserFailures = 0;
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i], text = res[0].transcript.trim();
        if (res.isFinal) {
          if (text) this.onFinal?.(text, { echo: this.muted, confidence: res[0].confidence, engine: "browser" });
        } else interim += text + " ";
      }
      if (interim.trim()) this.onInterim?.(interim.trim(), { echo: this.muted });
    };
    r.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      this.onError?.(`STT browser: ${e.error}`);
      if (["network", "service-not-allowed", "language-not-supported", "audio-capture"].includes(e.error) && ++this.browserFailures >= 2) {
        this.rec = null;
        try { r.abort(); } catch {}
        this.startWhisper();
      }
    };
    r.onend = () => {
      this.recRunning = false;
      if (this.rec === r && !this.paused) setTimeout(() => this.restartBrowser(), 120);
    };
    this.restartBrowser();
  }
  restartBrowser() {
    if (!this.rec || this.recRunning || this.paused) return;
    try { this.rec.start(); } catch {}
  }
  // abort() scarta l'audio accumulato (cioè l'eco della voce di JARVIS); onend lo riavvia pulito
  flushBrowser() {
    if (this.rec && this.recRunning) try { this.rec.abort(); } catch {}
  }

  // ---------- motore whisper (VAD) ----------
  startWhisper() {
    this.engine = "whisper";
    this.onState?.("WHISPER VAD");
    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
    let speaking = false, above = 0, below = 0, started = 0, recorder = null;
    const loop = () => {
      if (this.engine !== "whisper") return;
      const rms = this.rms || 0;
      const threshold = Math.max(0.018, this.noiseFloor * 3.2);
      if (!speaking) this.noiseFloor += (Math.min(rms, 0.05) - this.noiseFloor) * 0.02;
      const blocked = this.muted || this.paused;
      if (!speaking && !blocked) {
        above = rms > threshold ? above + 1 : 0;
        if (above >= 4) {
          speaking = true; below = 0; started = performance.now();
          const myChunks = [], t0 = started;
          recorder = new MediaRecorder(this.stream, { mimeType: mime });
          recorder.ondataavailable = (e) => e.data.size && myChunks.push(e.data);
          recorder.onstop = () => this.sendWhisper(new Blob(myChunks, { type: mime }), performance.now() - t0, mime);
          recorder.start();
          this.onState?.("RECORDING");
        }
      } else if (speaking) {
        below = rms < threshold * 0.75 ? below + 1 : 0;
        const dur = performance.now() - started;
        if (blocked || below > 45 || dur > 12000) { // ~750ms di silenzio
          speaking = false; above = 0;
          if (blocked) { recorder.onstop = null; }
          try { recorder.stop(); } catch {}
          this.onState?.("LISTENING");
        }
      }
      setTimeout(loop, 16);
    };
    loop();
  }
  async sendWhisper(blob, duration, mime) {
    if (duration < 450 || blob.size < 3000) return;
    try {
      const r = await fetch("/api/stt", { method: "POST", headers: { "Content-Type": mime }, body: blob });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || r.status);
      if (data.text) this.onFinal?.(data.text, { echo: this.muted, engine: "whisper" });
    } catch (e) {
      this.onError?.(`Whisper: ${e.message || e}`);
    }
  }

  // ---------- controllo ----------
  mute(on) {
    if (this.muted === on) return;
    this.muted = on;
    if (on) this.mutedAt = performance.now();
    else this.unmutedAt = performance.now();
    if (this.engine === "browser") this.flushBrowser();
    this.onState?.(on ? "ECHO GUARD" : "LISTENING");
  }
  pause() {
    this.paused = true;
    if (this.rec) try { this.rec.abort(); } catch {}
    this.stream?.getAudioTracks().forEach((t) => (t.enabled = false));
  }
  resume() {
    this.paused = false;
    this.stream?.getAudioTracks().forEach((t) => (t.enabled = true));
    this.restartBrowser();
  }
}

// ======================= EFFETTI SONORI =======================
function noiseBuffer(seconds) {
  const b = audioCtx.createBuffer(1, audioCtx.sampleRate * seconds, audioCtx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}
function env(g, t, a, peak, d) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
}
export const sfx = {
  wake() {
    const t = audioCtx.currentTime;
    // sub boom
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = "sine"; o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(32, t + 1.4);
    env(g, t, 0.02, 0.9, 1.6); o.connect(g).connect(master); o.start(t); o.stop(t + 1.8);
    // soffio che sale
    const n = audioCtx.createBufferSource(), f = audioCtx.createBiquadFilter(), ng = audioCtx.createGain();
    n.buffer = noiseBuffer(2.5); f.type = "bandpass"; f.Q.value = 1.4;
    f.frequency.setValueAtTime(180, t); f.frequency.exponentialRampToValueAtTime(5200, t + 0.9); f.frequency.exponentialRampToValueAtTime(900, t + 2.2);
    ng.gain.setValueAtTime(0.0001, t); ng.gain.exponentialRampToValueAtTime(0.22, t + 0.5); ng.gain.exponentialRampToValueAtTime(0.0001, t + 2.3);
    n.connect(f).connect(ng).connect(master); n.start(t); n.stop(t + 2.5);
    // shimmer armonico
    [523.25, 783.99, 1046.5, 1567.98].forEach((fr, i) => {
      const s = audioCtx.createOscillator(), sg = audioCtx.createGain();
      s.type = "sine"; s.frequency.value = fr; s.detune.value = (i - 1.5) * 6;
      env(sg, t + 0.45 + i * 0.07, 0.25, 0.05 / (i + 1), 1.8);
      s.connect(sg).connect(master); s.start(t + 0.4); s.stop(t + 3);
    });
  },
  listen() {
    const t = audioCtx.currentTime;
    [1318.5, 1975.5].forEach((fr, i) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = "sine"; o.frequency.value = fr;
      env(g, t + i * 0.07, 0.008, 0.05, 0.18);
      o.connect(g).connect(master); o.start(t + i * 0.07); o.stop(t + 0.4);
    });
  },
  think() {
    const t = audioCtx.currentTime, o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = "triangle"; o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(440, t + 0.25);
    env(g, t, 0.02, 0.03, 0.3); o.connect(g).connect(master); o.start(t); o.stop(t + 0.4);
  },
  sleep() {
    const t = audioCtx.currentTime;
    [987.77, 659.25, 440].forEach((fr, i) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = "sine"; o.frequency.value = fr;
      env(g, t + i * 0.11, 0.01, 0.045, 0.35);
      o.connect(g).connect(master); o.start(t + i * 0.11); o.stop(t + 0.9);
    });
  },
  tick() {
    const t = audioCtx.currentTime, o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = "square"; o.frequency.value = 2400;
    env(g, t, 0.002, 0.012, 0.03); o.connect(g).connect(master); o.start(t); o.stop(t + 0.05);
  },
};
