// Installazione di J.A.R.V.I.S.: dipendenze Node, ambiente Python per la voce, controlli.
// Uso:  npm run setup            (consigliato)
//       npm run setup -- --whisper   (aggiunge il riconoscimento vocale locale di riserva, ~200 MB)
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("./", import.meta.url));
const win = process.platform === "win32";
const ok = (m) => console.log(`  ✓ ${m}`);
const warn = (m) => console.log(`  ! ${m}`);
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { cwd: root, stdio: "inherit", shell: win, ...opts });
const probe = (cmd, args) => spawnSync(cmd, args, { encoding: "utf8" }); // senza shell: gli argomenti con spazi restano intatti

console.log("\nInstallazione di J.A.R.V.I.S.\n");

// 1. Node
const [major] = process.versions.node.split(".").map(Number);
if (major < 20) {
  console.log(`  ✗ Serve Node.js 20 o superiore (hai ${process.versions.node}). Scaricalo da https://nodejs.org`);
  process.exit(1);
}
ok(`Node.js ${process.versions.node}`);

// 2. Dipendenze Node (three.js)
if (run("npm", ["install", "--no-audit", "--no-fund"]).status !== 0) {
  console.log("  ✗ npm install non è riuscito.");
  process.exit(1);
}
ok("dipendenze dell'interfaccia installate");

// 3. Python per la voce neurale gratuita (facoltativo ma consigliato)
const candidates = win ? [["py", ["-3"]], ["python", []], ["python3", []]] : [["python3", []], ["python", []]];
let python = null;
for (const [cmd, pre] of candidates) {
  const r = probe(cmd, [...pre, "-c", "import sys; print(sys.version_info[0], sys.version_info[1])"]);
  const [maj, min] = (r.stdout || "").trim().split(" ").map(Number);
  if (r.status === 0 && maj === 3 && min >= 9) { python = [cmd, pre]; ok(`Python ${maj}.${min}`); break; }
}
const venvPython = join(root, ".venv", win ? "Scripts/python.exe" : "bin/python");
if (!python && !existsSync(venvPython)) {
  warn("Python 3.9+ non trovato: JARVIS funzionerà con la voce del browser (meno realistica).");
  warn("Per la voce neurale gratuita installa Python da https://www.python.org e rilancia `npm run setup`.");
} else {
  if (!existsSync(venvPython)) {
    if (run(python[0], [...python[1], "-m", "venv", ".venv"], { shell: false }).status !== 0) { console.log("  ✗ Impossibile creare l'ambiente Python."); process.exit(1); }
  }
  run(venvPython, ["-m", "pip", "install", "--upgrade", "pip", "-q"], { shell: false });
  if (run(venvPython, ["-m", "pip", "install", "-q", "-r", "requirements.txt"], { shell: false }).status !== 0) warn("Installazione della voce neurale non riuscita: verrà usata la voce del browser.");
  else ok("voce neurale gratuita installata");
  if (process.argv.includes("--whisper")) {
    if (run(venvPython, ["-m", "pip", "install", "-q", "-r", "requirements-whisper.txt"], { shell: false }).status === 0) ok("riconoscimento vocale locale (Whisper) installato");
    else warn("Whisper non installato: non è indispensabile.");
  }
}

console.log(`
Installazione completata.

  Avvia:   npm start
  Apri:    http://localhost:4173   (Chrome o Edge)

Al primo avvio la pagina ti chiede la chiave OpenAI e, se vuoi, quella ElevenLabs e il calendario.
`);
