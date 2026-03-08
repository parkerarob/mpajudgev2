const { spawnSync } = require("child_process");

function run(cmd, args) {
  const result = spawnSync(cmd, args, { stdio: "inherit", shell: true });
  return result.status ?? 1;
}

function hasRequiredEnv(names) {
  return names.every((name) => String(process.env[name] || "").trim().length > 0);
}

const smokeEnv = [
  "MPA_BASE_URL",
  "MPA_ADMIN_EMAIL",
  "MPA_ADMIN_PASSWORD",
  "MPA_JUDGE_EMAIL",
  "MPA_JUDGE_PASSWORD",
  "MPA_DIRECTOR_EMAIL",
  "MPA_DIRECTOR_PASSWORD",
];
const releaseEnv = [
  "MPA_BASE_URL",
  "MPA_ADMIN_EMAIL",
  "MPA_ADMIN_PASSWORD",
  "MPA_DIRECTOR_EMAIL",
  "MPA_DIRECTOR_PASSWORD",
];
const requireE2E = String(process.env.MPA_REQUIRE_E2E || "").toLowerCase() === "true";

const unitStatus = run("npm", ["run", "test:unit"]);
let smokeStatus = 0;
let smokeReportStatus = 0;
if (hasRequiredEnv(smokeEnv)) {
  smokeStatus = run("npm", ["run", "test:e2e:smoke"]);
  smokeReportStatus = run("npm", ["run", "report:e2e:smoke"]);
} else if (requireE2E) {
  console.error("Missing required env vars for smoke E2E and MPA_REQUIRE_E2E=true.");
  smokeStatus = 1;
} else {
  console.log("Skipping smoke E2E suite (required MPA_* env vars not fully set).");
}

let releaseStatus = 0;
let releaseReportStatus = 0;
if (String(process.env.MPA_RUN_RELEASE_E2E || "").toLowerCase() === "true") {
  if (hasRequiredEnv(releaseEnv)) {
    releaseStatus = run("npm", ["run", "test:e2e:release"]);
    releaseReportStatus = run("npm", ["run", "report:e2e:release"]);
  } else if (requireE2E) {
    console.error("Missing required env vars for release E2E and MPA_REQUIRE_E2E=true.");
    releaseStatus = 1;
  } else {
    console.log("Skipping release E2E suite (required MPA_* env vars not fully set).");
  }
} else {
  console.log("Skipping release E2E suite (set MPA_RUN_RELEASE_E2E=true to include it).");
}

process.exit(unitStatus || smokeStatus || smokeReportStatus || releaseStatus || releaseReportStatus ? 1 : 0);
