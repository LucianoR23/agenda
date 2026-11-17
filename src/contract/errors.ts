import type { ErrorBodyT, ErrorCodeT } from "./common";

/** Default message per code (Spanish, for the UI and for an LLM caller). Handlers may pass a more specific one. */
export const DEFAULT_MESSAGES: Record<ErrorCodeT, string> = {
  VALIDATION_ERROR: "Hay datos inválidos en el pedido. Revisá `details.fields`.",
  UNSUPPORTED_MEDIA_TYPE: "El cuerpo tiene que ser JSON (Content-Type: application/json).",
  UNAUTHORIZED: "Hace falta iniciar sesión o un token válido.",
  DEVICE_LOCKED: "El dispositivo está bloqueado: desbloquealo con tu PIN o tu huella.",
  REAUTH_REQUIRED: "Confirmá tu PIN o tu huella para seguir (vale 5 minutos).",
  FORBIDDEN: "No tenés permiso para hacer esto.",
  ORIGIN_NOT_ALLOWED: "Pedido rechazado: el origen no es la app.",
  INSUFFICIENT_SCOPE: "El token no tiene el permiso necesario para esta operación.",
  NOT_FOUND: "No encontré lo que buscabas.",
  SETUP_REQUIRED: "La app todavía no está configurada.",
  SETUP_COMPLETED: "La app ya está configurada.",
  METHOD_NOT_ALLOWED: "Ese método no está permitido en esta ruta.",
  VERSION_CONFLICT: "Cambió en el servidor mientras lo editabas. `details.current` tiene la versión actual.",
  CONFLICT: "Ya existe algo igual.",
  READ_ONLY_EVENT: "Ese evento viene de Google Calendar (o iCal) y es de solo lectura: cambialo en Google Calendar.",
  IDEMPOTENCY_KEY_REUSE: "Esa Idempotency-Key ya se usó con otro pedido.",
  IDEMPOTENCY_IN_PROGRESS: "Un pedido con esa Idempotency-Key todavía se está procesando.",
  RATE_LIMITED: "Demasiados pedidos. Esperá `details.retryAfterSeconds` segundos.",
  LOCKED_OUT: "Demasiados intentos fallidos. Esperá `details.retryAfterSeconds` segundos.",
  INVALID_CREDENTIALS: "Credenciales incorrectas.",
  INTERNAL_ERROR: "Error inesperado del servidor.",
  SERVICE_UNAVAILABLE: "El servicio no está disponible en este momento.",
};

/** Builds an error body. Used by the API at runtime and by the contract examples. */
export function errorBody(
  code: ErrorCodeT,
  message?: string,
  details?: Record<string, unknown>,
  requestId = "req_01JA9X7Q2M8K",
): ErrorBodyT {
  return { error: { code, message: message ?? DEFAULT_MESSAGES[code], ...(details ? { details } : {}), requestId } };
}
