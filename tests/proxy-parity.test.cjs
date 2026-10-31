// The Android app re-implements the Node proxy and control server in Java
// (LocalProxy.java, ControlServer.java). This test keeps the two in step: the same
// routes, the same allowed upstream hosts, the same ports, and the same bundle
// package name. If one side changes and the other does not, this fails.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const JAVA = "android/app/src/main/java/org/axotube/tv";

// The text from a named declaration to its closing "};" or "));" (whichever comes first).
function block(text, name) {
  const start = text.indexOf(name);
  assert.ok(start >= 0, name + " not found");
  const close = [text.indexOf("};", start), text.indexOf("));", start)].filter((i) => i >= 0);
  return text.slice(start, Math.min(...close) + 2);
}

const quoted = (text, re) => new Set([...text.matchAll(re)].map((m) => m[1]));

test("upstream host allowlist matches between proxy.js and LocalProxy.java", () => {
  const js = quoted(block(read("service/proxy.js"), "CORS_HOSTS"), /'([a-z0-9.-]+)'\s*:/g);
  const java = quoted(block(read(JAVA + "/LocalProxy.java"), "CORS_HOSTS"), /"([a-z0-9.-]+)"/g);
  assert.ok(js.size >= 5, "JS host list parsed");
  assert.deepEqual([...java].sort(), [...js].sort());
});

test("proxy routes match between proxy.js and LocalProxy.java", () => {
  const js = quoted(read("service/proxy.js"), /'(\/axotube\/[a-zA-Z0-9/.]+)'/g);
  const java = quoted(read(JAVA + "/LocalProxy.java"), /"(\/axotube\/[a-zA-Z0-9/.]+)"/g);
  assert.ok(js.has("/axotube/health"), "JS proxy routes parsed");
  assert.deepEqual([...java].sort(), [...js].sort());
});

test("control server routes match between service.js and ControlServer.java", () => {
  const js = quoted(read("service/service.js"), /app\.(?:get|post)\("(\/api\/[a-z/-]+)"/g);
  const java = quoted(read(JAVA + "/ControlServer.java"), /"(\/api\/[a-z/-]+)"/g);
  assert.ok(js.has("/api/pairing-code"), "JS control routes parsed");
  assert.deepEqual([...java].sort(), [...js].sort());
});

test("both sides use the same ports", () => {
  assert.match(read("service/proxy.js"), /PORT\s*=\s*8099/);
  assert.match(read(JAVA + "/LocalProxy.java"), /PORT = 8099/);
  assert.match(read("service/service.js"), /PORT = 8085/);
  assert.match(read(JAVA + "/ControlServer.java"), /DEFAULT_PORT = 8085/);
});

test("the bundle package name is one value across root, WGT and APK", () => {
  const name = JSON.parse(read("package.json")).bundlePackage;
  assert.equal(name, "axotube");
  assert.match(read("service/bundleUpdates.cjs"), new RegExp("DEFAULT_PACKAGE = '" + name + "'"));
  assert.match(read(JAVA + "/BundleStore.java"), new RegExp('NPM_CDN = "https://cdn.jsdelivr.net/npm/' + name + '"'));
});
