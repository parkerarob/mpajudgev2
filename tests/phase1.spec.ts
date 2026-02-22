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
  eventName: `Phase1 Event ${Date.now()}`,
};

async function signIn(page, email, password) {
  await page.goto("/");
  const signInBtn = page.locator("#signInBtn");
  if (await signInBtn.isVisible()) {
    await signInBtn.click();
  }
  await page.fill("#emailInput", email);
  await page.fill("#passwordInput", password);
  await page.click("#emailForm button[type='submit']");
  await expect(page.locator("#authStatus")).toContainText(email, { timeout: 20000 });
}

async function signOut(page) {
  const signOutBtn = page.locator("#signOutBtn");
  if (await signOutBtn.isVisible()) {
    await signOutBtn.click();
  }
  await expect(page.locator("#authStatus")).toContainText("Signed out", { timeout: 20000 });
}

test.describe.serial("Phase 1 Smoke Tests", () => {
  test("Admin: create event, seed school", async ({ page }) => {
    await signIn(page, requireEnv("MPA_ADMIN_EMAIL"), requireEnv("MPA_ADMIN_PASSWORD"));

    await page.fill("#schoolIdCreateInput", data.schoolId);
    await page.fill("#schoolNameCreateInput", data.schoolName);
    await page.click("#schoolForm button[type='submit']");
    await expect(page.locator("#schoolResult")).toContainText("Saved", { timeout: 20000 });

    await page.fill("#eventNameInput", data.eventName);
    const now = new Date();
    const start = new Date(now.getTime() + 60 * 60 * 1000);
    const end = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const toLocalInput = (d) => d.toISOString().slice(0, 16);
    await page.fill("#eventStartAtInput", toLocalInput(start));
    await page.fill("#eventEndAtInput", toLocalInput(end));
    await page.click("#createEventBtn");

    const eventItem = page.locator("#eventList li", { hasText: data.eventName });
    await expect(eventItem).toBeVisible();
    await eventItem.getByRole("button", { name: "Set Active" }).click();
    await expect(page.locator("#activeEventDisplay")).toContainText(data.eventName, { timeout: 20000 });

    await signOut(page);
  });

  test("Director: attach, create ensemble, detach/attach", async ({ page }) => {
    await signIn(page, requireEnv("MPA_DIRECTOR_EMAIL"), requireEnv("MPA_DIRECTOR_PASSWORD"));

    await page.selectOption("#directorAttachSelect", { label: data.schoolName });
    await page.click("#directorAttachBtn");
    await expect(page.locator("#directorSchoolName")).toContainText(data.schoolName, { timeout: 20000 });

    await page.fill("#directorEnsembleNameInput", data.ensembleName);
    await page.fill("#directorEnsembleGradeInput", "III");
    await page.click("#directorEnsembleForm button[type='submit']");
    await expect(page.locator("#directorEnsembleList")).toContainText(data.ensembleName);

    await expect(page.locator("#directorEmpty")).toBeVisible();

    await page.click("#directorDetachBtn");
    await expect(page.locator("#directorSchoolName")).toContainText("No school attached");

    await page.selectOption("#directorAttachSelect", { label: data.schoolName });
    await page.click("#directorAttachBtn");
    await expect(page.locator("#directorSchoolName")).toContainText(data.schoolName, { timeout: 20000 });

    await signOut(page);
  });

  test("Admin: schedule entry + judge assignments + packet view controls", async ({ page }) => {
    await signIn(page, requireEnv("MPA_ADMIN_EMAIL"), requireEnv("MPA_ADMIN_PASSWORD"));

    const performance = new Date(Date.now() + 3 * 60 * 60 * 1000);
    await page.fill("#performanceAtInput", performance.toISOString().slice(0, 16));
    await page.selectOption("#scheduleSchoolSelect", { label: data.schoolName });
    await page.selectOption("#scheduleEnsembleSelect", { label: data.ensembleName });
    await page.click("#scheduleSubmitBtn");

    const scheduleRow = page.locator("#scheduleList li", { hasText: data.ensembleName }).first();
    await expect(scheduleRow).toBeVisible();

    await page.selectOption("#stage1JudgeSelect", { label: requireEnv("MPA_JUDGE_EMAIL") });
    await page.selectOption("#stage2JudgeSelect", { label: requireEnv("MPA_JUDGE_EMAIL") });
    await page.selectOption("#stage3JudgeSelect", { label: requireEnv("MPA_JUDGE_EMAIL") });
    await page.selectOption("#sightJudgeSelect", { label: requireEnv("MPA_JUDGE_EMAIL") });
    await page.click("#assignmentsForm button[type='submit']");
    await expect(page.locator("#assignmentsError")).toContainText("Assignments saved", { timeout: 20000 });

    const viewPacketBtn = scheduleRow.getByRole("button", { name: "View Packet" });
    await viewPacketBtn.click();
    await expect(scheduleRow).toContainText("Release Packet");
    await expect(scheduleRow).toContainText("Unrelease Packet");

    await signOut(page);
  });

  test("Judge: test mode record/transcribe/draft", async ({ page }) => {
    await signIn(page, requireEnv("MPA_JUDGE_EMAIL"), requireEnv("MPA_JUDGE_PASSWORD"));

    await page.click("#testModeToggle");
    await expect(page.locator("#judgeTestBadge")).toBeVisible();

    await page.selectOption("#testFormTypeSelect", "stage");
    await page.click("#testRecordBtn");
    await page.waitForTimeout(1000);
    await page.click("#testStopBtn");
    await expect(page.locator("#testRecordingStatus")).toContainText("Recording ready", { timeout: 20000 });

    await page.click("#testTranscribeBtn");
    await expect(page.locator("#testTranscriptInput")).not.toHaveValue("", { timeout: 30000 });

    await page.click("#testDraftBtn");
    await expect(page.locator("#testCaptionForm textarea")).toHaveCount(7, { timeout: 20000 });

    await signOut(page);
  });
});
