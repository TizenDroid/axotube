// Regression checks for the follow-up fixes on top of upstream main:
// - ConfigStore saves without java.nio.file (API 23 minSdk) and still replaces
//   an existing file on a host JVM through the delete-and-retry fallback;
// - both proxies echo the requested CORS headers in the preflight response;
// - a nothing-playing poll sends {} (not null) and clears the stored state.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const JAVA = "android/app/src/main/java/org/axotube/tv";

test("ConfigStore does not use java.nio.file (minSdk 23 has no Files)", () => {
  const src = read(JAVA + "/ConfigStore.java");
  assert.ok(!/import java\.nio\.file/.test(src), "no java.nio.file import");
  assert.ok(!/\bFiles\.[a-z]/.test(src), "no Files.* calls");
  assert.match(src, /tmp\.renameTo\(file\)/);
  assert.match(src, /file\.delete\(\)/, "fallback deletes the old file before retrying");
});

test("the Node proxy echoes requested CORS headers, and only plain header names", () => {
  const src = read("service/proxy.js");
  assert.match(src, /req\.get\('Access-Control-Request-Headers'\)/);
  assert.match(src, /\/\^\[A-Za-z0-9,\\- \]\{1,512\}\$\//, "validates before echoing");
});

test("the Java proxy answers preflight with the requested headers, validated the same way", () => {
  const src = read(JAVA + "/LocalProxy.java");
  assert.match(src, /sendPreflight\(output, req\.headers\.get\("access-control-request-headers"\), req\.headers\.get\("origin"\)\)/);
  assert.match(src, /requested\.matches\("\[A-Za-z0-9,\\\\- \]\{1,512\}"\)/);
});

test("a nothing-playing poll sends {} and the service stores it as no media", () => {
  const webConfig = read("mods/features/webConfig.js");
  assert.match(webConfig, /serialized === "none" \? "\{\}" : serialized/);
  assert.ok(!webConfig.includes('"null" : serialized'), "bare null body removed");
  const service = read("service/service.js");
  assert.match(service, /Object\.keys\(body\)\.length > 0/);
});
