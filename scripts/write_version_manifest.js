const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

function getGitSha() {
  try {
    return execSync("git rev-parse --short HEAD", {
      cwd: path.resolve(__dirname, ".."),
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
}

const repoRoot = path.resolve(__dirname, "..");
const packageJsonPath = path.join(repoRoot, "package.json");
const versionManifestPath = path.join(repoRoot, "public", "version.json");

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
const generatedAt = new Date().toISOString();
const gitSha = getGitSha();

const manifest = {
  app: "mpa-judge-v2",
  version: packageJson.version || "0.0.0",
  gitSha,
  generatedAt,
  buildId: `${generatedAt}:${gitSha}`,
};

fs.writeFileSync(versionManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ${path.relative(repoRoot, versionManifestPath)} (${manifest.buildId})`);
