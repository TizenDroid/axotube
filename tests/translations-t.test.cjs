// The UI string lookup that replaces i18next. The app only needs English lookups with
// {{name}} interpolation, so this checks that, plus that every literal key the code
// asks for exists in the English resource file.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

// t.js is an ES module; evaluate it with its import replaced by a plain read.
const en = JSON.parse(read("mods/translations/resources/en.json"));
const source = read("mods/translations/t.js")
  .replace(
    'import en from "./resources/en.json";',
    'const en = JSON.parse(require("fs").readFileSync(require("path").join(__dirname, "resources", "en.json"), "utf8"));'
  )
  .replace("export function t", "function t") + "\nmodule.exports = { t };";
const mod = { exports: {} };
new Function("module", "exports", "require", "__dirname", source)(mod, mod.exports, require, path.join(ROOT, "mods", "translations"));
const { t } = mod.exports;

function leaves(node, prefix, out) {
  for (const key of Object.keys(node)) {
    const value = node[key];
    const here = prefix ? prefix + "." + key : key;
    if (typeof value === "string") out.push([here, value]);
    else if (value && typeof value === "object") leaves(value, here, out);
  }
  return out;
}

test("looks up a nested English string", () => {
  assert.equal(t("app.name"), en.app.name);
});

test("interpolates every {{name}} placeholder when values are given", () => {
  for (const [key, text] of leaves(en, "", [])) {
    const names = [...text.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]);
    if (!names.length) continue;
    const values = Object.fromEntries(names.map((n) => [n, "VALUE_" + n]));
    const out = t(key, values);
    assert.ok(!/\{\{/.test(out), key + " left a placeholder: " + out);
    for (const n of names) assert.ok(out.includes("VALUE_" + n), key + " did not insert " + n);
  }
});

test("leaves a placeholder in place when no value is given for it", () => {
  const withPlaceholder = leaves(en, "", []).find(([, text]) => /\{\{version\}\}/.test(text));
  assert.ok(withPlaceholder, "a key with {{version}} exists");
  assert.ok(t(withPlaceholder[0], {}).includes("{{version}}"));
});

test("returns the key itself for a missing key, as i18next did", () => {
  assert.equal(t("no.such.key"), "no.such.key");
  assert.equal(t("app"), "app", "an object node is not a string, so it is treated as missing");
});

test("every literal key the app asks for exists in en.json", () => {
  const files = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && entry.name !== "resources") walk(full);
      } else if (full.endsWith(".js")) files.push(full);
    }
  })(path.join(ROOT, "mods"));
  const missing = new Map();
  const literal = /(?:^|[^\w.])t\(\s*["'`]([a-zA-Z][\w.]*)["'`]/g;
  for (const file of files) {
    let m;
    const src = fs.readFileSync(file, "utf8");
    while ((m = literal.exec(src))) {
      if (t(m[1]) === m[1]) {
        const where = missing.get(m[1]) || [];
        where.push(path.relative(ROOT, file));
        missing.set(m[1], where);
      }
    }
  }
  assert.deepEqual([...missing.entries()], []);
});
