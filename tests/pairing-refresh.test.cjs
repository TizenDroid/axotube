// The phone-sync pairing code must refresh on its own timer. Gating it on
// pollFailures left the panel on "waiting" for as long as config pulls kept failing.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const src = fs.readFileSync(path.join(__dirname, "..", "mods/features/webConfig.js"), "utf8");

test("the pairing code refresh is not gated on pollFailures", () => {
  const line = src.split("\n").find((l) => l.includes("fetchPairingInfo();") && l.includes("pairingInfoAge"));
  assert.ok(line, "refresh call exists");
  assert.ok(!line.includes("pollFailures"), "refresh does not depend on pollFailures");
  assert.ok(line.includes("serviceHost()"), "refresh only runs where the service exists");
});
