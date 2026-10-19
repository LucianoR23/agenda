"use client";

import { api } from "@/client/api";

/** Registers /sw.js (production builds only, so dev hot reload is never served from a cache). */
export function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return;
  navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
}

const b64ToBytes = (b64: string) => {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

export const pushSupported = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

/** Asks permission, subscribes and registers the subscription with the server. */
export async function enablePush(vapidPublicKey: string, prefs: { callReminders: boolean; sleepReminders: boolean }) {
  if (!pushSupported()) throw new Error("Este navegador no soporta notificaciones push.");
  if ((await Notification.requestPermission()) !== "granted") throw new Error("Permiso de notificaciones denegado.");
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(vapidPublicKey) }));
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  await api("POST", "/api/push/subscribe", { endpoint: json.endpoint, keys: json.keys, ...prefs });
}

export async function disablePush() {
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await api("DELETE", "/api/push/subscribe", { endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe();
}

export async function currentPushEndpoint(): Promise<string | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription())?.endpoint ?? null;
}

// ---------- install prompt (Android) ----------

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
let deferred: InstallEvent | null = null;
const installListeners = new Set<() => void>();
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallEvent;
    installListeners.forEach((l) => l());
  });
}
export const canInstall = () => deferred !== null;
export const onInstallable = (l: () => void) => {
  installListeners.add(l);
  return () => void installListeners.delete(l);
};
export async function promptInstall() {
  if (!deferred) return;
  await deferred.prompt();
  await deferred.userChoice;
  deferred = null;
}
