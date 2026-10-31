// The WGT is validated by Apps2Samsung and Tizen Studio before it installs.
// A single wrong namespace prefix is a critical error that rejects the whole
// package, so guard the shapes that have already bitten us:
// - <feature> belongs to the plain widgets namespace; <tizen:feature> is invalid;
// - <tizen:allow-navigation> takes an href attribute, not text content;
// - only real Tizen extension elements may carry the tizen: prefix.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const config = fs.readFileSync(path.join(ROOT, "standalone", "config.xml"), "utf8");

// Elements the Tizen widgets schema defines inside the tizen namespace.
const TIZEN_ELEMENTS = new Set([
  "access",
  "allow-navigation",
  "application",
  "content",
  "description",
  "metadata",
  "name",
  "privilege",
  "profile",
  "service",
  "setting",
]);

test("features use the widgets namespace, never the tizen one", () => {
  assert.ok(!/<tizen:feature[\s/>]/.test(config), "no <tizen:feature>");
  assert.ok(/<feature\s+name="http:\/\/tizen\.org\/feature\/screen\.size\.all"\s*\/>/.test(config), "screen.size.all");
  assert.ok(/<feature\s+name="http:\/\/tizen\.org\/feature\/web\.service"\s*\/>/.test(config), "web.service");
});

test("allow-navigation passes the URL as an href attribute", () => {
  // Same shape the current TizenTube config ships: the URL is the href value,
  // not the element text.
  assert.ok(!/<tizen:allow-navigation>/.test(config), "no text-content form");
  assert.ok(/<tizen:allow-navigation\s+href="\*"\s*\/>/.test(config), "href=\"*\"");
});

test("every tizen: element is a real Tizen extension", () => {
  const names = new Set([...config.matchAll(/<tizen:([A-Za-z-]+)/g)].map((m) => m[1]));
  assert.ok(names.size > 0, "config uses Tizen extensions");
  for (const name of names) {
    assert.ok(TIZEN_ELEMENTS.has(name), "unexpected tizen:" + name);
  }
});
