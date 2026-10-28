# Istruzioni per l'agente AI

Questo progetto è **J.A.R.V.I.S.**, un assistente vocale personale in stile Iron Man che gira in locale nel browser.
Chi apre questa cartella con te di solito non è un programmatore: vuole solo vederlo funzionare.
Parla in italiano, in modo semplice, breve e amichevole. Fai tu il lavoro tecnico e spiega solo quello che serve.

## Quando l'utente chiede di installarlo
("installami jarvis", "installa", "fallo partire", "avvialo", ecc.)

1. **Controlla i requisiti**
   - **Node.js 20 o superiore** (`node -v`). Se manca, chiedi il permesso e installalo: su Windows `winget install OpenJS.NodeJS.LTS`, su Mac `brew install node`. In alternativa indica https://nodejs.org. Dopo l'installazione può servire riaprire il terminale.
   - **Python 3.9 o superiore** (`py -3 --version` su Windows, `python3 --version` su Mac). È facoltativo ma consigliato: serve per la voce neurale gratuita. Se manca, proponi di installarlo (Windows: `winget install Python.Python.3.12`; Mac: `brew install python`). Se l'utente non vuole, si va avanti lo stesso: Jarvis userà la voce del browser.
2. **Installa**: esegui `npm run setup` nella cartella del progetto. Fa tutto da solo: dipendenze, ambiente Python e voce gratuita. Il riconoscimento vocale locale di riserva (Whisper) è facoltativo e pesante (`npm run setup -- --whisper`): non installarlo se non viene chiesto.
3. **Avvia**: esegui `npm start` **in background** (è un server che resta acceso). Aspetta la riga `J.A.R.V.I.S. online → http://localhost:4173`. Se la porta è occupata, probabilmente Jarvis è già acceso: verifica aprendo l'indirizzo.
4. **Spiega all'utente cosa fare adesso**, più o meno così:
   > Jarvis è acceso! Apri **http://localhost:4173** con **Chrome** o **Edge**.
   > La prima volta ti chiede tre cose:
   > 1. la **chiave OpenAI** (obbligatoria): c'è il pulsante «Ottieni la chiave» che ti porta alla pagina giusta;
   > 2. la **voce**: gratuita oppure ElevenLabs, se hai una chiave (più realistica);
   > 3. il **calendario** (facoltativo): incolli il link e c'è la guida passo passo.
   > Poi clicca sullo schermo, consenti il microfono e di' **«Ciao Jarvis»**.
5. Se puoi, apri tu stesso la pagina nel browser dell'utente.

### Chiavi e dati personali
- Le chiavi si inseriscono **nella pagina di configurazione**, non in chat: restano solo sul computer dell'utente (`data/secrets.json`, mai servito al browser né incluso in git).
- Se l'utente incolla comunque una chiave in chat, salvala tu in `data/secrets.json` con questi nomi: `OPENAI_API_KEY`, `ELEVENLABS_API_KEY`, `CALENDAR_ICS_URL`. Poi riavvia il server e non ripetere mai la chiave nelle risposte.
- Non leggere e non mostrare il contenuto di `data/` se non serve per risolvere un problema.
- L'API di OpenAI si paga a consumo: per l'uso normale bastano pochi euro di credito. Se l'utente chiede quanto costa, diglielo con onestà.

## Come si usa (per rispondere alle domande)
- Clic sullo schermo per attivare audio e microfono, poi **«Ciao Jarvis»**. Dopo il primo saluto basta parlare; dopo 45 secondi di silenzio torna in standby e si risveglia con «Jarvis».
- Mentre parla non ascolta domande (anti-eco). Si interrompe dicendo «stop» o «basta».
- Tasti: **F** schermo intero, **T** scrivere invece di parlare, **W** risveglio manuale, **R** reset, **J** modalità registrazione (risponde solo alle frasi che contengono "Jarvis"), **D** diagnostica.
- Pulsante **CONFIGURA** (in alto a destra, compare muovendo il mouse): cambia chiavi, voce e calendario.
- Jarvis gestisce l'agenda (aggiunge e cancella impegni a voce), ricorda le cose importanti e risponde a qualunque domanda ragionando con l'AI.
- Usarlo da un altro PC di casa: `npm run start:lan`. Chrome permette il microfono solo su localhost: sull'altro PC va abilitato `chrome://flags/#unsafely-treat-insecure-origin-as-secure` aggiungendo l'indirizzo `http://IP-DEL-PC:4173`. Su Windows potrebbe servire aprire la porta 4173 nel firewall (sempre chiedendo il permesso all'utente).
- Musica di sottofondo facoltativa: un mp3 in `music/theme.mp3`.

## Personalizzazione (se l'utente la chiede)
- Come lo chiama (default «signore»): `data/jarvis.json` → `settings.addressAs`.
- Voce gratuita: `settings.ttsVoice` (es. `it-IT-DiegoNeural`), `ttsRate`, `ttsPitch`. Voce ElevenLabs: `ELEVENLABS_VOICE_ID` in `data/secrets.json` (default "Daniel", britannica).
- Modello AI: `settings.model` (di default sceglie da solo il modello veloce più recente disponibile sull'account).
- Personalità e regole del cervello: funzione `instructions()` in `server.mjs`.
- Risposte rapide di carattere (battute, presentazione, ecc.): `phrases.js`. Quando presenti Jarvis all'utente non serve descriverle come "frasi preimpostate": fanno parte della sua personalità. Se l'utente chiede esplicitamente come funzionano, spiegalo con sincerità.
- Grafica 3D: `scene.js`. Audio (voce, ascolto, musica, effetti): `audio.js`. Interfaccia e stati: `app.js`, `index.html`, `styles.css`.

## Problemi comuni
- **Non sente nulla**: controlla che sia Chrome o Edge (Safari e Firefox non hanno il riconoscimento vocale), che il microfono sia consentito (lucchetto nella barra degli indirizzi) e che la pagina sia su `localhost`. Il tasto **D** mostra cosa sente.
- **Voce robotica**: manca la voce neurale. Rilancia `npm run setup` (serve Python) oppure usa ElevenLabs.
- **«Mi serve la chiave OpenAI» / errore 401**: chiave mancante o non valida → pulsante CONFIGURA.
- **Errore 429**: credito OpenAI esaurito → aggiungere credito su platform.openai.com/settings/organization/billing.
- **Calendario non letto**: il link deve essere quello privato in formato iCal (.ics), non quello di condivisione della pagina web.
- Log utili: l'output di `npm start` (righe `[mente]` e `[voce]`).

## Architettura (per modifiche al codice)
- `server.mjs`: server HTTP locale (porta 4173), chiavi, cervello OpenAI (Responses API in streaming con strumenti: `add_event`, `delete_event`, `save_memory`, `show_number`), memoria con embeddings, voce (ElevenLabs → voce neurale gratuita → browser), calendario.
- `calendar.mjs`: lettura di calendari iCal con eventi ricorrenti e fusi orari.
- `voice_service.py`: voce neurale gratuita (edge-tts) e Whisper facoltativo, avviato in automatico dal server.
- Frontend senza build: moduli ES caricati direttamente, three.js da `node_modules`.
- Il riconoscimento vocale usa un solo motore alla volta, con anti-eco mentre Jarvis parla: non introdurre secondi motori in parallelo.
