// JARVIS-MEMORIA.md: la memoria di Jarvis in un file di testo che puoi aprire e modificare.
// Jarvis lo rilegge prima di ogni risposta, quindi qualunque AI stia usando in quel momento
// (e anche dopo un riavvio) sa chi sei e riparte dal punto in cui eravate rimasti.
import { readFile, writeFile } from "node:fs/promises";

const H_ME = "## Cosa so di te";
const H_NOW = "## Di cosa stavamo parlando";
const H_BRAIN = "## Ultimi cervelli usati";

const intro = `# Memoria di J.A.R.V.I.S.

Jarvis legge questo file prima di ogni risposta, qualunque intelligenza artificiale stia usando.
Puoi modificarlo a mano: aggiungi o togli righe in "${H_ME.slice(3)}" e Jarvis se ne accorge subito.
Le altre due sezioni le aggiorna lui da solo.
`;

function section(md, head) {
  const i = md.indexOf(head);
  if (i < 0) return "";
  const rest = md.slice(i + head.length);
  const j = rest.search(/\n## /);
  return (j < 0 ? rest : rest.slice(0, j)).trim();
}
const bullets = (s) => s.split("\n").map((l) => l.trim()).filter((l) => /^[-*] /.test(l)).map((l) => l.slice(2).trim()).filter(Boolean);
const oneLine = (s, n) => { const t = String(s).replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

export function createMemory(file) {
  let cache = null;

  async function load() {
    let md = "";
    try { md = await readFile(file, "utf8"); } catch {}
    cache = { facts: bullets(section(md, H_ME)), now: section(md, H_NOW), brains: bullets(section(md, H_BRAIN)) };
    return cache;
  }
  async function save() {
    const c = cache;
    const md = `${intro}
${H_ME}
${c.facts.length ? c.facts.map((f) => `- ${f}`).join("\n") : "- (ancora niente: dimmi qualcosa di te e me lo segno)"}

${H_NOW}
${c.now || "_Nessuna conversazione ancora._"}

${H_BRAIN}
${c.brains.length ? c.brains.map((b) => `- ${b}`).join("\n") : "- (nessuno ancora)"}
`;
    await writeFile(file, md);
  }

  return {
    // Prima volta: crea il file partendo dai ricordi che Jarvis aveva già salvato.
    async init(oldMemories = []) {
      await load();
      if (!cache.facts.length && oldMemories.length) cache.facts = oldMemories.map((m) => m.text).reverse();
      cache.facts = cache.facts.filter((f) => !f.startsWith("(ancora niente"));
      cache.brains = cache.brains.filter((b) => !b.startsWith("(nessuno"));
      await save();
    },
    // Testo da dare all'AI insieme alle istruzioni (riletto ogni volta: le modifiche a mano valgono subito).
    async forPrompt() {
      const c = await load();
      const facts = c.facts.filter((f) => !f.startsWith("(ancora niente"));
      return {
        facts,
        text: `Cosa sai dell'utente:\n${facts.length ? facts.map((f) => `- ${f}`).join("\n") : "- ancora niente"}\n\nDi cosa stavate parlando l'ultima volta:\n${c.now && !c.now.startsWith("_Nessuna") ? c.now : "- nessuna conversazione precedente"}`.slice(0, 7000),
      };
    },
    async addFact(text) {
      await load();
      cache.facts = cache.facts.filter((f) => !f.startsWith("(ancora niente") && f.toLowerCase() !== text.toLowerCase());
      cache.facts.push(oneLine(text, 300));
      await save();
    },
    // Dopo ogni risposta: tiene le ultime battute e quale AI ha risposto.
    async afterTurn(history, brain) {
      await load();
      const when = new Date().toLocaleString("it-IT", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
      const lines = history.slice(-8).map((m) => `- ${m.role === "user" ? "Tu" : "Jarvis"}: ${oneLine(m.content, 280)}`);
      cache.now = `_Aggiornato ${when}._\n${lines.join("\n")}`;
      if (brain?.via) {
        cache.brains = cache.brains.filter((b) => !b.startsWith("(nessuno"));
        const last = cache.brains[0] || "";
        if (!last.includes(brain.via)) cache.brains.unshift(`${when}: ${brain.via}`);
        cache.brains = cache.brains.slice(0, 10);
      }
      await save();
    },
  };
}
