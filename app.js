import { createScene } from "./scene.js";
import { Mouth, Ears, Music, sfx, audioCtx } from "./audio.js";
import { CONFIG, matchPhrase, linesFor, staticLines } from "./phrases.js";

const $ = (s) => document.querySelector(s);
const body = document.body;
const fmt = new Intl.NumberFormat("it-IT");

let state = { memories: [], settings: { addressAs: "signore" }, setup: {}, briefing: { lines: [], today: [] } };
let mode = "boot",
  greeted = false,
  history = [],
  streamAbort = null,
  lastActivity = 0,
  lastHandled = { text: "", at: 0 },
  lastSpoken = "",
  sleepAfterSpeech = false,
  briefingAudio = null,
  thinkStart = 0,
  thinkSyn = 0,
  partyMode = false,
  briefingDone = false,
  musicOn = false,
  recMode = false; // modalità registrazione: risponde solo se senti "Jarvis", non va mai in standby
const music = new Music(CONFIG.music);

const WAKE = /\b(jarvis|giarvis|jarvi|iarvis|jervis|gervis|darvis|charvis|javis|jar vis|giarvi)\b/i;
const STOP = /\b(stop|basta|fermati|zitto|silenzio|aspetta|jarvis|giarvis)\b/i;
const STANDBY = /\b(grazie jarvis|a dopo|vai in standby|standby|riposati|spegniti|buonanotte|disattivati)\b/i;
const SHORT_OK = /^(sì|si|no|stop|grazie|ok|okay|conferma|confermo|annulla|procedi|esatto|certo|perfetto|basta|continua)$/i;

// ---------------------------------------------------------------- scena + audio
const scene = createScene($("#gl"), $("#labels"));
scene.setMode("boot");

const mouth = new Mouth({
  onLevel: (v) => scene.setLevel(v),
  onSentence: (text, dur, meta) => {
    lastSpoken = text;
    showCaption(text, dur);
    if (meta.stat) revealStat(meta.stat, dur);
    if (meta.stat2) setTimeout(() => revealStat(meta.stat2, dur * 0.6), dur * 450);
    if (meta.stat?.id === "agenda") revealAgenda();
    if (meta.stat2?.id === "agenda") setTimeout(revealAgenda, dur * 450);
    if (meta.music === "party") { partyMode = true; music.play(1); scene.burstSynapses(80); }
    if (meta.music === "stop") { partyMode = false; musicOn = false; setTimeout(() => music.stop(3), 900); }
    if (meta.music === "party") musicOn = true;
    if (meta.stat && !/^(agenda|week)$/.test(meta.stat.id)) body.classList.add("show-stats");
  },
  onIdle: () => {
    if (mode !== "speak" && mode !== "wake") return;
    if (sleepAfterSpeech) { sleepAfterSpeech = false; return setTimeout(goSleep, 400); }
    setTimeout(() => {
      if (mouth.busy || (mode !== "speak" && mode !== "wake")) return;
      setMode("listen");
      sfx.listen();
    }, 250);
  },
});

const ears = new Ears({
  onFinal: handleFinal,
  onInterim: (text, { echo }) => {
    if (echo || mode !== "listen") return;
    $("#you").textContent = text;
    $("#you").classList.add("live");
  },
  onMic: (level) => {
    scene.setMic(mode === "sleep" || mode === "listen" ? level : 0);
    $("#micBar").style.transform = `scaleX(${Math.min(1, level * 1.4)})`;
  },
  onState: (s) => debug("debugRec", s),
  onError: (e) => { console.warn(e); debug("debugError", e); },
});

// ---------------------------------------------------------------- stato
const STATUS = {
  boot: "INIZIALIZZAZIONE",
  sleep: "IN ATTESA · DÌ «CIAO JARVIS»",
  wake: "CONNESSIONE NEURALE",
  listen: "IN ASCOLTO",
  listenRec: "IN ASCOLTO · DÌ «JARVIS»",
  think: "ELABORAZIONE",
  speak: "RISPOSTA",
  paused: "MICROFONO IN PAUSA",
};
function setMode(m) {
  mode = m;
  body.dataset.mode = m;
  scene.setMode(m === "wake" ? "speak" : m === "paused" ? "sleep" : m);
  ears.mute(m === "speak" || m === "wake");
  $("#statusText").textContent = (m === "listen" && recMode ? STATUS.listenRec : STATUS[m]) || m.toUpperCase();
  debug("debugState", m.toUpperCase());
  if (m === "listen") lastActivity = performance.now();
  // musica: forte al risveglio, poi sempre in sottofondo (più bassa dopo il briefing); si ferma solo in pausa
  const C = CONFIG.music, bed = briefingDone ? C.bedAfter : C.bed, duck = briefingDone ? C.duckAfter : C.duck;
  if (m === "wake") {
    musicOn = true;
    music.play(music.playing ? bed : C.intro).then((ok) => ok && setTimeout(() => mode === "wake" && music.fade(duck, 0.5), 700));
  } else if (m === "speak" && music.playing) music.fade(partyMode ? 0.4 : duck, 0.4);
  else if (m === "listen" && music.playing) {
    if (!briefingDone) briefingDone = true;
    music.fade(partyMode ? 1 : CONFIG.music.bedAfter, briefingDone ? 2.5 : 1.2);
  } else if (m === "sleep" && music.playing) { partyMode = false; music.fade(C.bedAfter, 2); }
  else if (m === "paused") { partyMode = false; music.stop(1.2); }
  if (m === "think") { $("#says").innerHTML = ""; thinkStart = performance.now(); thinkSyn = scene.synapses; }
}

function debug(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

// ---------------------------------------------------------------- HUD
function showCaption(text, dur) {
  const el = $("#says");
  el.innerHTML = "";
  const words = text.split(/\s+/);
  const step = Math.min(0.42, (dur * 0.9) / words.length);
  words.forEach((w, i) => {
    const s = document.createElement("span");
    s.textContent = w + " ";
    s.style.animationDelay = `${i * step}s`;
    el.appendChild(s);
  });
}
function countUp(el, target, duration, suffix = "") {
  const t0 = performance.now();
  let lastTick = 0;
  const frame = (now) => {
    const p = Math.min(1, (now - t0) / duration);
    const eased = p === 1 ? 1 : 1 - Math.pow(2, -10 * p);
    el.textContent = fmt.format(Math.round(target * eased)) + suffix;
    if (p < 1 && now - lastTick > 75) { sfx.tick(); lastTick = now; }
    if (p < 1) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
function revealStat(stat, dur) {
  let card = document.querySelector(`.stat[data-id="${stat.id}"]`);
  if (!card) {
    card = document.createElement("div");
    card.className = "stat";
    card.dataset.id = stat.id;
    const n = $("#stats").children.length + 1;
    card.innerHTML = `<div class="stat-head"><span>${String(n).padStart(2, "0")}</span><em></em></div><b>0</b><small></small><div class="bar"><i></i></div>`;
    card.querySelector("small").textContent = stat.label;
    $("#stats").appendChild(card);
  }
  requestAnimationFrame(() => card.classList.add("on"));
  const duration = Math.max(1200, Math.min(2600, dur * 850));
  countUp(card.querySelector("b"), stat.value, duration, stat.suffix || "");
  card.querySelector(".bar i").style.transitionDuration = `${duration}ms`;
  requestAnimationFrame(() => (card.querySelector(".bar i").style.transform = `scaleX(${stat.suffix === "%" ? stat.value / 100 : 1})`));
  scene.burstSynapses(18);
}
function renderAgenda() {
  const today = state.briefing.today || [];
  const now = new Date(), hm = now.getHours() * 60 + now.getMinutes();
  let nextMarked = false;
  $("#agenda").innerHTML = "";
  (today.length ? today : [{ title: "Nessun impegno", time: "—" }]).slice(0, 7).forEach((t, i) => {
    const li = document.createElement("li");
    const mins = t.minutes ?? NaN;
    if (!nextMarked && Number.isFinite(mins) && mins >= 0 && mins >= hm) { li.classList.add("next"); nextMarked = true; }
    li.style.transitionDelay = `${i * 0.12}s`;
    if (t.id) li.dataset.id = t.id;
    li.innerHTML = `<time></time><span></span>`;
    li.querySelector("time").textContent = t.time || (t.allDay ? "GIORNO" : "--:--");
    li.querySelector("span").textContent = t.title;
    $("#agenda").appendChild(li);
  });
}
// ---------------------------------------------------------------- frasi preimpostate
function phraseContext() {
  const d = new Date();
  return {
    today: state.briefing.today || [],
    hasMusic: !!music.buffer,
    nowMinutes: d.getHours() * 60 + d.getMinutes(),
    time: `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`,
  };
}
async function runPhrase(phrase, text) {
  const lines = linesFor(phrase, phraseContext());
  setMode("think");
  sfx.think();
  scene.burstSynapses(45);
  $("#thinkLabel").textContent = "ELABORAZIONE";
  const audio = await Promise.all([Promise.all(lines.map((l) => mouth.fetchAudio(l.text))), new Promise((r) => setTimeout(r, 650))]);
  if (mode !== "think") return; // interrotto
  history.push({ role: "user", content: text }, { role: "assistant", content: lines.map((l) => l.text).join(" ") });
  history = history.slice(-12);
  lines.forEach((l, i) => { if (i === 0) setMode("speak"); mouth.say(l.text, l, audio[0][i]); });
}

function revealAgenda() {
  renderAgenda();
  body.classList.add("show-agenda");
}
function setLabels() {
  const today = state.briefing.today || [];
  const items = [
    ...today.slice(0, 4).map((t) => ({ kind: `AGENDA · ${t.time || "GIORNO"}`, text: t.title.slice(0, 34) })),
    ...state.memories.slice(0, 3).map((m) => ({ kind: "MEMORIA", text: m.text.slice(0, 34) })),
    { kind: "SISTEMA", text: state.setup.calendar ? "Calendario sincronizzato" : "Agenda locale attiva" },
    { kind: "SISTEMA", text: "Rete neurale operativa" },
  ];
  scene.setLabels(items);
}
setInterval(() => {
  const d = new Date();
  $("#clock").textContent = d.toLocaleTimeString("it-IT");
  $("#date").textContent = d.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" }).toUpperCase();
  if (mode === "think") {
    $("#synapses").textContent = fmt.format((scene.synapses - thinkSyn) * 37);
    $("#thinkTime").textContent = `${((performance.now() - thinkStart) / 1000).toFixed(1)}s`;
  }
  if (!recMode && mode === "listen" && performance.now() - lastActivity > 45000 && !mouth.busy) goSleep();
}, 100);

// ---------------------------------------------------------------- voce
function speak(text, meta = {}) {
  if (mode !== "speak" && mode !== "wake") setMode("speak");
  mouth.say(text, meta);
}
function interrupt() {
  streamAbort?.abort();
  streamAbort = null;
  mouth.stop();
  $("#says").innerHTML = "";
  setMode("listen");
  sfx.listen();
}

// ---------------------------------------------------------------- risveglio / standby
async function wake(rest = "") {
  lastActivity = performance.now();
  const question = rest.replace(/^[\s,.!?]*(ciao|ehi|hey|ok|buongiorno|salve)?[\s,.!?]*/i, "").trim();
  body.classList.add("awake");
  if (greeted) {
    sfx.listen();
    scene.wake();
    if ($("#stats").children.length) body.classList.add("show-stats", "show-agenda");
    if (question.split(/\s+/).length >= 3) return process(question);
    setMode("speak");
    return speak(pick([`Sono qui, ${state.settings.addressAs}.`, `Dimmi pure, ${state.settings.addressAs}.`, `Ti ascolto, ${state.settings.addressAs}.`]));
  }
  greeted = true;
  setMode("wake");
  sfx.wake();
  scene.wake();
  setLabels();
  $("#says").innerHTML = "";
  $("#you").textContent = "";
  setTimeout(() => body.classList.add("show-stats"), 900);
  const lines = state.briefing.lines || [];
  const audio = await (briefingAudio || Promise.resolve([]));
  setTimeout(() => lines.forEach((l, i) => mouth.say(l.text, l, audio[i] || null)), 1100);
  if (question.split(/\s+/).length >= 3) pendingQuestion = question;
}
let pendingQuestion = null;
function goSleep() {
  streamAbort?.abort();
  mouth.stop();
  setMode("sleep");
  body.classList.remove("awake", "show-stats", "show-agenda");
  $("#says").innerHTML = "";
  $("#you").textContent = "";
  sfx.sleep();
}
const pick = (a) => a[Math.floor(Math.random() * a.length)];

// ---------------------------------------------------------------- input vocale
function normalize(t) {
  return t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}
function looksLikeEcho(text) {
  const heard = new Set(normalize(text).split(" ").filter((w) => w.length > 2));
  const spoken = new Set(normalize(lastSpoken).split(" "));
  if (!heard.size) return true;
  let common = 0;
  heard.forEach((w) => spoken.has(w) && common++);
  return common / heard.size > 0.5;
}
function handleFinal(raw, info = {}) {
  const text = raw.trim();
  if (!text) return;
  debug("debugText", `${info.engine || "?"}${info.echo ? " (eco)" : ""}: ${text}`);
  console.log(`[ears] ${mode}${info.echo ? " echo" : ""}:`, text);

  if (mode === "sleep") {
    const m = text.match(WAKE);
    if (m) wake(text.slice(m.index + m[0].length));
    return;
  }
  if (mode === "paused" || mode === "boot") return;
  if (info.engine === "tastiera" && mode !== "listen") { interrupt(); return process(text); }
  if (info.echo || mode === "think" || mode === "speak" || mode === "wake") {
    // barge-in: solo comandi espliciti e che non siano l'eco della voce di JARVIS
    if (STOP.test(text) && !looksLikeEcho(text)) interrupt();
    return;
  }
  // mode === "listen"
  if (recMode && !WAKE.test(text)) return debug("debugError", `modalità registrazione, ignorato: "${text}"`);
  const key = normalize(text);
  if (key === lastHandled.text && Date.now() - lastHandled.at < 4000) return;
  const words = key.split(" ").filter(Boolean);
  if (text.length < 3 || (words.length < 2 && !SHORT_OK.test(key) && !WAKE.test(text))) return debug("debugError", `ignorato: "${text}"`);
  if (info.confidence > 0 && info.confidence < 0.35 && words.length < 4) return debug("debugError", `bassa confidenza: "${text}"`);
  lastHandled = { text: key, at: Date.now() };
  $("#you").textContent = text;
  $("#you").classList.remove("live");
  process(text.replace(/^(ciao |ehi |hey )?(jarvis|giarvis)[,.]?\s*/i, "") || text);
}

async function process(text) {
  try {
    return await handleIntent(text);
  } catch (e) {
    debug("debugError", e.message);
    return speak(`Si è verificato un problema tecnico, ${state.settings.addressAs}. Puoi ripetere?`);
  }
}
async function handleIntent(text) {
  lastActivity = performance.now();
  const phrase = matchPhrase(text);
  if (STANDBY.test(text)) {
    sleepAfterSpeech = true;
    return speak(`A presto, ${state.settings.addressAs}. Resto in ascolto.`);
  }
  if (phrase) return runPhrase(phrase, text);
  return askMind(text);
}

async function askMind(text) {
  setMode("think");
  sfx.think();
  scene.burstSynapses(40);
  $("#thinkLabel").textContent = "ANALISI SEMANTICA";
  const labels = ["ANALISI SEMANTICA", "ATTRAVERSAMENTO MEMORIA", "SINTESI RISPOSTA"];
  let li = 0;
  const labelTimer = setInterval(() => ($("#thinkLabel").textContent = labels[++li % labels.length]), 900);
  const ctrl = new AbortController();
  streamAbort = ctrl;
  let buffer = "", full = "", spoke = false;
  const flush = (force) => {
    for (;;) {
      const m = buffer.match(/^[\s\S]*?[.!?…;](?=\s|$)/);
      if (!m) break;
      let s = m[0];
      if (s.trim().length < 20) {
        const m2 = buffer.slice(s.length).match(/^[\s\S]*?[.!?…;](?=\s|$)/);
        if (!m2) break;
        s += m2[0];
      }
      buffer = buffer.slice(s.length);
      say(s);
    }
    if (force && buffer.trim()) { say(buffer); buffer = ""; }
  };
  const say = (s) => {
    s = s.trim();
    if (!s || ctrl.signal.aborted) return;
    spoke = true;
    clearInterval(labelTimer);
    mouth.open = true;
    speak(s);
  };
  try {
    const res = await fetch("/api/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, history }),
      signal: ctrl.signal,
    });
    const reader = res.body.getReader(), dec = new TextDecoder();
    let raw = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      raw += dec.decode(value, { stream: true });
      let i;
      while ((i = raw.indexOf("\n\n")) >= 0) {
        const line = raw.slice(0, i).replace(/^data:\s*/, "");
        raw = raw.slice(i + 2);
        let ev;
        try { ev = JSON.parse(line); } catch { continue; }
        if (ev.type === "context") {
          $("#thinkLabel").textContent = "MEMORIA PERTINENTE TROVATA";
          scene.highlight();
        } else if (ev.type === "tool") {
          $("#thinkLabel").textContent = { add_event: "AGGIORNAMENTO AGENDA", delete_event: "AGGIORNAMENTO AGENDA", save_memory: "CODIFICA NUOVA MEMORIA", show_number: "ELABORAZIONE DATI" }[ev.name] || "ELABORAZIONE";
          scene.burstSynapses(40);
        } else if (ev.type === "agenda") {
          state.briefing.today = ev.today;
          revealAgenda();
          // aggiorna le card del briefing, se già visibili
          for (const [id, value] of [["agenda", ev.today.length], ["week", ev.week]]) {
            const b = document.querySelector(`.stat[data-id="${id}"] b`);
            if (b) countUp(b, value, 900);
          }
          setLabels();
          scene.highlight();
        } else if (ev.type === "memory") {
          state.memories.unshift({ text: ev.text });
          setLabels();
          scene.highlight(0);
        } else if (ev.type === "stat") {
          body.classList.add("show-stats");
          revealStat(ev.stat, 2);
        } else if (ev.type === "delta") {
          buffer += ev.text;
          full += ev.text;
          flush(false);
        }
      }
    }
    flush(true);
  } catch (e) {
    if (!ctrl.signal.aborted) say("La connessione con la mia mente generale si è interrotta. Riprova tra un istante.");
  } finally {
    clearInterval(labelTimer);
    if (streamAbort === ctrl) streamAbort = null;
    mouth.open = false;
    if (full.trim()) history.push({ role: "user", content: text }, { role: "assistant", content: full.trim() });
    history = history.slice(-12);
    if (!spoke && mode === "think") setMode("listen");
    else mouth.next();
  }
}

// ---------------------------------------------------------------- API + avvio
async function api(path, o = {}) {
  const r = await fetch(path, { headers: { "Content-Type": "application/json" }, ...o });
  if (!r.ok) throw Error((await r.json().catch(() => ({}))).error || "Errore");
  return r.json();
}
async function boot() {
  try {
    state = await api("/api/bootstrap");
    refreshSetupBadge();
    if (!state.setup.openai) openSetup();
  } catch (e) {
    debug("debugError", "server non raggiungibile");
  }
  renderAgenda();
  fetch("/api/voice/health").then((r) => r.json()).then((h) => debug("debugVoice", h.elevenlabs ? "ELEVENLABS" : h.tts ? `NEURALE GRATUITA${h.whisper ? " + WHISPER" : ""}` : "BROWSER")).catch(() => {});
}
async function start() {
  $("#gate").classList.add("hide");
  await audioCtx.resume();
  if (!document.fullscreenElement && !new URLSearchParams(location.search).has("nofs")) document.documentElement.requestFullscreen?.().catch(() => {});
  briefingAudio = mouth.preload((state.briefing.lines || []).map((l) => l.text));
  briefingAudio.then(() => mouth.preload(staticLines())); // frasi preimpostate pronte in anticipo
  try {
    await ears.start();
    debug("debugMic", ears.micLabel);
    debug("debugEngine", ears.engine.toUpperCase());
  } catch (e) {
    debug("debugError", `microfono: ${e.message}`);
    $("#hint span").textContent = "MICROFONO BLOCCATO · CONSENTILO DAL LUCCHETTO · PREMI T PER SCRIVERE";
  }
  setTimeout(() => setMode("sleep"), 600);
}
$("#gate").addEventListener("click", () => (state.setup.openai ? start() : openSetup()));

// ---------------------------------------------------------------- controlli (nascosti durante la registrazione)
let hideTimer;
addEventListener("pointermove", () => {
  body.classList.add("show-controls");
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => body.classList.remove("show-controls"), 2200);
});
$("#pauseBtn").addEventListener("click", () => {
  if (mode === "paused") { ears.resume(); setMode(greeted && body.classList.contains("awake") ? "listen" : "sleep"); if (musicOn) music.play(briefingDone ? CONFIG.music.bedAfter : CONFIG.music.bed); $("#pauseBtn span").textContent = "PAUSA"; }
  else { interrupt(); ears.pause(); setMode("paused"); $("#pauseBtn span").textContent = "RIPRENDI"; }
});
$("#fsBtn").addEventListener("click", () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()));
addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" || body.classList.contains("show-setup")) return;
  const k = e.key.toLowerCase();
  if (k === "d") $("#debug").classList.toggle("show");
  if (k === "j") { recMode = !recMode; sfx.tick(); setMode(mode); debug("debugError", recMode ? "MODALITÀ REGISTRAZIONE ON" : "MODALITÀ REGISTRAZIONE OFF"); }
  if (k === "f") $("#fsBtn").click();
  if (k === "w" && mode === "sleep") wake("");                 // risveglio manuale (per i ciak)
  if (k === "r") { greeted = false; briefingDone = false; musicOn = false; music.stop(1); history = []; $("#stats").innerHTML = ""; goSleep(); } // reset completo della scena
  if (k === "t") { e.preventDefault(); $("#typeBox").classList.toggle("show"); $("#typeBox input").focus(); }
  if (k === "escape") $("#typeBox").classList.remove("show");
});
$("#typeBox").addEventListener("submit", (e) => {
  e.preventDefault();
  const v = $("#typeBox input").value.trim();
  $("#typeBox input").value = "";
  $("#typeBox").classList.remove("show");
  if (v) handleFinal(v, { engine: "tastiera" });
});

// ---------------------------------------------------------------- configurazione guidata
function refreshSetupBadge() {
  $("#aiDot").classList.toggle("connected", !!state.setup.openai);
  debug("debugMind", state.setup.openai ? (state.setup.model || "OPENAI").toUpperCase() : "NON CONFIGURATA");
}
function setState(id, text, kind = "") {
  const el = document.getElementById(id);
  el.textContent = text;
  el.className = `state ${kind}`;
}
function openSetup() {
  const st = state.setup;
  body.classList.add("show-setup");
  $("#openaiKey").value = $("#elevenKey").value = $("#calendarUrl").value = "";
  $("#openaiKey").placeholder = st.openai ? `salvata: ${st.openaiMasked} (lascia vuoto per tenerla)` : "sk-...";
  $("#elevenKey").placeholder = st.elevenlabs ? `salvata: ${st.elevenlabsMasked}` : "sk_...";
  $("#calendarUrl").placeholder = st.calendar ? "collegato (incolla un nuovo link per cambiarlo)" : "https://calendar.google.com/calendar/ical/.../basic.ics";
  setState("openaiState", st.openai ? "Collegata" : "", st.openai ? "ok" : "");
  setState("elevenState", st.elevenlabs ? "Voce ElevenLabs attiva" : "", st.elevenlabs ? "ok" : "");
  setState("calendarState", st.calendar ? (st.calendarError ? `Errore: ${st.calendarError}` : `Collegato · ${st.calendarEvents} eventi letti`) : "", st.calendar ? (st.calendarError ? "err" : "ok") : "");
  document.querySelector(`input[name=voice][value=${st.elevenlabs ? "eleven" : "free"}]`).checked = true;
  $("#setup").classList.toggle("eleven", !!st.elevenlabs);
  $("#setupClose").style.display = st.openai ? "" : "none";
  $("#setupError").textContent = "";
  if (!st.openai) setTimeout(() => $("#openaiKey").focus(), 50);
}
const closeSetup = () => body.classList.remove("show-setup");
document.querySelectorAll("input[name=voice]").forEach((r) => r.addEventListener("change", () => $("#setup").classList.toggle("eleven", r.value === "eleven" && r.checked)));
$("#setupClose").addEventListener("click", closeSetup);
$("#setupBtn").addEventListener("click", () => openSetup());
$("#setupForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const eleven = document.querySelector("input[name=voice]:checked").value === "eleven";
  const payload = {
    openaiKey: $("#openaiKey").value.trim(),
    elevenlabsKey: eleven ? $("#elevenKey").value.trim() : "",
    useFreeVoice: !eleven,
    ...($("#calendarUrl").value.trim() ? { calendarUrl: $("#calendarUrl").value.trim() } : {}),
  };
  if (!state.setup.openai && !payload.openaiKey) return ($("#setupError").textContent = "Inserisci la chiave OpenAI: è l'unica obbligatoria.");
  if (eleven && !state.setup.elevenlabs && !payload.elevenlabsKey) return ($("#setupError").textContent = "Inserisci la chiave ElevenLabs oppure scegli la voce gratuita.");
  $("#setupSave").disabled = true;
  $("#setupSave").textContent = "VERIFICA IN CORSO…";
  $("#setupError").textContent = "";
  try {
    const r = await api("/api/setup", { method: "POST", body: JSON.stringify(payload) });
    if (r.errors.openai) setState("openaiState", r.errors.openai, "err");
    if (r.errors.elevenlabs) setState("elevenState", r.errors.elevenlabs, "err");
    if (r.errors.calendar) setState("calendarState", r.errors.calendar, "err");
    state.setup = r.status;
    if (!r.ok) return ($("#setupError").textContent = "Controlla i campi evidenziati.");
    state = { ...state, ...(await api("/api/bootstrap")) };
    mouth.cache = new Map(); // la voce potrebbe essere cambiata
    refreshSetupBadge();
    renderAgenda();
    closeSetup();
  } catch (err) {
    $("#setupError").textContent = `Errore: ${err.message}`;
  } finally {
    $("#setupSave").disabled = false;
    $("#setupSave").textContent = "ATTIVA JARVIS";
  }
});

// domanda detta insieme al "Ciao Jarvis": risposta dopo il briefing
setInterval(() => {
  if (pendingQuestion && mode === "listen") { const q = pendingQuestion; pendingQuestion = null; process(q); }
}, 300);

boot();
