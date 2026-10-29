// The shipped bundles must be strict ES5 syntax, since the Tizen 4 engine
// rejects anything newer. Parsed with acorn at ecmaVersion 5, so any arrow
// function, let/const, class, template literal or generator left in the
// output fails here. Run `npm run build` first.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const acorn = require(path.join(ROOT, "mods", "node_modules", "acorn"));

for (const file of ["dist/userScript.js", "dist/service.js"]) {
  test(`${file} parses as ES5`, () => {
    const src = fs.readFileSync(path.join(ROOT, file), "utf8");
    assert.doesNotThrow(() => acorn.parse(src, { ecmaVersion: 5 }));
  });
}
