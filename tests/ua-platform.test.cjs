"use strict";
// The user agent check, per platform. On Tizen the module sets the agent and reloads once. On
// Android the app sets it natively, so the module only checks what the page reports.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { blankSyntax } = require("./support/module-source.cjs");

const ROOT = path.join(__dirname, "..");
const SOURCE = blankSyntax(fs.readFileSync(path.join(ROOT, "mods/features/userAgentSpoofing.js"), "utf8"));
const TV = "Mozilla/5.0 (SMART-TV; LINUX; Tizen 4.0) AppleWebKit/537.3 (KHTML, like Gecko) SamsungBrowser/2.1 TV Safari/537.3";
const WV = "Mozilla/5.0 (Linux; Android 14; SM-S911B; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/125.0.6422.147 Mobile Safari/537.36";
const WV_STRIPPED = WV.replace("; wv", "");

function run({ profile, userAgent, tizen }) {
  const win = { tizen: tizen ? { websetting: { setUserAgentString: (ua) => (win.set = ua) } } : undefined };
  let reloads = 0;
  const store = {};
  new Function(
    "configRead",
    "window",
    "navigator",
    "location",
    "sessionStorage",
    "debugLogsOn",
    "console",
    SOURCE,
  )(
    (k) => (k === "userAgentProfile" ? profile : undefined),
    win,
    { userAgent },
    { reload: () => reloads++ },
    { getItem: (k) => store[k] || null, setItem: (k, v) => (store[k] = v) },
    () => false,
    console,
  );
  return { status: win.__axotubeUserAgent.status, reloads, set: win.set };
}

const ANDROID_TV = "Mozilla/5.0 (Linux; Android 12; Android TV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 CrKey/1.56.500000";

test("Android: auto is the Android TV agent, and the page reports it", () => {
  assert.deepEqual(run({ profile: "auto", userAgent: ANDROID_TV }), { status: "applied", reloads: 0, set: undefined });
});

test("Android: auto with the WebView's own agent is reported as not applied, not overridden", () => {
  assert.deepEqual(run({ profile: "auto", userAgent: WV }), { status: "not-applied", reloads: 0, set: undefined });
});

test("Android: android is the phone layout: the WebView agent with the wv marker removed", () => {
  assert.deepEqual(run({ profile: "android", userAgent: WV_STRIPPED }), { status: "applied", reloads: 0, set: undefined });
});

test("Android: the Samsung profile is checked against the TV agent", () => {
  assert.equal(run({ profile: "samsung", userAgent: TV }).status, "applied");
});

test("Tizen: the profile's agent is set once and the page reloads to pick it up", () => {
  const r = run({ profile: "auto", userAgent: WV, tizen: true });
  assert.equal(r.set, TV);
  assert.equal(r.reloads, 1);
});
