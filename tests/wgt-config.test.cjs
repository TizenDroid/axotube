// The WGT is validated by Apps2Samsung and Tizen Studio before it installs.
// A single wrong namespace prefix is a critical error that rejects the whole
// package, so guard the shapes that have already bitten us:
// - <feature> belongs to the plain widgets namespace; <tizen:feature> is invalid;
// - <tizen:allow-navigation> takes the domain list as text content (the form the
//   Tizen docs and the config editor write), not an href attribute;
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
  "content-security-policy",
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

test("allow-navigation is the documented domain list, and the CSP is explicit", () => {
  // Tizen docs: <tizen:allow-navigation> holds a list of domains as text. The
  // href form is not documented anywhere in the reference.
  assert.ok(!/<tizen:allow-navigation[^>]*\bhref=/.test(config), "no href on allow-navigation");
  const nav = config.match(/<tizen:allow-navigation>([^<]*)<\/tizen:allow-navigation>/);
  assert.ok(nav, "allow-navigation has domain text");
  for (const host of ["localhost", "127.0.0.1", "youtube.com"]) {
    assert.ok(nav[1].split(/\s+/).includes(host), host + " is allowed to navigate");
  }
  // The default CSP enforces script-src 'self', which blocks the splash's inline
  // script. An explicit policy removes that dependency.
  const csp = config.match(/<tizen:content-security-policy>([^<]*)<\/tizen:content-security-policy>/);
  assert.ok(csp, "explicit content-security-policy");
  assert.match(csp[1], /script-src[^;]*'unsafe-inline'/);
});

test("every tizen: element is a real Tizen extension", () => {
  const names = new Set([...config.matchAll(/<tizen:([A-Za-z-]+)/g)].map((m) => m[1]));
  assert.ok(names.size > 0, "config uses Tizen extensions");
  for (const name of names) {
    assert.ok(TIZEN_ELEMENTS.has(name), "unexpected tizen:" + name);
  }
});
