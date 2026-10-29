// Every custom action the client dispatches must have a handler in the router.
// Catches renames that update one side only (the settings entry broke this way).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

// Actions defined by YouTube's own client, not by us.
const NATIVE_ACTIONS = new Set(["ACTION_ADD_VIDEO"]);

function modFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "test") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) modFiles(p, out);
    else if (p.endsWith(".js")) out.push(p);
  }
  return out;
}

test("every dispatched customAction has a router case", () => {
  const dispatched = new Set();
  for (const file of modFiles(path.join(ROOT, "mods"))) {
    const src = fs.readFileSync(file, "utf8");
    for (const m of src.matchAll(/action\s*:\s*["'`]([A-Z_]+)["'`]/g)) dispatched.add(m[1]);
  }
  const router = fs.readFileSync(path.join(ROOT, "mods/resolveCommand.js"), "utf8");
  const handled = new Set([...router.matchAll(/case\s+"([A-Z_]+)"\s*:/g)].map((m) => m[1]));
  const unhandled = [...dispatched].filter((a) => !NATIVE_ACTIONS.has(a) && !handled.has(a)).sort();
  assert.deepEqual(unhandled, [], `dispatched but not routed: ${unhandled.join(", ")}`);
});
