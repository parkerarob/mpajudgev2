const { spawnSync } = require("child_process");

function run(cmd, args) {
  const result = spawnSync(cmd, args, { stdio: "inherit", shell: true });
  return result.status ?? 1;
}

const testStatus = run("npm", ["run", "test:phase1"]);
const reportStatus = run("npm", ["run", "report:phase1"]);

process.exit(testStatus || reportStatus ? 1 : 0);
