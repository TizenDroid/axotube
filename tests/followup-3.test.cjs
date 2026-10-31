// Regression check: the app-context poll must not log an error every 5 seconds
// when the service runs with plain node (no tizen global).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("the app-context poll skips when there is no tizen runtime", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "service", "service.js"), "utf8");
  const guard = src.indexOf('if (typeof tizen === "undefined") return;');
  const call = src.indexOf("tizen.application.getAppsContext(");
  assert.ok(guard > 0 && call > guard, "guard comes before the first tizen call in the poll");
});
