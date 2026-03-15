import { test, expect } from "@playwright/test";
import { captureActiveEventSnapshot, restoreActiveEventSnapshot, type ActiveEventSnapshot } from "./event-state";

const requiredEnv = [
  "MPA_BASE_URL",
  "MPA_ADMIN_EMAIL",
  "MPA_ADMIN_PASSWORD",
  "MPA_DIRECTOR_EMAIL",
  "MPA_DIRECTOR_PASSWORD",
];

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

test.beforeAll(() => {
  requiredEnv.forEach((name) => requireEnv(name));
});

const data = {
  eventName: `Release Event ${Date.now()}`,
};

let initialActiveEvent: ActiveEventSnapshot = { name: null };

async function signIn(page, email, password) {
  await page.goto("/");
  const accountSummary = page.locator("#accountSummary");
  if ((await accountSummary.count()) > 0) {
    const summaryText = (await accountSummary.textContent()) || "";
    if (summaryText.includes(email)) return;
  }
  const signInBtn = page.locator("#signInBtn");
  if (await signInBtn.isVisible()) {
    await signInBtn.click();
  }
  await expect(page.locator("#emailInput")).toBeVisible({ timeout: 20000 });
  await page.fill("#emailInput", email);
  await page.fill("#passwordInput", password);
  await page.click("#emailForm button[type='submit']");
  await expect(page.locator("#accountSummary")).toContainText(email, { timeout: 20000 });
}

async function signOut(page) {
  const signOutBtn = page.locator("#signOutBtn");
  if (await signOutBtn.isVisible()) {
    await signOutBtn.click();
  }
  await expect(page.locator("#accountSummary")).toContainText("Signed out", { timeout: 20000 });
}

test.describe.serial("Release E2E Tests", () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    try {
      await signIn(page, requireEnv("MPA_ADMIN_EMAIL"), requireEnv("MPA_ADMIN_PASSWORD"));
      initialActiveEvent = await captureActiveEventSnapshot(page);
      await signOut(page);
    } finally {
      await page.close();
    }
  });

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    try {
      await signIn(page, requireEnv("MPA_ADMIN_EMAIL"), requireEnv("MPA_ADMIN_PASSWORD"));
      await restoreActiveEventSnapshot(page, initialActiveEvent);
      await signOut(page);
    } finally {
      await page.close();
    }
  });

  test("Admin: release controls are unavailable without scheduled packets", async ({ page }) => {
    await signIn(page, requireEnv("MPA_ADMIN_EMAIL"), requireEnv("MPA_ADMIN_PASSWORD"));

    await page.click("#adminSubnavSettingsBtn");
    await page.fill("#eventNameInput", data.eventName);
    await page.click("#createEventBtn");
    const eventItem = page.locator("#eventList li", { hasText: data.eventName });
    await expect(eventItem).toBeVisible({ timeout: 20000 });
    await eventItem.getByRole("button", { name: "Set Active" }).click();
    await expect(page.locator("#activeEventDisplay")).toContainText(data.eventName, { timeout: 20000 });

    await page.click("#adminSubnavPacketsBtn");
    await expect(page.locator("#adminPacketsHint")).toContainText(
      /No scheduled ensembles for the active event\.|Set an active event to begin\./
    );
    await expect(page.locator("#adminPacketsSchoolSelect")).toHaveCount(1);
    await expect(page.locator("#adminPacketsList")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Release Packet" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Unrelease Packet" })).toHaveCount(0);

    await signOut(page);
  });

  test("Director: results panel remains release-gated", async ({ page }) => {
    await signIn(page, requireEnv("MPA_DIRECTOR_EMAIL"), requireEnv("MPA_DIRECTOR_PASSWORD"));

    const attachSelect = page.locator("#directorAttachSelect");
    if (await attachSelect.isVisible()) {
      const optionValues = await attachSelect.locator("option").evaluateAll((options) =>
        options.map((o) => (o as HTMLOptionElement).value).filter(Boolean)
      );
      if (optionValues.length > 0) {
        await page.selectOption("#directorAttachSelect", optionValues[0]);
        await page.click("#directorAttachBtn");
      }
    }

    await page.click("#directorNavResultsBtn");
    await expect(page.getByRole("button", { name: "Release Packet" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Unrelease Packet" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Delete Packet" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Lock Open Sheet" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Unlock Open Sheet" })).toHaveCount(0);

    await signOut(page);
  });
});
