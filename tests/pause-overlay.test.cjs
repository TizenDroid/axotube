const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const source = fs
  .readFileSync(path.join(ROOT, "mods/features/overlayState.js"), "utf8")
  .replace(/^export\s+/gm, "");
const ctx = vm.createContext({});
vm.runInContext(source + "\n;globalThis.s = { isOverlayOpenCommand, classifyOverlayCommand };", ctx);
const { isOverlayOpenCommand, classifyOverlayCommand } = ctx.s;

test("dropdowns and popups over the video are popups", () => {
  assert.equal(classifyOverlayCommand({ openPopupAction: { popupType: "MODAL", popup: {} } }), "popup");
  assert.equal(classifyOverlayCommand({ openPopupAction: { popup: {} } }), "popup");
});

test("description and comments panels are reading panels", () => {
  assert.equal(
    classifyOverlayCommand({ showEngagementPanelEndpoint: { panelIdentifier: "comments" } }),
    "reading",
  );
});

test("toasts, skip actions and ordinary commands are not overlays", () => {
  assert.equal(isOverlayOpenCommand({ openPopupAction: { popupType: "TOAST", popup: {} } }), false);
  assert.equal(
    isOverlayOpenCommand({
      showEngagementPanelEndpoint: { customAction: { action: "SKIP", parameters: {} } },
    }),
    false,
  );
  assert.equal(isOverlayOpenCommand({ watchEndpoint: { videoId: "x" } }), false);
  assert.equal(isOverlayOpenCommand({ customAction: { action: "ADD_TO_QUEUE" } }), false);
  assert.equal(isOverlayOpenCommand(null), false);
});

test("AXO settings open commands count, but setting writes do not", () => {
  assert.equal(isOverlayOpenCommand({ customAction: { action: "AXO_SETTINGS_SHOW" } }), true);
  assert.equal(isOverlayOpenCommand({ customAction: { action: "SETTINGS_SET" } }), false);
});
