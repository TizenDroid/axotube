// A stand-in for the page's globals, so the browser bundles can run in a Chromium 47 realm.
// Any property is another stub, callable and constructable: enough for code that only touches
// the page while it loads. Interfaces Chromium 47 lacks (tests/fixtures/chrome47-dom.json) read
// as undefined, so feature checks take the same branch they take on the TV. Timers are recorded
// and never fire, so a load is deterministic and leaves nothing running. Web Storage follows its
// real contract: a missing key reads as null.
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const DOM = JSON.parse(fs.readFileSync(path.join(ROOT, "tests", "fixtures", "chrome47-dom.json"), "utf8"));

// DOM navigation ends where a real page ends: a walk up or across the tree reads null, not
// another stub, so loops over ancestors and siblings terminate.
const END_OF_TREE = new Set([
  "parentNode", "parentElement", "nextSibling", "previousSibling", "nextElementSibling",
  "previousElementSibling", "firstChild", "lastChild", "firstElementChild", "lastElementChild",
  "offsetParent", "activeElement", "documentElement", "body", "head",
]);

// Every stub operation counts against a budget. A loop over the page that never ends fails here
// with a stack trace, instead of exhausting memory.
const budget = { ops: 0, limit: 200000 };
function tick() {
  budget.ops += 1;
  if (budget.ops > budget.limit) {
    throw new Error("page stub budget exceeded (" + budget.limit + " operations): a loop over the page does not end");
  }
}
function resetBudget() {
  budget.ops = 0;
}

function makeStub(label, hidden) {
  const cache = new Map();
  const handler = {
    get(target, prop) {
      tick();
      if (prop === Symbol.toPrimitive) return () => "";
      if (typeof prop === "symbol" || prop === "then") return undefined;
      if (hidden.has(prop)) return undefined;
      if (prop in target) return target[prop];
      if (END_OF_TREE.has(prop)) return null;
      if (prop === "length") return 0;
      if (!cache.has(prop)) cache.set(prop, makeStub(label + "." + prop, hidden));
      return cache.get(prop);
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
    apply() {
      tick();
      return makeStub(label + "()", hidden);
    },
    construct() {
      tick();
      return makeStub("new " + label, hidden);
    },
    has() {
      return true;
    },
  };
  return new Proxy(function () {}, handler);
}

function makeStorage() {
  const data = new Map();
  return {
    getItem(key) {
      return data.has(String(key)) ? data.get(String(key)) : null;
    },
    setItem(key, value) {
      data.set(String(key), String(value));
    },
    removeItem(key) {
      data.delete(String(key));
    },
    clear() {
      data.clear();
    },
    key(index) {
      const keys = Array.from(data.keys());
      return index < keys.length ? keys[index] : null;
    },
    get length() {
      return data.size;
    },
  };
}

// The page's globals for one run. `timers` collects the callbacks the code schedules.
function createPageSandbox(timers) {
  const unsupported = new Set(DOM.unsupported);
  const window = makeStub("window", unsupported);
  const silent = { log() {}, info() {}, warn() {}, error() {}, debug() {} };
  const schedule = function (callback) {
    timers.push(callback);
    return timers.length;
  };
  const sandbox = {
    window: window,
    self: window,
    document: makeStub("document", new Set()),
    location: makeStub("location", unsupported),
    navigator: makeStub("navigator", unsupported),
    console: silent,
    setTimeout: schedule,
    clearTimeout: function () {},
    setInterval: schedule,
    clearInterval: function () {},
    requestAnimationFrame: schedule,
    cancelAnimationFrame: function () {},
    // fetch resolves to a stub Response, as the real one does.
    fetch: function fetch() {
      return Promise.resolve(makeStub("Response", unsupported));
    },
    localStorage: makeStorage(),
    sessionStorage: makeStorage(),
  };
  DOM.supported.forEach(function (name) {
    if (!unsupported.has(name) && !(name in sandbox)) sandbox[name] = makeStub(name, unsupported);
  });
  return sandbox;
}

module.exports = { createPageSandbox, resetBudget };
