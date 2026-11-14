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

  // the `url` the API gives Sunday opens the task's editor
  const inbox = await (await page.request.get("/api/tasks?view=inbox")).json();
  await page.goto(inbox.tasks[0].url.replace(/^https?:\/\/[^/]+/, ""));
  await expect(page.getByLabel("Título")).toHaveValue("comprar regalo para Ana");
  await expect(page).toHaveURL(/\/tareas$/);
});

test("reminders: quick add in reminder mode, Recordatorios, Hoy, Más", async ({ page }) => {
  await page.goto("/");
  // a fresh browser context: the user exists (first test), so this is a new device that unlocks with the PIN
  await expect(page.getByRole("heading", { name: "Ingresá tu PIN" })).toBeVisible();
  await typePin(page, E2E.pin);
  await expect(page.getByRole("heading", { name: "Hoy" })).toBeVisible();

  // Recordatorios lives under "Más" since Calendario took its tab
  await page.getByRole("button", { name: "Más" }).click();
  await page.getByRole("link", { name: /Recordatorios/ }).click();
  await expect(page.getByRole("heading", { name: "Recordatorios", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Nuevo recordatorio" }).click();
  const input = page.getByRole("textbox", { name: "Recordatorio", exact: true });
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

test("events: Calendario agenda and week, editor with a reminder, shown on Hoy", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Ingresá tu PIN" })).toBeVisible();
  await typePin(page, E2E.pin);
  await expect(page.getByRole("heading", { name: "Hoy" })).toBeVisible();

  await page
    .getByRole("link", { name: /Calendario/ })
    .first()
    .click();
  await expect(page.getByRole("heading", { name: "Calendario" })).toBeVisible();
  await expect(page.getByText("Sin eventos")).toBeVisible();
  await shot(page, "10-calendario-empty");

  // a timed event later today with a 30-minute notice (Buenos Aires time, like the browser context)
  const now = Number(
    new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: "America/Buenos_Aires" }).format(new Date()),
  );
  const at = Math.min(now + 2, 22);
  const hh = String(at).padStart(2, "0");
  await page.getByRole("button", { name: "Nuevo evento" }).click();
  await page.getByRole("textbox", { name: "Título" }).fill("Cena con Ana");
  await page.getByRole("button", { name: /^Empieza/ }).click();
  await page.getByRole("button", { name: hh, exact: true }).click();
  await page.getByRole("textbox", { name: "Lugar" }).fill("Palermo");
  await page.getByRole("button", { name: "30 min", exact: true }).click();
  await shot(page, "11-event-editor");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("Cena con Ana")).toBeVisible();
  await expect(page.getByText(`${hh}:00–${String(at + 1).padStart(2, "0")}:00`)).toBeVisible();
  await shot(page, "12-calendario-agenda");

  // an all-day event from quick add's Evento mode
  await page.getByRole("link", { name: /Hoy/ }).first().click();
  await page.getByRole("button", { name: "Nueva tarea" }).click();
  await page.getByRole("radio", { name: "Evento" }).click();
  await page.getByRole("textbox", { name: "Evento", exact: true }).fill("hoy feriado puente");
  await page.getByRole("button", { name: "Agregar", exact: true }).click();
  const agenda = page.getByRole("region", { name: "Agenda de hoy" });
  await expect(agenda.getByText("feriado puente")).toBeVisible();
  await expect(agenda.getByText("Cena con Ana")).toBeVisible();
  await shot(page, "13-hoy-agenda");

  // week view
  await page
    .getByRole("link", { name: /Calendario/ })
    .first()
    .click();
  await page.getByRole("radio", { name: "Semana" }).click();
  await expect(page.getByRole("button", { name: "Cena con Ana" })).toBeVisible();
  await shot(page, "14-calendario-semana");

  // the event's notice is a reminder (when its time is still ahead), and the change reached the server
  await page.reload();
  await page.getByRole("button", { name: "Más", exact: true }).click();
  await page.getByRole("link", { name: /Recordatorios/ }).click();
  if (at === now + 2) await expect(page.getByText("Cena con Ana")).toBeVisible();

  // Ajustes → Google Calendar (not configured in E2E: the iCal plan B is offered)
  await page.getByRole("button", { name: "Más", exact: true }).click();
  await page.getByRole("link", { name: /Ajustes/ }).click();
  await page.getByRole("link", { name: /Google Calendar/ }).click();
  await expect(page.getByRole("heading", { name: "Google Calendar" })).toBeVisible();
  await shot(page, "15-ajustes-google");
});

test("habits, cierre del día, historial y métricas", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Ingresá tu PIN" })).toBeVisible();
  await typePin(page, E2E.pin);
  await expect(page.getByRole("heading", { name: "Hoy" })).toBeVisible();

  // create a weekly habit linked to +gym tasks
  await page.getByRole("button", { name: "Más", exact: true }).click();
  await page.getByRole("link", { name: /Hábitos/ }).click();
  await expect(page.getByText("Sin hábitos")).toBeVisible();
  await page.getByRole("button", { name: "Crear hábito" }).click();
  await page.getByRole("textbox", { name: "Nombre" }).fill("Gym");
  await page.getByRole("textbox", { name: "Meta" }).fill("3");
  await page.getByRole("radio", { name: "Por semana" }).click();
  await page.getByRole("textbox", { name: /Etiqueta de tarea/ }).fill("gym");
  await shot(page, "16-habit-editor");
  await page.getByRole("dialog", { name: "Hábito" }).getByRole("button", { name: "Crear hábito" }).click();
  await expect(page.getByRole("region", { name: "Gym" })).toBeVisible();
  await shot(page, "17-habitos");

  // check it on Hoy
  await page.getByRole("link", { name: /Hoy/ }).first().click();
  const habits = page.getByRole("region", { name: "Hábitos" });
  await expect(habits.getByText("0/3 esta semana")).toBeVisible();
  await habits.getByRole("button", { name: /Gym/ }).click();
  await expect(habits.getByText("1/3 esta semana")).toBeVisible();
  await shot(page, "18-hoy-habitos");

  // close the day
  await page.goto("/cierre");
  await expect(page.getByRole("heading", { name: "Cierre del día" })).toBeVisible();
  await page.getByRole("radio", { name: "Ánimo 4 de 5" }).click();
  await page.getByRole("textbox", { name: "Algo bueno 1" }).fill("Fui al gym");
  await shot(page, "19-cierre");
  await page.getByRole("button", { name: "Cerrar el día" }).click();
  await expect(page.getByText("Día cerrado. Buenas noches.")).toBeVisible();

  // Historial and Métricas
  await page.goto("/historial");
  await expect(page.getByRole("heading", { name: "Historial", exact: true })).toBeVisible();
  await expect(page.getByText("Días cerrados")).toBeVisible();
  await shot(page, "20-historial");
  await page.getByRole("radio", { name: "Métricas" }).click();
  await expect(page.getByText("Constancia de hábitos")).toBeVisible();
  await shot(page, "21-metricas");
  await page.goto("/metricas");
  await expect(page.getByText("Constancia de hábitos")).toBeVisible();
});
