// Regression checks for the second follow-up: the pairing page must parse, the
// standalone build must refuse an external node-fetch, and lounge pairing calls
// must go through cors-bypass in both proxies.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const JAVA = "android/app/src/main/java/org/axotube/tv";

test("every inline script in the pairing page parses", () => {
  const { webConfigPage } = require(path.join(ROOT, "service/webConfigPage.js"));
  const scripts = [...webConfigPage.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.ok(scripts.length >= 1, "page has an inline script");
  for (const code of scripts) {
    assert.doesNotThrow(() => new Function(code), "inline script is valid JavaScript");
  }
});

test("the build refuses a standalone bundle that still requires node-fetch", () => {
  const build = read("scripts/build-standalone.js");
  assert.ok(build.includes("node-fetch"), "node-fetch check present");
  assert.ok(build.includes("npm ci --prefix service"), "error names the fix");
});

test("lounge pairing calls are routed through cors-bypass in both proxies", () => {
  const node = read("service/proxy.js");
  assert.ok(node.includes("\\/\\/www\\.youtube\\.com\\/api\\/lounge"), "Node lounge rule");
  assert.ok(node.includes("'www.youtube.com': true"), "Node allow-list");
  const java = read(JAVA + "/LocalProxy.java");
  assert.ok(java.includes("//www\\\\.youtube\\\\.com/api/lounge"), "Java lounge rule");
  assert.ok(java.includes('"www.youtube.com"'), "Java allow-list");
});
