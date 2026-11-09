# Istruzioni per l'agente AI

Questo progetto è **J.A.R.V.I.S.**, un assistente vocale personale in stile Iron Man che gira in locale nel browser.
Chi apre questa cartella con te di solito non è un programmatore: vuole solo vederlo funzionare.
Parla in italiano, in modo semplice, breve e amichevole. Fai tu il lavoro tecnico e spiega solo quello che serve.

## Quando l'utente chiede di installarlo
("installami jarvis", "installa", "fallo partire", "avvialo", ecc.)

1. **Controlla i requisiti**
   - **Node.js 20 o superiore** (`node -v`). Se manca, chiedi il permesso e installalo: su Windows `winget install OpenJS.NodeJS.LTS`, su Mac `brew install node`. In alternativa indica https://nodejs.org. Dopo l'installazione può servire riaprire il terminale.
   - **Python 3.9 o superiore** (`py -3 --version` su Windows, `python3 --version` su Mac). È facoltativo ma consigliato: serve per la voce neurale gratuita. Se manca, proponi di installarlo (Windows: `winget install Python.Python.3.12`; Mac: `brew install python`). Se l'utente non vuole, si va avanti lo stesso: Jarvis userà la voce del browser.
2. **Cervello gratis (consigliato)**: Jarvis ragiona gratis tramite **FreeLLMAPI** (https://github.com/tashfeenahmed/freellmapi, open source, MIT), un'app che resta accesa vicino all'orologio e passa da un'AI gratuita all'altra quando una finisce i limiti.
   - Chiedi all'utente se vuole il cervello gratis (consigliato) o OpenAI a consumo. Se sceglie gratis e FreeLLMAPI non è già installato, **chiedi il permesso** e installalo dall'ultima release ufficiale: https://github.com/tashfeenahmed/freellmapi/releases/latest
     - Windows: scarica `FreeLLMAPI-Setup-<versione>.exe` (circa 110 MB) e avvialo (installazione in un clic, senza permessi di amministratore; con `/S` è silenziosa).
     - Mac: scarica il `.dmg` giusto (`arm64` per i Mac con chip Apple, `x64` per quelli Intel), aprilo e copia FreeLLMAPI in Applicazioni.
   - Poi aprilo: compare un'icona vicino all'orologio e il pannello su http://localhost:3001. L'utente deve aggiungere lì (pagina **Keys**) almeno una chiave gratuita: Google AI Studio (https://aistudio.google.com/apikey), Groq (https://console.groq.com/keys), Cerebras, OpenRouter, Mistral. Più ne mette, più cervelli di riserva ha. Le chiavi le incolla lui nel pannello, non in chat.
   - Jarvis trova da solo FreeLLMAPI e la sua chiave unica. Se non ci riesce, l'utente la copia dall'icona (**Copy Key**) e la incolla nella configurazione di Jarvis.
3. **Installa**: esegui `npm run setup` nella cartella del progetto. Fa tutto da solo: dipendenze, ambiente Python e voce gratuita. Il riconoscimento vocale locale di riserva (Whisper) è facoltativo e pesante (`npm run setup -- --whisper`): non installarlo se non viene chiesto.
4. **Avvia**: esegui `npm start` **in background** (è un server che resta acceso). Aspetta la riga `J.A.R.V.I.S. online → http://localhost:4173`. Se la porta è occupata, probabilmente Jarvis è già acceso: verifica aprendo l'indirizzo.
5. **Spiega all'utente cosa fare adesso**, più o meno così:
   > Jarvis è acceso! Apri **http://localhost:4173** con **Chrome** o **Edge**.
   > La prima volta ti chiede tre cose:
   > 1. il **cervello** (obbligatorio): gratis con FreeLLMAPI (la pagina ti dice se è collegato e quante AI gratuite sono pronte) oppure la chiave OpenAI;
   > 2. la **voce**: gratuita oppure ElevenLabs, se hai una chiave (più realistica);
   > 3. il **calendario** (facoltativo): incolli il link e c'è la guida passo passo.
   > Poi clicca sullo schermo, consenti il microfono e di' **«Ciao Jarvis»**.
6. Se puoi, apri tu stesso la pagina nel browser dell'utente.

### Chiavi e dati personali
- Le chiavi si inseriscono **nella pagina di configurazione**, non in chat: restano solo sul computer dell'utente (`data/secrets.json`, mai servito al browser né incluso in git).
- Se l'utente incolla comunque una chiave in chat, salvala tu in `data/secrets.json` con questi nomi: `OPENAI_API_KEY`, `ELEVENLABS_API_KEY`, `CALENDAR_ICS_URL`, `FREELLM_API_KEY` (chiave unica di FreeLLMAPI). Il cervello scelto è `BRAIN` (`free` oppure `openai`). Poi riavvia il server e non ripetere mai la chiave nelle risposte.
- Non leggere e non mostrare il contenuto di `data/` se non serve per risolvere un problema.
- Il cervello gratis non costa niente ma ha limiti giornalieri per ogni servizio (Jarvis passa al successivo da solo) e alcuni piani gratuiti possono usare le conversazioni per addestrare i modelli. L'API di OpenAI si paga a consumo: per l'uso normale bastano pochi euro di credito. Se l'utente chiede quanto costa, diglielo con onestà.

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
- Modello AI con OpenAI: `settings.model` (di default sceglie da solo il modello veloce più recente disponibile sull'account). Con il cervello gratis: `settings.freeModel` (default `auto`; `auto:fast` più veloce, `auto:smart` più intelligente).
- Memoria: `data/JARVIS-MEMORIA.md` (cosa sa dell'utente, l'ultima conversazione, le AI usate). Si può modificare a mano; Jarvis lo rilegge a ogni risposta.
- Personalità e regole del cervello: funzione `instructions()` in `server.mjs`.
- Risposte rapide di carattere (battute, presentazione, ecc.): `phrases.js`. Quando presenti Jarvis all'utente non serve descriverle come "frasi preimpostate": fanno parte della sua personalità. Se l'utente chiede esplicitamente come funzionano, spiegalo con sincerità.
- Grafica 3D: `scene.js`. Audio (voce, ascolto, musica, effetti): `audio.js`. Interfaccia e stati: `app.js`, `index.html`, `styles.css`.

## Problemi comuni
- **Non sente nulla**: controlla che sia Chrome o Edge (Safari e Firefox non hanno il riconoscimento vocale), che il microfono sia consentito (lucchetto nella barra degli indirizzi) e che la pagina sia su `localhost`. Il tasto **D** mostra cosa sente.
- **Voce robotica**: manca la voce neurale. Rilancia `npm run setup` (serve Python) oppure usa ElevenLabs.
- **«Il mio cervello gratuito è spento» / non collegato**: FreeLLMAPI non è aperto (avvialo, icona vicino all'orologio) oppure non ha chiavi (pannello http://localhost:3001 → Keys).
- **«Tutte le intelligenze gratuite sono occupate»**: tutti i servizi configurati hanno finito i limiti. Aggiungere altre chiavi gratuite in FreeLLMAPI o riprovare più tardi (i limiti si azzerano ogni giorno).
- **«Mi serve la chiave OpenAI» / errore 401**: chiave mancante o non valida → pulsante CONFIGURA.
- **Errore 429**: credito OpenAI esaurito → aggiungere credito su platform.openai.com/settings/organization/billing.
- **Calendario non letto**: il link deve essere quello privato in formato iCal (.ics), non quello di condivisione della pagina web.
- Log utili: l'output di `npm start` (righe `[mente]` e `[voce]`).

## Architettura (per modifiche al codice)
- `server.mjs`: server HTTP locale (porta 4173), chiavi, cervello (strumenti `add_event`, `delete_event`, `save_memory`, `show_number`), voce (ElevenLabs → voce neurale gratuita → browser), calendario. Con OpenAI usa la Responses API in streaming.
- `cervello-gratis.mjs`: collegamento a FreeLLMAPI (`/v1/chat/completions` in streaming con strumenti). Trova da solo l'app desktop e la sua chiave; legge l'header `X-Routed-Via` per sapere quale AI ha risposto e lo mostra in alto («CERVELLO · GROQ»), con un lampo quando cambia.
- `calcolo.mjs`: calcolatrice istantanea. Se la domanda è solo un conto («quanto fa 12 per 75», «il 20% di 150», «radice di 144») Jarvis risponde subito da solo, senza AI.
- Se un'AI gratuita non dice neanche una parola entro 15 secondi, Jarvis la abbandona e chiede a un'altra più veloce (fino a 3 tentativi). Il tempo si cambia con la variabile `JARVIS_FREE_TIMEOUT_MS`.
- `memoria.mjs`: gestisce `data/JARVIS-MEMORIA.md`, riletto a ogni risposta e passato all'AI, così il contesto sopravvive ai cambi di AI e ai riavvii.
- `calendar.mjs`: lettura di calendari iCal con eventi ricorrenti e fusi orari.
- `voice_service.py`: voce neurale gratuita (edge-tts) e Whisper facoltativo, avviato in automatico dal server.
- Frontend senza build: moduli ES caricati direttamente, three.js da `node_modules`.
- Il riconoscimento vocale usa un solo motore alla volta, con anti-eco mentre Jarvis parla: non introdurre secondi motori in parallelo.
