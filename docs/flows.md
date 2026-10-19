# Flows

Concrete requests and responses for every step: `docs/api-examples.md`. Contract: `openapi.yaml`.

## Daily flow (Monday 2026-10-19)

```mermaid
sequenceDiagram
    autonumber
    actor Me as Yo (PWA)
    participant GC as Google Calendar
    participant Bot as Agenbot
    participant API as Agenda API
    participant Push as Web Push

    Note over Bot,API: 07:00 — load
    Bot->>GC: read work + personal calendars (read-only)
    Bot->>API: GET /api/agent/context?date=2026-10-19
    API-->>Bot: weekly gym 0/3, habits pending, yesterday 67 %, skipped patterns
    Bot->>API: PUT /api/days/2026-10-19 (Idempotency-Key)<br/>4 calendar events + agent blocks, options A & B, checklist
    API-->>Bot: 201 created · status draft · v1
    API->>Push: "Agenbot cargó tu día"
    Push-->>Me: notification

    Note over Me,API: 07:42 — I choose
    Me->>API: POST /days/2026-10-19/choose {option: A}
    API-->>Me: 200 · status chosen · v2
    API-)Bot: webhook (immediate): choose A

    Note over Me,API: morning — I track
    Me->>API: PATCH /blocks/{martín} {status: done, outcome: follow_up}
    API-->>Me: 200 · day v3 (still chosen) · outbox: collecting, send at +120 s
    Me->>API: PATCH /blocks/{lectura} {start: 11:15}
    API-->>Me: 200 · userOverrides [start, end] · day edited · v4 · debounce restarts
    Note over API: 120 s without new changes
    API-)Bot: webhook batch: 2 changes (Martín done/follow_up, lectura moved)
    Bot-->>API: 200 (else retry: backoff, 5 attempts)

    Note over Me,Bot: 12:20 — Laura asks to move the call
    Me->>GC: move Laura 14:00 → 15:00 (by hand)
    Me->>Bot: "moví a Laura a las 15"
    Bot->>GC: read
    Bot->>API: PUT /api/days/2026-10-19 (Laura 15:00, lectura 14:00, reason)
    API-->>Bot: 202 proposed · day unchanged (v4) · proposal pending
    API->>Push: "Agenbot propone un cambio"
    Push-->>Me: notification

    Note over Me,API: 12:41 — I review the diff
    Me->>API: GET /days/2026-10-19 (pendingProposal.diff)
    API-->>Me: moved: Laura 14:00→15:00 · preservedOverrides: lectura (start, end)
    Me->>API: POST /proposals/{id}/accept
    API-->>Me: 200 · v5 · Laura 15:00 · lectura stays 11:15 · Martín stays done
    API-)Bot: webhook (immediate): proposal accepted

    Note over API: 00:05 — Coolify scheduled task
    API->>API: POST /api/internal/close-day → 2026-10-19 closed
```

Alternatives: on **reject** the day is untouched and the webhook reports `proposal / reject`. If Agenbot sends another PUT
while a proposal is pending, the old one becomes `superseded`. If the cron is missed, the first read of the past day
closes it (lazy close).

## `Day.status`

```mermaid
stateDiagram-v2
    [*] --> draft: agent PUT (first load) → 201
    draft --> draft: agent PUT → replaced (200)<br/>my tracking edits
    draft --> chosen: choose option
    chosen --> chosen: choose another option<br/>tracking edits (done / skipped / outcome / note)<br/>agent PUT → proposal (202)<br/>accept / reject proposal
    chosen --> edited: my first schedule change<br/>(add / move / edit / delete block, shift, reorder)
    edited --> edited: any edit<br/>agent PUT → proposal (202)<br/>accept / reject proposal
    draft --> closed: close-day job · lazy close · PATCH status=closed
    chosen --> closed: close-day job · lazy close · PATCH status=closed
    edited --> closed: close-day job · lazy close · PATCH status=closed
    closed --> closed: my edits (agent → 409 day_closed)
    closed --> [*]
```

| From | Event | Actor | To | Notes |
|---|---|---|---|---|
| — | `PUT /days/{date}` | agent | `draft` | 201 |
| `draft` | `PUT` | agent | `draft` | 200, replaced in place (tracking preserved on matched blocks) |
| `draft` | `POST choose` | user/agent | `chosen` | webhook immediately |
| `chosen` | `POST choose` (other label) | user/agent | `chosen` | not allowed once `edited` (409 `invalid_transition`) |
| `chosen` | schedule change by me | user | `edited` | tracking changes keep `chosen` |
| `chosen`/`edited` | `PUT` | agent | unchanged | 202, proposal; `?mode=force` applies immediately |
| `chosen`/`edited` | accept / reject | user | unchanged | |
| any open | close job (00:05), lazy close, `PATCH status=closed` | system/user | `closed` | `userOverrides` stop mattering |
| `closed` | any write | agent | — | 409 `day_closed` |
| `closed` | edits | user | `closed` | allowed (corrections, review) |

## `Proposal.status`

```mermaid
stateDiagram-v2
    [*] --> pending: agent PUT on chosen/edited day
    pending --> accepted: I accept
    pending --> rejected: I reject
    pending --> superseded: newer agent PUT · day closes
    accepted --> [*]
    rejected --> [*]
    superseded --> [*]
```
