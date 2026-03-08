import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: ["**/*.spec.ts"],
  timeout: 120000,
  expect: { timeout: 15000 },
  reporter: [["json", { outputFile: process.env.MPA_PLAYWRIGHT_REPORT || "reports/e2e_results.json" }]],
  use: {
    baseURL: process.env.MPA_BASE_URL,
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
    permissions: ["microphone"],
    launchOptions: {
      args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
    },
  },
});
