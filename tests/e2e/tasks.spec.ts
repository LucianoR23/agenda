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
