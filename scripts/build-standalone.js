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
const builtEarly = path.join(ROOT, "dist", "early.js");
if (!fs.existsSync(builtEarly)) throw new Error("Root build did not produce dist/early.js");
fs.copyFileSync(builtEarly, path.join(STANDALONE, "userscript", "early.js"));
console.log("copied fresh dist/early.js -> standalone/userscript/early.js");
// The version the shipped bundles were built from. The proxy compares it with the
// CDN's version to decide whether to use a newer cached bundle.
const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
fs.writeFileSync(
  path.join(STANDALONE, "userscript", "version.json"),
  JSON.stringify({ version: rootPkg.version }, null, 2) + "\n",
);
console.log("wrote standalone/userscript/version.json (" + rootPkg.version + ")");

// The standalone service is built by the root build (service/rollup.config.js)
// from the same source as the Tizen service, so it is already up to date here.
const standaloneService = path.join(STANDALONE, "service", "dist", "index.js");
if (!fs.existsSync(standaloneService)) {
  throw new Error("Root build did not produce standalone/service/dist/index.js");
}
console.log("standalone service is current: standalone/service/dist/index.js");
