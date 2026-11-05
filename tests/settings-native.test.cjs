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

function harness(initial = {}, pairing = null, status = { checked: true, service: { version: "2.0", launchDebugger: false, bundle: null }, proxy: null }) {
  const launchWrites = [];
  const toasts = [];
  const hostLocation = { href: "" };
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
    generateQRCode: (link) => ({ link }),
    getPairingInfo: () => pairing,
    // Status stubs: refreshStatus answers at once with the status the test set up.
    getServiceStatus: () => status,
    refreshStatus: (done) => {
      if (done) done();
    },
    setLaunchMode: (debuggerOn, done) => {
      launchWrites.push(debuggerOn);
      status.service = Object.assign({}, status.service, { launchDebugger: debuggerOn });
      done(true);
    },
    showToast: (title, text) => toasts.push(text),
    location: hostLocation,
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
    QrCodeRenderer: (qr) => ({ qr: qr.link }),
    window: hostWindow,
    nativeHost: () => hostWindow.h5vcc.tizentube,
    console,
  });
  let src = SOURCE.replace(/^import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, "")
    .replace(/^export default function modernUI/m, "function modernUI")
    .replace(/^export function /gm, "function ");
  src += "\n;globalThis.__api = { modernUI, handleSettingsAction, buildSettingsTree };";
  vm.runInContext(src, ctx, { filename: "settings.js" });
  return { api: ctx.__api, config, shown, writes, launchWrites, toasts, hostLocation, status };
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

// Web config now lives inside the AxoTube panel: open that, then Web config.
function openWebConfig(h) {
  open(h, "settings.axotube.title");
  return open(h, "settings.webConfig.title");
}

test("the root holds the categories by purpose, with AxoTube, then Advanced and About last", () => {
  const h = harness();
  h.api.modernUI();
  assert.equal(h.shown.length, 1);
  assert.equal(h.shown[0].update, false, "root is pushed, not updated");
  // Copied into this realm: arrays built inside the vm context fail strict equality.
  const titles = Array.from(h.shown[0].rows, (r) => r.title).filter((t) => t !== undefined);
  assert.deepEqual(titles, [
    "settings.playback.title",
    "settings.playerControls.title",
    "settings.ads.title",
    "settings.browsing.title",
    "settings.home.title",
    "settings.appearance.title",
    "settings.axotube.title",
    "settings.advanced.title",
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
  // The ads row is no longer first (phone sync is), so its panel id is its position in the root.
  const adsIndex = h.shown[0].rows.findIndex((r) => r.title === "settings.ads.title");
  assert.equal(last(h).id, `axo-settings:root.${adsIndex}`, "same unique id as the panel it refreshes");
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

test("phone sync shows the QR code, the address and the code from the live pairing store", () => {
  const h = harness({}, { code: "123456", urls: ["http://192.168.1.5:8090"] });
  h.api.modernUI();
  const rows = openWebConfig(h);
  const shown = rows.map((r) => r.text || r.qr || r.title);
  assert.ok(shown.includes("settings.phoneSync.intro"));
  assert.ok(shown.includes("settings.phoneSync.address"));
  assert.ok(shown.includes("settings.phoneSync.code"));
  assert.ok(!rows.some((r) => r.qr), "the QR is in its own panel, not in the text panel");
  const qr = open(h, "settings.webConfig.qrTitle");
  assert.ok(qr.some((r) => r.qr === "http://192.168.1.5:8090/?code=123456"), "the QR carries the pairing code");
  assert.equal(qr.filter((r) => r.qr).length, 1, "the QR panel shows only the code");
});

test("web config without pairing info says so, and shows no QR code", () => {
  const h = harness({}, null);
  h.api.modernUI();
  const rows = openWebConfig(h);
  assert.ok(rows.some((r) => r.text === "settings.phoneSync.waiting"));
  assert.ok(!rows.some((r) => r.qr !== undefined), "no QR without a pairing code");
});

test("phone sync with a code but no address still shows the code, without a QR", () => {
  const h = harness({}, { code: "654321", urls: [] });
  h.api.modernUI();
  const rows = openWebConfig(h);
  assert.ok(rows.some((r) => r.text === "settings.phoneSync.code"));
  assert.ok(!rows.some((r) => r.qr !== undefined));
});


// Redesign: Web config, About and Advanced.

function texts(rows) {
  return rows.map((r) => r.text).filter((x) => x !== undefined);
}

test("About lists the userscript, service, proxy, bundle and launch mode, with Socials below", () => {
  const h = harness({}, null, {
    checked: true,
    service: { version: "1.31.3", launchDebugger: false, bundle: { current: "1.31.3", latest: "1.31.4", available: true } },
    proxy: { version: "1.31.3" },
  });
  h.api.modernUI();
  const rows = open(h, "settings.about.title");
  const lines = texts(rows);
  assert.ok(lines.includes("settings.about.userscript"));
  assert.ok(lines.includes("settings.about.serviceOnline"));
  assert.ok(lines.includes("settings.about.proxyOnline"));
  assert.ok(lines.includes("settings.about.bundleUpdate"), "an available update is named");
  assert.ok(lines.includes("settings.about.launchMode"));
  assert.ok(!rows.some((r) => r.qr), "About shows no QR codes itself");
  assert.ok(rows.some((r) => r.title === "settings.about.socials.title"), "Socials is a button below the text");
  const socials = open(h, "settings.about.socials.title");
  assert.ok(socials.some((r) => r.title === "GitHub"), "Socials lists GitHub");
  assert.ok(socials.some((r) => r.title === "Discord"), "Socials lists Discord");
  const github = open(h, "GitHub");
  assert.ok(github.some((r) => r.qr === "https://github.com/TizenDroid/axotube"), "GitHub opens its QR code");
});

test("About says what is not running when the service and proxy do not answer", () => {
  const h = harness({}, null, { checked: true, service: null, proxy: null });
  h.api.modernUI();
  const lines = texts(open(h, "settings.about.title"));
  assert.ok(lines.includes("settings.about.serviceOffline"));
  assert.ok(lines.includes("settings.about.proxyOffline"));
  assert.ok(lines.includes("settings.about.launchUnknown"));
});

test("About shows checking until the first check has answered", () => {
  const h = harness({}, null, { checked: false, service: null, proxy: null });
  h.api.modernUI();
  const lines = texts(open(h, "settings.about.title"));
  assert.ok(lines.includes("settings.status.checking"));
  assert.ok(!lines.includes("settings.about.serviceOffline"), "no offline claim before the check");
});

test("Web config says the service is not running and shows no QR code", () => {
  const h = harness({}, { code: "123456", urls: ["http://192.168.1.5:8090"] }, { checked: true, service: null, proxy: null });
  h.api.modernUI();
  const rows = openWebConfig(h);
  assert.ok(texts(rows).includes("settings.webConfig.offline"));
  assert.ok(!rows.some((r) => r.qr !== undefined), "no QR while the service is off");
});

test("opening a panel with a refresh draws it again once the check answers", () => {
  const h = harness();
  h.api.modernUI();
  open(h, "settings.about.title");
  assert.ok(h.shown.some((s) => s.update === true), "the same modal is updated in place");
});

test("launch mode shows the stored choice and a click writes it through the service", () => {
  const h = harness({}, null, { checked: true, service: { version: "2", launchDebugger: false, bundle: null }, proxy: null });
  h.api.modernUI();
  open(h, "settings.advanced.title");
  const rows = open(h, "settings.advanced.launch.title");
  const proxy = rows.find((r) => r.title === "settings.advanced.launch.proxy");
  const debuggerRow = rows.find((r) => r.title === "settings.advanced.launch.debugger");
  assert.equal(proxy.secondaryIcon, "RADIO_BUTTON_CHECKED");
  assert.equal(debuggerRow.secondaryIcon, "RADIO_BUTTON_UNCHECKED");

  const cmd = debuggerRow.commands[0].customAction;
  assert.equal(cmd.action, "SETTINGS_LAUNCH");
  h.api.handleSettingsAction(cmd.action, cmd.parameters);
  assert.deepEqual(h.launchWrites, [true]);
  assert.deepEqual(h.toasts, ["settings.advanced.launch.saved"]);
  const after = last(h).rows.find((r) => r.title === "settings.advanced.launch.debugger");
  assert.equal(after.secondaryIcon, "RADIO_BUTTON_CHECKED", "the panel redraws with the new choice");
});

test("the user agent radio shows auto as the Samsung agent and writes android when picked", () => {
  const h = harness({ userAgentProfile: "auto" });
  h.api.modernUI();
  open(h, "settings.advanced.title");
  const rows = open(h, "settings.advanced.userAgent.title");
  const samsung = rows.find((r) => r.title === "settings.advanced.userAgent.samsung");
  const phone = rows.find((r) => r.title === "settings.advanced.userAgent.android");
  assert.equal(samsung.secondaryIcon, "RADIO_BUTTON_CHECKED", "auto shows as the Samsung agent");
  assert.equal(phone.secondaryIcon, "RADIO_BUTTON_UNCHECKED");

  const cmd = phone.commands[0].customAction;
  h.api.handleSettingsAction(cmd.action, cmd.parameters);
  assert.deepEqual(h.writes.at(-1), { k: "userAgentProfile", valName: "stringValue", value: "android" });
  assert.equal(h.config.userAgentProfile, "android");
});

test("the diagnostics shortcut opens the proxy's diagnostics page", () => {
  const h = harness();
  h.api.modernUI();
  const rows = open(h, "settings.advanced.title");
  const row = rows.find((r) => r.title === "settings.advanced.diagnostics.title");
  const cmd = row.commands[0].customAction;
  assert.equal(cmd.action, "SETTINGS_OPEN_DIAGNOSTICS");
  h.api.handleSettingsAction(cmd.action, cmd.parameters);
  assert.equal(h.hostLocation.href, "http://127.0.0.1:8081/axotube/diagnostics");
});
