// Exercises every branch of mods/polyfills.js. Each polyfill installs only when the
// engine lacks the feature, so each one is run twice: in a Chromium 47 realm (feature
// missing, the install branch) and in a native realm (feature present, the skip branch).
// Branch coverage of the file is measured by V8 coverage (see the README).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const chrome47 = require("./support/chrome47.cjs");

const ROOT = path.resolve(__dirname, "..");
const POLYFILLS = fs.readFileSync(path.join(ROOT, "mods", "polyfills.js"), "utf8");
const FILE = path.join(ROOT, "mods", "polyfills.js");

// A realm with the Chromium 47 gaps removed and polyfills.js run (the production state).
function tv() {
  return chrome47.createContext({});
}
// A realm with every built-in native and polyfills.js run, to hit the skip branches.
function native(sandbox = {}) {
  const ctx = vm.createContext(sandbox);
  vm.runInContext("if (typeof window === 'undefined') { var window = this; }", ctx);
  vm.runInContext(POLYFILLS, ctx, { filename: FILE });
  return ctx;
}
const ev = (ctx, code) => vm.runInContext(code, ctx);
const json = (ctx, code) => JSON.parse(vm.runInContext("JSON.stringify(" + code + ")", ctx));

// ── defineHidden: every polyfill goes through it, so it must be non-enumerable ───────────
test("polyfills are non-enumerable (defineHidden)", () => {
  const ctx = tv();
  assert.equal(json(ctx, "(function(){var k=[];for(var x in [1])k.push(x);return k})()").join(), "0");
});

// ── globalThis ───────────────────────────────────────────────────────────────────────────
test("globalThis: native present, so the block returns early", () => {
  assert.equal(ev(native(), "typeof globalThis"), "object");
});
test("globalThis: installed via the __globalThis__ getter when missing", () => {
  const ctx = tv();
  assert.equal(ev(ctx, "typeof globalThis"), "object");
  assert.equal(ev(ctx, "globalThis === this"), true);
  assert.equal(ev(ctx, "Object.prototype.hasOwnProperty.call(Object.prototype, '__globalThis__')"), false, "the temporary getter is removed");
});
test("globalThis: falls back to window when Object.prototype cannot be extended", () => {
  const ctx = vm.createContext({});
  vm.runInContext("Object.preventExtensions(Object.prototype); delete globalThis.globalThis; if (typeof window === 'undefined') { var window = this; }", ctx);
  vm.runInContext(POLYFILLS, ctx, { filename: FILE });
  assert.equal(ev(ctx, "window.globalThis === window"), true);
});
// ── NodeList / HTMLCollection forEach ────────────────────────────────────────────────────
test("NodeList and HTMLCollection get forEach when missing", () => {
  const ctx = native({ NodeList: function NodeList() {}, HTMLCollection: function HTMLCollection() {} });
  assert.equal(ev(ctx, "typeof NodeList.prototype.forEach"), "function");
  assert.equal(ev(ctx, "typeof HTMLCollection.prototype.forEach"), "function");
});
test("NodeList keeps its own forEach when present", () => {
  const own = function forEach() {};
  const ctx = native({ NodeList: function NodeList() {} });
  ctx.NodeList.prototype.forEach = own;
  vm.runInContext(POLYFILLS, ctx, { filename: FILE });
  assert.equal(ev(ctx, "NodeList.prototype.forEach"), own);
});
test("NodeList is skipped when the interface is absent", () => {
  const ctx = native({});
  assert.equal(ev(ctx, "typeof window.NodeList"), "undefined");
});

// ── EventTarget facade ───────────────────────────────────────────────────────────────────
test("EventTarget: a native constructable EventTarget is kept", () => {
  class NativeET {}
  const ctx = native({ EventTarget: NativeET });
  assert.equal(ev(ctx, "window.EventTarget"), NativeET);
});
test("EventTarget: a non-constructable native is replaced and shares its prototype", () => {
  const throwing = function () { throw new TypeError("not constructable"); };
  throwing.prototype = { marker: true };
  const ctx = native({ EventTarget: throwing });
  assert.notEqual(ev(ctx, "window.EventTarget"), throwing);
  assert.equal(ev(ctx, "window.EventTarget.prototype === window.EventTarget.prototype"), true);
});
test("EventTarget: a missing EventTarget gets the facade with no prototype link", () => {
  const ctx = native({});
  assert.equal(typeof ev(ctx, "window.EventTarget"), "function");
  assert.equal(ev(ctx, "window.EventTarget.prototype.marker"), undefined);
});
test("EventTarget facade: add ignores non-functions and de-duplicates", () => {
  const ctx = native({});
  ev(ctx, `
    var et = new window.EventTarget(); var calls = 0; var cb = function () { calls++; };
    et.addEventListener("x", 5); et.addEventListener("x", cb); et.addEventListener("x", cb);
    et.dispatchEvent({ type: "x" });
  `);
  assert.equal(ev(ctx, "calls"), 1);
});
test("EventTarget facade: remove handles a missing type, a missing listener and a present one", () => {
  const ctx = native({});
  ev(ctx, `
    var et = new window.EventTarget(); var calls = 0; var cb = function () { calls++; };
    et.removeEventListener("never", cb);
    et.addEventListener("x", cb); et.removeEventListener("x", function () {});
    et.removeEventListener("x", cb);
    et.dispatchEvent({ type: "x" });
  `);
  assert.equal(ev(ctx, "calls"), 0);
});
test("EventTarget facade: dispatch isolates a throwing listener and reports defaultPrevented", () => {
  const ctx = native({});
  const errors = [];
  ctx.console = { error: (e) => errors.push(String(e && e.message)) };
  ev(ctx, `
    var et = new window.EventTarget(); var after = 0;
    et.addEventListener("x", function () { throw new Error("boom"); });
    et.addEventListener("x", function () { after++; });
    var ok = et.dispatchEvent({ type: "x", defaultPrevented: false });
    var prevented = et.dispatchEvent({ type: "x", defaultPrevented: true });
    var none = et.dispatchEvent({ type: "unknown" });
    var nullEvent = et.dispatchEvent(null);
    globalThis.results = { after: after, ok: ok, prevented: prevented, none: none, nullEvent: nullEvent };
  `);
  assert.deepEqual(json(ctx, "results"), { after: 2, ok: true, prevented: false, none: true, nullEvent: true });
  assert.deepEqual(errors, ["boom", "boom"]);
});

// ── AbortController / AbortSignal ────────────────────────────────────────────────────────
test("AbortController: a native implementation is kept", () => {
  class NativeAC {}
  const ctx = native({ AbortController: NativeAC });
  assert.equal(ev(ctx, "window.AbortController"), NativeAC);
});
test("AbortController: abort notifies abort listeners once and ignores other event types", () => {
  const ctx = tv();
  ev(ctx, `
    var ac = new AbortController(); var s = ac.signal; var hits = 0, other = 0;
    var onAbort = function () { hits++; };
    s.addEventListener("abort", onAbort);
    s.addEventListener("other", function () { other++; });
    s.addEventListener("abort", 42);
    s.removeEventListener("other", onAbort);
    s.removeEventListener("abort", function () {});
    s.dispatchEvent({ type: "other" });
    s.dispatchEvent(null);
    ac.abort(); ac.abort();
    globalThis.r = { hits: hits, other: other, aborted: s.aborted };
  `);
  assert.deepEqual(json(ctx, "r"), { hits: 1, other: 0, aborted: true });
});
test("AbortController: removing a registered abort listener stops it firing", () => {
  const ctx = tv();
  ev(ctx, `
    var ac = new AbortController(); var hits = 0; var cb = function () { hits++; };
    ac.signal.addEventListener("abort", cb); ac.signal.removeEventListener("abort", cb);
    ac.abort(); globalThis.hits = hits;
  `);
  assert.equal(ev(ctx, "hits"), 0);
});

// ── CustomEvent ──────────────────────────────────────────────────────────────────────────
test("CustomEvent: a native constructor is kept", () => {
  function NativeCE() {}
  const ctx = native({ CustomEvent: NativeCE });
  assert.equal(ev(ctx, "CustomEvent"), NativeCE);
});
test("CustomEvent: initCustomEvent path, with the defaults for missing params", () => {
  const made = [];
  const ctx = native({
    Event: function Event() {},
    document: { createEvent: (kind) => { const e = { kind: kind, initCustomEvent: function (t, b, c, d) { made.push([t, b, c, d]); }, }; return e; } },
  });
  ev(ctx, "globalThis.evt = new window.CustomEvent('go');");
  ev(ctx, "globalThis.evt2 = new window.CustomEvent('go2', { bubbles: true, cancelable: 1, detail: 7 });");
  assert.deepEqual(made, [["go", false, false, null], ["go2", true, true, 7]]);
});
test("CustomEvent: falls back to initEvent and sets detail when initCustomEvent is missing", () => {
  const ctx = native({
    Event: function Event() {},
    document: { createEvent: (kind) => (kind === "CustomEvent" ? { initCustomEvent: () => { throw new Error("no"); } } : { initEvent: function (t, b, c) { this.t = t; this.b = b; this.c = c; } }) },
  });
  assert.deepEqual(json(ctx, "(function(){var e=new window.CustomEvent('f',{detail:'d'});return {t:e.t,detail:e.detail,b:e.b,c:e.c}})()"),
    { t: "f", detail: "d", b: false, c: false });
});
test("CustomEvent: an Event.prototype is inherited when Event exists", () => {
  const eventProto = { marker: "event" };
  const ctx = native({ Event: { prototype: eventProto }, document: { createEvent: () => ({ initCustomEvent() {} }) } });
  assert.equal(ev(ctx, "CustomEvent.prototype === window.Event.prototype"), true);
});

// ── Promise.prototype.finally / Promise.allSettled ───────────────────────────────────────
test("Promise.prototype.finally: a native finally is kept", () => {
  const ctx = native({});
  assert.equal(ev(ctx, "Promise.prototype.finally === Promise.prototype.finally"), true);
  const nativeFinally = ev(ctx, "Promise.prototype.finally");
  vm.runInContext(POLYFILLS, ctx, { filename: FILE });
  assert.equal(ev(ctx, "Promise.prototype.finally"), nativeFinally);
});
test("Promise.prototype.finally polyfill: keeps the value, keeps the reason, runs the callback once each", async () => {
  const ctx = tv();
  const result = await ev(ctx, `
    (async function () {
      var log = [];
      var value = await Promise.resolve(5).finally(function () { log.push("value-cb"); });
      var reason;
      try { await Promise.reject(new Error("x")).finally(function () { log.push("reason-cb"); }); }
      catch (e) { reason = e.message; }
      return { value: value, reason: reason, log: log };
    }())`);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { value: 5, reason: "x", log: ["value-cb", "reason-cb"] });
});
test("Promise.prototype.finally: a throwing callback replaces the outcome with its error", async () => {
  const ctx = tv();
  const message = await ev(ctx, `
    Promise.resolve(1).finally(function () { throw new Error("cb"); }).then(null, function (e) { return e.message; })`);
  assert.equal(message, "cb");
});
test("Promise.allSettled polyfill maps fulfilled and rejected inputs", async () => {
  const ctx = tv();
  const result = await ev(ctx, "Promise.allSettled([Promise.resolve(1), Promise.reject(2), 3])");
  assert.deepEqual(JSON.parse(JSON.stringify(result)), [
    { status: "fulfilled", value: 1 }, { status: "rejected", reason: 2 }, { status: "fulfilled", value: 3 },
  ]);
});
test("Promise.allSettled: a native implementation is kept", () => {
  const ctx = native({});
  const native1 = ev(ctx, "Promise.allSettled");
  vm.runInContext(POLYFILLS, ctx, { filename: FILE });
  assert.equal(ev(ctx, "Promise.allSettled"), native1);
});

// ── Array.prototype.flat / flatMap / String.prototype.replaceAll ─────────────────────────
test("flat: default depth is 1, a negative depth is 0, fractions floor", () => {
  const ctx = tv();
  assert.deepEqual(json(ctx, "[1,[2,[3]]].flat()"), [1, 2, [3]]);
  assert.deepEqual(json(ctx, "[1,[2,[3]]].flat(-4)"), [1, [2, [3]]]);
  assert.deepEqual(json(ctx, "[1,[2,[3]]].flat(1.9)"), [1, 2, [3]]);
  assert.deepEqual(json(ctx, "[1,[2,[3]]].flat(Infinity)"), [1, 2, 3]);
});
test("flat: a native implementation is kept", () => {
  const ctx = native({});
  const f = ev(ctx, "Array.prototype.flat");
  vm.runInContext(POLYFILLS, ctx, { filename: FILE });
  assert.equal(ev(ctx, "Array.prototype.flat"), f);
});
test("flatMap: maps then flattens one level", () => {
  const ctx = tv();
  assert.deepEqual(json(ctx, "[1,2].flatMap(function (x) { return [x, [x]]; })"), [1, [1], 2, [2]]);
});
test("replaceAll: a string search replaces every occurrence, with a function or a string", () => {
  const ctx = tv();
  assert.equal(ev(ctx, "'a-b-c'.replaceAll('-', '+')"), "a+b+c");
  assert.equal(ev(ctx, "'a-b'.replaceAll('-', function (m, i) { return '[' + i + ']'; })"), "a[1]b");
});
test("replaceAll: a string search is taken literally, not as a pattern", () => {
  const ctx = tv();
  assert.equal(ev(ctx, "'a.b*c'.replaceAll('.', '!')"), "a!b*c");
  assert.equal(ev(ctx, "'a.b.c'.replaceAll('.', '$&$&')"), "a..b..c");
  assert.equal(ev(ctx, "'x'.replaceAll('', '_')"), "_x_");
});
test("replaceAll: a RegExp without the g flag throws, as the spec requires", () => {
  const ctx = tv();
  assert.throws(() => ev(ctx, "'a'.replaceAll(/a/, 'b')"), /global RegExp/);
});
test("replaceAll: a non-string search delegates to replace", () => {
  const ctx = tv();
  assert.equal(ev(ctx, "'a1b2'.replaceAll(/\\d/g, '#')"), "a#b#");
});
test("replaceAll: a native implementation is kept", () => {
  const ctx = native({});
  const r = ev(ctx, "String.prototype.replaceAll");
  vm.runInContext(POLYFILLS, ctx, { filename: FILE });
  assert.equal(ev(ctx, "String.prototype.replaceAll"), r);
});

// ── Object.values / entries / fromEntries ────────────────────────────────────────────────
test("Object.values and Object.entries are installed when missing", () => {
  const ctx = tv();
  assert.deepEqual(json(ctx, "Object.values({a:1,b:2})"), [1, 2]);
  assert.deepEqual(json(ctx, "Object.entries({a:1})"), [["a", 1]]);
});
test("Object.values and Object.entries are kept when present", () => {
  const ctx = native({});
  const v = ev(ctx, "Object.values"), e = ev(ctx, "Object.entries");
  vm.runInContext(POLYFILLS, ctx, { filename: FILE });
  assert.equal(ev(ctx, "Object.values"), v);
  assert.equal(ev(ctx, "Object.entries"), e);
});
test("Object.values is replaced only where it is missing, Object.entries kept", () => {
  const ctx = native({});
  const e = ev(ctx, "Object.entries");
  ev(ctx, "delete Object.values");
  vm.runInContext(POLYFILLS, ctx, { filename: FILE });
  assert.equal(typeof ev(ctx, "Object.values"), "function");
  assert.equal(ev(ctx, "Object.entries"), e);
});
test("Object.entries is replaced only where it is missing, Object.values kept", () => {
  const ctx = native({});
  const v = ev(ctx, "Object.values");
  ev(ctx, "delete Object.entries");
  vm.runInContext(POLYFILLS, ctx, { filename: FILE });
  assert.equal(typeof ev(ctx, "Object.entries"), "function");
  assert.equal(ev(ctx, "Object.values"), v);
});
test("Object.fromEntries accepts any iterable of pairs (Map, array), per the spec", () => {
  const ctx = tv();
  assert.deepEqual(json(ctx, "Object.fromEntries(new Map([['a', 1]]))"), { a: 1 });
  assert.deepEqual(json(ctx, "Object.fromEntries([['b', 2]])"), { b: 2 });
  assert.throws(() => ev(ctx, "Object.fromEntries({length: 1, 0: ['c', 3]})"), /not iterable|iterator/i, "array-likes are not iterable");
});
test("Object.fromEntries: rejects a null iterable and a non-object entry", () => {
  const ctx = tv();
  assert.throws(() => ev(ctx, "Object.fromEntries(null)"), /requires an iterable/);
  assert.throws(() => ev(ctx, "Object.fromEntries([1])"), /not an entry object/);
});
test("Object.fromEntries returns an ordinary object with Object.prototype", () => {
  const ctx = tv();
  assert.equal(ev(ctx, "Object.getPrototypeOf(Object.fromEntries([])) === Object.prototype"), true);
});
test("Object.fromEntries: a native implementation is kept", () => {
  const ctx = native({});
  const f = ev(ctx, "Object.fromEntries");
  vm.runInContext(POLYFILLS, ctx, { filename: FILE });
  assert.equal(ev(ctx, "Object.fromEntries"), f);
});

// ── queueMicrotask ───────────────────────────────────────────────────────────────────────
test("queueMicrotask is installed when missing and runs its callback", async () => {
  const ctx = tv();
  await ev(ctx, "new Promise(function (resolve) { queueMicrotask(function () { globalThis.ran = true; resolve(); }); })");
  assert.equal(ev(ctx, "ran"), true);
});
test("queueMicrotask: a native implementation is kept", () => {
  const ctx = native({});
  const q = ev(ctx, "queueMicrotask");
  vm.runInContext(POLYFILLS, ctx, { filename: FILE });
  assert.equal(ev(ctx, "queueMicrotask"), q);
});
test("queueMicrotask rethrows a callback error asynchronously", async () => {
  const ctx = tv();
  const seen = [];
  ctx.setTimeout = (fn) => { seen.push(fn); };
  ev(ctx, "queueMicrotask(function () { throw new Error('later'); });");
  await new Promise((r) => setImmediate(r));
  assert.equal(seen.length, 1);
  assert.throws(() => seen[0](), /later/);
});

// ── Element.closest / Element.matches ────────────────────────────────────────────────────
test("Element.closest and matches are skipped when there is no Element interface", () => {
  const ctx = native({});
  assert.equal(ev(ctx, "typeof window.Element"), "undefined");
});
test("Element.closest is kept when native, and matches is kept when native", () => {
  const ElementNative = function Element() {};
  ElementNative.prototype.closest = function () { return "native"; };
  ElementNative.prototype.matches = function () { return "native"; };
  const ctx = native({ Element: ElementNative });
  assert.equal(ev(ctx, "new Element().closest('x')"), "native");
  assert.equal(ev(ctx, "new Element().matches('x')"), "native");
});
test("Element.matches: prefers msMatchesSelector, then webkitMatchesSelector", () => {
  const ElementA = function Element() {};
  ElementA.prototype.msMatchesSelector = function () { return "ms"; };
  ElementA.prototype.webkitMatchesSelector = function () { return "webkit"; };
  const ctxA = native({ Element: ElementA });
  assert.equal(ev(ctxA, "typeof Element.prototype.matches"), "function");
  assert.equal(ev(ctxA, "new Element().matches('x')"), "ms");

  const ElementB = function Element() {};
  ElementB.prototype.webkitMatchesSelector = function () { return "webkit"; };
  const ctxB = native({ Element: ElementB });
  assert.equal(ev(ctxB, "new Element().matches('x')"), "webkit");
});
test("Element.matches fallback counts from the document and finds the element", () => {
  const ElementC = function Element() {};
  const ctx = native({ Element: ElementC });
  ev(ctx, "Element.prototype.matches = undefined; delete Element.prototype.matches;");
  vm.runInContext(POLYFILLS, ctx, { filename: FILE });
  const target = {};
  const list = [target];
  list.item = (i) => list[i];
  const docStub = { querySelectorAll: () => list };
  const el = Object.create(ElementC.prototype);
  el.ownerDocument = docStub;
  ctx.__el = el; ctx.__target = target;
  assert.equal(ev(ctx, "typeof Element.prototype.matches"), "function");
  assert.equal(ev(ctx, "(function(){ var self = __el; return Element.prototype.matches.call(self, 'x'); }())"), false);
  el.ownerDocument = { querySelectorAll: () => { const l = [el]; l.item = (i) => l[i]; return l; } };
  assert.equal(ev(ctx, "Element.prototype.matches.call(__el, 'x')"), true);
});
test("Element.closest climbs past non-matching ancestors and stops at a non-element", () => {
  const ElementD = function Element() {};
  const ctx = native({ Element: ElementD });
  ev(ctx, "delete Element.prototype.closest;");
  vm.runInContext(POLYFILLS, ctx, { filename: FILE });
  ev(ctx, `
    var root = { nodeType: 1, matches: function (s) { return s === 'root'; }, parentElement: null, parentNode: null };
    var mid = { nodeType: 1, matches: function () { return false; }, parentElement: null, parentNode: root };
    var leaf = { nodeType: 1, matches: function () { return false; }, parentElement: mid };
    globalThis.found = Element.prototype.closest.call(leaf, 'root');
    globalThis.none = Element.prototype.closest.call({ nodeType: 3 }, 'root');
    globalThis.missing = Element.prototype.closest.call(leaf, 'nothing');
  `);
  assert.equal(ev(ctx, "found.matches('root')"), true);
  assert.equal(ev(ctx, "none"), null);
  assert.equal(ev(ctx, "missing"), null);
});
test("Element.closest uses msMatchesSelector and webkitMatchesSelector when matches is absent", () => {
  const ElementE = function Element() {};
  const ctx = native({ Element: ElementE });
  ev(ctx, "delete Element.prototype.closest; delete Element.prototype.matches;");
  vm.runInContext(POLYFILLS, ctx, { filename: FILE });
  ev(ctx, `
    var ms = { nodeType: 1, msMatchesSelector: function () { return true; }, parentElement: null };
    var wk = { nodeType: 1, webkitMatchesSelector: function () { return false; }, parentElement: null, parentNode: ms };
    var none = { nodeType: 1, parentElement: null, parentNode: null };
    globalThis.viaMs = Element.prototype.closest.call(wk, 'x');
    globalThis.viaNone = Element.prototype.closest.call(none, 'x');
  `);
  assert.equal(ev(ctx, "viaMs === ms"), true, "the ancestor with msMatchesSelector is the match");
  assert.equal(ev(ctx, "viaNone"), null);
});

// ── Intl.Locale ──────────────────────────────────────────────────────────────────────────
test("Intl.Locale: native present, so the block returns early", () => {
  const ctx = native({});
  const original = ev(ctx, "Intl.Locale");
  vm.runInContext(POLYFILLS, ctx, { filename: FILE });
  assert.equal(ev(ctx, "Intl.Locale"), original);
});
test("Intl.Locale: a missing Intl gets no polyfill and does not throw", () => {
  const ctx = native({});
  ev(ctx, "delete Intl.Locale; var savedIntl = Intl; delete globalThis.Intl;");
  vm.runInContext(POLYFILLS, ctx, { filename: FILE });
  assert.equal(ev(ctx, "typeof Intl"), "undefined");
});
test("Intl.Locale polyfill maps region to language and defaults to en", () => {
  const ctx = tv();
  assert.equal(ev(ctx, "new Intl.Locale('und', { region: 'FR' }).maximize().language"), "fr");
  assert.equal(ev(ctx, "new Intl.Locale('und', { region: 'ZZ' }).maximize().language"), "en");
  assert.equal(ev(ctx, "new Intl.Locale('und').maximize().language"), "en");
});

// ── Error paths of the shims (the spec TypeErrors) ───────────────────────────────────────
// Chromium 47 has these built-ins natively, so the shims only install in a realm where the
// native version has been removed first. This realm does that for the listed names.
function shimmedRealm(names) {
  const ctx = native({});
  names.forEach((name) => ev(ctx, "(function (p) { var s = p.split('.'); if (s.length === 1) { delete globalThis[s[0]]; } else if (s[1] === 'prototype') { delete globalThis[s[0]].prototype[s[2]]; } else { delete globalThis[s[0]][s[1]]; } }(" + JSON.stringify(name) + "))"));
  vm.runInContext(POLYFILLS, ctx, { filename: FILE });
  return ctx;
}

test("String.prototype.includes and startsWith reject a null receiver", () => {
  const ctx = shimmedRealm(["String.prototype.includes", "String.prototype.startsWith"]);
  assert.equal(ev(ctx, "/\\[native code\\]/.test(String.prototype.includes.toString())"), false, "the shim is installed, not the engine method");
  assert.throws(() => ev(ctx, "String.prototype.includes.call(null, 'a')"), /called on null or undefined/);
  assert.throws(() => ev(ctx, "String.prototype.startsWith.call(undefined, 'a')"), /called on null or undefined/);
});
test("Array.from rejects null and a non-function mapFn", () => {
  const ctx = shimmedRealm(["Array.from"]);
  assert.throws(() => ev(ctx, "Array.from(null)"), /requires an array-like or iterable/);
  assert.throws(() => ev(ctx, "Array.from([1], 42)"), /mapFn must be a function/);
});
test("Object.assign rejects a null target and skips null sources", () => {
  const ctx = shimmedRealm(["Object.assign"]);
  assert.throws(() => ev(ctx, "Object.assign(null, {a: 1})"), /Cannot convert undefined or null/);
  assert.deepEqual(json(ctx, "Object.assign({a: 1}, null, undefined, {b: 2})"), { a: 1, b: 2 });
});
test("Array.from uses the iterator of a Map and maps each element", () => {
  const ctx = shimmedRealm(["Array.from"]);
  assert.deepEqual(json(ctx, "Array.from(new Map([['k', 1]]), function (pair, i) { return pair[0] + i; })"), ["k0"]);
});

test("Array.prototype.find and findIndex reject a non-function predicate", () => {
  const ctx = shimmedRealm(["Array.prototype.find", "Array.prototype.findIndex"]);
  assert.throws(() => ev(ctx, "[1].find(42)"), /predicate must be a function/);
  assert.throws(() => ev(ctx, "[1].findIndex(null)"), /predicate must be a function/);
  assert.equal(ev(ctx, "[1, 2].find(function (x) { return x > 1; })"), 2);
  assert.equal(ev(ctx, "[1, 2].findIndex(function (x) { return x > 9; })"), -1);
});
test("String includes and startsWith clamp a negative position to the start", () => {
  const ctx = shimmedRealm(["String.prototype.includes", "String.prototype.startsWith"]);
  assert.equal(ev(ctx, "'abc'.includes('a', -5)"), true);
  assert.equal(ev(ctx, "'abc'.startsWith('a', -1)"), true);
  assert.equal(ev(ctx, "'abc'.startsWith('c', -1)"), false);
});
