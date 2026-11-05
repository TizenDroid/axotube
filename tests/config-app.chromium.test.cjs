"use strict";
// The redesigned Web Config application, run in a real Chromium against a stateful stub
// of the TV API. Covers saving with the revision, conflict resolution on HTTP 409,
// discard, search, the CDN-outage state, phone layout and forgetting a browser.
// Skipped when Playwright's Chromium is missing, like the other browser suites.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const { webConfigPage } = require(path.join(ROOT, "service", "webConfigPage.js"));
const WEB_DIR = path.join(ROOT, "service", "web");

function loadPlaywright() {
  for (const c of [process.env.PLAYWRIGHT_PATH, "playwright", "/opt/npm-tools/node_modules/playwright"]) {
    if (!c) continue;
    try { return require(c); } catch (e) { /* next */ }
  }
  return null;
}
const pw = loadPlaywright();
const chromePath = pw ? pw.chromium.executablePath() : null;
const SKIP = chromePath && fs.existsSync(chromePath) ? false : "Playwright Chromium not installed";

const CDN = /^https:\/\/cdn\.jsdelivr\.net\/gh\/TizenDroid\/axotube@v[^/]+\/service\/web\/([\w.-]+)$/;

// A TV with saved settings. `api` lets a test change the TV behind the page's back.
function makeTv(initial) {
  const tv = {
    revision: initial.revision,
    config: Object.assign({}, initial.config),
    posts: [],
    launchDebugger: false,
    postStatus: null, // when set, the next POST /api/config answers with this status
  };
  return tv;
}

function startServer(tv) {
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      const url = req.url.split("?")[0];
      const send = (status, data) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(data));
      };
      if (req.method === "GET" && url === "/") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        return res.end(webConfigPage);
      }
      if (req.method === "GET" && url === "/api/config") return send(200, { revision: tv.revision, config: tv.config });
      if (req.method === "POST" && url === "/api/config") {
        const parsed = JSON.parse(body);
        tv.posts.push(parsed);
        if (tv.postStatus) {
          const status = tv.postStatus;
          tv.postStatus = null;
          return send(status, { error: status === 409 ? "stale" : "nope" });
        }
        if (parsed.revision !== tv.revision) return send(409, { error: "stale" });
        tv.revision += 1;
        tv.config = parsed.config;
        return send(200, { revision: tv.revision });
      }
      if (req.method === "GET" && url === "/api/launch") return send(200, { debugger: tv.launchDebugger });
      if (req.method === "POST" && url === "/api/launch") {
        tv.launchDebugger = JSON.parse(body).debugger === true;
        return send(200, { ok: true, debugger: tv.launchDebugger });
      }
      if (req.method === "GET" && url === "/api/diagnostics") {
        return send(200, {
          service: { version: "1.41.0" },
          bundle: { current: "1.41.0", available: false },
          launch: { debugger: false },
          events: [],
        });
      }
      if (req.method === "POST" && url === "/api/command") return send(200, { ok: true });
      if (req.method === "POST" && url === "/api/pair") return send(200, { token: "test-token" });
      res.writeHead(404);
      res.end();
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({
    base: "http://127.0.0.1:" + server.address().port,
    close: () => new Promise((r) => server.close(() => r())),
  })));
}

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

const DEFAULT_CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, "config-schema.json"), "utf8")).defaults;

async function openPaired(browser, server, opts) {
  const options = opts || {};
  const context = await browser.newContext(options.viewport ? { viewport: options.viewport } : {});
  await context.addInitScript((token) => {
    if (!window.sessionStorage.getItem("seeded")) {
      window.localStorage.setItem("axotube-pair-token", token);
      window.sessionStorage.setItem("seeded", "1");
    }
  }, "test-token");
  await serveAssets(context, { down: !!options.cdnDown });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  await page.goto(server.base + "/");
  return { page, errors, context };
}

// The page opens on Overview. Wait for it to be rendered from the loaded settings.
async function waitForSettings(page) {
  await page.waitForSelector("#nav", { state: "attached" });
  await page.waitForSelector(".cards");
}

async function withBrowser(fn) {
  const browser = await pw.chromium.launch({ executablePath: chromePath, args: ["--no-sandbox", "--disable-gpu"] });
  try {
    return await fn(browser);
  } finally {
    await browser.close();
  }
}

test("a changed switch is counted, then saved with the TV's revision", { skip: SKIP, timeout: 60000 }, async () => {
  const tv = makeTv({ revision: 3, config: DEFAULT_CONFIG });
  const server = await startServer(tv);
  try {
    await withBrowser(async (browser) => {
      const { page, errors, context } = await openPaired(browser, server);
      await waitForSettings(page);
      await page.click('[data-section="browse"]');
      await page.waitForSelector('[data-key="enableShorts"]');

      assert.equal(await page.isDisabled("#saveBtn"), true, "nothing to save at first");
      await page.click('[data-key="enableShorts"] input[role="switch"]');
      assert.match(await page.textContent("#saveCount"), /1 unsaved change/);
      assert.equal(await page.isDisabled("#saveBtn"), false);

      await page.click("#saveBtn");
      await page.waitForFunction(() => document.getElementById("conn").textContent.indexOf("revision 4") !== -1);
      assert.equal(tv.posts.length, 1, "one save request");
      assert.equal(tv.posts[0].revision, 3, "sent the revision it loaded");
      assert.equal(tv.posts[0].config.enableShorts, false, "sent the changed value");
      assert.equal(tv.config.enableShorts, false, "the TV stored it");
      assert.deepEqual(errors, [], "no page errors");
      await context.close();
    });
  } finally {
    await server.close();
  }
});

test("a stale save re-reads the TV and asks before overwriting a conflicting edit", { skip: SKIP, timeout: 60000 }, async () => {
  const tv = makeTv({ revision: 3, config: DEFAULT_CONFIG });
  const server = await startServer(tv);
  try {
    await withBrowser(async (browser) => {
      const { page, errors, context } = await openPaired(browser, server);
      await waitForSettings(page);

      // Edit quality here, while the TV changes quality and ad blocking elsewhere.
      await page.fill("#search", "quality");
      await page.waitForSelector('[data-key="preferredVideoQuality"] select');
      await page.selectOption('[data-key="preferredVideoQuality"] select', "1080p");

      tv.revision = 4;
      tv.config = Object.assign({}, DEFAULT_CONFIG, { preferredVideoQuality: "720p", enableAdBlock: false });

      await page.click("#saveBtn");
      await page.waitForSelector(".conflicts");
      assert.match(await page.textContent(".conflicts h2"), /changed on your TV/);
      assert.equal(await page.isDisabled("#saveBtn"), true, "cannot save until the conflict is decided");

      const row = page.locator(".conflict-row", { hasText: "Preferred video quality" });
      await row.getByRole("button", { name: "Keep mine" }).click();
      assert.equal(await page.isDisabled("#saveBtn"), false, "save is available once decided");

      await page.click("#saveBtn");
      await page.waitForFunction(() => document.getElementById("conn").textContent.indexOf("revision 5") !== -1);
      const sent = tv.posts[tv.posts.length - 1];
      assert.equal(sent.revision, 4, "resubmitted with the latest revision");
      assert.equal(sent.config.preferredVideoQuality, "1080p", "the user's choice was kept");
      assert.equal(sent.config.enableAdBlock, false, "the untouched TV change was accepted, not overwritten");
      assert.deepEqual(errors, [], "no page errors");
      await context.close();
    });
  } finally {
    await server.close();
  }
});

test("discard restores the saved value without sending anything", { skip: SKIP, timeout: 60000 }, async () => {
  const tv = makeTv({ revision: 3, config: DEFAULT_CONFIG });
  const server = await startServer(tv);
  try {
    await withBrowser(async (browser) => {
      const { page, context } = await openPaired(browser, server);
      await waitForSettings(page);
      await page.fill("#search", "shorts");
      await page.waitForSelector('[data-key="enableShorts"]');
      await page.click('[data-key="enableShorts"] input[role="switch"]');
      await page.click("#discardBtn");
      assert.equal(await page.isChecked('[data-key="enableShorts"] input[role="switch"]'), true, "back to the saved value");
      assert.equal(tv.posts.length, 0, "discard sends no request");
      await context.close();
    });
  } finally {
    await server.close();
  }
});

test("search finds a setting by an alias, not only its internal key", { skip: SKIP, timeout: 60000 }, async () => {
  const tv = makeTv({ revision: 3, config: DEFAULT_CONFIG });
  const server = await startServer(tv);
  try {
    await withBrowser(async (browser) => {
      const { page, context } = await openPaired(browser, server);
      await waitForSettings(page);
      await page.fill("#search", "4K");
      await page.waitForSelector('[data-key="preferredVideoQuality"]');
      assert.equal(await page.isVisible('[data-key="preferredVideoQuality"]'), true);
      await context.close();
    });
  } finally {
    await server.close();
  }
});

test("when the CDN cannot be reached the page says so, rather than staying blank", { skip: SKIP, timeout: 60000 }, async () => {
  const tv = makeTv({ revision: 3, config: DEFAULT_CONFIG });
  const server = await startServer(tv);
  try {
    await withBrowser(async (browser) => {
      const { page, errors, context } = await openPaired(browser, server, { cdnDown: true });
      await page.waitForSelector("#bootError:not([hidden])", { timeout: 15000 });
      assert.match(await page.textContent("#bootError"), /could not load its interface assets/i);
      assert.deepEqual(errors, [], "a failed asset is not an uncaught error");
      await context.close();
    });
  } finally {
    await server.close();
  }
});

test("a phone-width screen has no horizontal scroll and keeps the save bar in view", { skip: SKIP, timeout: 60000 }, async () => {
  const tv = makeTv({ revision: 3, config: DEFAULT_CONFIG });
  const server = await startServer(tv);
  try {
    await withBrowser(async (browser) => {
      const { page, context } = await openPaired(browser, server, { viewport: { width: 320, height: 640 } });
      await waitForSettings(page);
      await page.selectOption("#sectionSelect", "playback");
      await page.click('[data-key="enableRemainingTime"] input[role="switch"]');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(overflow <= 0, "no horizontal overflow at 320px (got " + overflow + ")");
      assert.equal(await page.isVisible("#savebar"), true, "save bar is visible");
      await context.close();
    });
  } finally {
    await server.close();
  }
});

test("forgetting this browser clears its pairing and returns to the code screen", { skip: SKIP, timeout: 60000 }, async () => {
  const tv = makeTv({ revision: 3, config: DEFAULT_CONFIG });
  const server = await startServer(tv);
  try {
    await withBrowser(async (browser) => {
      const { page, context } = await openPaired(browser, server);
      await waitForSettings(page);
      await page.click('[data-section="overview"]');
      await page.click("#forgetBtn");
      await page.waitForSelector("#forgetDialog[open]");
      await page.click("#forgetConfirm");
      await page.waitForSelector("#pairing:not([hidden])");
      const token = await page.evaluate(() => window.localStorage.getItem("axotube-pair-token"));
      assert.equal(token, null, "this browser's token is removed");
      await context.close();
    });
  } finally {
    await server.close();
  }
});
