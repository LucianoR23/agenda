import { expect, type Page, test } from "@playwright/test";
import { E2E } from "../../playwright.config";

const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/screens/${name}.png`, fullPage: true });

async function typePin(page: Page, pin: string) {
  for (const d of pin) await page.keyboard.press(d);
}

test("setup → PIN → quick add → complete → undo", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Código de configuración").fill(E2E.setupCode);
  await page.getByRole("button", { name: "Continuar" }).click();
  await typePin(page, E2E.pin); // choose
  await typePin(page, E2E.pin); // confirm
  await expect(page.getByRole("heading", { name: "Códigos de recuperación" })).toBeVisible();
  await shot(page, "01-recovery-codes");
  await page.getByRole("button", { name: /ya los guardé|continuar|listo/i }).click();

  // Hoy, empty
  await expect(page.getByRole("heading", { name: "Hoy" })).toBeVisible();
  await expect(page.getByText("Nada para hoy")).toBeVisible();
  await shot(page, "02-hoy-empty");

  // quick add with date words, a time, a priority and a tag
  await page.getByRole("button", { name: "Nueva tarea" }).click();
  await page.getByRole("textbox", { name: "Tarea", exact: true }).fill("hoy 18 llamar al contador !alta +trabajo");
  await expect(page.getByRole("button", { name: /18:00/ })).toBeVisible();
  await shot(page, "03-quick-add");
  await page.getByRole("button", { name: "Agregar", exact: true }).click();
  await expect(page.getByText("llamar al contador")).toBeVisible();

  // a task without a date goes to the Inbox
  await page.getByRole("button", { name: "Nueva tarea" }).click();
  await page.getByRole("textbox", { name: "Tarea", exact: true }).fill("comprar regalo para Ana");
  await page.getByRole("button", { name: "Agregar", exact: true }).click();
  await shot(page, "04-hoy-with-task");

  // complete, then undo from the toast
  await page.getByRole("button", { name: 'Completar "llamar al contador"' }).click();
  await expect(page.getByText(/"llamar al contador" hecha/)).toBeVisible();
  await expect(page.getByText("Nada para hoy")).toBeVisible();
  await page.getByRole("button", { name: "Deshacer" }).click();
  await expect(page.getByRole("button", { name: 'Completar "llamar al contador"' })).toBeVisible();

  // the change reached the server
  await page.reload();
  await expect(page.getByText("llamar al contador")).toBeVisible();

  // Inbox
  await page.getByRole("link", { name: /Inbox/ }).first().click();
  await expect(page.getByText("comprar regalo para Ana")).toBeVisible();
  await shot(page, "05-inbox");

  // editor
  await page.getByText("comprar regalo para Ana").click();
  await expect(page.getByLabel("Título")).toHaveValue("comprar regalo para Ana");
  await shot(page, "06-editor");
});

test("reminders: quick add in reminder mode, Recordatorios, Hoy, Más", async ({ page }) => {
  await page.goto("/");
  // a fresh browser context: the user exists (first test), so this is a new device that unlocks with the PIN
  await expect(page.getByRole("heading", { name: "Ingresá tu PIN" })).toBeVisible();
  await typePin(page, E2E.pin);
  await expect(page.getByRole("heading", { name: "Hoy" })).toBeVisible();

  await page
    .getByRole("link", { name: /Recordatorios/ })
    .first()
    .click();
  await expect(page.getByRole("heading", { name: "Recordatorios" })).toBeVisible();
  await page.getByRole("button", { name: "Nuevo recordatorio" }).click();
  const input = page.getByRole("textbox", { name: "Tarea", exact: true });
  await input.fill("tomar agua");
  await expect(page.getByText(/Falta la hora/)).toBeVisible();
  // an hour from now, still today if possible (Buenos Aires time, like the browser context)
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: "America/Buenos_Aires" }).format(new Date()),
  );
  const today = hour < 23;
  await input.fill(today ? `hoy ${hour + 1}:00 tomar agua` : "mañana 10 tomar agua");
  await shot(page, "07-quick-add-reminder");
  await page.getByRole("button", { name: "Agregar", exact: true }).click();
  await expect(page.getByText("tomar agua")).toBeVisible();
  await shot(page, "08-recordatorios");

  if (today) {
    await page.getByRole("link", { name: /Hoy/ }).first().click();
    await expect(page.getByRole("region", { name: "Recordatorios de hoy" }).getByText("tomar agua")).toBeVisible();
  }

  await page.getByRole("button", { name: "Más" }).click();
  await expect(page.getByRole("link", { name: /Ajustes/ })).toBeVisible();
  await page.getByRole("link", { name: /Ajustes/ }).click();
  await expect(page.getByText("Horas de silencio")).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Más secciones" })).toBeHidden(); // the sheet closes on navigation
  await shot(page, "09-ajustes-notificaciones");
});
