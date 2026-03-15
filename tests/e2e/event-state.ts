import { expect, type Page } from "@playwright/test";

export type ActiveEventSnapshot = {
  name: string | null;
};

export async function openAdminSettings(page: Page) {
  await page.goto("/");
  await page.click("#adminSubnavSettingsBtn");
  await expect(page.locator("#eventList")).toBeVisible({ timeout: 20000 });
}

export async function captureActiveEventSnapshot(page: Page): Promise<ActiveEventSnapshot> {
  await openAdminSettings(page);
  const activeItem = page.locator("#eventList li", {
    has: page.getByRole("button", { name: "Deactivate" }),
  });
  if ((await activeItem.count()) === 0) {
    await expect(page.locator("#activeEventDisplay")).toContainText("No active event.", {
      timeout: 20000,
    });
    return { name: null };
  }

  const name = ((await activeItem.locator("div").first().textContent()) || "").trim();
  return { name: name || null };
}

export async function restoreActiveEventSnapshot(page: Page, snapshot: ActiveEventSnapshot) {
  await openAdminSettings(page);
  if (!snapshot.name) {
    const deactivateBtn = page.getByRole("button", { name: "Deactivate" }).first();
    if (await deactivateBtn.isVisible()) {
      await deactivateBtn.click();
      await expect(page.locator("#activeEventDisplay")).toContainText("No active event.", {
        timeout: 20000,
      });
    }
    return;
  }

  const activeItem = page.locator("#eventList li", {
    has: page.getByRole("button", { name: "Deactivate" }),
  });
  if ((await activeItem.count()) > 0) {
    const currentName = ((await activeItem.locator("div").first().textContent()) || "").trim();
    if (currentName === snapshot.name) {
      return;
    }
  }

  const targetItem = page.locator("#eventList li", { hasText: snapshot.name });
  await expect(targetItem).toBeVisible({ timeout: 20000 });
  await targetItem.getByRole("button", { name: "Set Active" }).click();
  await expect(activeItem.locator("div").first()).toContainText(snapshot.name, {
    timeout: 20000,
  });
}
