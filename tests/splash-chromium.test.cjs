"use strict";
// The TV splash (standalone/index.html) in a real Chromium, with the Tizen API
// stubbed and a stub proxy on 127.0.0.1:8081. Covers the version warning, the
// Enter retry after launch failures, and the red key opening diagnostics.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const lock = require(path.join(ROOT, "tests", "support", "port-lock.cjs"));
const { diagnosticsPage } = require(path.join(ROOT, "service", "diagnosticsPage.js"));

function loadPlaywright() {
  const candidates = [process.env.PLAYWRIGHT_PATH, "playwright", "/opt/npm-tools/node_modules/playwright"];
  for (const c of candidates) {
    if (!c) continue;
    try {
      return require(c);
    } catch (e) {
      // next location
    }
  }
  return null;
}
const pw = loadPlaywright();
const chromePath = pw ? pw.chromium.executablePath() : null;
const SKIP = chromePath && fs.existsSync(chromePath) ? false : "Playwright Chromium not installed";

// The stub proxy on 8081: health with a version, launch answers, and the pages.
// healthStatus 503 keeps the splash waiting on the health check (it never opens YouTube).
function startProxy(serviceVersion, requests, healthStatus) {
  const server = http.createServer((req, res) => {
    requests.push(req.method + " " + req.url);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "*");
    if (req.method === "OPTIONS") return res.end();
    const url = req.url.split("?")[0];
    if (url === "/axotube/health" && healthStatus) {
      res.writeHead(healthStatus);
      return res.end();
    }
    if (url === "/axotube/health") {
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ ok: true, version: serviceVersion }));
    }
    if (url === "/axotube/launch/next") {
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ action: "proxy", mode: "proxy", state: "idle", reason: "" }));
    }
    if (url === "/axotube/diagnostics") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.end(diagnosticsPage);
    }
    if (url === "/tv") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.end("<!doctype html><title>STUB YOUTUBE PROXY</title>");
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(8081, "127.0.0.1", () => resolve(server));
  });
}

// Serves the splash itself on another port, so its origin is not 8081.
function startSplashHost() {
  const html = fs.readFileSync(path.join(ROOT, "standalone", "index.html"), "utf8");
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(html);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

// Tizen stand-in. launchFailures is how many launches fail before one succeeds.
function tizenStub(appVersion, launchFailures) {
  return `
    window.__launchCalls = 0;
    window.__exits = 0;
    window.tizen = {
      websetting: { setUserAgentString: function () {} },
      tvinputdevice: { registerKey: function () {} },
      ApplicationControl: function () {},
      application: {
        getCurrentApplication: function () {
          return {
            appInfo: { packageId: "axotubeapp", version: ${JSON.stringify(appVersion)} },
            getRequestedAppControl: function () { throw new Error("no app control"); },
            exit: function () { window.__exits += 1; }
          };
        },
        launchAppControl: function (control, id, ok, fail) {
          window.__launchCalls += 1;
          if (window.__launchCalls <= ${launchFailures}) fail({ message: "stub refused" });
          else setTimeout(ok, 0);
        }
      }
    };
  `;
}

async function withPage(fn) {
  const browser = await pw.chromium.launch({ executablePath: chromePath, args: ["--no-sandbox", "--disable-gpu"] });
  try {
    return await fn(browser);
  } finally {
    await browser.close();
  }
}

test("a splash whose service is older than the app warns, then opens YouTube", { skip: SKIP, timeout: 60000 }, async () => {
  await lock.acquire();
  const requests = [];
  const proxy = await startProxy("1.31.2", requests);
  const host = await startSplashHost();
  try {
    await withPage(async (browser) => {
      const page = await browser.newPage();
      await page.addInitScript(tizenStub("1.31.3", 0));
      await page.goto("http://127.0.0.1:" + host.address().port + "/index.html");
      await page.waitForFunction(() => document.getElementById("status").textContent.indexOf("older") !== -1, null, { timeout: 15000 });
      assert.match(await page.textContent("#status"), /Service 1\.31\.2 is older than the app 1\.31\.3\. Reinstall the app\./);
      await page.waitForURL(/localhost:8081\/tv/, { timeout: 15000 });
      assert.ok(requests.some((r) => r.indexOf("/axotube/launch/next") !== -1), "the proxy was asked how to open YouTube");
    });
  } finally {
    proxy.close();
    host.close();
    lock.release();
  }
});

test("launch failures show a retry prompt, and Enter launches the service again", { skip: SKIP, timeout: 60000 }, async () => {
  await lock.acquire();
  const requests = [];
  const proxy = await startProxy("1.31.3", requests);
  const host = await startSplashHost();
  try {
    await withPage(async (browser) => {
      const page = await browser.newPage();
      await page.addInitScript(tizenStub("1.31.3", 3));
      await page.goto("http://127.0.0.1:" + host.address().port + "/index.html");
      await page.waitForFunction(() => document.getElementById("status").textContent.indexOf("Press Enter") !== -1, null, { timeout: 20000 });
      assert.match(await page.textContent("#status"), /Press Enter to retry\. Red for diagnostics\./);
      assert.equal(await page.evaluate(() => window.__launchCalls), 3);

      await page.keyboard.press("Enter");
      await page.waitForFunction(() => window.__launchCalls === 4, null, { timeout: 15000 });
      await page.waitForURL(/localhost:8081\/tv/, { timeout: 15000 });
    });
  } finally {
    proxy.close();
    host.close();
    lock.release();
  }
});

test("the red key opens the diagnostics page", { skip: SKIP, timeout: 60000 }, async () => {
  await lock.acquire();
  const requests = [];
  const proxy = await startProxy("1.31.3", requests, 503);
  const host = await startSplashHost();
  try {
    await withPage(async (browser) => {
      const page = await browser.newPage();
      await page.addInitScript(tizenStub("1.31.3", 0));
      await page.goto("http://127.0.0.1:" + host.address().port + "/index.html");
      await page.waitForFunction(() => document.getElementById("status").textContent.indexOf("Starting") !== -1, null, { timeout: 15000 });
      // Playwright has no name for the Tizen colour keys, so the keydown is sent
      // with the TV's key code (403 is red).
      await page.evaluate(() => {
        const event = new Event("keydown", { bubbles: true });
        Object.defineProperty(event, "keyCode", { get: function () { return 403; } });
        document.dispatchEvent(event);
      });
      await page.waitForURL(/127\.0\.0\.1:8081\/axotube\/diagnostics/, { timeout: 15000 });
    });
  } finally {
    proxy.close();
    host.close();
    lock.release();
  }
});

test("a service that updated itself ahead of the app opens YouTube with no warning", { skip: SKIP, timeout: 60000 }, async () => {
  await lock.acquire();
  const requests = [];
  const proxy = await startProxy("1.31.4", requests);
  const host = await startSplashHost();
  try {
    await withPage(async (browser) => {
      const page = await browser.newPage();
      await page.addInitScript(tizenStub("1.31.3", 0));
      await page.goto("http://127.0.0.1:" + host.address().port + "/index.html");
      await page.waitForURL(/localhost:8081\/tv/, { timeout: 15000 });
    });
  } finally {
    proxy.close();
    host.close();
    lock.release();
  }
});
