// The browser bundle must run on engines that lack the ES2015-ES2017 built-ins it
// calls. Each built-in is removed from a fresh VM realm, the real mods/polyfills.js is
// run inside it, and the shims are checked against the spec behavior the app relies on.
// Also checks that the polyfills are non-enumerable, so for...in over arrays stays
// clean, and that native built-ins are left untouched. Syntax is covered separately by
// es5-output.test.cjs; this file covers runtime built-ins, which a parser cannot see.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const chrome47 = require("./support/chrome47.cjs");

const ROOT = path.resolve(__dirname, "..");
const SRC = fs.readFileSync(path.join(ROOT, "mods", "polyfills.js"), "utf8");
const acorn = require(path.join(ROOT, "mods", "node_modules", "acorn"));

// Removes the built-ins in a realm, as an engine without them would have. Number is
// swapped for a bare function because its static members are non-configurable.
const STRIPPED = `
  delete Array.prototype.includes;
  delete Array.prototype.find;
  delete Array.prototype.findIndex;
  delete Array.prototype.flat;
  delete Array.prototype.flatMap;
  delete Array.from;
  delete Object.assign;
  delete Object.values;
  delete Object.entries;
  delete Object.fromEntries;
  delete String.prototype.includes;
  delete String.prototype.startsWith;
  delete String.prototype.replaceAll;
  (function () {
    var Bare = function Number(v) { return +v; };
    Bare.prototype = Number.prototype;
    Number = Bare;
  }());
`;

function load(strip) {
  const ctx = chrome47.createContext({ window: {} });
  if (strip) vm.runInContext(STRIPPED, ctx);
  vm.runInContext(SRC, ctx, { filename: path.join(ROOT, "mods", "polyfills.js") });
  return ctx;
}

// Evaluates an expression in the realm and returns its JSON form (undefined stays "undefined").
function run(ctx, expr) {
  const value = vm.runInContext(expr, ctx);
  return value === undefined ? "undefined" : JSON.stringify(value);
}

test("mods/polyfills.js parses as ES5", () => {
  assert.doesNotThrow(() => acorn.parse(SRC, { ecmaVersion: 5 }));
});

test("every shimmed built-in is installed when the engine lacks it", () => {
  const ctx = load(true);
  const present = [
    "typeof Array.prototype.includes === 'function'",
    "typeof Array.prototype.find === 'function'",
    "typeof Array.prototype.findIndex === 'function'",
    "typeof Array.prototype.flat === 'function'",
    "typeof Array.prototype.flatMap === 'function'",
    "typeof Array.from === 'function'",
    "typeof Object.assign === 'function'",
    "typeof Object.values === 'function'",
    "typeof Object.entries === 'function'",
    "typeof Object.fromEntries === 'function'",
    "typeof String.prototype.includes === 'function'",
    "typeof String.prototype.startsWith === 'function'",
    "typeof String.prototype.replaceAll === 'function'",
    "typeof Number.isFinite === 'function'",
    "typeof Number.isSafeInteger === 'function'",
    "Number.MAX_SAFE_INTEGER === 9007199254740991",
    "Number.MIN_SAFE_INTEGER === -9007199254740991",
  ];
  for (const expr of present) assert.equal(run(ctx, expr), "true", expr);
});

const CASES = [
  ["[1, NaN].includes(NaN)", "true"],
  ["[1, 2].includes(3)", "false"],
  ["[1, 2, 3].includes(1, 1)", "false"],
  ["[1, 2, 3].includes(3, -1)", "true"],
  ["[1, 2, 3].find(function (x) { return x > 1; })", "2"],
  ["[1, 2, 3].find(function (x) { return x > 9; })", "undefined"],
  ["[1, 2, 3].findIndex(function (x) { return x > 1; })", "1"],
  ["[1, 2, 3].findIndex(function (x) { return x > 9; })", "-1"],
  ["[1, [2, [3]]].flat(Infinity)", "[1,2,3]"],
  ["Array.from(new Set([1, 2, 2]))", "[1,2]"],
  ["Array.from('ab')", '["a","b"]'],
  ["Array.from({ length: 2, 0: 'x', 1: 'y' })", '["x","y"]'],
  ["Array.from([1, 2], function (x) { return x * 10; })", "[10,20]"],
  ["Array.from(new Map([['k', 1]]).entries())", '[["k",1]]'],
  ["Object.assign({}, { a: 1 }, null, { b: 2 })", '{"a":1,"b":2}'],
  ["Object.values({ a: 1, b: 2 })", "[1,2]"],
  ["Object.entries({ a: 1 })", '[["a",1]]'],
  ["Object.fromEntries([['a', 1]])", '{"a":1}'],
  ["'a-b-c'.replaceAll('-', '+')", '"a+b+c"'],
  ["'abc'.includes('b')", "true"],
  ["'abc'.includes('a', 1)", "false"],
  ["'abc'.startsWith('ab')", "true"],
  ["'abc'.startsWith('b', 1)", "true"],
  ["'abc'.startsWith('a', 5)", "false"],
  ["(function () { try { 'a'.includes(/a/); return 'no'; } catch (e) { return e.name; } }())", '"TypeError"'],
  ["Number.isFinite(1)", "true"],
  ["Number.isFinite('1')", "false"],
  ["Number.isFinite(NaN)", "false"],
  ["Number.isSafeInteger(5)", "true"],
  ["Number.isSafeInteger(5.5)", "false"],
  ["Number.isSafeInteger(9007199254740992)", "false"],
];

const ctx = load(true);
for (const [expr, expected] of CASES) {
  test("shim behaves as the spec: " + expr, () => {
    assert.equal(run(ctx, expr), expected);
  });
}

test("polyfills are non-enumerable, so for...in over an array only yields indices", () => {
  const stripped = load(true);
  assert.equal(
    run(stripped, "(function () { var keys = []; for (var k in [1]) keys.push(k); return keys; }())"),
    '["0"]'
  );
  assert.equal(run(stripped, "Object.keys(Array.prototype).length"), "0");
  assert.equal(run(stripped, "Object.keys(Object).length"), "0");
});

test("native built-ins are left untouched when the engine already has them", () => {
  const ctx = load(false);
  const expr =
    "[Array.prototype.includes, Array.prototype.find, Array.from, Object.assign," +
    " String.prototype.includes, Number.isFinite].every(function (f) {" +
    " return /\\[native code\\]/.test(Function.prototype.toString.call(f)); })";
  assert.equal(run(ctx, expr), "true");
});
