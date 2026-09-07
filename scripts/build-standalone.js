const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const STANDALONE = path.join(ROOT, "standalone");

function run(cmd, cwd) {
  console.log(`> ${cmd}`);
  execSync(cmd, { cwd, stdio: "inherit" });
}

// Never trust an existing dist/ bundle here. This script is also used directly
// by CI/developers, so it must produce standalone artifacts from current source.
run("npm run build", ROOT);

const builtUserScript = path.join(ROOT, "dist", "userScript.js");
const builtService = path.join(ROOT, "dist", "service.js");
if (!fs.existsSync(builtUserScript) || !fs.existsSync(builtService)) {
  throw new Error("Root build did not produce dist/userScript.js and dist/service.js");
}

fs.mkdirSync(path.join(STANDALONE, "userscript"), { recursive: true });
fs.copyFileSync(
  builtUserScript,
  path.join(STANDALONE, "userscript", "userScript.js"),
);
console.log("copied fresh dist/userScript.js -> standalone/userscript/userScript.js");

const svcDir = path.join(STANDALONE, "service");
// standalone/service intentionally has a tiny independent package. Versions are
// pinned exactly in its package.json, so npm install is deterministic at the
// direct dependency layer even when this checkout has no node_modules yet.
run("npm install --no-audit --no-fund", svcDir);
run("npm run build", svcDir);

const standaloneService = path.join(svcDir, "dist", "index.js");
if (!fs.existsSync(standaloneService)) {
  throw new Error("Standalone service build did not produce dist/index.js");
}
console.log("built standalone/service/dist/index.js from current source");
