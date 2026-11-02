"use strict";
// The CDP path against a real Chromium: the injected source, the CSP bypass, the
// ordering of the early bundle, the page scripts and the main bundle, frames, and
// the launcher's own attach-and-navigate flow. Skipped when Playwright's Chromium
// is not installed.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const cdp = require(path.join(ROOT, "service", "cdp", "cdp.js"));
const sdb = require(path.join(ROOT, "service", "cdp", "sdb.js"));
const launcher = require(path.join(ROOT, "service", "cdp", "launcher.js"));

function loadPlaywright() {
  const candidates = [process.env.PLAYWRIGHT_PATH, "playwright", "/opt/npm-tools/node_modules/playwright"];
  for (const c of candidates) {
    if (!c) continue;
    try {
      return require(c);
    } catch (e) {
      // try the next location
    }
  }
  return null;
}

const pw = loadPlaywright();
const chromePath = pw ? pw.chromium.executablePath() : null;
const SKIP = chromePath && fs.existsSync(chromePath) ? false : "Playwright Chromium not installed";
const USERSCRIPT_DIR = path.join(ROOT, "standalone", "userscript");
const REAL_BUNDLES = fs.existsSync(path.join(USERSCRIPT_DIR, "userScript.js"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(fn, ms, label) {
  const end = Date.now() + (ms || 15000);
  let last = null;
  while (Date.now() < end) {
    try {
      last = await fn();
      if (last) return last;
    } catch (e) {
      last = e.message;
    }
    await sleep(150);
  }
  throw new Error("timed out waiting for " + label + " (last: " + last + ")");
}

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

function getJson(port, p) {
  return new Promise((resolve, reject) => {
    cdp.getJson("127.0.0.1", port, p, (err, body) => (err ? reject(err) : resolve(body)));
  });
}

async function startChrome(port) {
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), "axo-chrome-"));
  const proc = spawn(chromePath, [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-port=" + port,
    "--user-data-dir=" + userDir,
    "about:blank",
  ], { stdio: "ignore" });
  await until(() => getJson(port, "/json/version"), 30000, "Chromium debugger");
  return {
    port: port,
    stop: () => new Promise((resolve) => {
      // The profile is removed best effort: Chromium can still be writing to it
      // for a moment after exit, and a leftover temp profile must not fail a test.
      const done = () => {
        try {
          fs.rmSync(userDir, { recursive: true, force: true, maxRetries: 3 });
        } catch (e) {
          // leave it in the temp directory
        }
        resolve();
      };
      if (proc.exitCode !== null) return done();
      proc.once("exit", done);
      proc.kill("SIGKILL");
    }),
  };
}

// Leaves one page target, so the launcher's "first page" is the one under test.
async function keepOnlyPage(port, keepId) {
  const list = await getJson(port, "/json/list");
  for (const t of list) {
    if (t.type === "page" && t.id !== keepId) {
      await new Promise((resolve) => {
        http.get({ host: "127.0.0.1", port: port, path: "/json/close/" + t.id }, (res) => {
          res.resume();
          res.on("end", resolve);
        }).on("error", resolve);
      });
    }
  }
}

function serve(pages) {
  const server = http.createServer((req, res) => {
    const body = pages[req.url.split("?")[0]];
    if (body === undefined) {
      res.writeHead(404);
      return res.end();
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(body);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

// Evaluates an expression in the first page target. Returns the value.
function evaluate(port, expression) {
  return new Promise((resolve, reject) => {
    cdp.attach({ host: "127.0.0.1", port: port }, (err, session) => {
      if (err) return reject(err);
      session.send("Runtime.evaluate", { expression: expression, returnByValue: true }, (e, r) => {
        session.close();
        if (e) return reject(e);
        resolve(r && r.result ? r.result.value : undefined);
      });
    });
  });
}

// A page that is CSP-locked, so the bundles can only run with the bypass.
const CSP = '<meta http-equiv="Content-Security-Policy" content="script-src \'self\'">';
function pages() {
  return {
    "/yt.html": "<!doctype html><html><head>" + CSP + '<script src="/page.js"></script></head>' +
      '<body><iframe src="/frame.html"></iframe></body></html>',
    "/page.js": "window.__order = (window.__order || []).concat('page');",
    "/frame.html": "<!doctype html><html><body>frame</body></html>",
    "/plain.html": "<!doctype html><html><head><script src=\"/page.js\"></script></head><body></body></html>",
  };
}

// The wrapper with small, observable bundles: early runs before the page script,
// main runs after DOMContentLoaded.
function timingSource() {
  return launcher.buildInjectedSource(
    "window.__order = (window.__order || []).concat('early'); window.__earlyState = document.readyState;",
    "window.__mainState = document.readyState;",
  );
}

// The direct CDP calls the launcher makes, with a chosen source and bypass.
function navigateWithSource(port, source, url, bypass) {
  return new Promise((resolve, reject) => {
    cdp.attach({ host: "127.0.0.1", port: port }, (err, session) => {
      if (err) return reject(err);
      const steps = [["Page.enable", {}]];
      if (bypass) steps.push(["Page.setBypassCSP", { enabled: true }]);
      steps.push(["Page.addScriptToEvaluateOnNewDocument", { source: source }]);
      steps.push(["Page.navigate", { url: url }]);
      (function run(i) {
        if (i >= steps.length) return resolve(session);
        session.send(steps[i][0], steps[i][1], (e) => {
          if (e) return reject(e);
          run(i + 1);
        });
      })(0);
    });
  });
}

test("the injected wrapper runs early, the page script after it, and the main bundle after DOMContentLoaded", { skip: SKIP }, async () => {
  const chromePort = await freePort();
  const chrome = await startChrome(chromePort);
  const server = await serve(pages());
  const base = "http://127.0.0.1:" + server.address().port;
  let session = null;
  try {
    await keepOnlyPage(chromePort, (await getJson(chromePort, "/json/list"))[0].id);
    session = await navigateWithSource(chromePort, timingSource(), base + "/yt.html", true);
    const order = await until(async () => {
      const v = await evaluate(chromePort, "JSON.stringify(window.__order)");
      return v === '["early","page"]' ? v : null;
    }, 15000, "page order");
    assert.deepEqual(JSON.parse(order), ["early", "page"], "early runs before the page script");
    assert.equal(await evaluate(chromePort, "window.__earlyState"), "loading", "early runs before the DOM is ready");
    const main = await until(() => evaluate(chromePort, "window.__mainState"), 15000, "main bundle");
    assert.ok(main === "interactive" || main === "complete", "main ran after DOMContentLoaded, got " + main);
    assert.equal(await evaluate(chromePort, "window.__axotubeServiceUrl"), "http://127.0.0.1:8080");
  } finally {
    if (session) session.close();
    server.close();
    await chrome.stop();
  }
});

test("the bundles run on a CSP-locked page with the bypass enabled", { skip: SKIP }, async () => {
  const chromePort = await freePort();
  const chrome = await startChrome(chromePort);
  const server = await serve(pages());
  const base = "http://127.0.0.1:" + server.address().port;
  let session = null;
  try {
    await keepOnlyPage(chromePort, (await getJson(chromePort, "/json/list"))[0].id);
    session = await navigateWithSource(chromePort, timingSource(), base + "/yt.html", true);
    const early = await until(() => evaluate(chromePort, "String(window.__earlyState)"), 15000, "early bundle");
    assert.equal(early, "loading");
    assert.equal(await evaluate(chromePort, "JSON.stringify(window.__axotubeErrors || [])"), "[]", "no bundle errors on the CSP page");
  } finally {
    if (session) session.close();
    server.close();
    await chrome.stop();
  }
});

// Observed on this Chromium: addScriptToEvaluateOnNewDocument scripts can eval even
// under script-src 'self', so the bypass is not the only thing making them run. The
// bypass stays on because the TV's Chromium may enforce CSP differently.

test("frames other than the top page run nothing", { skip: SKIP }, async () => {
  const chromePort = await freePort();
  const chrome = await startChrome(chromePort);
  const server = await serve(pages());
  const base = "http://127.0.0.1:" + server.address().port;
  let session = null;
  try {
    await keepOnlyPage(chromePort, (await getJson(chromePort, "/json/list"))[0].id);
    session = await navigateWithSource(chromePort, timingSource(), base + "/yt.html", true);
    await until(() => evaluate(chromePort, "window.__mainState"), 15000, "top page");
    const inFrame = await evaluate(chromePort, "typeof document.querySelector('iframe').contentWindow.__axotubeCdp");
    assert.equal(inFrame, "undefined", "the iframe has no AxoTube wrapper");
  } finally {
    if (session) session.close();
    server.close();
    await chrome.stop();
  }
});

test("the launcher's own flow attaches to Chromium, registers the bundles and navigates", { skip: SKIP || !REAL_BUNDLES }, async () => {
  const chromePort = await freePort();
  const chrome = await startChrome(chromePort);
  const server = await serve(pages());
  const base = "http://127.0.0.1:" + server.address().port;
  const apiPort = await freePort();
  const sdbPort = await freePort();
  // Device API in developer mode with the local IP, and an SDB that reports
  // Chromium's debugger port, the way the TV reports the WGT's.
  const api = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ device: { developerMode: "1", developerIP: "127.0.0.1", ip: "127.0.0.1" } }));
  });
  await new Promise((r) => api.listen(apiPort, "127.0.0.1", r));
  const sdbServer = net.createServer((socket) => {
    let buf = "";
    socket.on("error", () => {});
    socket.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      const len = parseInt(buf.slice(0, 4), 16);
      if (buf.length < 4 + len) return;
      socket.write("OKAY");
      socket.write("debug : " + chromePort + "\n");
    });
  });
  await new Promise((r) => sdbServer.listen(sdbPort, "127.0.0.1", r));
  sdb.setEndpoints({ apiPort: apiPort, sdbPort: sdbPort });
  launcher.setTestOverrides({ youtubeUrl: base + "/yt.html" });

  const deps = {
    supported: () => true,
    appId: () => "axotubeapp.AxoTubeStandalone",
    appRunning: (id, cb) => cb(null, false),
    debugLaunch: (id, cb) => sdb.debugLaunch(id, {}, cb),
    checkDeveloperMode: (cb) => sdb.checkDeveloperMode(cb),
    attach: (opts, cb) => cdp.attach(opts, cb),
    launchNormal: () => {},
    readBundle: (name) => fs.readFileSync(path.join(USERSCRIPT_DIR, name), "utf8"),
    readSettings: () => ({ debugger: true, revision: 0 }),
    schedule: (fn, ms) => setTimeout(fn, ms),
    now: () => Date.now(),
  };
  const l = launcher.createLauncher(deps);
  const ask = () => new Promise((resolve) => l.next("", resolve));
  try {
    await keepOnlyPage(chromePort, (await getJson(chromePort, "/json/list"))[0].id);
    assert.equal((await ask()).action, "exit");
    await until(async () => (await ask()).action === "attached", 20000, "attached");
    const flags = await until(
      () => evaluate(chromePort, "JSON.stringify({ cdp: window.__axotubeCdp === true, url: window.__axotubeServiceUrl, proxy: window.__axotubeProxyUrl, errors: (window.__axotubeErrors || []).filter(function (e) { return /^early:/.test(e); }) })"),
      20000,
      "injected flags",
    );
    const parsed = JSON.parse(flags);
    assert.equal(parsed.cdp, true, "the injected wrapper ran");
    assert.equal(parsed.url, "http://127.0.0.1:8080");
    assert.equal(parsed.proxy, "http://127.0.0.1:8081", "the updater on youtube.com needs the proxy's address");
    assert.deepEqual(parsed.errors, [], "the early bundle ran without errors");
    const mainErrors = await evaluate(chromePort, "JSON.stringify(window.__axotubeErrors || [])");
    if (JSON.parse(mainErrors).length) {
      console.log("[note] main bundle reported (expected offline, YouTube is not reachable): " + mainErrors);
    }
  } finally {
    server.close();
    api.close();
    sdbServer.close();
    await chrome.stop();
  }
});

test("refreshScripts makes the next page load run the new bundle", { skip: SKIP }, async () => {
  const chromePort = await freePort();
  const chrome = await startChrome(chromePort);
  const server = await serve(pages());
  const base = "http://127.0.0.1:" + server.address().port;
  const apiPort = await freePort();
  const sdbPort = await freePort();
  const api = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ device: { developerMode: "1", developerIP: "127.0.0.1", ip: "127.0.0.1" } }));
  });
  await new Promise((r) => api.listen(apiPort, "127.0.0.1", r));
  const sdbServer = net.createServer((socket) => {
    let buf = "";
    socket.on("error", () => {});
    socket.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      const len = parseInt(buf.slice(0, 4), 16);
      if (buf.length < 4 + len) return;
      socket.write("OKAY");
      socket.write("debug : " + chromePort + "\n");
    });
  });
  await new Promise((r) => sdbServer.listen(sdbPort, "127.0.0.1", r));
  sdb.setEndpoints({ apiPort: apiPort, sdbPort: sdbPort });
  launcher.setTestOverrides({ youtubeUrl: base + "/yt.html" });

  // The "bundle" is a single marker that the early bundle sets. A new version
  // changes the marker, so a page load shows which code ran.
  let version = "v1";
  const bundleFor = (name) => (name === "early.js"
    ? "window.__bundleVersion = " + JSON.stringify(version) + ";"
    : "");
  const deps = {
    supported: () => true,
    appId: () => "axotubeapp.AxoTubeStandalone",
    appRunning: (id, cb) => cb(null, false),
    debugLaunch: (id, cb) => sdb.debugLaunch(id, {}, cb),
    checkDeveloperMode: (cb) => sdb.checkDeveloperMode(cb),
    attach: (opts, cb) => cdp.attach(opts, cb),
    launchNormal: () => {},
    readBundle: bundleFor,
    readSettings: () => ({ debugger: true, revision: 0 }),
    schedule: (fn, ms) => setTimeout(fn, ms),
    now: () => Date.now(),
  };
  const l = launcher.createLauncher(deps);
  const ask = () => new Promise((resolve) => l.next("", resolve));
  try {
    await keepOnlyPage(chromePort, (await getJson(chromePort, "/json/list"))[0].id);
    assert.equal((await ask()).action, "exit");
    await until(async () => (await ask()).action === "attached", 20000, "attached");
    const first = await until(() => evaluate(chromePort, "String(window.__bundleVersion)"), 15000, "first version");
    assert.equal(first, "v1");

    // An update lands. The running page is not touched; the next load gets v2.
    version = "v2";
    l.refreshScripts();
    assert.equal(await evaluate(chromePort, "String(window.__bundleVersion)"), "v1", "the page is not reloaded by the refresh");
    await evaluate(chromePort, "location.reload()");
    const second = await until(async () => {
      const v = await evaluate(chromePort, "String(window.__bundleVersion)");
      return v === "v2" ? v : null;
    }, 20000, "v2 after reload");
    assert.equal(second, "v2");
  } finally {
    server.close();
    api.close();
    sdbServer.close();
    await chrome.stop();
  }
});
