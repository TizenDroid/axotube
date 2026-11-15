// Runtime gate for the shipped bundles. Syntax is covered by es5-output.test.cjs; this
// file covers the built-ins and DOM APIs an engine has to provide at run time:
//   • browser bundles (dist/early.js, dist/userScript.js) target Chromium 47
//   • the service bundles (dist/service.js, standalone core.js) run on Node 4.4.4
// Checks are name-based. Each one lists what it matches and why that match is safe:
// a shim installed only when missing, a typeof guard, or an object that is not the
// global. A new match fails the suite until it is reviewed and added here. Several
// entries were checked against the real Node 4.4.4 runtime (see the probe notes).
// Run `npm run build` first, so the built artifacts exist.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

// Occurrences of `re` in `src`, each with the text just before it.
function occurrences(src, re) {
  const out = [];
  const g = new RegExp(re.source, "g");
  let m;
  while ((m = g.exec(src))) out.push({ index: m.index, text: m[0], before: src.slice(Math.max(0, m.index - 160), m.index) });
  return out;
}

// Each check: `absent` means the name must not appear at all; otherwise `reason` must
// explain why the matches are safe. `guard`, when given, must appear just before every
// occurrence (within `window` characters).
const BROWSER_CHECKS = [
  { name: "Object.values", re: /\bObject\.values\b/, reason: "polyfills.js installs it when missing (Chromium 54+)" },
  { name: "Object.entries", re: /\bObject\.entries\b/, reason: "polyfills.js installs it when missing (Chromium 54+)" },
  { name: "Object.fromEntries", re: /\bObject\.fromEntries\b/, reason: "polyfills.js installs it when missing (Chromium 73+)" },
  { name: "Object.getOwnPropertyDescriptors", re: /\bObject\.getOwnPropertyDescriptors\(/, guard: /Object\.getOwnPropertyDescriptors\?/, window: 160, reason: "called only after the ternary check for the method" },
  { name: "Promise.allSettled", re: /\bPromise\.allSettled\b/, reason: "polyfills.js installs it when missing (Chromium 76+)" },
  { name: "Promise.prototype.finally", re: /\.finally\(/, reason: "polyfills.js installs it when missing (Chromium 63+)" },
  { name: "Reflect", re: /\bReflect\./, reason: "every use is behind a typeof Reflect check or a try block (Chromium 49+); see the Reflect.construct test" },
  { name: "Intl.Locale", re: /\bIntl\.Locale\b/, reason: "polyfills.js installs a minimal version when missing (Chromium 74+)" },
  { name: "Intl.PluralRules / RelativeTimeFormat / ListFormat", re: /\bIntl\.(PluralRules|RelativeTimeFormat|ListFormat)\b/, absent: true },
  { name: "Array.prototype.flat / flatMap", re: /\.(flat|flatMap)\(/, reason: "polyfills.js installs them when missing (Chromium 69+)" },
  { name: "String.prototype.replaceAll", re: /\.replaceAll\(/, reason: "polyfills.js installs it when missing (Chromium 85+)" },
  { name: "queueMicrotask", re: /\bqueueMicrotask\b/, reason: "polyfills.js installs it when missing (Chromium 71+)" },
  { name: "new AbortController", re: /\bnew AbortController\b/, reason: "polyfills.js installs it when missing (Chromium 66+)" },
  { name: "AbortSignal", re: /\bAbortSignal\b/, reason: "polyfills.js installs it when missing (Chromium 66+)" },
  { name: "Array.prototype.includes", re: /\.includes\(/, reason: "polyfills.js installs it when missing (Chromium 47+; shim covers older engines)" },
  { name: "String.prototype.startsWith", re: /\.startsWith\(/, reason: "polyfills.js installs it when missing (Chromium 41+)" },
  { name: "Array.prototype.find / findIndex", re: /\.find(Index)?\(/, reason: "polyfills.js installs them when missing (Chromium 45+)" },
  { name: "Array.from", re: /\bArray\.from\(/, reason: "polyfills.js installs it when missing (Chromium 45+)" },
  { name: "Object.assign", re: /\bObject\.assign\(/, reason: "polyfills.js installs it when missing (Chromium 45+)" },
  { name: "Number.isFinite / isSafeInteger / safe-integer constants", re: /\bNumber\.(isFinite|isSafeInteger|MAX_SAFE_INTEGER|MIN_SAFE_INTEGER)\b/, reason: "polyfills.js installs them when missing" },
  { name: "IntersectionObserver / ResizeObserver", re: /\b(IntersectionObserver|ResizeObserver)\b/, absent: true },
  { name: "Element.before / after / prepend / replaceWith / toggleAttribute", re: /\.(before|after|prepend|replaceWith|toggleAttribute)\(/, absent: true },
  { name: "Node.getRootNode", re: /\.getRootNode\(/, guard: /\.getRootNode\)\{/, window: 60, reason: "called only when the method exists" },
  { name: "new URL", re: /\bnew URL\(/, reason: "Chromium 32+ constructor; the one call is inside try/catch" },
  { name: ".append( (whatwg-fetch Headers and URLSearchParams)", re: /\.append\(/, reason: "whatwg-fetch's own Headers and URLSearchParams classes, not the DOM" },
  { name: "Symbol.toPrimitive / asyncIterator", re: /\bSymbol\.(toPrimitive|asyncIterator)\b/, reason: "Symbol.toPrimitive is Chromium 47+; asyncIterator is only read, and Babel emits it behind a typeof Symbol check" },
];

// The service runs on Node 4.4.4. Probed on that binary: Proxy, Reflect, WeakRef,
// URL and URLSearchParams globals, fetch, AbortController, Intl, Object.values,
// Object.getOwnPropertyDescriptors, Promise.prototype.finally, padStart/padEnd and
// Array.prototype.includes are missing; String.prototype.includes, Symbol.iterator,
// Number.isFinite and Array.prototype.fill are present.
const NODE4_CHECKS = [
  { name: "Proxy", re: /\bnew Proxy\b|\bProxy\.(revocable|prototype)\b/, absent: true },
  { name: "URLSearchParams / AbortController (globals)", re: /\bnew (URLSearchParams|AbortController)\b/, absent: true },
  { name: "Intl", re: /\bIntl\./, absent: true },
  { name: "Promise.prototype.finally", re: /\.finally\(/, absent: true },
  { name: "Reflect", re: /\bReflect\./, reason: "every use is behind a typeof Reflect check, or is the Babel native-super helper guarded by guardNativeSuperConstruct" },
  { name: "WeakRef", re: /\bWeakRef\b/, reason: "only read behind a typeof WeakRef check (node_modules feature detection)" },
  { name: "Object.values", re: /\bObject\.values\(/, reason: "node4-compat.js installs it when missing" },
  { name: "Object.getOwnPropertyDescriptors", re: /\bObject\.getOwnPropertyDescriptors\(/, guard: /Object\.getOwnPropertyDescriptors\?/, window: 160, reason: "called only after the ternary check for the method" },
  { name: "padStart / padEnd", re: /\.pad(Start|End)\(/, reason: "node4-compat.js installs them when missing" },
  { name: ".includes( (Array and String)", re: /\.includes\(/, reason: "node4-compat.js installs Array.prototype.includes when missing; String.prototype.includes exists on Node 4" },
  { name: "AbortSignal (name checks only)", re: /\bAbortSignal\b/, reason: "node-fetch compares constructor names and quotes the type in an error message; no global use" },
  { name: ".append( (Headers and URLSearchParams classes)", re: /\.append\(/, reason: "the bundled HTTP-client classes' own methods, not a Node global" },
  { name: "Symbol.toPrimitive / asyncIterator", re: /\bSymbol\.(toPrimitive|asyncIterator)\b/, reason: "read only; undefined on Node 4 and used as a lookup key, which is harmless" },
];

// Each browser check that relies on a shim must find the shim in mods/polyfills.js, so
// removing a polyfill fails here instead of passing on the strength of its reason.
const SHIM_TOKENS = {
  "Object.values": "values", "Object.entries": "entries", "Object.fromEntries": "fromEntries",
  "Promise.allSettled": "allSettled", "Promise.prototype.finally": "finally", "Intl.Locale": "Locale",
  "Array.prototype.flat / flatMap": "flatMap", "String.prototype.replaceAll": "replaceAll",
  "queueMicrotask": "queueMicrotask", "new AbortController": "AbortController", "AbortSignal": "AbortSignal",
  "Array.prototype.includes": "includes", "String.prototype.startsWith": "startsWith",
  "Array.prototype.find / findIndex": "findIndex", "Array.from": "from", "Object.assign": "assign",
  "Number.isFinite / isSafeInteger / safe-integer constants": "isSafeInteger",
};
const POLYFILLS = read("mods/polyfills.js");

// Reviewed exact snippets that are safe even though they are unguarded: the call is only
// reached after the Reflect probe in the enclosing helper has passed.
const REVIEWED_UNGUARDED_REFLECT = ["if(m())return Reflect.construct"];

function runChecks(file, checks) {
  const src = read(file);
  const hits = [];
  for (const check of checks) {
    const found = occurrences(src, check.re);
    if (!found.length) continue;
    if (check.absent) {
      hits.push(check.name + ": " + found.length + " occurrence(s), must be absent");
      continue;
    }
    if (!check.reason) hits.push(check.name + ": no reviewed reason");
    if (check.guard) {
      for (const o of found) {
        const window = o.before.slice(-(check.window || 0) || undefined);
        if (!check.guard.test(window) && !check.guard.test(o.before.slice(-40))) {
          hits.push(check.name + ": occurrence without its guard near: " + JSON.stringify(o.before.slice(-60)));
        }
      }
    }
  }
  return hits;
}

const BUILT = ["dist/early.js", "dist/userScript.js", "dist/service.js", "standalone/service/dist/core.js"];
for (const file of BUILT) {
  test(file + " is built (run npm run build first)", () => {
    assert.ok(fs.existsSync(path.join(ROOT, file)), file + " is missing; run npm run build");
  });
}

test("every shim named in the browser checks is really installed by mods/polyfills.js", () => {
  const problems = [];
  for (const check of BROWSER_CHECKS) {
    const token = SHIM_TOKENS[check.name];
    if (check.reason && /polyfills\.js/.test(check.reason)) {
      if (!token) problems.push(check.name + ": no shim token recorded");
      else if (!POLYFILLS.includes(token)) problems.push(check.name + ": polyfills.js has no \"" + token + "\"");
    }
  }
  assert.deepEqual(problems, []);
});

test("browser bundles use only Chromium 47 APIs that are shimmed, guarded or absent", () => {
  const problems = [];
  for (const file of ["dist/early.js", "dist/userScript.js"]) {
    for (const hit of runChecks(file, BROWSER_CHECKS)) problems.push(file + ": " + hit);
  }
  assert.deepEqual(problems, []);
});

test("service bundles use only Node 4.4.4 APIs that are shimmed, guarded or absent", () => {
  const problems = [];
  for (const file of ["dist/service.js", "standalone/service/dist/core.js"]) {
    for (const hit of runChecks(file, NODE4_CHECKS)) problems.push(file + ": " + hit);
  }
  assert.deepEqual(problems, []);
});

test("every Reflect.construct call in the service bundles is guarded or reviewed", () => {
  const problems = [];
  for (const file of ["dist/service.js", "standalone/service/dist/core.js", "dist/userScript.js", "dist/early.js"]) {
    const src = read(file);
    for (const o of occurrences(src, /Reflect\.construct\b/)) {
      const guarded = /typeof\s*Reflect|Reflect\s*&&|try\s*\{/.test(o.before.slice(-80));
      // A reviewed exception covers only the occurrence whose preceding text ends with it.
      const reviewed = REVIEWED_UNGUARDED_REFLECT.some((snippet) => (o.before + "Reflect.construct").endsWith(snippet));
      if (!guarded && !reviewed) problems.push(file + ": " + JSON.stringify(o.before.slice(-80) + "Reflect.construct"));
    }
  }
  assert.deepEqual(problems, []);
});
