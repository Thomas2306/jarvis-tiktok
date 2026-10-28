"""Servizio vocale locale di JARVIS (avviato automaticamente da server.mjs).

- POST /tts         {text, voice, rate, pitch} -> audio/mpeg (voce neurale Microsoft via edge-tts)
- POST /transcribe  audio (webm/opus)          -> {text} (faster-whisper, OPZIONALE: npm run setup -- --whisper)
- GET  /health
"""
import asyncio, json, os, re, sys, tempfile, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR = os.path.join(ROOT, "data", "models")
WHISPER_SIZE = os.environ.get("WHISPER_MODEL", "base")
os.makedirs(MODEL_DIR, exist_ok=True)

model = None
model_error = None

def load_whisper():
    global model, model_error
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        model_error = "whisper non installato (opzionale)"
        return
    try:
        model = WhisperModel(WHISPER_SIZE, device="cpu", compute_type="int8", download_root=MODEL_DIR)
        log(f"whisper-{WHISPER_SIZE} pronto")
    except Exception as e:  # il TTS deve funzionare anche senza Whisper
        model_error = str(e)
        log(f"whisper non disponibile: {e}")

def log(msg):
    print(f"[voice] {msg}", flush=True)

# Frasi che Whisper "inventa" quando sente solo rumore o silenzio.
HALLUCINATIONS = re.compile(
    r"sottotitol|amara\.org|grazie (a tutti )?per (la )?(visione|l'attenzione|aver guardato)|iscriviti|"
    r"a cura di|qtss|\bmusica\b|\[.*?\]|\(.*?\)|♪|www\.|\.com|ciao a tutti e benvenuti|alla prossima",
    re.I,
)

async def synth(text, voice, rate, pitch):
    import edge_tts
    audio = bytearray()
    async for chunk in edge_tts.Communicate(text, voice, rate=rate, pitch=pitch).stream():
        if chunk["type"] == "audio":
            audio.extend(chunk["data"])
    return bytes(audio)

class Handler(BaseHTTPRequestHandler):
    def reply(self, status, data, ctype="application/json"):
        raw = data if isinstance(data, bytes) else json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def body(self):
        return self.rfile.read(int(self.headers.get("Content-Length", "0")))

    def do_GET(self):
        if self.path != "/health":
            return self.reply(404, {})
        self.reply(200, {"ok": True, "tts": True, "whisper": model is not None,
                         "model": f"whisper-{WHISPER_SIZE}", "error": model_error})

    def do_POST(self):
        if self.path == "/tts":
            return self.tts()
        if self.path == "/transcribe":
            return self.transcribe()
        self.reply(404, {})

    def tts(self):
        try:
            p = json.loads(self.body() or b"{}")
            text = (p.get("text") or "").strip()
            if not text:
                return self.reply(400, {"error": "testo vuoto"})
            audio, last = None, None
            for attempt in range(4):  # il servizio Microsoft ogni tanto risponde 403: riprova
                try:
                    audio = asyncio.run(synth(text, p.get("voice") or "it-IT-GiuseppeMultilingualNeural",
                                              p.get("rate") or "+0%", p.get("pitch") or "+0Hz"))
                    if audio: break
                except Exception as e:
                    last = e
                    time.sleep(0.25 * (attempt + 1))
            if not audio and last:
                raise last
            if not audio:
                raise RuntimeError("nessun audio generato")
            self.reply(200, audio, "audio/mpeg")
        except Exception as e:
            log(f"tts error: {e}")
            self.reply(502, {"error": str(e)})

    def transcribe(self):
        if model is None:
            return self.reply(503, {"error": model_error or "whisper in caricamento"})
        audio, path = self.body(), None
        try:
            with tempfile.NamedTemporaryFile(delete=False, suffix=".webm") as f:
                f.write(audio)
                path = f.name
            segments, info = model.transcribe(
                path, language="it", beam_size=1, vad_filter=True,
                vad_parameters={"min_silence_duration_ms": 400, "speech_pad_ms": 200},
                condition_on_previous_text=False, no_speech_threshold=0.5,
                initial_prompt="Ciao Jarvis.")
            parts = []
            for s in segments:
                t = s.text.strip()
                if not t or s.no_speech_prob > 0.55 or s.avg_logprob < -1.0 or HALLUCINATIONS.search(t):
                    continue
                parts.append(t)
            self.reply(200, {"text": " ".join(parts).strip(), "language": info.language})
        except Exception as e:
            self.reply(500, {"error": str(e)})
        finally:
            if path:
                try: os.unlink(path)
                except OSError: pass

    def log_message(self, *_):
        pass

if __name__ == "__main__":
    threading.Thread(target=load_whisper, daemon=True).start()
    port = int(os.environ.get("JARVIS_VOICE_PORT", "8765"))
    log(f"servizio vocale su http://127.0.0.1:{port}")
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
