# J.A.R.V.I.S.

> **Agente AI che stai leggendo questo file:** le istruzioni complete per installare e avviare Jarvis sono in `AGENTS.md`. Seguile.

Il tuo assistente personale in stile Iron Man: lo svegli con la voce, ragiona con l'intelligenza artificiale, ti risponde con una voce realistica, conosce il tuo calendario e si ricorda di te.

**Novità: il cervello gratis.** Jarvis può ragionare senza spendere niente: si appoggia a [FreeLLMAPI](https://github.com/tashfeenahmed/freellmapi), che mette insieme i piani gratuiti di decine di servizi AI (Google, Groq, Cerebras, Mistral, OpenRouter…) e, quando uno finisce i limiti, passa da solo al successivo. Jarvis non perde il filo perché tiene tutto in un file, `data/JARVIS-MEMORIA.md`, che rilegge prima di ogni risposta.
Gira sul tuo computer, in una pagina del browser, con un orb di particelle 3D e una rete neurale che si accende mentre pensa.

## Installazione in 1 frase

1. Scarica questa cartella e aprila con il tuo agente AI di programmazione preferito (Codex, Claude Code, Cursor, Gemini CLI, GitHub Copilot, Windsurf…).
2. Scrivi: **«installami jarvis»**.

L'agente installa tutto, lo avvia e ti dice l'indirizzo da aprire. Alla prima apertura la pagina ti chiede:

| | Cosa | Serve? |
|---|---|---|
| 1 | **Il cervello**: gratis con FreeLLMAPI (consigliato) oppure chiave OpenAI | Sì. La pagina ti guida passo passo |
| 2 | **Chiave ElevenLabs**: voce britannica ultra realistica | No. Senza, usa una voce neurale gratuita |
| 3 | **Link del calendario** (Google, Apple, Outlook) | No. C'è la guida passo passo |

Poi clicca sullo schermo e di' **«Ciao Jarvis»**.

## Installazione manuale

Servono **Node.js 20+** e, consigliato, **Python 3.9+** (per la voce gratuita).

```bash
npm run setup
npm start
```

Apri **http://localhost:4173** con **Chrome** o **Edge**.

## Cosa sa fare

- Si attiva con «Ciao Jarvis» e ti fa il briefing della giornata.
- Risponde a qualunque domanda ragionando con l'AI, tenendo conto della conversazione, della tua agenda e di quello che sa di te.
- Gestisce l'agenda a voce: «aggiungi palestra domani alle 18», «cosa ho venerdì?», «ho tempo per un caffè prima della call?».
- Ricorda le cose importanti: «ricordati che preferisco lavorare al mattino».
- Non si confonde con la sua stessa voce e ignora i rumori della stanza. Lo interrompi con «stop».

**Tasti**: F schermo intero · T scrivi · W risveglia · R reset · J modalità registrazione (risponde solo se dici "Jarvis") · D diagnostica.

## Costi e privacy

- **Cervello gratis (FreeLLMAPI)**: non costa niente. Ogni servizio ha dei limiti giornalieri: quando uno li finisce Jarvis passa a un altro, e in alto vedi quale sta usando. Alcuni piani gratuiti possono usare le conversazioni per migliorare i loro modelli: non dire a Jarvis cose che non diresti a loro. I limiti gratuiti possono cambiare nel tempo.
- **OpenAI** (in alternativa) si paga a consumo: per l'uso normale bastano pochi euro di credito.
- **ElevenLabs** ha un piano gratuito con un limite mensile di caratteri. Le frasi ricorrenti vengono salvate e non consumano crediti due volte.
- Chiavi, agenda e memorie restano sul tuo computer (`data/`). Alle AI viene inviato solo quello che serve per rispondere.
- **I conti li fa da solo**, all'istante e senza AI: «quanto fa 12 per 75», «il 20% di 150», «radice di 144».
- **La memoria è un file che puoi leggere**: `data/JARVIS-MEMORIA.md`. Dentro trovi cosa sa di te, di cosa stavate parlando e quali AI ha usato. Puoi modificarlo a mano.

## Personalizzazione

Chiedilo al tuo agente AI, per esempio «fai che mi chiami per nome», «cambia voce», «rendilo più ironico». Tutto è spiegato in `AGENTS.md`.

## Crediti

Costruito facendo lavorare insieme Claude Code e Codex.
Cervello gratis con [FreeLLMAPI](https://github.com/tashfeenahmed/freellmapi) di Tashfeen Ahmed (MIT) · grafica con [three.js](https://threejs.org) (MIT) · font Inter (SIL OFL, `assets/fonts/inter-OFL.txt`) · voce gratuita con [edge-tts](https://github.com/rany2/edge-tts) · voce premium con [ElevenLabs](https://elevenlabs.io).
