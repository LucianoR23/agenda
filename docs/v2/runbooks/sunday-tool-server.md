# Runbook — Sunday's tool server (Open WebUI)

Sunday (Open WebUI at `https://sunday.lemydev.com`) uses agenda through an **OpenAPI tool server**: Open WebUI reads
`/api/openapi.sunday.json` and turns each operation into a tool. Do this after the deploy (`deploy.md`), once
`https://agenda.lemydev.com/api/health` answers `ok`.

## 1. The token

1. In the app: **Ajustes → Tokens de API → Nuevo token** (it asks for the PIN or fingerprint).
2. Name `sunday`, scopes **read, write, notify**, no expiry.
3. Copy the `agd_…` secret: it's shown once. Don't paste it anywhere but Open WebUI's form.

To rotate it: create a new one with another name, swap it in Open WebUI, then revoke the old one.

## 2. Check the spec and the token

```sh
curl -s https://agenda.lemydev.com/api/openapi.sunday.json | head -c 200        # public: the tools
curl -s -H "Authorization: Bearer $AGENDA_TOKEN" https://agenda.lemydev.com/api/now   # 200 with today's date
```

(`AGENDA_TOKEN` set in that shell only; don't save it in history or files.)

## 3. Register it in Open WebUI

Use a **global** tool server (configured by the admin; Open WebUI's backend calls agenda server-side). Menu names move
between Open WebUI versions: look under **Admin Panel → Settings → External Tools** (older versions: **Settings →
Tools → Tool Servers**).

| Field | Value |
|---|---|
| URL | `https://agenda.lemydev.com` |
| OpenAPI spec path | `api/openapi.sunday.json` |
| Auth | Bearer, key = the `agd_…` token |
| Name / description | `Agenda` — "Tareas, recordatorios, eventos, hábitos y sueño de Lemy" |

Save, then check that the tools list shows names like `getNow`, `createTask`, `getAgendaOverview`.

A **user-level** tool server (in the user's own settings) also works: then the browser calls agenda directly, which
is what CORS (`CORS_ALLOWED_ORIGINS=https://sunday.lemydev.com`) is for.

For the Sunday side (prompts, automations, what each tool does), hand [`../sunday-integration.md`](../sunday-integration.md)
to the sunday repo.

## 4. Smoke test (from a Sunday chat)

1. "¿Qué día es hoy?" → `getNow`.
2. "Anotá llamar al contador mañana a las 9 y recordámelo 15 minutos antes" → `createTask` with `reminderAt`; the
   task shows up in Hoy/Tareas with source Sunday.
3. "¿Qué tengo mañana?" → `getAgendaOverview`.
4. "Mandame una notificación de prueba" → `sendPushNotification`; it arrives on the subscribed phone.

## Limits worth knowing

- 60 requests a minute and 1,000 a day per token (429 with `Retry-After`); 20 pushes per 24 h from `/api/notify`.
- Google Calendar events are read-only through Sunday too (it can only add a "Recordarme").
- Everything Sunday creates is stored with `source = sunday` (Métricas shows the split).
