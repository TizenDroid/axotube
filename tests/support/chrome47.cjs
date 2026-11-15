// Creates the VM realms the runtime tests run module code in, and makes them match the
// TV's engine rather than the newest Node. Each realm:
//   1. starts from a fresh V8 realm;
//   2. removes every built-in that tests/fixtures/chrome47-gaps.json lists (MDN data for
//      Chromium 47, the TV target), including the non-configurable Symbol well-knowns,
//      which are hidden by replacing the global Symbol with a wrapper;
//   3. runs mods/polyfills.js, as early.js does at the start of the real bundle.
// A test that touches a built-in Chromium 47 lacks, without a polyfill, throws here.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..", "..");
const GAPS = JSON.parse(fs.readFileSync(path.join(ROOT, "tests", "fixtures", "chrome47-gaps.json"), "utf8"));
const POLYFILLS = fs.readFileSync(path.join(ROOT, "mods", "polyfills.js"), "utf8");

// Runs inside the realm. Deletes configurable gaps on the realm's own global, and hides
// the non-configurable Symbol members behind a wrapper Symbol.
const REMOVE = `(function (gaps) {
  var realGlobal = globalThis, failed = [], removed = 0;
  // Only this realm's own objects are changed. A host object handed in through the sandbox
  // (String, Object, URL ...) is in another realm and fails this check, so it is never mutated.
  function isRealmObject(x) { return x !== null && (typeof x === "object" || typeof x === "function") && x instanceof Object; }
  function del(obj, key, label) {
    if (!isRealmObject(obj)) return;
    try {
      if (Object.getOwnPropertyDescriptor(obj, key)) {
        if (delete obj[key]) removed++; else failed.push(label);
      }
    } catch (e) { failed.push(label + ": " + e.message); }
  }
  gaps.forEach(function (p) {
    var s = p.split(".");
    if (s.length === 1) { del(realGlobal, s[0], p); return; }
    var root = realGlobal[s[0]];
    if (s.length === 2) { del(root, s[1], p); if (isRealmObject(root)) del(root.prototype, s[1], p); return; }
    var mid = isRealmObject(root) ? root[s[1]] : undefined;
    del(mid, s[2], p); if (isRealmObject(mid)) del(mid.prototype, s[2], p);
  });
  var hiddenSymbols = {};
  failed.forEach(function (p) { if (p.indexOf("Symbol.") === 0) hiddenSymbols[p.slice(7)] = true; });
  if (Object.keys(hiddenSymbols).length) {
    var OrigSymbol = realGlobal.Symbol;
    var WrappedSymbol = function Symbol(description) { return OrigSymbol(description); };
    Object.getOwnPropertyNames(OrigSymbol).forEach(function (k) {
      if (k === "prototype" || k === "length" || k === "name" || hiddenSymbols[k]) return;
      WrappedSymbol[k] = OrigSymbol[k];
    });
    WrappedSymbol.prototype = OrigSymbol.prototype;
    realGlobal.Symbol = WrappedSymbol;
    failed = failed.filter(function (p) { return p.indexOf("Symbol.") !== 0; });
  }
  return { removed: removed, failed: failed };
})`;

// Returns a context (the sandbox itself, as vm.createContext does) that behaves like a
// Chromium 47 page with polyfills.js already loaded. Passing filename lets V8 coverage
// attribute the polyfill source to its real path.
// Names of the JavaScript built-in globals of a fresh realm (String, Object, Math, ...).
const BUILTIN_GLOBALS = new Set(vm.runInContext("Object.getOwnPropertyNames(globalThis)", vm.createContext({})));

function createContext(sandbox = {}) {
  const ctx = vm.createContext(sandbox);
  // While the realm is prepared, the host's built-in constructors are hidden so the removal and
  // polyfills act on this realm's own intrinsics. They are restored under the same names after.
  const hidden = Object.keys(sandbox).filter((k) => BUILTIN_GLOBALS.has(k));
  const saved = {};
  hidden.forEach((k) => { saved[k] = sandbox[k]; delete ctx[k]; });
  try {
    const report = vm.runInContext(REMOVE, ctx)(GAPS);
    if (report.failed.length) {
      throw new Error("Chromium 47 gaps that could not be removed: " + report.failed.join(", "));
    }
    vm.runInContext("if (typeof window === 'undefined') { var window = this; }", ctx);
    vm.runInContext(POLYFILLS, ctx, { filename: path.join(ROOT, "mods", "polyfills.js") });
  } finally {
    hidden.forEach((k) => { ctx[k] = saved[k]; });
  }
  return ctx;
}

// Runs source in a context from createContext, with a real filename for coverage.
function runFile(ctx, file, extra = "") {
  return vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8") + extra, ctx, {
    filename: path.join(ROOT, file),
  });
}

module.exports = { createContext, runFile, GAPS };

// Runs source in a fresh Chromium 47 realm and returns the completion value.
function runInNewContext(source, sandbox = {}) {
  const ctx = createContext(sandbox);
  return vm.runInContext(source, ctx);
}
module.exports.runInNewContext = runInNewContext;
