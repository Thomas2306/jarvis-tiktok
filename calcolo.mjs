// Calcolatrice istantanea: se la domanda è solo un conto ("quanto fa 12 per 75"),
// Jarvis risponde subito da solo, senza chiedere niente all'intelligenza artificiale.
// Nessun eval: un piccolo parser che conosce solo numeri e operazioni.

const WORDS = [
  [/\b(jarvis|ehi|hey|ok|allora|dimmi|scusa|signore|per favore|per piacere|grazie)\b/g, " "],
  [/quant'è|\s(è|é)\s/g, " "],
  [/\b(quanto|calcola|calcolami|mi calcoli|puoi calcolare|fammi|fa|fanno|viene|il|risultato di|il risultato|uguale a|uguale)\b/g, " "],
  [/(\d)x(\d)/g, "$1*$2"],
  [/(\d)\s*%\s*di\s*/g, "$1/100*"],
  [/(\d)\s*per\s*cento\s*di\s*/g, "$1/100*"],
  [/\bradice\s+(quadrata\s+)?di\s*/g, "√"],
  [/\bal\s+quadrato\b|\balla\s+seconda\b/g, "^2"],
  [/\bal\s+cubo\b|\balla\s+terza\b/g, "^3"],
  [/\belevato\s+(alla?|a)\s*/g, "^"],
  [/\bdiviso\s+(per\s+)?|\bfratto\b|÷/g, "/"],
  [/\bmoltiplicato\s+per\b|\bper\b|\bx\b|×|·/g, "*"],
  [/più|\bpiu\b/g, "+"],
  [/\bmeno\b/g, "-"],
  [/\baperta\s+parentesi\b/g, "("],
  [/\bchiusa\s+parentesi\b/g, ")"],
];

function normalize(text) {
  let s = ` ${String(text).toLowerCase()} `.replace(/[?!¿¡=]/g, " ");
  for (const [re, to] of WORDS) s = s.replace(re, to);
  s = s.replace(/(\d)\.(\d{3})(?!\d)/g, "$1$2"); // 1.000 -> 1000
  s = s.replace(/(\d),(\d)/g, "$1.$2"); // 3,5 -> 3.5
  return s.replace(/\s+/g, "").replace(/\.$/, "");
}

function parse(src) {
  let i = 0;
  const peek = () => src[i];
  const num = () => {
    const m = /^\d+(\.\d+)?/.exec(src.slice(i));
    if (!m) throw 0;
    i += m[0].length;
    return Number(m[0]);
  };
  const atom = () => {
    if (peek() === "(") { i++; const v = expr(); if (peek() !== ")") throw 0; i++; return v; }
    if (peek() === "√") { i++; return Math.sqrt(unary()); }
    return num();
  };
  const unary = () => (peek() === "-" ? (i++, -unary()) : peek() === "+" ? (i++, unary()) : atom());
  const power = () => { const b = unary(); if (peek() === "^") { i++; return b ** power(); } return b; };
  const term = () => {
    let v = power();
    while (peek() === "*" || peek() === "/") { const op = src[i++]; const r = power(); v = op === "*" ? v * r : v / r; }
    return v;
  };
  const expr = () => {
    let v = term();
    while (peek() === "+" || peek() === "-") { const op = src[i++]; const r = term(); v = op === "+" ? v + r : v - r; }
    return v;
  };
  const v = expr();
  if (i !== src.length) throw 0;
  return v;
}

/** Restituisce il risultato se il messaggio è solo un conto, altrimenti null. */
export function tryCalc(message) {
  const s = normalize(message);
  if (!s || s.length > 120 || !/^[\d.+\-*/^()√]+$/.test(s) || !/\d[+\-*/^]|√/.test(s)) return null;
  try {
    const v = parse(s);
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

export function sayNumber(v) {
  return v.toLocaleString("it-IT", { maximumFractionDigits: Math.abs(v) < 1 ? 6 : 4 });
}
