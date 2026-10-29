const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(ROOT, name), "utf8");

function loadBoundedCache() {
  const source = read("mods/shared/boundedCache.js").replace(/^export\s+/gm, "");
  const ctx = vm.createContext({});
  vm.runInContext(source + "\n;globalThis.createBoundedCache = createBoundedCache;", ctx);
  return ctx.createBoundedCache;
}

test("bounded cache evicts first-in entries once full", () => {
  const createBoundedCache = loadBoundedCache();
  const cache = createBoundedCache(2);
  cache.set("a", 1);
  cache.set("b", 2);
  cache.set("c", 3);
  assert.equal(cache.has("a"), false);
  assert.equal(cache.get("b"), 2);
  assert.equal(cache.get("c"), 3);
});

test("updating an existing key keeps its place (FIFO, not LRU)", () => {
  const createBoundedCache = loadBoundedCache();
  const cache = createBoundedCache(2);
  cache.set("a", 1);
  cache.set("b", 2);
  cache.set("a", 10);
  cache.set("c", 3);
  assert.equal(cache.has("a"), false, "a was first in, so it is evicted first");
  assert.equal(cache.get("b"), 2);
});

test("prototype-like keys are ordinary entries, not inherited values", () => {
  const createBoundedCache = loadBoundedCache();
  const cache = createBoundedCache(4);
  assert.equal(cache.get("constructor"), undefined);
  assert.equal(cache.get("__proto__"), undefined);
  cache.set("constructor", "value");
  assert.equal(cache.get("constructor"), "value");
});

test("delete and clear remove entries", () => {
  const createBoundedCache = loadBoundedCache();
  const cache = createBoundedCache(4);
  cache.set("a", 1);
  cache.set("b", 2);
  cache.delete("a");
  assert.equal(cache.has("a"), false);
  cache.clear();
  assert.equal(cache.has("b"), false);
});

test('every t("key") used in mods exists in en.json (fallback language)', () => {
  const en = JSON.parse(read("mods/translations/resources/en.json"));
  const lookup = (key) =>
    key.split(".").reduce((node, part) => (node == null ? undefined : node[part]), en);
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && entry.name !== "translations") walk(full);
      } else if (entry.name.endsWith(".js")) files.push(full);
    }
  };
  walk(path.join(ROOT, "mods"));
  const missing = [];
  const pattern = /\bt\(\s*["']([A-Za-z0-9_.]+)["']/g;
  for (const file of files) {
    let match;
    while ((match = pattern.exec(fs.readFileSync(file, "utf8")))) {
      if (lookup(match[1]) === undefined) missing.push(`${path.relative(ROOT, file)}: ${match[1]}`);
    }
  }
  assert.deepEqual(missing, []);
});
