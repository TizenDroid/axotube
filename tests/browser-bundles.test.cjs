// Runs the built browser bundles in the order the page loads them, in a Chromium 47 realm
// (tests/support/chrome47.cjs) with a page stub (tests/support/dom-stub.cjs). The load runs the
// bundles' own code, and running the scheduled callbacks once runs the code they start. A
// built-in Chromium 47 lacks, used without a guard, fails here as a ReferenceError or TypeError.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const chrome47 = require("./support/chrome47.cjs");
const { createPageSandbox, resetBudget } = require("./support/dom-stub.cjs");

const ROOT = path.resolve(__dirname, "..");
const BUNDLES = ["dist/early.js", "dist/userScript.js"];

for (const file of BUNDLES) {
  test(file + " exists (run npm run build first)", () => {
    assert.ok(fs.existsSync(path.join(ROOT, file)), file + " is missing");
  });
}

function openPage() {
  resetBudget();
  const timers = [];
  const ctx = chrome47.createContext(createPageSandbox(timers), { polyfills: false });
  return { ctx: ctx, timers: timers };
}

function loadBundle(ctx, file, source) {
  resetBudget();
  const code = source === undefined ? fs.readFileSync(path.join(ROOT, file), "utf8") : source;
  vm.runInContext(code, ctx, { filename: path.join(ROOT, file) });
}

test("the early and user bundles load, in order, in a Chromium 47 realm", () => {
  const page = openPage();
  for (const file of BUNDLES) loadBundle(page.ctx, file);
  // The early bundle installs the polyfills, so the realm now has them.
  assert.equal(vm.runInContext("typeof Object.values", page.ctx), "function");
  assert.equal(vm.runInContext("typeof Object.fromEntries", page.ctx), "function");
  // The realm really is missing the gaps the bundles were checked against.
  assert.equal(vm.runInContext("typeof Proxy", page.ctx), "undefined");
  assert.equal(vm.runInContext("typeof Reflect", page.ctx), "undefined");
});

test("the callbacks the bundles schedule run once without throwing", () => {
  const page = openPage();
  for (const file of BUNDLES) loadBundle(page.ctx, file);
  const failures = [];
  // A snapshot: callbacks that schedule more work append to page.timers, and those are not run here.
  for (const callback of page.timers.slice()) {
    resetBudget();
    try {
      callback();
    } catch (err) {
      failures.push(err && (err.name + ": " + err.message));
    }
  }
  assert.deepEqual(failures, [], "scheduled callbacks that threw");
});

test("the realm is strict: a bundle that uses a missing built-in fails to load", () => {
  const page = openPage();
  const source = fs.readFileSync(path.join(ROOT, "dist/userScript.js"), "utf8") + "\n;new Proxy({}, {});\n";
  const probe = path.join(os.tmpdir(), "axotube-probe-userScript.js");
  fs.writeFileSync(probe, source);
  loadBundle(page.ctx, "dist/early.js");
  assert.throws(() => loadBundle(page.ctx, "dist/userScript.js", source), /Proxy is not defined/);
  fs.unlinkSync(probe);
});
