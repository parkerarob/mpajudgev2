const fs = require("fs");
const path = require("path");

const reportPath = process.env.MPA_E2E_REPORT_PATH || path.join("reports", "e2e_results.json");
const outputPath = process.env.MPA_E2E_REPORT_MD_PATH || path.join("reports", "e2e_report.md");
const reportTitle = process.env.MPA_E2E_REPORT_TITLE || "E2E Test Report";

if (!fs.existsSync(reportPath)) {
  console.error("Missing report data:", reportPath);
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(reportPath, "utf8"));
const startTime = data?.metadata?.startTime || new Date().toISOString();
const baseURL = (data?.metadata?.baseURL || process.env.MPA_BASE_URL || "").toString();

const rows = [];

function collectTests(suite) {
  if (!suite) return;
  if (suite.specs) {
    suite.specs.forEach((spec) => {
      spec.tests.forEach((test) => {
        const result = test.results[0];
        const status = result?.status || "unknown";
        const title = `${spec.title}`.trim();
        let error = "";
        let screenshotPath = "";
        if (result?.error) {
          error = result.error.message || "";
        }
        if (result?.attachments) {
          const screenshot = result.attachments.find((a) => a.name === "screenshot");
          if (screenshot?.path) screenshotPath = screenshot.path;
        }
        rows.push({ title, status, error, screenshotPath });
      });
    });
  }
  if (suite.suites) {
    suite.suites.forEach(collectTests);
  }
}

collectTests(data.suites[0]);

const lines = [];
lines.push(`# ${reportTitle}`);
lines.push("");
lines.push(`- Timestamp: ${startTime}`);
lines.push(`- Base URL: ${baseURL || "(not provided)"}`);
lines.push("");
lines.push("| Test Case | Status | Details | Screenshot |");
lines.push("| --- | --- | --- | --- |");

rows.forEach((row) => {
  const status = row.status === "passed" ? "PASS" : "FAIL";
  const details = row.error ? row.error.replace(/\n/g, " ") : "";
  const screenshot = row.screenshotPath ? `\`${row.screenshotPath}\`` : "";
  lines.push(`| ${row.title} | ${status} | ${details} | ${screenshot} |`);
});

fs.writeFileSync(outputPath, lines.join("\n"));
console.log(lines.join("\n"));
