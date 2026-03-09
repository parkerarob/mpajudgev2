import { test, expect } from "@playwright/test";

const requiredEnv = [
  "MPA_BASE_URL",
  "MPA_ADMIN_EMAIL",
  "MPA_ADMIN_PASSWORD",
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

test.describe.serial("UX Contract E2E", () => {
  test("Profile modal locks body, closes with Escape, and restores focus", async ({ page }) => {
    await signIn(page, requireEnv("MPA_ADMIN_EMAIL"), requireEnv("MPA_ADMIN_PASSWORD"));

    const profileToggleCandidates = [
      { toggle: "#adminProfileToggleBtn", modal: "#userProfileModal" },
      { toggle: "#judgeProfileToggleBtn", modal: "#userProfileModal" },
      { toggle: "#judgeOpenProfileToggleBtn", modal: "#userProfileModal" },
      { toggle: "#directorProfileToggleBtn", modal: "#directorProfileModal" },
    ];
    let selectedCandidate = null;
    const deadline = Date.now() + 20000;
    while (!selectedCandidate && Date.now() < deadline) {
      for (const candidate of profileToggleCandidates) {
        const locator = page.locator(candidate.toggle);
        if ((await locator.count()) > 0 && await locator.isVisible()) {
          selectedCandidate = candidate;
          break;
        }
      }
      if (!selectedCandidate) await page.waitForTimeout(250);
    }

    expect(selectedCandidate).toBeTruthy();
    const profileToggle = page.locator(selectedCandidate!.toggle);
    await profileToggle.click();

    const modal = page.locator(selectedCandidate!.modal);
    await expect(modal).toHaveAttribute("aria-hidden", "false");
    await expect(page.locator("body")).toHaveClass(/modal-open/);

    await page.keyboard.press("Escape");

    await expect(modal).toHaveAttribute("aria-hidden", "true");
    await expect(page.locator("body")).not.toHaveClass(/modal-open/);
    await expect(profileToggle).toBeFocused();

    await signOut(page);
  });
});
