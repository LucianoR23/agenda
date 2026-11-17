import { errorBody } from "../errors";
import type { RouteDef } from "../route-def";
import { NotifyInput, NotifyResult, Now } from "../sunday";

export const sundayRoutes: RouteDef[] = [
  {
    operationId: "getNow",
    method: "get",
    path: "/api/now",
    tag: "Assistant",
    summary: "Current date, time and weekday of the user",
    description:
      "The user's clock (America/Buenos_Aires). Call it first whenever you need to resolve a relative date (hoy, mañana, el viernes, la semana que viene) and aren't sure what day it is. Also returns this week's Monday–Sunday.",
    access: "user",
    token: "read",
    responses: { 200: { description: "Now.", schema: Now } },
    exchanges: [
      {
        name: "now",
        summary: "Thursday morning",
        actor: "user",
        status: 200,
        response: {
          now: "2026-11-19T09:12:30.000-03:00",
          date: "2026-11-19",
          time: "09:12",
          weekday: "jueves",
          whenText: "jueves 19 de noviembre, 09:12",
          timezone: "America/Buenos_Aires",
          utcOffset: "-03:00",
          tomorrow: "2026-11-20",
          weekStart: "2026-11-16",
          weekEnd: "2026-11-22",
        },
      },
    ],
  },
  {
    operationId: "sendPushNotification",
    method: "post",
    path: "/api/notify",
    tag: "Assistant",
    summary: "Send a push notification to Lemy's devices now",
    description:
      'For messages that must reach Lemy right away (an automation\'s result, "ya terminé"). For something at a later time use createReminder instead. Title ≤ 60 and body ≤ 240 characters. At most 20 per 24 hours.',
    access: "user",
    token: "notify",
    body: NotifyInput,
    responses: {
      200: { description: "Sent (or no device available: see `delivered`).", schema: NotifyResult },
      429: { description: "`RATE_LIMITED`: 20 pushes in the last 24 hours.", headers: ["Retry-After"] },
    },
    exchanges: [
      {
        name: "notify",
        summary: "Evening summary",
        actor: "user",
        body: { title: "Resumen del día", body: "Hiciste 6 de 8 tareas y marcaste Gym. Mañana: dentista 10:00.", tag: "resumen-noche" },
        status: 200,
        response: { delivered: 2, failed: 0, remainingToday: 19 },
      },
      {
        name: "badUrl",
        summary: "Link outside the allowed sites",
        actor: "user",
        body: { title: "Mirá esto", body: "Un link", url: "https://example.com" },
        status: 400,
        response: errorBody(
          "VALIDATION_ERROR",
          "El link tiene que ser https en sunday.lemydev.com o agenda.lemydev.com, o una ruta de la app como /tareas.",
          { fields: [{ path: "/url", message: "Host not allowed" }] },
        ),
      },
    ],
  },
];
