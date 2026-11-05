// The Tizen service runs on Node 4, so the sources that end up in the service
// bundle must not use built-ins added later. Rollup and Babel transpile syntax,
// but they do not polyfill runtime APIs, and a missing one only shows up on the
// TV, at the moment the code path runs.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const SOURCES = [
  "service/service.js",
  "service/loader.js",
  "service/serviceUpdater.cjs",
  "service/proxy.js",
  "service/bundleUpdates.cjs",
  "service/standalone.js",
  "service/webConfigPage.js",
  "shared/configPolicy.js",
  "service/diagnostics.js",
  "service/launchSettings.js",
  "service/webConfigPage.js",
  "service/diagnosticsPage.js",
  "service/cdp/websocket.js",
  "service/cdp/sdb.js",
  "service/cdp/cdp.js",
  "service/cdp/launcher.js",
];

// Strips // and /* */ comments so the explanatory comments that name the
// removed APIs do not count as uses.
function code(file) {
  return fs
    .readFileSync(path.join(ROOT, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const FORBIDDEN = [
  [/\bpadStart\s*\(/, "String.prototype.padStart (ES2017)"],
  [/\.includes\s*\(/, "Array.prototype.includes (ES2016)"],
  [/crypto\.timingSafeEqual/, "crypto.timingSafeEqual (Node 6.6)"],
  [/mkdirSync\s*\([^)]*recursive/, "fs.mkdirSync({ recursive }) (Node 10.12)"],
  [/\buuid\.v4\s*\(/, "uuid.v4 (needs crypto.getRandomValues)"],
  [/\bnew URL\s*\(/, "the global URL constructor (Node 10)"],
  [/\.padEnd\s*\(/, "String.prototype.padEnd (ES2017)"],
  [/\bBuffer\.(from|alloc|allocUnsafe)\s*\(/, "Buffer.from/alloc/allocUnsafe (Node 4.5+); use new Buffer"],
  [/\bglobalThis\b/, "globalThis (Node 12)"],
  [/\bObject\.(entries|values|fromEntries)\s*\(/, "Object.entries/values/fromEntries (Node 7+)"],
  [/\.(finally|allSettled|trimStart|trimEnd|flatMap|flat|replaceAll)\s*\(/, "a Promise or string/array method added after Node 4"],
  [/\bfs\.promises\b|require\(["']fs\/promises["']\)/, "fs.promises (Node 10)"],
  [/\bcrypto\.randomUUID\b|\brandomFillSync\b|\brandomFill\b/, "crypto.randomUUID / randomFill (Node 7+)"],
  [/\bTextEncoder\b|\bTextDecoder\b|\bstructuredClone\b|\bAbortController\b/, "a Web API missing on Node 4"],
  [/require\(["']uuid["']\)/, "the uuid package (ES2015+, does not load on Node 4)"],
];

for (const file of SOURCES) {
  test(`${file} stays within the Node 4 runtime`, () => {
    const src = code(file);
    for (const [pattern, name] of FORBIDDEN) {
      assert.ok(!pattern.test(src), `${file} uses ${name}`);
    }
  });
}

test("the device UUID is a local SHA-1 v5, the same bytes uuid.v5 produced", () => {
  const src = code("service/service.js");
  assert.ok(/function sha1Uuid\s*\(/.test(src), "sha1Uuid exists");
  assert.ok(/sha1Uuid\(tizenid, "4bcbc514-bdd6-4163-8215-316526fd1d9b"\)/.test(src), "deviceUuid uses it with the same namespace");
  const crypto = require("node:crypto");
  const { createHash } = crypto;
  const ns = Buffer.from("4bcbc514bdd641638215316526fd1d9b", "hex");
  const hash = createHash("sha1").update(ns).update(Buffer.from("abc", "utf8")).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const h = hash.toString("hex", 0, 16);
  const out = [h.slice(0, 8), h.slice(8, 12), h.slice(12, 16), h.slice(16, 20), h.slice(20)].join("-");
  assert.equal(out, "4436dfeb-1113-57ba-aa5e-dade725a8a6b", "matches uuid.v5(\"abc\", namespace)");
});

test("the UUID fallback is built from crypto.randomBytes", () => {
  const src = code("service/service.js");
  assert.ok(/function randomUuidV4\s*\(/.test(src), "randomUuidV4 exists");
  assert.ok(/return randomUuidV4\(\);/.test(src), "deviceUuid falls back to it");
});

test("the web config page answers the favicon request", () => {
  assert.ok(/app\.get\("\/favicon\.ico"/.test(code("service/service.js")), "favicon route");
});
