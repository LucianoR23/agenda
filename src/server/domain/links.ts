import { env } from "../env";

/** Links into the app for API responses (Sunday reads them back as "abrilo acá"). */
const origin = () => new URL(env().APP_ORIGIN).origin;

export const taskUrl = (id: string) => `${origin()}/tareas?task=${id}`;
export const reminderUrl = (id: string) => `${origin()}/recordatorios?reminder=${id}`;
export const eventUrl = (id: string) => `${origin()}/calendario?event=${id}`;
