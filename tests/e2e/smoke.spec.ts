import { test, expect } from "@playwright/test";

const requiredEnv = [
  "MPA_BASE_URL",
  "MPA_ADMIN_EMAIL",
  "MPA_ADMIN_PASSWORD",
  "MPA_JUDGE_EMAIL",
  "MPA_JUDGE_PASSWORD",
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
  schoolId: `school_${Date.now()}`,
  schoolName: `Test School ${Date.now()}`,
  ensembleName: `Wind Ensemble ${Date.now()}`,
  eventName: `Smoke Event ${Date.now()}`,
};

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

test.describe.serial("Smoke E2E Tests", () => {
  test("Admin: create event, seed school", async ({ page }) => {
    await signIn(page, requireEnv("MPA_ADMIN_EMAIL"), requireEnv("MPA_ADMIN_PASSWORD"));

    await page.click("#adminSubnavSettingsBtn");

    await page.fill("#schoolIdCreateInput", data.schoolId);
    await page.fill("#schoolNameCreateInput", data.schoolName);
    await page.click("#schoolForm button[type='submit']");
    await expect(page.locator("#schoolResult")).toContainText("Added", { timeout: 20000 });

    await page.fill("#eventNameInput", data.eventName);
    await page.click("#createEventBtn");

    const eventItem = page.locator("#eventList li", { hasText: data.eventName });
    await expect(eventItem).toBeVisible();
    await eventItem.getByRole("button", { name: "Set Active" }).click();
    await expect(page.locator("#activeEventDisplay")).toContainText(data.eventName, { timeout: 20000 });

    await signOut(page);
  });

  test("Director: attach, create ensemble, detach/attach", async ({ page }) => {
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
    await expect(page.locator("#directorSummarySchool")).not.toContainText("No school attached", { timeout: 20000 });

    await page.click("#directorNavEnsemblesBtn");
    await page.click("#directorShowEnsembleFormBtn");
    await page.fill("#directorEnsembleNameInput", data.ensembleName);
    await page.click("#directorEnsembleForm button[type='submit']");
    await expect(page.locator("#directorEnsembleList")).toContainText(data.ensembleName);

    await signOut(page);
  });

  test("Admin: judge assignments save", async ({ page }) => {
    await signIn(page, requireEnv("MPA_ADMIN_EMAIL"), requireEnv("MPA_ADMIN_PASSWORD"));

    await page.click("#adminSubnavSettingsBtn");

    const usedJudgeValues = new Set<string>();
    const pickFirstJudgeOption = async (selector: string) => {
      const select = page.locator(selector);
      await expect
        .poll(
          async () =>
            await select.locator("option").evaluateAll((options) =>
              options.map((o) => (o as HTMLOptionElement).value).filter(Boolean).length
            ),
          { timeout: 30000 }
        )
        .toBeGreaterThan(0);
      const optionValues = await select.locator("option").evaluateAll((options) =>
        options.map((o) => (o as HTMLOptionElement).value).filter(Boolean)
      );
      const nextValue = optionValues.find((value) => !usedJudgeValues.has(value));
      if (!nextValue) {
        throw new Error(`No assignable judge options for ${selector}`);
      }
      await page.selectOption(selector, nextValue);
      usedJudgeValues.add(nextValue);
    };
    await pickFirstJudgeOption("#stage1JudgeSelect");
    await pickFirstJudgeOption("#stage2JudgeSelect");
    await pickFirstJudgeOption("#stage3JudgeSelect");
    await pickFirstJudgeOption("#sightJudgeSelect");
    await page.click("#assignmentsForm button[type='submit']");
    await expect(page.locator("#assignmentsError")).toContainText("Assignments saved", { timeout: 20000 });

    await signOut(page);
  });

  test("Judge: practice workspace opens", async ({ page }) => {
    await signIn(page, requireEnv("MPA_JUDGE_EMAIL"), requireEnv("MPA_JUDGE_PASSWORD"));

    await page.click("#judgeOpenChoosePracticeBtn");
    await expect(page.locator("#judgeOpenWorkspace")).toBeVisible();
    await expect(page.locator("#judgeOpenNewPacketBtn")).toBeVisible();
    await expect(page.locator("#judgeOpenWorkspaceModeLabel")).toContainText(
      "Practice Adjudication Mode",
      { timeout: 20000 }
    );
    await expect(page.locator("#judgeOpenPacketHint")).toContainText(
      "Practice mode active",
      { timeout: 20000 }
    );

    await signOut(page);
  });
});
