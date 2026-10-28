// =====================================================================
//  RISPOSTE RAPIDE DI JARVIS
//  Momenti "di carattere" con battute curate e audio pronto all'istante.
//  Tutto il resto lo gestisce il cervello AI.
//  - match: espressioni regolari sul testo detto (minuscolo, senza accenti)
//  - say:   frasi dette in sequenza; stringhe oppure { text, stat, music }.
//           Può essere una funzione (ctx) => [...] per risposte dinamiche.
//    stat:  { id, label, value, suffix } -> card con numero che cresce
//    music: "party" (volume pieno) | "stop"
// =====================================================================

export const CONFIG = {
  // Musica opzionale: metti un mp3 in music/theme.mp3 (vedi music/LEGGIMI.txt)
  music: {
    file: "music/theme.mp3",
    start: 0,        // secondo da cui partire
    loop: true,      // resta in sottofondo, in loop
    intro: 0.7,      // volume nel momento del risveglio
    bed: 0.16,       // durante il briefing, quando Jarvis è in silenzio
    duck: 0.05,      // durante il briefing, mentre Jarvis parla
    bedAfter: 0.07,  // dopo il briefing: sottofondo leggero
    duckAfter: 0.03, // dopo il briefing, mentre Jarvis parla
  },
};

export const PHRASES = [
  {
    id: "come-stai",
    match: [/come stai|come va jarvis|tutto bene jarvis/],
    say: ["Tutti i sistemi al cento per cento, signore.", "Più di quanto si possa dire del tuo livello di caffeina."],
  },
  {
    id: "chi-sei",
    match: [/chi sei|presentati|cosa sei/],
    say: [
      "Sono J.A.R.V.I.S., il tuo sistema cognitivo personale.",
      "Gestisco la tua agenda, ricordo quello che mi dici e ragiono con te su qualunque cosa.",
      "In poche parole: la tua seconda mente.",
    ],
  },
  {
    id: "cosa-sai-fare",
    match: [/cosa sai fare|cosa puoi fare/],
    say: [
      "Organizzo la tua giornata, gestisco il calendario, ricordo tutto quello che mi dici e rispondo a qualunque domanda.",
      "E se serve, ti ricordo anche di dormire.",
    ],
  },
  {
    id: "siri",
    match: [/(piu intelligente|meglio) (di|del|dello) (siri|alexa|chatgpt|google)/],
    say: ["Diciamo che Siri imposta i timer.", "Io gestisco la tua vita. Ma non vorrei sembrare presuntuoso."],
  },
  {
    id: "sistemi",
    match: [/stato (dei|del) sistem|diagnostica|come stanno i sistemi|analisi completa/],
    say: [
      { text: "Diagnostica completata.", stat: { id: "uptime", label: "INTEGRITÀ DEI SISTEMI", value: 100, suffix: "%" } },
      "Memoria neurale sincronizzata, nessuna anomalia rilevata. Siamo pronti a tutto.",
    ],
  },
  {
    id: "ora",
    match: [/che ore sono|che ora e/],
    say: (ctx) => [`Sono le ${ctx.time}, signore.`],
  },
  {
    id: "festa",
    match: [/protocollo (festa|house party)|house party|alza la musica|metti (la )?musica/],
    say: (ctx) =>
      ctx.hasMusic
        ? [{ text: "Protocollo House Party attivato.", music: "party" }]
        : ["Mi piacerebbe, signore, ma non ho ancora una colonna sonora. Mettila nella cartella music e ci penso io."],
  },
  {
    id: "stop-musica",
    match: [/(spegni|ferma|togli|abbassa) (la )?musica/],
    say: [{ text: "Musica in dissolvenza.", music: "stop" }],
  },
  {
    id: "battuta",
    match: [/battuta|fammi ridere|barzelletta/],
    say: ["Ho calcolato quattordici milioni di possibili battute.", "Purtroppo, in tutte, il finale sei tu che lavori di domenica."],
  },
  {
    id: "pronto",
    match: [/sei pronto|stiamo registrando|siamo in onda|si gira/],
    say: ["Sempre pronto. Luci, camera e un pizzico di genialità."],
  },
  {
    id: "grazie",
    match: [/^(grazie|grazie mille|perfetto grazie|ottimo lavoro|bravo)$/],
    say: ["È sempre un piacere, signore."],
  },
];

function norm(t) {
  return t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}
export function matchPhrase(text) {
  const n = norm(text);
  return PHRASES.find((p) => p.match.some((r) => r.test(n))) || null;
}
export function linesFor(phrase, ctx) {
  const raw = typeof phrase.say === "function" ? phrase.say(ctx) : phrase.say;
  return raw.map((l) => (typeof l === "string" ? { text: l } : l));
}
// testi fissi da preparare all'avvio (risposta istantanea)
export function staticLines() {
  return PHRASES.filter((p) => typeof p.say !== "function").flatMap((p) => p.say.map((l) => (typeof l === "string" ? l : l.text)));
}
