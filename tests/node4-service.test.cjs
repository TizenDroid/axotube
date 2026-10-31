// The Tizen service runs on Node 4, so the service sources must not use the
// built-ins added later. Rollup and Babel transpile syntax, but they do not
// polyfill runtime APIs, and a missing one only shows up on the TV.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const SOURCES = ["service.js", "proxy.js", "bundleUpdates.cjs", "standalone.js", "webConfigPage.js"];

// Strips // and /* */ comments so the explanatory comments that name the
// removed APIs do not count as uses.
function code(file) {
  return fs
    .readFileSync(path.join(ROOT, "service", file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const FORBIDDEN = [
  [/\bpadStart\s*\(/, "String.prototype.padStart (ES2017)"],
  [/\.includes\s*\(/, "Array.prototype.includes (ES2016)"],
  [/crypto\.timingSafeEqual/, "crypto.timingSafeEqual (Node 6.6)"],
  [/mkdirSync\s*\([^)]*recursive/, "fs.mkdirSync({ recursive }) (Node 10.12)"],
  [/\buuid\.v4\s*\(/, "uuid.v4 (needs crypto.getRandomValues)"],
];

for (const file of SOURCES) {
  test(`${file} stays within the Node 4 runtime`, () => {
    const src = code(file);
    for (const [pattern, name] of FORBIDDEN) {
      assert.ok(!pattern.test(src), `${file} uses ${name}`);
    }
  });
}

test("the UUID fallback is built from crypto.randomBytes", () => {
  const src = code("service.js");
  assert.ok(/function randomUuidV4\s*\(/.test(src), "randomUuidV4 exists");
  assert.ok(/return randomUuidV4\(\);/.test(src), "deviceUuid falls back to it");
});
