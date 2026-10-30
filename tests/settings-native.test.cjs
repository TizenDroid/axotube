// Drives the real mods/ui/settings.js native renderer with stubbed YouTube
// renderers. Checks lazy panel opening, in-place refresh after a write, schema
// clamping for the stepper, the SponsorBlock segment cycle, and that every
// string and config key the tree uses actually exists.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const SOURCE = fs.readFileSync(path.join(ROOT, "mods/ui/settings.js"), "utf8");
const SCHEMA = JSON.parse(fs.readFileSync(path.join(ROOT, "config-schema.json"), "utf8"));
const EN = JSON.parse(
  fs.readFileSync(path.join(ROOT, "mods/translations/resources/en.json"), "utf8"),
);

function harness(initial = {}) {
  const config = {
    enableAdBlock: true,
    previewLengthSeconds: 40,
    sponsorBlockManualSkips: [],
    enableSponsorBlock: true,
    enableSponsorBlockSponsor: true,
    ...initial,
  };
  const shown = [];
  const writes = [];
  const hostWindow = { h5vcc: { tizentube: { GetVersion: () => "1.0", SetFrameRate() {} } } };
  const ctx = vm.createContext({
    t: (k) => k,
    AXOTUBE_VERSION: "test-version",
    configSchema: SCHEMA,
    configRead: (k) => config[k],
    writeClientSetting: (k, valName, value) => {
      writes.push({ k, valName, value });
      if (valName === "arrayValue") {
        const arr = (config[k] || []).slice();
        if (arr.indexOf(value) !== -1) arr.splice(arr.indexOf(value), 1);
        else arr.push(value);
        config[k] = arr;
      } else {
        config[k] = value;
      }
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
    window: hostWindow,
    nativeHost: () => hostWindow.h5vcc.tizentube,
    console,
  });
  let src = SOURCE.replace(/^import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, "")
    .replace(/^export default function modernUI/m, "function modernUI")
    .replace(/^export function /gm, "function ");
  src += "\n;globalThis.__api = { modernUI, handleSettingsAction, buildSettingsTree };";
  vm.runInContext(src, ctx, { filename: "settings.js" });
  return { api: ctx.__api, config, shown, writes };
}

const action = (row) => row.commands[0].customAction;
const last = (h) => h.shown[h.shown.length - 1];

// Opens the submenu whose title is `title` from the newest panel.
function open(h, title) {
  const row = last(h).rows.find((r) => r.title === title);
  assert.ok(row, `row "${title}" present in the current panel`);
  h.api.handleSettingsAction("SETTINGS_OPEN", action(row).parameters);
  return last(h).rows;
}

test("the root has eight categories and opening one pushes a new modal", () => {
  const h = harness();
  h.api.modernUI();
  assert.equal(h.shown.length, 1);
  assert.equal(h.shown[0].update, false, "root is pushed, not updated");
  // Copied into this realm: arrays built inside the vm context fail strict equality.
  const titles = Array.from(h.shown[0].rows, (r) => r.title);
  assert.deepEqual(titles, [
    "settings.ads.title",
    "settings.playback.title",
    "settings.playerControls.title",
    "settings.browsing.title",
    "settings.home.title",
    "settings.appearance.title",
    "settings.system.title",
    "settings.about.title",
  ]);
  open(h, "settings.browsing.title");
  assert.equal(h.shown.length, 2);
  assert.equal(h.shown[1].update, false, "submenu is pushed so Back works");
  assert.notEqual(h.shown[1].id, h.shown[0].id, "submenu has its own unique id");
});

test("a toggle inside a submenu writes once and refreshes that panel in place", () => {
  const h = harness();
  h.api.modernUI();
  const rows = open(h, "settings.ads.title");
  const adblock = rows.find((r) => action(r)?.parameters?.key === "enableAdBlock");
  assert.ok(adblock, "ad block toggle present under Ads & sponsors");
  h.api.handleSettingsAction(action(adblock).action, action(adblock).parameters);
  assert.deepEqual(h.writes, [{ k: "enableAdBlock", valName: "boolValue", value: false }]);
  assert.equal(last(h).update, true, "refresh updates the modal in place");
  assert.equal(last(h).id, "axo-settings:root.0", "same unique id as the panel it refreshes");
});

test("stepper steps the value and clamps to the schema range", () => {
  const h = harness();
  h.api.modernUI();
  open(h, "settings.browsing.title");
  open(h, "settings.browsing.previews.title");
  const length = last(h).rows.find((r) => r.title === "settings.browsing.previews.length");
  assert.ok(length, "preview length row present");
  h.api.handleSettingsAction("SETTINGS_OPEN", action(length).parameters);
  const stepPanel = last(h).rows;
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

test("a segment type cycles skip automatically, show a skip button, then off", () => {
  const h = harness({ enableSponsorBlockIntro: true, sponsorBlockManualSkips: [] });
  h.api.modernUI();
  open(h, "settings.ads.title");
  open(h, "settings.ads.segmentTypes.title");
  const press = (rowTitle) => {
    const row = last(h).rows.find((r) => r.title === rowTitle);
    assert.ok(row, `segment row ${rowTitle}`);
    h.api.handleSettingsAction(action(row).action, action(row).parameters);
  };
  const modeOf = (rowTitle) => last(h).rows.find((r) => r.title === rowTitle).subtitle;

  assert.equal(modeOf("settings.ads.segments.sponsor"), "settings.segmentModes.skip");

  press("settings.ads.segments.sponsor"); // skip -> show
  assert.equal(h.config.sponsorBlockManualSkips.indexOf("sponsor") !== -1, true);
  assert.equal(h.config.enableSponsorBlockSponsor, true);
  assert.equal(modeOf("settings.ads.segments.sponsor"), "settings.segmentModes.show");

  press("settings.ads.segments.sponsor"); // show -> off
  assert.equal(h.config.enableSponsorBlockSponsor, false);
  assert.equal(h.config.sponsorBlockManualSkips.indexOf("sponsor"), -1, "manual flag cleared");
  assert.equal(modeOf("settings.ads.segments.sponsor"), "settings.segmentModes.off");

  press("settings.ads.segments.sponsor"); // off -> skip
  assert.equal(h.config.enableSponsorBlockSponsor, true);
  assert.equal(h.config.sponsorBlockManualSkips.indexOf("sponsor"), -1);
  assert.equal(modeOf("settings.ads.segments.sponsor"), "settings.segmentModes.skip");

  // Only the keys that need to change are written, so an array write never toggles the wrong way.
  const arrayWrites = h.writes.filter((w) => w.valName === "arrayValue");
  assert.deepEqual(
    arrayWrites.map((w) => w.value),
    ["sponsor", "sponsor"],
  );
});

test("every string key the settings tree uses exists in en.json", () => {
  const flat = new Set();
  const walk = (obj, prefix) => {
    for (const [k, v] of Object.entries(obj)) {
      const p = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === "object") walk(v, p);
      else flat.add(p);
    }
  };
  walk(EN, "");

  const literal = Array.from(SOURCE.matchAll(/\bt\(\s*"(settings\.[^"]+)"/g), (m) => m[1]);
  const missing = literal.filter((k) => !flat.has(k));
  assert.deepEqual(missing, [], "literal keys missing from en.json");

  // Keys built from a template: check every value the template can take.
  const dynamic = [
    ...["skip", "show", "off"].map((m) => `settings.segmentModes.${m}`),
    ...[
      "sponsor",
      "intro",
      "outro",
      "interaction",
      "selfpromo",
      "preview",
      "filler",
      "music_offtopic",
    ].map((c) => `settings.ads.segments.${c}`),
    ...[
      "default",
      "black",
      "darkGray",
      "charcoal",
      "navy",
      "darkRed",
      "darkGreen",
      "darkPurple",
    ].map((c) => `settings.appearance.colors.${c}`),
    ...["default", "white", "gray", "red", "blue", "green", "purple", "yellow"].map(
      (c) => `settings.appearance.textColors.${c}`,
    ),
  ];
  assert.deepEqual(
    dynamic.filter((k) => !flat.has(k)),
    [],
    "template keys missing from en.json",
  );
});

test("every config key the built tree reads or writes is in the schema", () => {
  const h = harness();
  const known = new Set(Object.keys(SCHEMA.defaults));
  const used = new Set();
  const walk = (list) => {
    for (const node of list) {
      if (!node) continue;
      // Radio rows bind a config key; toggles and steppers bind their value.
      if (node.key !== undefined) used.add(node.key);
      else if (node.arrayToEdit !== undefined) used.add(node.arrayToEdit);
      else if (typeof node.value === "string" && !node.options && !node.action && !node.segment)
        used.add(node.value);
      // Multi-select children are list values, not keys, so they are not walked.
      if (node.arrayToEdit === undefined && Array.isArray(node.options)) walk(node.options);
    }
  };
  walk(h.api.buildSettingsTree());
  // Segment enable keys are reached through a table, not a node value.
  for (const k of [
    "enableSponsorBlockSponsor",
    "enableSponsorBlockIntro",
    "enableSponsorBlockOutro",
    "enableSponsorBlockInteraction",
    "enableSponsorBlockSelfPromo",
    "enableSponsorBlockPreview",
    "enableSponsorBlockFiller",
    "enableSponsorBlockMusicOfftopic",
  ]) {
    used.add(k);
  }
  const unknown = Array.from(used).filter((k) => !known.has(k));
  assert.deepEqual(unknown, [], "keys missing from config-schema.json defaults");
});
