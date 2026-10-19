import { execSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { type Browser, type BrowserContext, type CDPSession, expect, type Page, test } from "@playwright/test";
import { E2E, serverEnv } from "../../playwright.config";

/**
 * Mobile E2E on an Android viewport: drives the real production build and saves a screenshot of every view
 * to docs/screenshots (STOP 4).
 */
const SHOTS = "docs/screenshots";
mkdirSync(SHOTS, { recursive: true });

const art = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const TODAY = art();
const at = (hhmm: string) => new Date(`${TODAY}T${hhmm}:00-03:00`);

const seed = (cmd: string) => execSync(`pnpm exec tsx tests/e2e/seed.ts ${cmd}`, { env: { ...process.env, ...serverEnv }, stdio: "pipe" }).toString();

let ctx: BrowserContext;
let page: Page;
let cdp: CDPSession;
let authenticatorId = "";

/** Moves the app's clock to `hh:mm` today (ART) and reloads. */
async function setTime(hhmm: string, p = page) {
  await p.evaluate((o) => localStorage.setItem("e2e:offset", String(o)), at(hhmm).getTime() - Date.now());
  await p.reload();
}

const shot = async (name: string, p = page) => {
  await p.waitForTimeout(450); // let sheets / toasts finish animating
  await p.screenshot({ path: `${SHOTS}/${name}.png` });
};

async function agentApi(method: string, path: string, body?: unknown) {
  const res = await fetch(`http://localhost:${E2E.port}${path}`, {
    method,
    headers: { authorization: `Bearer ${E2E.agentToken}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function typePin(p: Page, pin: string) {
  for (const d of pin) await p.getByRole("button", { name: d, exact: true }).click();
}

/** Horizontal drag on a block (pointer events, like a finger). */
async function swipe(p: Page, testId: string, dx: number) {
  await p.getByTestId(testId).scrollIntoViewIfNeeded();
  await p.waitForTimeout(150);
  const box = (await p.getByTestId(testId).boundingBox())!;
  const y = box.y + 30;
  const x = box.x + box.width / 2;
  await p.mouse.move(x, y);
  await p.mouse.down();
  for (let i = 1; i <= 12; i++) await p.mouse.move(x + (dx * i) / 12, y);
  await p.mouse.up();
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  ctx = await browser.newContext(test.info().project.use);
  page = await ctx.newPage();
  cdp = await ctx.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  ({ authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  }));
  // app time = real time + an offset, applied only to Date (Playwright's clock also fakes requestAnimationFrame,
  // which stalls motion's exit animations)
  await ctx.addInitScript(() => {
    const off = Number(localStorage.getItem("e2e:offset") ?? 0);
    if (!off) return;
    const Real = Date;
    class Shifted extends Real {
      constructor(...args: unknown[]) {
        if (args.length) super(...(args as [number]));
        else super(Real.now() + off);
      }
      static now() {
        return Real.now() + off;
      }
    }
    globalThis.Date = Shifted as DateConstructor;
  });
});

test.afterAll(async () => {
  await ctx?.close();
});

test("first-run setup: code, PIN, recovery codes", async () => {
  await page.goto("/");
  await expect(page.getByText("Configurar Agenda")).toBeVisible();
  await shot("01-setup");
  await page.getByPlaceholder("Código de configuración").fill(E2E.setupCode);
  await page.getByRole("button", { name: "Continuar" }).click();
  await typePin(page, E2E.pin);
  await expect(page.getByText("Repetí el PIN")).toBeVisible();
  await shot("02-setup-pin");
  await typePin(page, E2E.pin);
  await expect(page.getByTestId("recovery-codes").locator("li")).toHaveCount(10);
  await shot("03-recovery-codes");
  await page.getByRole("button", { name: "Ya los guardé" }).click();
  await expect(page.getByText("Agenbot todavía no cargó tu día")).toBeVisible();
  await shot("04-hoy-empty");
});

test("07:00 load → draft: swipe between options, choose A", async () => {
  seed("history");
  seed("today");
  await setTime("07:05");
  await expect(page.getByTestId("options")).toBeVisible();
  await shot("05-hoy-draft-option-a");
  await page.getByTestId("options").evaluate((el) => el.scrollTo({ left: el.scrollWidth, behavior: "instant" }));
  await expect(page.getByText("OPCIÓN B")).toBeVisible();
  await page.waitForTimeout(300);
  await shot("06-hoy-draft-option-b");
  await page.getByTestId("options").evaluate((el) => el.scrollTo({ left: 0, behavior: "instant" }));
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "Elegir esta" }).click();
  await expect(page.getByText("Opción A · Gym al mediodía")).toBeVisible();
});

test("timeline at 15:12: now line, calls, swipe done with undo toast", async () => {
  await setTime("15:12");
  await expect(page.getByLabel(/^Ahora, 15:12/)).toBeVisible();
  await shot("07-hoy-timeline");
  const gym = page.getByTestId("timeline").locator('[data-testid^="block-"]', { hasText: "Gym — tren superior" });
  await swipe(page, (await gym.getAttribute("data-testid"))!, 220);
  await expect(page.getByText("Gym — tren superior marcado como hecho")).toBeVisible();
  await shot("08-swipe-done-toast");
  const dogs = page.getByTestId("timeline").locator('[data-testid^="block-"]', { hasText: "Paseo con las perras" });
  await swipe(page, (await dogs.getAttribute("data-testid"))!, -220);
  await expect(page.getByText("Paseo con las perras marcado como salteado")).toBeVisible();
});

test("call block: calendar editor (tracking only) with outcome picker", async () => {
  await page.getByText("Martín Gómez").first().click();
  await expect(page.getByTestId("block-editor")).toBeVisible();
  await expect(page.getByRole("link", { name: "Editar en Google Calendar" })).toBeVisible();
  await shot("09-editor-calendar-call");
  await page.getByRole("button", { name: /Resultado/ }).click();
  await page.getByRole("button", { name: "Seguimiento" }).click();
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("Seguimiento").first()).toBeVisible();
});

test("agent block editor, add block, Me atrasé", async () => {
  await page.getByText("Lectura (30 min)").first().click();
  await expect(page.getByLabel("Inicio")).toBeVisible();
  await shot("10-editor-agent-block");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Agregar bloque" }).click();
  await page.getByLabel("Título").fill("Pagar alquiler del local");
  await page.getByLabel("Inicio").fill("17:30");
  await page.getByLabel("Fin").fill("17:45");
  await shot("11-new-block");
  await page.getByRole("button", { name: "Agregar bloque" }).last().click();
  await expect(page.getByText("Pagar alquiler del local")).toBeVisible();
  await page.getByRole("button", { name: "Me atrasé" }).click();
  await expect(page.getByText("Desde las")).toBeVisible();
  await shot("12-me-atrase");
  await page.keyboard.press("Escape");
});

test("Agenbot re-plan → proposal banner → diff → accept", async () => {
  const r = await agentApi("PUT", `/api/days/${TODAY}`, JSON.parse(readFileSync("scripts/fixtures/agenbot-replan.json", "utf8")));
  expect(r.status).toBe(202);
  await page.reload();
  await expect(page.getByText(/Agenbot propone/)).toBeVisible();
  await shot("13-proposal-banner");
  await page.getByRole("button", { name: "Ver", exact: true }).click();
  await expect(page.getByRole("button", { name: "Aceptar" })).toBeVisible();
  await shot("14-proposal-diff");
  await page.getByRole("button", { name: "Aceptar" }).click();
  await expect(page.getByText("Cambios aplicados")).toBeVisible();
});

test("Tareas y hábitos, Historial, Métricas", async () => {
  await page.getByRole("link", { name: "Tareas" }).click();
  await expect(page.getByText("Confirmar por WhatsApp a Martín (10:00)")).toBeVisible();
  await page.getByText("Confirmar por WhatsApp a Martín (10:00)").click();
  await shot("17-tareas-habitos");
  await page.getByRole("link", { name: "Historial" }).click();
  await expect(page.getByTestId("heatmap")).toBeVisible();
  await page.waitForTimeout(600);
  await shot("18-historial");
  const past = await page.getByTestId("heatmap").getByRole("button", { name: /hecho/ }).first();
  await past.click();
  await expect(page.getByTestId("day-detail")).toBeVisible();
  await shot("19-historial-dia");
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "Métricas" }).click();
  await expect(page.getByText("Bloques hechos")).toBeVisible();
  await shot("20-metricas-semana");
  await page.getByRole("radio", { name: "Mes" }).click();
  await expect(page.getByText("Llamadas cerradas")).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/21-metricas-mes.png`, fullPage: true });
});

test("Ajustes, Hábitos, Seguridad with fingerprint", async () => {
  await page.getByRole("link", { name: "Ajustes" }).click();
  await expect(page.getByText("Carga diaria a las 07:00")).toBeVisible();
  await shot("22-ajustes");
  await page.getByRole("link", { name: /Hábitos y metas/ }).click();
  await expect(page.getByRole("button", { name: /Gym/ })).toBeVisible();
  await shot("23-ajustes-habitos");
  await page.getByRole("button", { name: /Gym/ }).click();
  await shot("24-ajustes-habito-editar");
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "Volver" }).click();
  await page.getByRole("link", { name: /Seguridad/ }).click();
  await page.getByRole("switch", { name: "Desbloquear con huella" }).click();
  await expect(page.getByText("Huella activada en este dispositivo")).toBeVisible();
  await expect(page.getByRole("switch", { name: "Desbloquear con huella" })).toHaveAttribute("aria-checked", "true");
  await shot("25-seguridad-dispositivos");
});

test("offline: queued change, offline banner, then sync", async () => {
  await page.getByRole("link", { name: "Hoy" }).click();
  await expect(page.getByTestId("timeline")).toBeVisible();
  await ctx.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  const lunch = page.getByTestId("timeline").locator('[data-testid^="block-"]', { hasText: "Almuerzo" });
  await swipe(page, (await lunch.getAttribute("data-testid"))!, 220);
  await expect(page.getByText(/Sin conexión\. Guardamos tus cambios/)).toBeVisible();
  await shot("26-offline");
  await ctx.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByText(/Sin conexión\. Guardamos/)).toBeHidden({ timeout: 15_000 });
});

test("conflict: my offline edit vs a newer server version → conflict sheet", async () => {
  const day = (await agentApi("GET", `/api/days/${TODAY}`)).body;
  const reading = day.options.find((o: { id: string }) => o.id === day.chosenOptionId).blocks.find((b: { type: string }) => b.type === "reading");
  await ctx.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await page.getByText(reading.title).first().click();
  await page.getByLabel("Título").fill("Lectura en el parque");
  await page.getByRole("button", { name: "Guardar" }).click();
  seed(`agent-title ${reading.id}`); // the server moves on meanwhile
  await ctx.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByText("Tu versión y la del servidor no coinciden")).toBeVisible({ timeout: 20_000 });
  await shot("27-conflict");
  await page.getByRole("button", { name: "Mantener el mío" }).click();
  await expect(page.getByText("Lectura en el parque").first()).toBeVisible({ timeout: 15_000 });
});

test("light theme", async () => {
  await page.getByRole("link", { name: "Ajustes" }).click();
  await page.getByRole("radio", { name: "Claro" }).click();
  await page.getByRole("link", { name: "Hoy" }).click();
  await expect(page.getByTestId("timeline")).toBeVisible();
  await shot("28-hoy-claro");
  await page.getByRole("link", { name: "Ajustes" }).click();
  await page.getByRole("radio", { name: "Sistema" }).click();
});

// the night comes last: the remaining tests don't depend on the time
test("22:30: cierre del día + sleep card", async () => {
  await page.goto("/");
  await setTime("22:30");
  await expect(page.getByText("Cierre del día")).toBeVisible();
  await page.getByText("Cierre del día").scrollIntoViewIfNeeded();
  await shot("15-cierre-del-dia");
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.getByRole("button", { name: "Me voy a dormir" })).toBeVisible();
  await shot("16-sleep-night");
});

test("locked after 7 days: fingerprint unlock", async () => {
  seed("lock-device");
  // the automatic fingerprint prompt fails first (finger not verified) so the locked screen can be captured
  await cdp.send("WebAuthn.setUserVerified", { authenticatorId, isUserVerified: false });
  await page.goto("/ajustes");
  await expect(page.getByRole("button", { name: "Desbloquear con huella" })).toBeVisible();
  await page.waitForTimeout(800);
  await shot("29-unlock-fingerprint");
  await cdp.send("WebAuthn.setUserVerified", { authenticatorId, isUserVerified: true });
  await page.getByRole("button", { name: "Desbloquear con huella" }).click();
  await expect(page.getByText("Carga diaria a las 07:00")).toBeVisible({ timeout: 15_000 });
});

test("new device: PIN, wrong PIN, recovery screen", async ({ browser }) => {
  const other = await browser.newContext(test.info().project.use);
  const p = await other.newPage();
  await p.goto("/");
  await expect(p.getByText("Dispositivo nuevo")).toBeVisible();
  await typePin(p, "111111");
  await expect(p.getByText(/Incorrecto\. Te quedan 4 intentos/)).toBeVisible();
  await shot("30-unlock-pin-error", p);
  await p.getByRole("button", { name: "Usar código de recuperación" }).click();
  await shot("31-recover", p);
  await p.getByRole("button", { name: "Volver" }).click();
  await typePin(p, E2E.pin);
  await expect(p.getByRole("link", { name: "Hoy" })).toBeVisible();
  await other.close();
});

test("desktop: sidebar with every section", async ({ browser }) => {
  const desk = await browser.newContext({ viewport: { width: 1280, height: 860 }, colorScheme: "dark", timezoneId: "America/Buenos_Aires", locale: "es-AR" });
  const p = await desk.newPage();
  await p.goto("/");
  await typePin(p, E2E.pin);
  await expect(p.getByTestId("timeline")).toBeVisible();
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${SHOTS}/32-desktop.png` });
  await desk.close();
});
