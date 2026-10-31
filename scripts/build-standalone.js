const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const STANDALONE = path.join(ROOT, "standalone");

function run(cmd, cwd) {
  console.log(`> ${cmd}`);
  execSync(cmd, { cwd, stdio: "inherit" });
}

// Expects a fresh root build (`npm run build`). The root script `build:standalone`
// runs the build first; CI runs it once in that order.

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
// A missing service/node_modules leaves node-fetch external. The bundle then
// keeps require("node-fetch") (the packager rejects it), and the proxy's
// maxHeaderSize patch is never applied, so YouTube's large headers fail with
// "Header overflow". Fail the build instead of shipping that.
const standaloneCode = fs.readFileSync(standaloneService, "utf8");
if (/require\(['"]node-fetch['"]\)/.test(standaloneCode)) {
  throw new Error("standalone service still requires node-fetch; run: npm ci --prefix service");
}
if (!standaloneCode.includes("maxHeaderSize:5242880")) {
  throw new Error("standalone service is missing the maxHeaderSize patch; rebuild with npm ci --prefix service");
}
console.log("standalone service is current: standalone/service/dist/index.js");
