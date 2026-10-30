// Panel open/closed is read from the markup in the probe dump:
// one root per panel; inner overlay gets "frHKed" while closing; root removed when closed.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const source = fs
  .readFileSync(path.join(ROOT, "mods/features/panelShrink.js"), "utf8")
  .replace(/^import\s+[\s\S]*?;\s*$/gm, "")
  .replace(/^export\s+/gm, "")
  .replace(/^start\(\);\s*$/m, "");
const ctx = vm.createContext({
  configRead: () => true,
  configChangeEmitter: { addEventListener() {} },
  document: { body: null, getElementById: () => null, querySelector: () => null },
  window: { addEventListener() {} },
  location: { hash: "" },
  requestAnimationFrame: () => 0,
  MutationObserver: function () {
    this.observe = () => {};
    this.disconnect = () => {};
  },
  setTimeout: () => 0,
});
vm.runInContext(source + "\n;globalThis.engagementPanelOpen = engagementPanelOpen;", ctx);
const engagementPanelOpen = ctx.engagementPanelOpen;

function panel(innerClass) {
  return {
    querySelector(sel) {
      if (sel !== "ytlr-animated-overlay") return null;
      return { classList: { contains: (c) => innerClass.split(" ").indexOf(c) !== -1 } };
    },
  };
}

test("no panel root means closed", () => {
  assert.equal(engagementPanelOpen(null), false);
});

test("an open panel (inner overlay not closing) means open", () => {
  assert.equal(engagementPanelOpen(panel("xwpPM RAE3Re UCPDVb zylon-focus")), true);
});

test("a closing panel (inner overlay has frHKed) means closed", () => {
  assert.equal(engagementPanelOpen(panel("frHKed xwpPM RAE3Re UCPDVb zylon-focus")), false);
});

test("a root with no inner overlay is treated as open", () => {
  assert.equal(engagementPanelOpen({ querySelector: () => null }), true);
});
