// Cervello gratis: Jarvis ragiona passando per FreeLLMAPI (https://github.com/tashfeenahmed/freellmapi, MIT),
// un router locale che mette insieme i piani gratuiti di decine di servizi AI e, quando uno finisce
// i limiti, passa da solo al successivo. Jarvis gli parla come se fosse un'unica AI.
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// Cartella dati dell'app desktop di FreeLLMAPI (lì c'è la chiave unica, in chiaro nel database locale).
function desktopDir() {
  if (process.platform === "win32") return join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "FreeLLMAPI");
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", "FreeLLMAPI");
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "FreeLLMAPI");
}

// Legge la chiave unica direttamente dall'app desktop, così l'utente non deve copiarla a mano.
async function desktopKey() {
  const file = join(desktopDir(), "freeapi.db");
  if (!existsSync(file)) return "";
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(file, { readOnly: true });
    try { return db.prepare("SELECT value FROM settings WHERE key = 'unified_api_key'").get()?.value || ""; }
    finally { db.close(); }
  } catch { return ""; }
}
async function desktopPort() {
  try {
    const c = JSON.parse(await readFile(join(desktopDir(), "config.json"), "utf8"));
    return Number(c.port || c.serverPort) || 3001;
  } catch { return 3001; }
}

// Dove si trova il router e con che chiave. Priorità: valori salvati a mano → app desktop → default.
export async function locate(secrets) {
  const env = (n) => process.env[n] || secrets[n] || "";
  const manualKey = env("FREELLM_API_KEY");
  const key = manualKey || (await desktopKey());
  const url = (env("FREELLM_URL") || `http://127.0.0.1:${await desktopPort()}/v1`).replace(/\/$/, "");
  return { url, key, source: manualKey ? "manuale" : key ? "app" : "" };
}

// Controlla che il router sia acceso e quante AI gratuite sono pronte a rispondere.
export async function status(secrets) {
  const { url, key, source } = await locate(secrets);
  const out = { url, source, online: false, keyOk: false, ready: 0, dashboard: url.replace(/\/v1$/, "") };
  if (!key) return out;
  try {
    const r = await fetch(`${url}/models?execution_status=ready`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(4000) });
    out.online = true;
    if (r.status === 401 || r.status === 403) return out;
    out.keyOk = r.ok;
    const ids = ((await r.json()).data || []).map((m) => m.id);
    out.ready = ids.filter((id) => id !== "auto" && id !== "fusion" && !id.startsWith("auto:")).length;
  } catch {}
  return out;
}

// "groq/llama-3.3-70b-versatile" → { provider: "GROQ", model: "llama-3.3-70b-versatile" }
export function brainLabel(via) {
  const [p, ...m] = String(via || "").split("/");
  return { via: String(via || ""), provider: p.toUpperCase(), model: m.join("/") };
}

const chatTools = (tools) => tools.map(({ name, description, parameters }) => ({ type: "function", function: { name, description, parameters } }));

// Una chiamata in streaming su /chat/completions (il formato che tutti i servizi gratuiti capiscono).
// Restituisce testo, chiamate agli strumenti e quale AI ha risposto davvero.
// Alcune AI gratuite a volte restano in coda per decine di secondi. Se entro questo tempo
// non arriva neanche una parola, Jarvis lascia perdere e chiede a un'altra AI (più veloce).
const FIRST_WORD_MS = Number(process.env.JARVIS_FREE_TIMEOUT_MS) || 15000;

export async function streamChat(opts, onText, onBrain, signal) {
  const tries = [opts.model, "auto:fast", "auto:fast"];
  for (let n = 0; ; n++) {
    try {
      return await streamOnce({ ...opts, model: tries[n], session: n ? `jarvis-${Date.now()}` : "jarvis" }, onText, onBrain, signal);
    } catch (e) {
      if (!e.slow || n >= tries.length - 1 || signal?.aborted) throw e;
      console.log(`[mente] ${e.via || "un'AI"} non risponde da ${FIRST_WORD_MS / 1000}s: provo un'altra AI`);
    }
  }
}

async function streamOnce({ url, key, model, messages, tools, session }, onText, onBrain, signal) {
  const ctrl = new AbortController();
  const stop = () => ctrl.abort();
  signal?.addEventListener("abort", stop, { once: true });
  let via = null;
  let slow = false;
  let timer = setTimeout(() => { slow = true; ctrl.abort(); }, FIRST_WORD_MS);
  const started = () => { clearTimeout(timer); timer = null; };
  try {
    return await readStream();
  } catch (e) {
    if (slow) throw Object.assign(new Error("AI troppo lenta"), { slow: true, via });
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener("abort", stop);
  }

  async function readStream() {
  const r = await fetch(`${url}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-Session-Id": session },
    body: JSON.stringify({ model, messages, tools: chatTools(tools), tool_choice: "auto", stream: true, temperature: 0.6 }),
    signal: ctrl.signal,
  });
  if (!r.ok) {
    const err = await r.text();
    throw Object.assign(new Error(`FreeLLMAPI ${r.status}: ${err.slice(0, 200)}`), { status: r.status, free: true });
  }
  via = r.headers.get("x-routed-via");
  if (via) onBrain(brainLabel(via), Number(r.headers.get("x-fallback-attempts")) || 0);
  let text = "";
  const calls = [];
  const dec = new TextDecoder();
  let buf = "";
  for await (const chunk of r.body) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;
      let ev;
      try { ev = JSON.parse(data); } catch { continue; }
      if (ev.error) throw new Error(ev.error.message || "risposta fallita");
      const d = ev.choices?.[0]?.delta || {};
      if (d.content || d.tool_calls?.length) started();
      if (d.content) { text += d.content; onText(d.content); }
      for (const tc of d.tool_calls || []) {
        const c = (calls[tc.index ?? calls.length] ??= { id: "", name: "", arguments: "" });
        if (tc.id) c.id = tc.id;
        if (tc.function?.name) c.name += tc.function.name;
        if (tc.function?.arguments) c.arguments += tc.function.arguments;
      }
    }
  }
  return { text, calls: calls.filter((c) => c?.name).map((c, n) => ({ ...c, id: c.id || `call_${Date.now()}_${n}` })) };
  }
}
