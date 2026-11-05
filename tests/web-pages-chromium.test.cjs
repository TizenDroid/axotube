"use strict";
// The phone config page and the TV diagnostics page, run in a real Chromium against
// stub APIs. Checks that they render with no page errors, show the data, and send
// the requests their buttons promise. Skipped when Playwright's Chromium is missing.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const { webConfigPage } = require(path.join(ROOT, "service", "webConfigPage.js"));
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

const DIAG = {
  service: { version: "1.31.3", node: "v4.4.4", uptimeSeconds: 42 },
  bundle: { current: "1.31.3", latest: "1.31.4", available: true, error: null },
  launch: { debugger: false, state: "idle", reason: "" },
  events: [{ t: 1700000000000, level: "warn", message: "media 403 /videoplayback range=- length=12" }],
};

// Serves the pages and records what was asked of the API.
function stubServer(pages, api) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      const url = req.url.split("?")[0];
      calls.push({ method: req.method, url: url, body: body });
      if (pages[req.method + " " + url]) {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        return res.end(pages[req.method + " " + url]);
      }
      if (api[req.method + " " + url]) {
        const out = api[req.method + " " + url](body);
        res.setHeader("Content-Type", "application/json");
        return res.end(JSON.stringify(out));
      }
      res.writeHead(404);
      res.end();
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({
    base: "http://127.0.0.1:" + server.address().port,
    calls: calls,
    close: () => new Promise((r) => server.close(() => r())),
  })));
}

// The shell loads its assets from the pinned jsDelivr release. Answer those requests from
// the files on disk, so the page runs exactly as shipped, integrity checks included.
// Pass { down: true } to simulate the CDN being unreachable.
const WEB_DIR = path.join(ROOT, "service", "web");
const CDN = /^https:\/\/cdn\.jsdelivr\.net\/gh\/TizenDroid\/axotube@v[^/]+\/service\/web\/([\w.-]+)$/;
async function serveAssets(context, opts) {
  await context.route(CDN, (route) => {
    if (opts && opts.down) return route.abort("internetdisconnected");
    const name = route.request().url().match(CDN)[1];
    const file = path.join(WEB_DIR, name);
    if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: "" });
    const type = name.endsWith(".css") ? "text/css" : name.endsWith(".json") ? "application/json" : "text/javascript";
    return route.fulfill({ status: 200, contentType: type, body: fs.readFileSync(file) });
  });
}

async function withBrowser(fn) {
  const browser = await pw.chromium.launch({ executablePath: chromePath, args: ["--no-sandbox", "--disable-gpu"] });
  try {
    return await fn(browser);
  } finally {
    await browser.close();
  }
}

test("the TV diagnostics page renders the versions, events and retry", { skip: SKIP, timeout: 60000 }, async () => {
  const server = await stubServer(
    { "GET /axotube/diagnostics": diagnosticsPage },
    {
      "GET /axotube/diagnostics.json": () => DIAG,
      "POST /axotube/launch/reset": () => ({ ok: true, state: "idle" }),
    },
  );
  try {
    await withBrowser(async (browser) => {
      const page = await browser.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(server.base + "/axotube/diagnostics?wgt=1.31.3");
      await page.waitForFunction(() => document.getElementById("versions").textContent.indexOf("Service") !== -1);
      const versions = await page.textContent("#versions");
      assert.match(versions, /App\s*1\.31\.3\s*Service\s*1\.31\.3\s*Bundle\s*1\.31\.3 \(update 1\.31\.4 ready\)/);
      assert.match(await page.textContent("#events"), /media 403 \/videoplayback/);
      assert.match(await page.textContent("#launch"), /Mode\s*Proxy/);

      await page.click("#retryBtn");
      await page.waitForFunction(() => document.getElementById("note").textContent.indexOf("Cleared") !== -1);
      assert.ok(server.calls.some((c) => c.method === "POST" && c.url === "/axotube/launch/reset"), "retry posts the reset");
      assert.deepEqual(errors, [], "no page errors");
    });
  } finally {
    await server.close();
  }
});

test("the TV diagnostics page warns when the service is older than the app", { skip: SKIP, timeout: 60000 }, async () => {
  const server = await stubServer(
    { "GET /axotube/diagnostics": diagnosticsPage },
    { "GET /axotube/diagnostics.json": () => DIAG },
  );
  try {
    await withBrowser(async (browser) => {
      const page = await browser.newPage();
      await page.goto(server.base + "/axotube/diagnostics?wgt=1.32.0");
      await page.waitForFunction(() => document.getElementById("versionWarn").textContent.indexOf("older") !== -1);
      const quiet = await browser.newPage();
      await quiet.goto(server.base + "/axotube/diagnostics?wgt=1.31.0");
      await quiet.waitForFunction(() => document.getElementById("versions").textContent.indexOf("Service") !== -1);
      assert.equal(await quiet.isHidden("#versionWarn"), true, "a newer service is not warned about");
      assert.match(await quiet.textContent("#versions"), /App\s*1\.31\.0\s*Service\s*1\.31\.3/);
    });
  } finally {
    await server.close();
  }
});

test("the phone config page shows the launch mode and saves it", { skip: SKIP, timeout: 60000 }, async () => {
  const settings = { debugger: false };
  const server = await stubServer(
    { "GET /": webConfigPage },
    {
      "GET /api/config": () => ({ revision: 1, config: {} }),
      "GET /api/launch": () => ({ debugger: settings.debugger }),
      "POST /api/launch": (body) => {
        settings.debugger = JSON.parse(body).debugger === true;
        return { ok: true, debugger: settings.debugger };
      },
      "GET /api/diagnostics": () => DIAG,
    },
  );
  try {
    await withBrowser(async (browser) => {
      const context = await browser.newContext();
      await context.addInitScript(() => {
        window.localStorage.setItem("axotube-pair-token", "test-token");
      });
      await serveAssets(context);
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(server.base + "/");
      await page.waitForFunction(() => document.getElementById("launchDebugger") && document.getElementById("launchDebugger").offsetParent !== null);
      assert.equal(await page.isChecked("#launchDebugger"), false, "proxy is the default");

      await page.check("#launchDebugger");
      await page.click("#launchSave");
      await page.waitForFunction(() => document.getElementById("launchNote").textContent.indexOf("Saved") !== -1);
      assert.equal(settings.debugger, true, "the choice reached the service");
      assert.match(await page.textContent("#launchNote"), /next time YouTube opens/);

      const diag = await page.textContent("#diagSummary");
      assert.match(diag, /Service 1\.31\.3 · bundle 1\.31\.3 \(update 1\.31\.4 ready\) · launch proxy/);
      assert.match(await page.textContent("#diagLog"), /media 403/);
      assert.deepEqual(errors, [], "no page errors");
    });
  } finally {
    await server.close();
  }
});
