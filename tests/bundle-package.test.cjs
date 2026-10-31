// The npm package the WGT and APK read through jsDelivr must carry a README:
// without one npm renders "This package does not have a README" on the package
// page, which makes a maintained package look abandoned.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

test("the bundle package script copies a README into the package", () => {
  const script = read("scripts/make-bundle-package.js");
  assert.ok(script.includes("bundle-package-README.md"), "README source named");
  assert.ok(script.includes('"README.md"'), "README written into the package");
});

test("the bundle package README explains what the package is", () => {
  const readme = read("scripts/bundle-package-README.md");
  assert.ok(readme.startsWith("# axotube"), "titled after the package");
  assert.ok(readme.includes("not a library"), "says it is not installable");
  assert.ok(readme.includes("jsDelivr"), "names the CDN the apps read");
  assert.ok(readme.includes("dist/early.js") && readme.includes("dist/userScript.js"), "lists both bundles");
});
