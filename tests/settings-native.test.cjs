// Drives the real mods/ui/settings.js native renderer with stubbed YouTube
// renderers. Checks lazy panel opening, in-place refresh after a write, and
// schema clamping for the stepper.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");

function harness() {
  const config = {
    enableAdBlock: true,
    previewLengthSeconds: 40,
    sponsorBlockManualSkips: [],
    enableSponsorBlock: true,
  };
  const shown = [];
  const writes = [];
  const ctx = vm.createContext({
    t: (k) => k,
    configSchema: JSON.parse(fs.readFileSync(path.join(ROOT, "config-schema.json"), "utf8")),
    configRead: (k) => config[k],
    writeClientSetting: (k, valName, value) => {
      writes.push({ k, valName, value });
      config[k] = value;
      return true;
    },
    generateQRCode: () => null,
    showModal: (header, content, id, update) =>
      shown.push({ header, rows: content.overlayPanelItemListRenderer.items, id, update }),
    buttonItem: (title, icon, commands) => ({
      title: title.title,
      subtitle: title.subtitle,
      secondaryIcon: icon && icon.secondaryIcon,
      commands,
    }),
    overlayPanelItemListRenderer: (items, selectedIndex) => ({
      overlayPanelItemListRenderer: { items, selectedIndex },
    }),
    overlayMessageRenderer: (text) => ({ text }),
    QrCodeRenderer: (url) => ({ qr: url }),
    window: { h5vcc: { tizentube: { GetVersion: () => "1.0" } } },
    console,
  });
  let src = fs
    .readFileSync(path.join(ROOT, "mods/ui/settings.js"), "utf8")
    .replace(/^import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, "")
    .replace(/^export default function modernUI/m, "function modernUI")
    .replace(/^export function /gm, "function ");
  src += "\n;globalThis.__api = { modernUI, handleSettingsAction };";
  vm.runInContext(src, ctx, { filename: "settings.js" });
  return { api: ctx.__api, config, shown, writes };
}

const action = (row) => row.commands[0].customAction;

test("opening settings shows one root panel and submenus push a new modal", () => {
  const h = harness();
  h.api.modernUI();
  assert.equal(h.shown.length, 1);
  assert.equal(h.shown[0].update, false, "root is pushed, not updated");
  const misc = h.shown[0].rows.find(
    (r) => action(r)?.parameters?.id && r.title === "settings.options.misc.title",
  );
  assert.ok(misc, "misc submenu row exists");
  h.api.handleSettingsAction("SETTINGS_OPEN", action(misc).parameters);
  assert.equal(h.shown.length, 2);
  assert.equal(h.shown[1].update, false, "submenu is pushed so Back works");
  assert.notEqual(h.shown[1].id, h.shown[0].id, "submenu has its own unique id");
});

test("a toggle writes once and refreshes its panel in place", () => {
  const h = harness();
  h.api.modernUI();
  const adblock = h.shown[0].rows.find((r) => action(r)?.parameters?.key === "enableAdBlock");
  assert.ok(adblock, "adblock toggle present in root");
  h.api.handleSettingsAction(action(adblock).action, action(adblock).parameters);
  assert.deepEqual(h.writes, [{ k: "enableAdBlock", valName: "boolValue", value: false }]);
  const last = h.shown[h.shown.length - 1];
  assert.equal(last.update, true, "refresh updates the modal in place");
  assert.equal(last.id, "axo-settings", "same unique id as the panel it refreshes");
});

test("stepper steps the value and clamps to the schema range", () => {
  const h = harness();
  h.api.modernUI();
  const misc = h.shown[0].rows.find((r) => r.title === "settings.options.misc.title");
  h.api.handleSettingsAction("SETTINGS_OPEN", action(misc).parameters);
  const misc2 = h.shown[1].rows;
  const length = misc2.find(
    (r) =>
      action(r)?.parameters?.key === undefined &&
      r.title === "settings.options.misc.options.previewLength",
  );
  assert.ok(length, "preview length row present");
  h.api.handleSettingsAction("SETTINGS_OPEN", action(length).parameters);
  const stepPanel = h.shown[h.shown.length - 1].rows;
  const up = stepPanel[2];
  h.api.handleSettingsAction(action(up).action, action(up).parameters);
  assert.equal(h.config.previewLengthSeconds, 45);
  h.config.previewLengthSeconds = 118;
  h.api.handleSettingsAction("SETTINGS_STEP", {
    key: "previewLengthSeconds",
    step: 5,
    panel: action(up).parameters.panel,
  });
  assert.equal(h.config.previewLengthSeconds, 120, "clamped to the schema maximum");
});
