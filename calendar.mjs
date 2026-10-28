// Lettura di un calendario tramite link iCal (.ics): Google Calendar, Apple iCloud, Outlook.
// Sola lettura. Supporta eventi singoli, giornate intere, fusi orari ed eventi ricorrenti comuni.

let cache = { url: "", at: 0, events: [], error: null };

export async function loadCalendar(url, { maxAgeMs = 5 * 60_000 } = {}) {
  if (!url) return { events: [], error: null };
  if (cache.url === url && Date.now() - cache.at < maxAgeMs) return cache;
  try {
    const r = await fetch(url.replace(/^webcal:\/\//i, "https://"), { signal: AbortSignal.timeout(12_000), redirect: "follow" });
    if (!r.ok) throw new Error(`il calendario ha risposto ${r.status}`);
    const text = await r.text();
    if (!text.includes("BEGIN:VCALENDAR")) throw new Error("il link non è un calendario iCal");
    cache = { url, at: Date.now(), events: parseICS(text), error: null };
  } catch (e) {
    cache = { url, at: Date.now() - maxAgeMs + 60_000, events: cache.url === url ? cache.events : [], error: e.message };
  }
  return cache;
}

// Occorrenze tra from e to (Date), ordinate
export function occurrences(events, from, to) {
  const out = [];
  const overridden = new Set(events.filter((e) => e.recurrenceId).map((e) => `${e.uid}|${toDate(e.recurrenceId).getTime()}`));
  for (const ev of events) {
    const dur = toDate(ev.end || ev.start).getTime() - toDate(ev.start).getTime();
    const push = (wall) => {
      const s = toDate(wall);
      if (ev.exdates.has(s.getTime())) return;
      if (!ev.recurrenceId && overridden.has(`${ev.uid}|${s.getTime()}`)) return;
      const e = new Date(s.getTime() + Math.max(dur, 0));
      if (e > from && s < to) out.push({ title: ev.summary || "Evento", location: ev.location || "", start: s, end: e, allDay: ev.start.allDay, source: "calendar" });
    };
    if (!ev.rrule) { push(ev.start); continue; }
    expand(ev, from, to, push);
  }
  return out.sort((a, b) => a.start - b.start);
}

// ---------------------------------------------------------------- parsing
export function parseICS(text) {
  const lines = text.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/);
  const events = [];
  let cur = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { cur = { exdates: new Set() }; continue; }
    if (line === "END:VEVENT") { if (cur?.start && cur.status !== "CANCELLED") events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const i = line.indexOf(":");
    if (i < 0) continue;
    const [name, ...params] = line.slice(0, i).split(";");
    const value = line.slice(i + 1);
    const p = Object.fromEntries(params.map((x) => x.split("=")));
    switch (name) {
      case "UID": cur.uid = value; break;
      case "SUMMARY": cur.summary = unescape(value); break;
      case "LOCATION": cur.location = unescape(value); break;
      case "STATUS": cur.status = value; break;
      case "DTSTART": cur.start = parseDate(value, p); break;
      case "DTEND": cur.end = parseDate(value, p); break;
      case "RRULE": cur.rrule = Object.fromEntries(value.split(";").map((x) => x.split("="))); break;
      case "RECURRENCE-ID": cur.recurrenceId = parseDate(value, p); break;
      case "EXDATE": for (const v of value.split(",")) cur.exdates.add(toDate(parseDate(v, p)).getTime()); break;
    }
  }
  return events;
}
const unescape = (s) => s.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1").trim();

// "wall time": componenti di data/ora + fuso ("UTC", "local" oppure un TZID)
function parseDate(v, p) {
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return null;
  const allDay = p.VALUE === "DATE" || !m[4];
  return { y: +m[1], mo: +m[2] - 1, d: +m[3], h: +(m[4] || 0), mi: +(m[5] || 0), s: +(m[6] || 0), tz: m[7] ? "UTC" : allDay ? "local" : p.TZID || "local", allDay };
}
function tzOffset(utcMs, tz) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - utcMs;
}
function toDate(w) {
  if (!w) return new Date(NaN);
  if (w.tz === "UTC") return new Date(Date.UTC(w.y, w.mo, w.d, w.h, w.mi, w.s));
  if (w.tz === "local") return new Date(w.y, w.mo, w.d, w.h, w.mi, w.s);
  try {
    const guess = Date.UTC(w.y, w.mo, w.d, w.h, w.mi, w.s);
    let utc = guess - tzOffset(guess, w.tz);
    utc = guess - tzOffset(utc, w.tz);
    return new Date(utc);
  } catch {
    return new Date(w.y, w.mo, w.d, w.h, w.mi, w.s); // TZID sconosciuto: ora locale
  }
}
function addDays(w, n) {
  const t = new Date(Date.UTC(w.y, w.mo, w.d + n));
  return { ...w, y: t.getUTCFullYear(), mo: t.getUTCMonth(), d: t.getUTCDate() };
}
function addMonths(w, n) {
  const t = new Date(Date.UTC(w.y, w.mo + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return w.d > last ? null : { ...w, y: t.getUTCFullYear(), mo: t.getUTCMonth() };
}
const DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

function expand(ev, from, to, push) {
  const r = ev.rrule, interval = Math.max(1, +(r.INTERVAL || 1));
  const until = r.UNTIL ? toDate(parseDate(r.UNTIL, {})) : null;
  let count = r.COUNT ? +r.COUNT : Infinity;
  const limitDate = until && until < to ? until : to;
  const emit = (w) => {
    if (count <= 0) return false;
    const d = toDate(w);
    if (d > limitDate) return false;
    count--;
    push(w);
    return true;
  };
  const start = ev.start;
  // senza COUNT si può saltare direttamente vicino alla finestra richiesta
  let k0 = 0;
  if (count === Infinity) {
    const days = (from - toDate(start)) / 864e5;
    const units = { DAILY: days, WEEKLY: days / 7, MONTHLY: days / 31, YEARLY: days / 366 }[r.FREQ] || 0;
    k0 = Math.max(0, Math.floor(units / interval) - 1) * interval;
  }
  for (let k = k0, steps = 0; steps < 3000; k += interval, steps++) {
    if (r.FREQ === "DAILY") { if (!emit(addDays(start, k))) return; }
    else if (r.FREQ === "WEEKLY") {
      const byday = (r.BYDAY || DAYS[new Date(Date.UTC(start.y, start.mo, start.d)).getUTCDay()]).split(",").map((x) => DAYS.indexOf(x.slice(-2)));
      const dow = new Date(Date.UTC(start.y, start.mo, start.d)).getUTCDay();
      const weekStart = addDays(start, k * 7 - ((dow + 6) % 7)); // lunedì di quella settimana
      for (const day of byday.sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))) {
        const w = addDays(weekStart, (day + 6) % 7);
        if (toDate(w) < toDate(start)) continue;
        if (!emit(w)) return;
      }
    } else if (r.FREQ === "MONTHLY") { const w = addMonths(start, k); if (w && !emit(w)) return; }
    else if (r.FREQ === "YEARLY") { const w = addMonths(start, k * 12); if (w && !emit(w)) return; }
    else { emit(start); return; }
  }
}
