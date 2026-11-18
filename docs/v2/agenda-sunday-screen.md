# Sunday inside Agenda — handoff for the agenda repo

**For:** whoever works on the **agenda** repo (Claude Code or a person). Self-contained: copy it into the agenda repo
(e.g. `docs/sunday-screen.md`). Written from the sunday repo on 2026-11-17, against Open WebUI **v0.12.5**.
Items marked **(verify)** were not tested end to end from the sunday side; check them against the running
instance before building on them.

## 1. Goal

Two things, in this order:

1. **Sunday screen in Agenda** (`/sunday`): chat + voice with interruption + an animated "galaxy" orb that reacts to
   audio. Same brain, memory and tools as `https://sunday.lemydev.com`: Agenda does **not** call Claude directly; it
   uses Open WebUI (Sunday) as its backend.
2. **Agenda as an Android app (APK)** that can listen for **"Hey Sunday"** in the background and open `/sunday` in
   voice mode. Do this after (1) works.

Sunday's own web UI stays as it is; this is an extra surface.

## 2. What Sunday already provides

| | |
|---|---|
| Base URL | `https://sunday.lemydev.com` |
| Auth | `Authorization: Bearer sk-…`: an Open WebUI API key of Lemy's account. Lemy generates it in Sunday → Configuración → Cuenta → Claves API and stores it **only** in Agenda's Coolify env (e.g. `SUNDAY_API_KEY`). Server-side only, never sent to the browser, never committed. In Open WebUI a user has one key; regenerating it invalidates the previous one. |
| Models | `sunday` (Sonnet, default, voice), `sunday-pro` (Sonnet, thinking), `sunday-max` (Opus). Same persona prompt (Rioplatense Spanish). |
| Agenda tools | Tool server id **`server:0`**: Agenda's own API (`/api/openapi.sunday.json`) with the token "sunday". Sunday calls Agenda's API back server-side when the model uses a tool. |
| STT | Groq `whisper-large-v3-turbo` behind Open WebUI. |
| TTS | Azure `es-AR-ElenaNeural` behind Open WebUI (says "Sunday" correctly). |
| Memory | Open WebUI memories of Lemy's user. |
| Web search | Claude's native web search (pipe), toggled per request. |

Nothing in Sunday needs to change for the screen to work. Once Agenda calls it from its backend, the sunday side
will turn on API key endpoint restrictions (`ENABLE_API_KEYS_ENDPOINT_RESTRICTIONS` + `API_KEYS_ALLOWED_ENDPOINTS`)
limited to the endpoints below. Tell the sunday side the final list.

## 3. Architecture

```
browser /sunday ──(Agenda session)──► Agenda backend /api/sunday/* ──(Bearer SUNDAY_API_KEY)──► sunday.lemydev.com
   mic, VAD, orb, audio playback         thin proxy, streams through          Open WebUI: Claude + tools + memory
                                                                               └─ tools ──► agenda.lemydev.com/api (token "sunday")
```

- A **thin proxy** in Agenda's backend: checks Agenda's session, adds the key, streams the response body
  unchanged. No CORS needed (server to server). Don't proxy anything except the endpoints in §4.
- Agenda never talks to Sunday's database, and Sunday never talks to Agenda's database: only HTTP APIs.

## 4. Endpoints

**Chat (streaming)**: `POST /api/chat/completions` (OpenAI-compatible):

```json
{
  "model": "sunday",
  "stream": true,
  "messages": [{"role": "user", "content": "¿Qué tengo mañana?"}],
  "tool_ids": ["server:0"],
  "features": {"memory": true, "web_search": false}
}
```

- Verified from the sunday side (non-streaming, with an API key): `tool_ids: ["server:0"]` makes the model call
  Agenda (`getNow`, `getAgendaOverview`, …) and answer in Spanish. Send `tool_ids` explicitly; don't rely on the
  model's defaults over the API.
- Response: SSE `data: {...}` chunks with `choices[0].delta.content`, ending in `data: [DONE]`.
- **Gotcha: the content contains HTML blocks.** The Anthropic pipe writes tool activity into the text as
  `<details type="tool_calls" … name="getAgendaOverview" arguments="…" result="…">…</details>` (and similar for
  tool search / web search). Strip every `<details …>…</details>` before showing text or sending it to TTS; you can
  use them to show small "consultando agenda…" chips.
- Preamble lines before tool calls ("Reviso la agenda.") were fixed on the sunday side (calendar filter + prompt).
  If one ever shows up, Agenda may drop text that comes before a `<details` block.
- `features.memory` **(verify)**: in the web UI memory is a per-user setting; check whether the API needs the flag.
- `features.web_search` **(verify)**: the pipe's web search toggle is a filter (`anthropic_web_search_toggle`).
  Check how to switch it on from the API.
- **Conversation history:** `messages` is the full history you send, so Agenda keeps the conversation.
  - MVP: keep it client-side or in Agenda's DB.
  - Later (optional) **(verify)**: persist into Open WebUI chats (`POST /api/v1/chats/new`, then completions with
    `chat_id`) so the conversation also shows on sunday.lemydev.com.

**Speech to text**: `POST /api/v1/audio/transcriptions`, `multipart/form-data` with `file` (webm/opus, wav or
mp3), returns `{"text": "…"}`. Used successfully from the sunday side.

**Text to speech**: `POST /api/v1/audio/speech`, JSON `{"input": "texto", "voice": "es-AR-ElenaNeural"}`, returns
`audio/mpeg`. Open WebUI uses its configured engine (Azure). Used successfully from the sunday side.

**Models** (optional, for a selector): `GET /api/models`. Show only `sunday`, `sunday-pro`, `sunday-max`.

## 5. Voice loop (the core of the screen)

1. `getUserMedia({audio: {echoCancellation: true, noiseSuppression: true, autoGainControl: true}})`.
2. VAD in the browser (e.g. `@ricky0123/vad-web`, Silero) to detect start and end of speech.
3. End of speech: send the clip to STT, take the text, start a chat stream.
4. As text streams in: strip `<details>`, split into sentences, send each sentence to TTS, and play them in a queue.
   The first audio comes out after the first sentence, not after the whole answer.
5. **Barge-in:** if the VAD detects speech while Sunday is talking, stop playback, clear the queue, abort the
   stream (`AbortController`) and start a new turn.
6. Voice style is already in the persona (short, no markdown, no URLs read aloud). Still, never send URLs or
   markdown symbols to TTS.
7. Deep link **`/sunday?call=1`**: opens directly in voice mode, listening. The wake word (APK and the Windows
   listener) uses it.

States for the UI and the orb: `idle`, `listening`, `thinking` (waiting for first token or running tools),
`speaking`.

## 6. The orb

- Web Audio: an `AnalyserNode` on the mic stream (listening) and another on the TTS playback (speaking). Feed RMS and
  frequency bands to the animation.
- Canvas 2D or WebGL (three.js, regl or plain shaders): a particle "galaxy" whose rotation and brightness follow the
  level. Colour or motion changes per state.
- Respect `prefers-reduced-motion`. Keep it at 60 fps on a mid-range phone and pause it when the tab is hidden.

## 7. Android app + "Hey Sunday" (after the screen works)

**Recommended: a TWA (Trusted Web Activity) built with Bubblewrap**, not Capacitor:
- The app is Agenda's PWA running in Chrome, so **Web Push keeps working as it is**.
  Capacitor/WebView can't receive Web Push and would need FCM on Agenda's backend.
- Needs `https://agenda.lemydev.com/.well-known/assetlinks.json` with the app's signing fingerprint.
- Installed by hand (sideloaded APK). Check Google's 2027 developer-verification rules for sideloading when you
  get there.

**Wake word**: a native part inside the same APK:
- A Kotlin **foreground service** (`foregroundServiceType="microphone"`, permanent notification "Sunday escuchando")
  reads the mic at 16 kHz and runs the detector.
- Engine, two options:
  - (a) The **same `hey_sunday.onnx`** trained in the sunday repo (`listener/models/`, livekit-wakeword 2.1.2) with
    ONNX Runtime Android. livekit-wakeword's feature pipeline (melspectrogram + embedding models in front of the
    classifier) has to be ported.
  - (b) **Picovoice Porcupine** (Android SDK, custom keyword from their console, free personal tier): less work.
- On detection: release the mic, then launch the TWA at `https://agenda.lemydev.com/sunday?call=1`. The page grabs
  the mic once the service has released it. Resume listening when the screen closes.
- Known constraints:
  - Android 14+ doesn't let a microphone foreground service start from the background or at boot. Lemy opens the
    app once after a reboot (or taps a quick-settings tile).
  - Battery: keep the detector light (one inference per 80 ms frame).
  - **(verify)** autoplay of TTS audio in the TWA when opened from the service: if Chrome blocks it, start with a
    tap ("Toca para hablar") as a fallback.
- Wait until the Windows listener (sunday repo, Phase 6) has shown the model works with Lemy's accent before
  investing in (a).

## 8. Checklist

- [ ] `SUNDAY_API_KEY` stored only in Agenda's Coolify env; proxy `/api/sunday/*` behind Agenda's session.
- [ ] Text chat on `/sunday` streams, shows tool chips, never shows raw `<details>`.
- [ ] "¿Qué tengo mañana?" on `/sunday` returns real Agenda data (tools through `server:0`).
- [ ] Voice: speak, hear Elena; first audio ≤ ~2 s after the end of speech for a simple question.
- [ ] Barge-in stops Sunday within ~0.5 s and answers the new question.
- [ ] `/sunday?call=1` starts listening directly.
- [ ] Orb reacts to mic and to TTS, with the 4 states.
- [ ] Final endpoint list sent to the sunday side for API key restrictions.
- [ ] (Phase 2) TWA APK installed; push still arrives; "Hey Sunday" with the screen off opens `/sunday?call=1`.
