import { expect, test } from "@playwright/test";

// Google's OAuth consent screen links here: it must load without a session (outside the (app) auth gate)
test("the privacy policy is public", async ({ page }) => {
  const res = await page.goto("/privacidad");
  expect(res?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Privacidad", level: 1 })).toBeVisible();
  await expect(page.getByText("calendar.readonly")).toBeVisible();
  await expect(page.getByLabel("Código de configuración")).toHaveCount(0);
});
