# Runbook — Google Calendar (OAuth, read-only)

One login with the **work** Google account sees both calendars (the personal one is shared into it with full
details). Agenda reads with scope `calendar.readonly`; with `calendar.app.created` it can also create its own calendar
"Agenda" and copy your events there (it can't touch any other calendar). Plan B, if the Workspace admin blocks third-party apps, is the
secret iCal address of each calendar (section 5): nothing to set up in Google Cloud for that.

## 1. Google Cloud project

1. Open <https://console.cloud.google.com/> signed in with the work account.
2. Project picker → **New project** → name `agenda`. Location: the Workspace organization if it lets you (then the
   consent screen can be *Internal*); otherwise "No organization".
3. **APIs & Services → Library** → search "Google Calendar API" → **Enable**.

## 2. Consent screen

**APIs & Services → OAuth consent screen** (Google Auth Platform → Branding / Audience / Data access):

| Setting | Value |
|---|---|
| App name | `Agenda` |
| User support / developer email | your address |
| Audience | **Internal** if the project is under the Workspace org (no verification, tokens don't expire). Otherwise **External** and then **Publish app → In production** (unverified is fine for one user: you'll see a "Google hasn't verified this app" warning → Advanced → Go to Agenda). **Never leave it in *Testing***: refresh tokens die after 7 days there. |
| Data access → scopes | `https://www.googleapis.com/auth/calendar.readonly` and `https://www.googleapis.com/auth/calendar.app.created` (Add or remove scopes → paste each one) |
| Branding → app home page | `https://agenda.lemydev.com` |
| Branding → privacy policy | `https://agenda.lemydev.com/privacidad` (required to publish an *External* app; public page, `src/app/privacidad`) |
| Branding → logo, terms of service | leave empty: uploading a logo forces Google's verification |
| Authorized domains | `lemydev.com` |

## 3. OAuth client

**APIs & Services → Credentials → Create credentials → OAuth client ID**:

- Application type: **Web application**, name `agenda`.
- Authorized redirect URIs:
  - `https://agenda.lemydev.com/api/google/callback`
  - `http://localhost:3000/api/google/callback` (development)
- No JavaScript origins needed.

Copy the **Client ID** and **Client secret**.

## 4. Server

Coolify → agenda → Environment Variables (mark the secret ones as **secret**):

| Variable | Value |
|---|---|
| `GOOGLE_CLIENT_ID` | the client ID (`….apps.googleusercontent.com`) |
| `GOOGLE_CLIENT_SECRET` | the client secret |
| `ENCRYPTION_KEY` | `openssl rand -base64 32` — encrypts the refresh token and iCal addresses. **Changing it later breaks both** (reconnect Google, add the iCal addresses again). |

For local development put the same three in `.env` (the localhost redirect URI is already registered).

Redeploy. Then in the app: **Ajustes → Google Calendar → Conectar con Google** → pick the work account → allow.
You land back on the same screen with "Google Calendar conectado" and the list of calendars: the ones Google shows in
its own sidebar start enabled. For each calendar you can hide it or turn on "Avisarme antes" (off by default: Google
Calendar already notifies on the phone; turn it on only where you want Agenda's notification with Listo/Posponer).

### If it fails

The screen shows why (`?google=…` after the round trip):

- `admin_policy_enforced` / `access_denied` by policy: the Workspace admin blocks the app → use section 5.
- `invalid_grant` later on (password change, revoked access, an *External* app left in *Testing*): Agenda pushes
  "Google Calendar desconectado" once and shows **Volver a conectar**. The events already synced stay visible.

## 5. Plan B: iCal address

For each calendar: Google Calendar (web) → ⚙ Settings → the calendar under "Settings for my calendars" →
**Integrate calendar → Secret address in iCal format** → copy. In Agenda: **Ajustes → Google Calendar → Dirección
iCal** → name + address → **Agregar calendario**. The address is checked (https only, public hosts only), stored
encrypted and never shown again. Refreshed every 15 minutes. If you reset the secret address in Google, remove the
calendar in Agenda and add the new address.

## 6. Disconnect

**Ajustes → Google Calendar → Desconectar**: the grant is revoked at Google and the credential, the Google calendars,
their events and the reminders attached to them are deleted. Also possible from Google's side:
<https://myaccount.google.com/permissions>.

## 7. Copy Agenda's events to Google

1. Google Cloud Console → **Data access** (OAuth consent screen) → **Add or remove scopes** → add
   `https://www.googleapis.com/auth/calendar.app.created` (manually, under "Manually add scopes") → **Update** → **Save**.
2. In Agenda: **Ajustes → Google Calendar**. If it says "Falta un permiso", tap **Volver a conectar** and accept the
   new permission (Google shows "ver, editar … los calendarios que esta app cree" or similar).
3. Turn on **Copiar mis eventos a Google**. Within a minute a calendar **"Agenda"** appears in your Google Calendar with
   your events from the last week on (recurring ones complete), without Google notifications (Agenda notifies).
4. Edit them in Agenda (or through Sunday): a change made in Google is overwritten by the next change in Agenda.

Turning it off or disconnecting leaves the "Agenda" calendar in Google; delete it there if you no longer want it.
