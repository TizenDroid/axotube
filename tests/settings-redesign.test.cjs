// The settings redesign: Web config, About and Advanced at the top of the TV settings
// root, their status and launch-mode wiring, and the user agent profile. These are
// source-level checks; the panels themselves need the TV's YouTube modal.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const settingsSrc = read("mods/ui/settings.js");
const statusSrc = read("mods/shared/serviceStatus.js");
const resolveSrc = read("mods/resolveCommand.js");
const uaSrc = read("mods/features/userAgentSpoofing.js");
const en = JSON.parse(read("mods/translations/resources/en.json"));

test("the three new pages are the first entries of the settings root, in order", () => {
  const webAt = settingsSrc.indexOf('t("settings.webConfig.title")');
  const aboutAt = settingsSrc.indexOf('t("settings.about.title")');
  const advancedAt = settingsSrc.indexOf('t("settings.advanced.title")');
  const adsAt = settingsSrc.indexOf('t("settings.ads.title")');
  assert.ok(webAt > 0 && aboutAt > webAt && advancedAt > aboutAt && adsAt > advancedAt);
});

test("each new page has an icon from the YouTube icon list", () => {
  assert.ok(settingsSrc.includes('"PHONELINK"'), "Web config icon");
  assert.ok(settingsSrc.includes('"INFO"'), "About icon");
  assert.ok(settingsSrc.includes('"SETTINGS"'), "Advanced icon");
  assert.ok(settingsSrc.includes('"BUG_REPORT"'), "diagnostics row icon");
  assert.ok(settingsSrc.includes('"LANGUAGE"'), "user agent row icon");
  assert.ok(settingsSrc.includes('"CAST_MOBILE"'), "launch mode row icon");
});

test("the old About submenu and phone-sync root entry are gone", () => {
  assert.equal(settingsSrc.includes("aboutLink("), false);
  assert.equal(settingsSrc.includes('t("settings.phoneSync.title")'), false);
});

test("Web config and About refresh when opened, and Launch mode refreshes too", () => {
  assert.ok(/webConfigLines,\s*refreshStatus/.test(settingsSrc));
  assert.ok(/aboutLines,\s*refreshStatus/.test(settingsSrc));
  assert.ok(
    /heading\(t\("settings\.advanced\.launch\.title"\), t\("settings\.advanced\.launch\.subtitle"\)\),\s*refreshStatus,?\s*\)/.test(
      settingsSrc,
    ),
    "launch submenu passes refreshStatus",
  );
  assert.ok(settingsSrc.includes("if (node && node.refresh) node.refresh(() => showPanel(p.id, true));"));
});

test("the diagnostics shortcut opens the proxy's diagnostics page", () => {
  assert.ok(settingsSrc.includes('const DIAGNOSTICS_URL = "http://127.0.0.1:8081/axotube/diagnostics";'));
  assert.ok(settingsSrc.includes("location.href = DIAGNOSTICS_URL;"));
});

test("launch mode offers proxy (false) and SDB debugger (true) and writes through the service", () => {
  assert.ok(/launchChoice\(t\("settings\.advanced\.launch\.proxy"\), "TV", false\)/.test(settingsSrc));
  assert.ok(/launchChoice\(t\("settings\.advanced\.launch\.debugger"\), "SETTINGS_REMOTE", true\)/.test(settingsSrc));
  assert.ok(settingsSrc.includes("setLaunchMode(p.debugger"));
  assert.ok(statusSrc.includes("`${SERVICE_URL}/api/launch`"));
  assert.ok(statusSrc.includes('method: "POST"'));
  assert.ok(statusSrc.includes("body: JSON.stringify({ debugger: !!debuggerOn })"));
});

test("the new SETTINGS_* actions are routed to the settings handler", () => {
  for (const action of ["SETTINGS_OPEN_DIAGNOSTICS", "SETTINGS_LAUNCH"]) {
    assert.ok(resolveSrc.includes(`case "${action}":`), action);
  }
  assert.ok(settingsSrc.includes('case "SETTINGS_OPEN_DIAGNOSTICS":'));
  assert.ok(settingsSrc.includes('case "SETTINGS_LAUNCH":'));
});

test("status is read from the service, the proxy and the pairing code, with deadlines", () => {
  assert.ok(statusSrc.includes("`${SERVICE_URL}/api/diagnostics`"));
  assert.ok(statusSrc.includes("`${PROXY_URL}/axotube/health`"));
  assert.ok(statusSrc.includes("`${SERVICE_URL}/api/pairing-code`"));
  assert.ok(statusSrc.includes('import { fetchWithTimeout } from "./fetch.js";'));
  // A missing part is a normal answer, so a failed request must resolve, not reject.
  assert.ok(statusSrc.includes(".catch(() => null)"));
});

test("the pairing code is only kept while the service answers", () => {
  assert.ok(statusSrc.includes("setPairingInfo(service ? answers[2] : null);"));
});

test("the user agent radio shows the default as checked and sends the phone agent for android", () => {
  assert.ok(/radio\(t\("settings\.advanced\.userAgent\.samsung"\), "userAgentProfile", "samsung", \["auto"\]\)/.test(settingsSrc));
  assert.ok(settingsSrc.includes("node.also.indexOf(stored) !== -1"));
  assert.ok(uaSrc.includes('configRead("userAgentProfile")'));
  assert.ok(uaSrc.includes('if (profile === "android") return { ua: PHONE_USER_AGENT'));
  assert.ok(uaSrc.includes('marker: "SamsungBrowser/2.1"'));
  assert.ok(uaSrc.includes("const APPLIED_SESSION_KEY"));
});

test("every settings translation key used by the new code exists in en.json", () => {
  const keyPattern = /t\(\s*["'`]([A-Za-z0-9_.]+)["'`]/g;
  const used = new Set();
  for (const src of [settingsSrc, statusSrc]) {
    let match;
    while ((match = keyPattern.exec(src))) used.add(match[1]);
  }
  const missing = [];
  for (const key of used) {
    if (!key.startsWith("settings.")) continue;
    const found = key
      .split(".")
      .reduce((node, part) => (node && typeof node === "object" ? node[part] : undefined), en);
    if (typeof found !== "string") missing.push(key);
  }
  assert.deepEqual(missing, []);
});
