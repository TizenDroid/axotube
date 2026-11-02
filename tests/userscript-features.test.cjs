"use strict";
// Pure parts of the TV page features, run from their source. The modules import
// the YouTube UI, so the functions are cut out of the file and run in a VM.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}
function extractFunction(src, name) {
  const text = src.replace(/\r\n/g, "\n");
  const start = text.indexOf("function " + name + "(");
  assert.ok(start !== -1, name + " is defined");
  const end = text.indexOf("\n}\n", start);
  return text.slice(start, end + 3);
}

const recoverySrc = read("mods/features/playbackRecovery.js");
const helpers = vm.runInNewContext(
  extractFunction(recoverySrc, "hashWithStartTime") + extractFunction(recoverySrc, "formatTime") +
    ";({ hashWithStartTime: hashWithStartTime, formatTime: formatTime })",
);

test("the retry hash carries the start time on a watch page", () => {
  assert.equal(helpers.hashWithStartTime("#/watch?v=ABC", 75), "#/watch?v=ABC&t=75");
  assert.equal(helpers.hashWithStartTime("#/watch?v=ABC&t=10&list=X", 75), "#/watch?v=ABC&list=X&t=75", "an old t is replaced");
  assert.equal(helpers.hashWithStartTime("#/home", 5), null, "not a watch page");
  assert.equal(helpers.hashWithStartTime("", 5), null);
});

test("the retry prompt shows the time as m:ss", () => {
  assert.equal(helpers.formatTime(75), "1:15");
  assert.equal(helpers.formatTime(5), "0:05");
  assert.equal(helpers.formatTime(0), "0:00");
});

test("the retry only arms on the error overlay or a video error, and blue retries only then", () => {
  assert.match(recoverySrc, /el\.offsetWidth > 0 && el\.offsetHeight > 0/, "a hidden overlay does not count");
  assert.match(recoverySrc, /event\.target\.tagName === "VIDEO"/);
  assert.match(recoverySrc, /KEY_BLUE = 406/);
  assert.match(recoverySrc, /event\.keyCode === KEY_BLUE && retryArmed/);
});

// The red key: run the module's own listener against a stub window.
function runDiagnosticsKey(href, port, extra) {
  const src = read("mods/features/standaloneDiagnostics.js");
  const listeners = [];
  const location = { href: href, port: port, hostname: "127.0.0.1", protocol: "http:" };
  const sandbox = {
    window: {
      addEventListener: (type, fn) => listeners.push([type, fn]),
    },
    location: location,
  };
  if (extra) Object.assign(sandbox.window, extra);
  sandbox.window.location = location;
  vm.runInNewContext(src, sandbox);
  return {
    press: (keyCode) => {
      let stopped = false;
      listeners.forEach(([type, fn]) => {
        if (type === "keydown") fn({ keyCode: keyCode, stopPropagation: () => { stopped = true; } });
      });
      return stopped;
    },
    location: location,
  };
}

test("the red key opens the diagnostics page on the standalone proxy", () => {
  const page = runDiagnosticsKey("http://localhost:8081/tv", "8081");
  const stopped = page.press(403);
  assert.equal(page.location.href, "http://127.0.0.1:8081/axotube/diagnostics");
  assert.equal(stopped, true, "the red key is taken from YouTube");
});

test("the red key does nothing outside the standalone app", () => {
  const page = runDiagnosticsKey("https://www.youtube.com/tv", "");
  const stopped = page.press(403);
  assert.equal(page.location.href, "https://www.youtube.com/tv", "no navigation");
  assert.equal(stopped, false);
});

test("the red key uses the proxy address the CDP launcher names", () => {
  const page = runDiagnosticsKey("https://www.youtube.com/tv", "", { __axotubeProxyUrl: "http://127.0.0.1:8081" });
  page.press(403);
  assert.equal(page.location.href, "http://127.0.0.1:8081/axotube/diagnostics");
});

test("other keys are left alone", () => {
  const page = runDiagnosticsKey("http://localhost:8081/tv", "8081");
  assert.equal(page.press(404), false);
  assert.equal(page.location.href, "http://localhost:8081/tv");
});

test("an update waits for playback to pause or end before it reloads", () => {
  const src = read("mods/features/updater.js");
  const fn = extractFunction(src, "reloadWhenIdle");
  assert.match(fn, /video\.paused \|\| video\.ended/, "an idle page reloads at once");
  assert.match(fn, /addEventListener\("pause", reload\)/);
  assert.match(fn, /addEventListener\("ended", reload\)/);
  assert.match(fn, /removeEventListener\("pause", reload\)/, "listeners are removed before the reload");
  assert.match(src, /reloadWhenIdle\(\);\r?\n    \}\)/, "apply uses it instead of a direct reload");
  assert.ok(!/\.then\(\(status\) => \{\s*if \(status\.error\) throw new Error\(status\.error\);\s*window\.location\.reload\(\);/.test(src), "no direct reload after apply");
});
