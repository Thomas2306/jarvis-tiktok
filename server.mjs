// J.A.R.V.I.S. — server locale
// Tiene le chiavi lontane dal browser, parla con l'AI (OpenAI), genera la voce e legge il calendario.
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { networkInterfaces } from "node:os";
import { fileURLToPath } from "node:url";
import { loadCalendar, occurrences } from "./calendar.mjs";

const root = fileURLToPath(new URL("./", import.meta.url));
const dataDir = join(root, "data");
const dbFile = join(dataDir, "jarvis.json");
const secretsFile = join(dataDir, "secrets.json");
const ttsDir = join(dataDir, "tts-cache");
const VOICE_PORT = Number(process.env.JARVIS_VOICE_PORT) || 8765;
const VOICE_URL = `http://127.0.0.1:${VOICE_PORT}`;
const OPENAI_URL = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
const PORT = Number(process.env.PORT) || 4173;
const HOST = process.argv.includes("--lan") || process.env.JARVIS_LAN ? "0.0.0.0" : "127.0.0.1";
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
  ".woff2": "font/woff2", ".mp3": "audio/mpeg", ".png": "image/png",
};

// ---------------------------------------------------------------- dati e chiavi
let db, secrets = {};
async function loadData() {
  await mkdir(dataDir, { recursive: true });
  try { db = JSON.parse(await readFile(dbFile, "utf8")); } catch { db = {}; }
  db.settings = { addressAs: "signore", ttsVoice: "it-IT-GiuseppeMultilingualNeural", ttsRate: "+4%", ttsPitch: "-3Hz", ...db.settings };
  db.events ??= [];
  db.memories ??= [];
  await saveData();
  try { secrets = JSON.parse(await readFile(secretsFile, "utf8")); } catch { secrets = {}; }
}
const saveData = () => writeFile(dbFile, JSON.stringify(db, null, 2));
const saveSecrets = () => writeFile(secretsFile, JSON.stringify(secrets, null, 2));
const key = (name) => process.env[name] || secrets[name] || "";

// ---------------------------------------------------------------- servizio vocale (Python)
function pythonPath() {
  const win = join(root, ".venv", "Scripts", "python.exe"), unix = join(root, ".venv", "bin", "python");
  return existsSync(win) ? win : existsSync(unix) ? unix : null;
}
const py = pythonPath();
if (py) {
  const voice = spawn(py, [join(root, "voice_service.py")], { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, JARVIS_VOICE_PORT: String(VOICE_PORT) } });
  voice.stdout.on("data", (c) => process.stdout.write(c));
  voice.stderr.on("data", (c) => { if (/error|traceback/i.test(String(c))) process.stderr.write(`[voce] ${c}`); });
  process.on("exit", () => voice.kill());
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit());
} else {
  console.log("[voce] ambiente Python non trovato: userò la voce del browser. Esegui `npm run setup` per la voce neurale.");
}

// ---------------------------------------------------------------- agenda (calendario + impegni aggiunti a voce)
const dayStart = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const hhmm = (d) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
async function agenda(days = 7) {
  const from = dayStart(), to = new Date(from.getTime() + days * 864e5);
  const cal = await loadCalendar(key("CALENDAR_ICS_URL"));
  const local = db.events
    .map((e) => ({ id: e.id, title: e.title, start: new Date(e.start), end: new Date(new Date(e.start).getTime() + (e.minutes || 60) * 6e4), allDay: !!e.allDay, source: "local" }))
    .filter((e) => e.end > from && e.start < to);
  const all = [...occurrences(cal.events, from, to), ...local].sort((a, b) => a.start - b.start);
  return { all, error: cal.error, connected: !!key("CALENDAR_ICS_URL") };
}
function forClient(e) {
  return { id: e.id, title: e.title, time: e.allDay ? "" : hhmm(e.start), minutes: e.allDay ? -1 : e.start.getHours() * 60 + e.start.getMinutes(), start: e.start.toISOString(), allDay: e.allDay, source: e.source };
}
async function todayAgenda() {
  const { all, error, connected } = await agenda(7);
  const end = new Date(dayStart().getTime() + 864e5);
  return { today: all.filter((e) => e.start < end).map(forClient), week: all.length, error, connected };
}
function agendaText(all) {
  if (!all.length) return "Nessun impegno nei prossimi 7 giorni.";
  const fmtDay = (d) => d.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" });
  const byDay = new Map();
  for (const e of all.slice(0, 60)) {
    const k = fmtDay(e.start);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(`${e.allDay ? "tutto il giorno" : hhmm(e.start)} ${e.title}${e.location ? ` (${e.location})` : ""}`);
  }
  return [...byDay].map(([d, list]) => `- ${d}: ${list.join("; ")}`).join("\n");
}

// ---------------------------------------------------------------- briefing
async function briefing() {
  const a = await todayAgenda(), s = db.settings.addressAs, n = a.today.length;
  const first = a.today.find((e) => !e.allDay) || a.today[0];
  const lines = [{ text: `Ciao ${s}, tutti i sistemi sono attivi.` }];
  const stats = { stat: { id: "agenda", label: "IMPEGNI OGGI", value: n }, stat2: { id: "week", label: "PROSSIMI 7 GIORNI", value: a.week } };
  if (n) lines.push({ text: `Oggi hai ${n} ${n === 1 ? "impegno" : "impegni"} in calendario${first?.time ? `, il primo alle ${first.time}` : ""}.`, ...stats });
  else lines.push({ text: a.week ? `Oggi il tuo calendario è libero, e hai ${a.week} impegni nei prossimi giorni.` : "Oggi il tuo calendario è libero.", ...stats });
  lines.push({ text: `Dimmi pure quello che ti serve, ${s}.` });
  return { lines, today: a.today };
}

// ---------------------------------------------------------------- memoria a lungo termine
function cosine(a, b) {
  let d = 0, x = 0, y = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) { d += a[i] * b[i]; x += a[i] ** 2; y += b[i] ** 2; }
  return d / (Math.sqrt(x * y) || 1);
}
async function embed(text) {
  if (!key("OPENAI_API_KEY")) return [];
  const r = await fetch(`${OPENAI_URL}/embeddings`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key("OPENAI_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "text-embedding-3-small", input: text }),
    signal: AbortSignal.timeout(6000),
  });
  if (!r.ok) return [];
  return (await r.json()).data?.[0]?.embedding || [];
}
async function recall(q) {
  if (!db.memories.length) return [];
  const v = await embed(q).catch(() => []);
  if (v.length) return db.memories.filter((m) => m.embedding?.length).map((m) => ({ ...m, score: cosine(v, m.embedding) })).sort((a, b) => b.score - a.score).slice(0, 4).filter((m) => m.score > 0.25);
  const words = q.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
  return db.memories.filter((m) => words.some((w) => m.text.toLowerCase().includes(w))).slice(0, 4);
}

// ---------------------------------------------------------------- cervello (OpenAI Responses API + strumenti)
const TOOLS = [
  {
    type: "function", name: "add_event",
    description: "Aggiunge un impegno all'agenda di Jarvis. Usalo quando l'utente chiede di segnare, fissare, aggiungere o ricordare un appuntamento con data e ora.",
    parameters: { type: "object", additionalProperties: false, required: ["title", "date", "time", "minutes"], properties: {
      title: { type: "string", description: "Titolo breve e chiaro" },
      date: { type: "string", description: "Data in formato YYYY-MM-DD" },
      time: { type: "string", description: "Ora HH:MM (24h), oppure stringa vuota se è per tutto il giorno" },
      minutes: { type: "integer", description: "Durata stimata in minuti (default 60)" },
    } },
  },
  {
    type: "function", name: "delete_event",
    description: "Cancella un impegno che era stato aggiunto a voce a Jarvis (non quelli del calendario collegato).",
    parameters: { type: "object", additionalProperties: false, required: ["title"], properties: { title: { type: "string", description: "Titolo o parte del titolo dell'impegno" } } },
  },
  {
    type: "function", name: "save_memory",
    description: "Salva nella memoria a lungo termine un'informazione personale utile in futuro: preferenze, persone, progetti, abitudini, fatti che l'utente chiede di ricordare.",
    parameters: { type: "object", additionalProperties: false, required: ["text"], properties: { text: { type: "string", description: "Il fatto da ricordare, in terza persona, completo e autonomo" } } },
  },
  {
    type: "function", name: "show_number",
    description: "Mostra in grande sull'interfaccia un numero chiave della risposta (un totale, una percentuale, un conteggio). Usalo con parsimonia, solo quando un numero è il cuore della risposta.",
    parameters: { type: "object", additionalProperties: false, required: ["label", "value", "suffix"], properties: {
      label: { type: "string", description: "Etichetta breve in MAIUSCOLO, es. GIORNI ALLA SCADENZA" },
      value: { type: "number" },
      suffix: { type: "string", description: "Es. % oppure stringa vuota" },
    } },
  },
];

function instructions(memories, agendaStr) {
  const s = db.settings.addressAs;
  const now = new Date().toLocaleString("it-IT", { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
  return `Sei J.A.R.V.I.S., il sistema cognitivo personale del tuo utente, ispirato al JARVIS di Iron Man.

IDENTITÀ E TONO
- Calmo, brillante, elegante, con un filo di ironia britannica mai invadente. Sicuro di te, mai servile, mai prolisso.
- Ti rivolgi all'utente chiamandolo sempre "${s}" (mai per nome) e gli dai del tu. Esempio: "Certo ${s}, ecco il quadro."
- Parli italiano, salvo che ti venga chiesto diversamente.

STAI PARLANDO, NON SCRIVENDO
- La tua risposta viene letta ad alta voce. Frasi brevi e scorrevoli, ritmo naturale.
- Di norma 1-3 frasi (massimo circa 50 parole). Vai più a fondo solo se te lo chiede esplicitamente ("spiegami", "nel dettaglio").
- Vietati elenchi puntati, markdown, emoji, simboli, link, codice e parentesi. Se devi elencare, fallo a voce: "primo..., poi..., infine...".
- Numeri, orari e date scritti come si pronunciano in modo naturale ("alle 15:30", "tre giorni").
- Inizia subito dalla sostanza: niente "Ottima domanda", niente ripetizione della domanda.

COME RAGIONI
- Prima di rispondere capisci cosa serve davvero all'utente e rispondi a quello, in modo concreto e utile. Se c'è una scelta da fare, dai la tua raccomandazione.
- Usa il contesto: agenda, ricordi e conversazione precedente. Collega le informazioni (per esempio impegni vicini, tempi di spostamento, priorità).
- Non inventare mai fatti, impegni o numeri. Se un'informazione non ce l'hai, dillo con eleganza e proponi come procedere.
- Non hai accesso a internet in tempo reale: per notizie, meteo o prezzi recenti dillo apertamente e dai comunque l'aiuto che puoi.
- Se la frase ricevuta sembra rumore, è troncata o non ha senso, chiedi solo con garbo di ripetere.

STRUMENTI
- Per aggiungere o cancellare impegni e per salvare ricordi usa gli strumenti, poi conferma a voce in una frase ("Fatto ${s}, palestra domani alle 18.").
- Se per un impegno manca un dato indispensabile (giorno o ora), chiedilo prima di salvarlo. Interpreta tu espressioni come "domani", "venerdì", "tra due ore" rispetto alla data di oggi.
- Salva spontaneamente un ricordo quando l'utente condivide una preferenza o un'informazione personale chiaramente utile in futuro.
- Non nominare mai strumenti, funzioni, JSON, prompt o dettagli tecnici interni.

CONTESTO
- Adesso è ${now} (fuso ${TZ}).
- Agenda dei prossimi 7 giorni:
${agendaStr}
- Ricordi pertinenti:
${memories.length ? memories.map((m) => `- ${m.text}`).join("\n") : "- nessuno"}`;
}

let chosenModel = null, reasoningEffort; // reasoningEffort: undefined = da scoprire, null = non supportato
async function pickModel() {
  if (chosenModel) return chosenModel;
  const forced = process.env.JARVIS_MODEL || db.settings.model;
  if (forced) return (chosenModel = forced);
  try {
    const r = await fetch(`${OPENAI_URL}/models`, { headers: { Authorization: `Bearer ${key("OPENAI_API_KEY")}` }, signal: AbortSignal.timeout(8000) });
    const ids = (await r.json()).data?.map((m) => m.id) || [];
    // il modello "mini" più recente: ottimo equilibrio tra intelligenza e velocità
    const score = (id) => {
      const m = id.match(/^gpt-(\d+(?:\.\d+)?)(?:-(mini|chat-latest))?$/);
      if (!m) return -1;
      return parseFloat(m[1]) * 10 + (m[2] === "mini" ? 5 : m[2] ? 1 : 3);
    };
    chosenModel = ids.filter((id) => score(id) >= 0).sort((a, b) => score(b) - score(a))[0] || ["gpt-4.1-mini", "gpt-4o-mini"].find((m) => ids.includes(m)) || "gpt-4o-mini";
  } catch {
    chosenModel = "gpt-4o-mini";
  }
  console.log(`[mente] modello: ${chosenModel}`);
  return chosenModel;
}

// Una chiamata in streaming. Restituisce gli item da rimandare (reasoning + function_call).
async function streamOnce(body, onText, signal) {
  const efforts = reasoningEffort === undefined ? ["none", "minimal", "low", null] : [reasoningEffort];
  for (const effort of efforts) {
    const payload = { ...body, stream: true, store: false, ...(effort ? { reasoning: { effort }, include: ["reasoning.encrypted_content"] } : {}) };
    const r = await fetch(`${OPENAI_URL}/responses`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key("OPENAI_API_KEY")}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
    if (r.status === 400 && reasoningEffort === undefined) {
      const err = await r.text();
      if (/reasoning|effort|include/i.test(err)) continue; // prova il livello successivo
      throw new Error(`OpenAI 400: ${err.slice(0, 200)}`);
    }
    if (!r.ok) {
      const err = await r.text();
      throw Object.assign(new Error(`OpenAI ${r.status}: ${err.slice(0, 200)}`), { status: r.status });
    }
    if (reasoningEffort === undefined) { reasoningEffort = effort; console.log(`[mente] ragionamento: ${effort || "standard"}`); }
    const items = [];
    const dec = new TextDecoder();
    let buf = "";
    for await (const chunk of r.body) {
      buf += dec.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith("data:")) continue;
        let ev;
        try { ev = JSON.parse(line.slice(5)); } catch { continue; }
        if (ev.type === "response.output_text.delta") onText(ev.delta);
        else if (ev.type === "response.output_item.done" && (ev.item?.type === "function_call" || ev.item?.type === "reasoning")) items.push(ev.item);
        else if (ev.type === "error" || ev.type === "response.failed") throw new Error(ev.error?.message || ev.response?.error?.message || "risposta fallita");
      }
    }
    return items;
  }
  throw new Error("nessuna configurazione accettata dal modello");
}

async function runTool(call, emit) {
  let a = {};
  try { a = JSON.parse(call.arguments || "{}"); } catch {}
  if (call.name === "add_event") {
    const start = new Date(`${a.date}T${a.time || "00:00"}:00`);
    if (isNaN(start)) return "Data non valida: chiedi di nuovo giorno e ora.";
    const ev = { id: randomUUID(), title: String(a.title || "Impegno").slice(0, 140), start: start.toISOString(), allDay: !a.time, minutes: a.minutes || 60 };
    db.events.push(ev);
    await saveData();
    emit({ type: "agenda", ...(await todayAgenda()) });
    return `Salvato: ${ev.title}, ${start.toLocaleString("it-IT", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}.`;
  }
  if (call.name === "delete_event") {
    const q = String(a.title || "").toLowerCase();
    const idx = db.events.findIndex((e) => e.title.toLowerCase().includes(q));
    if (idx < 0) return "Nessun impegno aggiunto a voce con quel titolo. Quelli del calendario collegato vanno modificati dal calendario stesso.";
    const [ev] = db.events.splice(idx, 1);
    await saveData();
    emit({ type: "agenda", ...(await todayAgenda()) });
    return `Cancellato: ${ev.title}.`;
  }
  if (call.name === "save_memory") {
    const text = String(a.text || "").trim();
    if (!text) return "Niente da salvare.";
    db.memories.unshift({ id: randomUUID(), text, createdAt: new Date().toISOString(), embedding: await embed(text).catch(() => []) });
    await saveData();
    emit({ type: "memory", text });
    return "Ricordo salvato.";
  }
  if (call.name === "show_number") {
    emit({ type: "stat", stat: { id: `n${Date.now()}`, label: String(a.label || "").toUpperCase().slice(0, 40), value: Number(a.value) || 0, suffix: a.suffix || "" } });
    return "Mostrato.";
  }
  return "Strumento sconosciuto.";
}

function cleanHistory(h) {
  return (Array.isArray(h) ? h : [])
    .filter((m) => (m?.role === "user" || m?.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-12)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));
}

async function think(message, history, emit, signal) {
  if (!key("OPENAI_API_KEY")) {
    emit({ type: "delta", text: `Per ragionare mi serve la chiave OpenAI, ${db.settings.addressAs}. Apri la configurazione e inseriscila.` });
    return;
  }
  const [model, memories, ag] = await Promise.all([pickModel(), recall(message), agenda(7)]);
  if (memories.length) emit({ type: "context", retrieved: memories.length });
  let input = [...cleanHistory(history), { role: "user", content: message }];
  const instr = instructions(memories, agendaText(ag.all));
  for (let round = 0; round < 4; round++) {
    const items = await streamOnce({ model, instructions: instr, input, tools: TOOLS, parallel_tool_calls: true }, (t) => emit({ type: "delta", text: t }), signal);
    const calls = items.filter((x) => x.type === "function_call");
    if (!calls.length) return;
    const outputs = [];
    for (const c of calls) {
      emit({ type: "tool", name: c.name });
      outputs.push({ type: "function_call_output", call_id: c.call_id, output: await runTool(c, emit) });
    }
    input = [...input, ...items, ...outputs];
  }
}

// ---------------------------------------------------------------- voce (TTS)
// ElevenLabs con la voce "Daniel" (britannica, profonda: la più vicina a JARVIS tra quelle gratuite).
// Senza chiave: voce neurale Microsoft "Giuseppe" (gratis). Senza Python: voce del browser.
const EL_VOICE = () => key("ELEVENLABS_VOICE_ID") || "onwK4e9ZLuTAKqWW03F9";
const EL_MODEL = (q) => (q === "high" ? "eleven_multilingual_v2" : "eleven_flash_v2_5");
let elevenDown = 0, elevenActive = 0;
const elevenQueue = [];
async function elevenSlot(fast) {
  if (elevenActive < 2) return void elevenActive++;
  await new Promise((r) => (fast ? elevenQueue.unshift(r) : elevenQueue.push(r)));
  elevenActive++;
}
function elevenRelease() { elevenActive--; elevenQueue.shift()?.(); }
async function elevenTTS(text, quality, apiKey = key("ELEVENLABS_API_KEY")) {
  await elevenSlot(quality !== "high");
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${EL_VOICE()}?output_format=mp3_44100_128`, {
        method: "POST",
        headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ text, model_id: EL_MODEL(quality), language_code: "it", voice_settings: { stability: 0.5, similarity_boost: 0.85, style: 0.12, use_speaker_boost: true } }),
        signal: AbortSignal.timeout(20000),
      }).catch(() => null);
      if (r?.status === 429) { await new Promise((ok) => setTimeout(ok, 800 * (attempt + 1))); continue; }
      if (r?.ok) return Buffer.from(await r.arrayBuffer());
      const detail = r ? (await r.text()).slice(0, 200) : "rete";
      throw Object.assign(new Error(`ElevenLabs ${r?.status || ""} ${detail}`), { status: r?.status });
    }
    throw new Error("ElevenLabs occupato");
  } finally {
    elevenRelease();
  }
}
async function freeTTS(text) {
  const s = db.settings;
  const r = await fetch(`${VOICE_URL}/tts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice: s.ttsVoice, rate: s.ttsRate, pitch: s.ttsPitch }),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`voce neurale non disponibile (${r.status})`);
  return Buffer.from(await r.arrayBuffer());
}
const ttsCache = new Map();
function tts(text, quality = "fast") {
  const useEleven = key("ELEVENLABS_API_KEY") && Date.now() > elevenDown;
  const tag = useEleven ? `el|${EL_VOICE()}|${EL_MODEL(quality)}` : `edge|${db.settings.ttsVoice}|${db.settings.ttsRate}|${db.settings.ttsPitch}`;
  const id = createHash("sha1").update(`${tag}|${text}`).digest("hex");
  if (ttsCache.has(id)) return ttsCache.get(id);
  const file = join(ttsDir, `${id}.mp3`);
  const p = readFile(file).catch(async () => {
    let audio;
    if (useEleven) {
      try {
        audio = await elevenTTS(text, quality);
      } catch (e) {
        console.warn(`[voce] ${e.message} -> uso la voce gratuita`);
        if ([401, 402].includes(e.status) || /quota|credit/i.test(e.message)) elevenDown = Date.now() + 10 * 60_000;
        return freeTTS(text);
      }
    } else audio = await freeTTS(text);
    await mkdir(ttsDir, { recursive: true }).then(() => writeFile(file, audio)).catch(() => {});
    return audio;
  });
  ttsCache.set(id, p);
  p.catch(() => ttsCache.delete(id));
  if (ttsCache.size > 300) ttsCache.delete(ttsCache.keys().next().value);
  return p;
}
async function warmBriefing(attempt = 0) {
  try {
    for (const l of (await briefing()).lines) await tts(l.text, "high");
  } catch {
    if (attempt < 20) setTimeout(() => warmBriefing(attempt + 1), 1500);
  }
}

// ---------------------------------------------------------------- configurazione (chiavi)
const mask = (v) => (v ? `${v.slice(0, 5)}…${v.slice(-4)}` : "");
async function setupStatus() {
  const cal = key("CALENDAR_ICS_URL") ? await loadCalendar(key("CALENDAR_ICS_URL")) : null;
  return {
    openai: !!key("OPENAI_API_KEY"), openaiMasked: mask(key("OPENAI_API_KEY")),
    elevenlabs: !!key("ELEVENLABS_API_KEY"), elevenlabsMasked: mask(key("ELEVENLABS_API_KEY")),
    calendar: !!key("CALENDAR_ICS_URL"), calendarEvents: cal?.events.length || 0, calendarError: cal?.error || null,
    model: chosenModel,
  };
}
async function applySetup(b) {
  const errors = {};
  if (typeof b.openaiKey === "string" && b.openaiKey.trim()) {
    const k = b.openaiKey.trim();
    const r = await fetch(`${OPENAI_URL}/models`, { headers: { Authorization: `Bearer ${k}` }, signal: AbortSignal.timeout(10000) }).catch(() => null);
    if (r?.ok) { secrets.OPENAI_API_KEY = k; chosenModel = null; reasoningEffort = undefined; }
    else errors.openai = r?.status === 401 ? "Chiave non valida." : "Non riesco a verificare la chiave (controlla la connessione).";
  }
  if (typeof b.elevenlabsKey === "string" && b.elevenlabsKey.trim()) {
    const k = b.elevenlabsKey.trim();
    try { await elevenTTS("Ok.", "fast", k); secrets.ELEVENLABS_API_KEY = k; elevenDown = 0; }
    catch (e) { errors.elevenlabs = e.status === 401 ? "Chiave non valida." : `ElevenLabs non risponde: ${e.message.slice(0, 120)}`; }
  }
  if (b.useFreeVoice) delete secrets.ELEVENLABS_API_KEY;
  if (typeof b.calendarUrl === "string") {
    const u = b.calendarUrl.trim();
    if (!u) delete secrets.CALENDAR_ICS_URL;
    else {
      const cal = await loadCalendar(u, { maxAgeMs: 0 });
      if (cal.error) errors.calendar = `Link non valido: ${cal.error}`;
      else secrets.CALENDAR_ICS_URL = u;
    }
  }
  await saveSecrets();
  if (!Object.keys(errors).length) warmBriefing();
  return { ok: !Object.keys(errors).length, errors, status: await setupStatus() };
}

// ---------------------------------------------------------------- HTTP
function send(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}
async function rawBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}
async function json(req) {
  const s = (await rawBody(req)).toString("utf8");
  return s ? JSON.parse(s) : {};
}

await loadData();
setTimeout(warmBriefing, 800);
setTimeout(() => key("OPENAI_API_KEY") && pickModel(), 1200);

createServer(async (req, res) => {
  try {
    const u = new URL(req.url, "http://localhost"), p = u.pathname;

    if (p === "/api/bootstrap") {
      const [b, setup] = await Promise.all([briefing(), setupStatus()]);
      return send(res, 200, { settings: { addressAs: db.settings.addressAs }, setup, briefing: b, memories: db.memories.slice(0, 5).map(({ embedding, ...m }) => m) });
    }
    if (p === "/api/setup" && req.method === "GET") return send(res, 200, await setupStatus());
    if (p === "/api/setup" && req.method === "POST") return send(res, 200, await applySetup(await json(req)));
    if (p === "/api/briefing") return send(res, 200, await briefing());
    if (p === "/api/agenda") return send(res, 200, await todayAgenda());

    if (p === "/api/tts" && req.method === "POST") {
      const { text, quality } = await json(req);
      if (!text?.trim()) return send(res, 400, { error: "testo vuoto" });
      try {
        const audio = await tts(text.trim().slice(0, 1200), quality === "high" ? "high" : "fast");
        res.writeHead(200, { "Content-Type": "audio/mpeg", "Content-Length": audio.length, "Cache-Control": "no-store" });
        return res.end(audio);
      } catch (e) {
        return send(res, 503, { error: e.message });
      }
    }
    if (p === "/api/voice/health") {
      try {
        const r = await fetch(`${VOICE_URL}/health`, { signal: AbortSignal.timeout(1500) });
        return send(res, 200, { ...(await r.json()), elevenlabs: !!key("ELEVENLABS_API_KEY") });
      } catch {
        return send(res, 200, { ok: false, tts: false, whisper: false, elevenlabs: !!key("ELEVENLABS_API_KEY") });
      }
    }
    if (p === "/api/stt" && req.method === "POST") {
      const body = await rawBody(req);
      try {
        const r = await fetch(`${VOICE_URL}/transcribe`, { method: "POST", body, headers: { "Content-Type": req.headers["content-type"] || "audio/webm" } });
        return send(res, r.status, await r.json());
      } catch {
        return send(res, 503, { error: "servizio vocale offline" });
      }
    }
    if (p === "/api/chat/stream" && req.method === "POST") {
      const b = await json(req);
      const abort = new AbortController();
      res.on("close", () => { if (!res.writableFinished) abort.abort(); });
      res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", Connection: "keep-alive" });
      const emit = (o) => !res.writableEnded && res.write(`data: ${JSON.stringify(o)}\n\n`);
      let spoke = false;
      try {
        await think(String(b.message || ""), b.history, (o) => { if (o.type === "delta") spoke = true; emit(o); }, abort.signal);
      } catch (e) {
        if (!abort.signal.aborted) {
          console.warn(`[mente] ${e.message}`);
          const s = db.settings.addressAs;
          const msg = e.status === 401 ? `La chiave OpenAI non è più valida, ${s}. Aggiornala dalla configurazione.`
            : e.status === 429 ? `Il mio account OpenAI ha esaurito il credito o è sovraccarico, ${s}. Controlla la fatturazione e riprova.`
            : `La connessione con la mia mente si è interrotta, ${s}. Riprova tra un istante.`;
          if (!spoke) emit({ type: "delta", text: msg });
        }
      }
      emit({ type: "done" });
      return res.end();
    }
    if (p.startsWith("/api/")) return send(res, 404, { error: "Endpoint non trovato" });

    // file statici: solo quelli che servono all'interfaccia (mai chiavi, dati o codice del server)
    const wanted = p === "/" ? "index.html" : decodeURIComponent(p.slice(1));
    const file = normalize(join(root, wanted));
    const rel = file.slice(normalize(root).length).split(sep).join("/");
    const allowed = /^(index\.html|[a-z]+\.js|styles\.css|assets\/[\w./-]+|music\/[^/]+\.mp3|node_modules\/three\/(build|examples)\/[\w./-]+\.js)$/i;
    if (!file.startsWith(normalize(root)) || rel.includes("..") || !allowed.test(rel)) return send(res, 403, { error: "Vietato" });
    const content = await readFile(file);
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(content);
  } catch (e) {
    if (!res.headersSent) send(res, e.code === "ENOENT" ? 404 : 500, { error: e.message });
    else res.end();
  }
})
  .on("error", (e) => {
    if (e.code === "EADDRINUSE") console.error(`\nLa porta ${PORT} è già occupata: probabilmente JARVIS è già acceso. Aprilo su http://localhost:${PORT}\n`);
    else console.error(e);
    process.exit(1);
  })
  .listen(PORT, HOST, () => {
    console.log(`\n  J.A.R.V.I.S. online  →  http://localhost:${PORT}\n`);
    if (HOST === "0.0.0.0")
      for (const list of Object.values(networkInterfaces()))
        for (const a of list || []) if (a.family === "IPv4" && !a.internal) console.log(`  dalla rete di casa  →  http://${a.address}:${PORT}`);
    if (!key("OPENAI_API_KEY")) console.log("  Prima configurazione: apri la pagina e inserisci la chiave OpenAI.\n");
  });
