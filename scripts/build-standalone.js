// Assembles the standalone WGT's page bundles and service from one root build.
//
//   standalone/userscript/        page bundles (userScript.js, early.js, version.json)
//   standalone/service/dist/      index.js            loader: chooses the service to run
//                                 core.js             the standalone service itself
//                                 version.json        the version shipped in this WGT
//                                 service-core.json   checksum manifest for the CDN copy
//
// Expects a fresh root build (`npm run build`), which also builds core.js.
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const STANDALONE = path.join(ROOT, "standalone");
const SERVICE_DIST = path.join(STANDALONE, "service", "dist");
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
const MIN_CORE_BYTES = 200 * 1000;

function fail(message) {
  throw new Error(message);
}

// Everything that runs on the TV's Node 4 runtime or Chromium 47 must be ES5.
// acorn comes from mods/, which the build already installs.
function assertEs5(file) {
  const acorn = require(path.join(ROOT, "mods", "node_modules", "acorn"));
  try {
    acorn.parse(fs.readFileSync(file, "utf8"), { ecmaVersion: 5 });
  } catch (err) {
    fail(path.relative(ROOT, file) + " is not ES5: " + err.message);
  }
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

// 1. Page bundles, as before.
const builtUserScript = path.join(ROOT, "dist", "userScript.js");
const builtEarly = path.join(ROOT, "dist", "early.js");
const builtService = path.join(ROOT, "dist", "service.js");
for (const file of [builtUserScript, builtEarly, builtService]) {
  if (!fs.existsSync(file)) fail("Root build did not produce " + path.relative(ROOT, file));
}

fs.mkdirSync(path.join(STANDALONE, "userscript"), { recursive: true });
fs.copyFileSync(builtUserScript, path.join(STANDALONE, "userscript", "userScript.js"));
fs.copyFileSync(builtEarly, path.join(STANDALONE, "userscript", "early.js"));
fs.writeFileSync(
  path.join(STANDALONE, "userscript", "version.json"),
  JSON.stringify({ version: VERSION }, null, 2) + "\n",
);
console.log("copied page bundles " + VERSION + " -> standalone/userscript/");

// 2. The core: the whole standalone service, built by the root build.
const core = path.join(SERVICE_DIST, "core.js");
if (!fs.existsSync(core)) fail("Root build did not produce standalone/service/dist/core.js");
const coreBytes = fs.readFileSync(core);
if (coreBytes.length < MIN_CORE_BYTES) fail("core.js is too small to be the full service");
const coreText = coreBytes.toString("utf8");
// A missing service/node_modules leaves node-fetch external, and the packaged WGT
// cannot resolve it. Fail the build rather than ship that.
if (/require\(["']node-fetch["']\)/.test(coreText)) {
  fail("core.js still requires node-fetch; run: npm ci --prefix service");
}
if (!coreText.includes("maxHeaderSize:5242880")) {
  fail("core.js is missing the maxHeaderSize patch; rebuild with npm ci --prefix service");
}
assertEs5(core);

// 3. The loader becomes index.js, the file the Tizen service entry runs.
fs.copyFileSync(path.join(ROOT, "service", "loader.js"), path.join(SERVICE_DIST, "index.js"));
assertEs5(path.join(SERVICE_DIST, "index.js"));

// 4. The version this WGT ships, read by the loader to compare with downloads.
fs.writeFileSync(
  path.join(SERVICE_DIST, "version.json"),
  JSON.stringify({ version: VERSION }, null, 2) + "\n",
);

// 5. The checksum manifest published beside service-core.js. The checksum covers
// the exact bytes of core.js, which the packager publishes unchanged.
const manifest = {
  version: VERSION,
  file: "service-core.js",
  bytes: coreBytes.length,
  sha256: sha256(coreBytes),
};
fs.writeFileSync(path.join(SERVICE_DIST, "service-core.json"), JSON.stringify(manifest, null, 2) + "\n");

for (const file of [
  path.join(STANDALONE, "userscript", "early.js"),
  path.join(STANDALONE, "userscript", "userScript.js"),
]) {
  assertEs5(file);
}

console.log("loader: standalone/service/dist/index.js");
console.log("core: standalone/service/dist/core.js (" + coreBytes.length + " bytes, sha256 " + manifest.sha256.slice(0, 12) + ")");
console.log("standalone build " + VERSION + " is current");
