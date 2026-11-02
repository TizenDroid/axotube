"use strict";
// The whole launch as a user sees it: the real standalone/index.html in a real
// Chromium, the real content proxy in a child process (with a Tizen stand-in), and
// the real launcher's SDB and CDP calls. Each scenario is one dev-mode setting.
// Skipped when Playwright's Chromium is not installed, or when port 8081 is busy.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const cdp = require(path.join(ROOT, "service", "cdp", "cdp.js"));
const lock = require(path.join(ROOT, "tests", "support", "port-lock.cjs"));

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

function portFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.listen(port, "127.0.0.1", () => s.close(() => resolve(true)));
  });
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

function closeServer(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

// Device API stand-in with the given developer settings. null = no server at all.
async function deviceApi(device) {
  if (device === null) {
    const port = await freePort();
    return { port: port, close: async () => {} };
  }
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ device: device }));
  });
  const port = await listen(server);
  return { port: port, close: () => closeServer(server) };
}

// SDB stand-in. refused = answer with a failure. debugPort = the port it reports.
async function sdbStandIn(mode, debugPort) {
  const server = net.createServer((socket) => {
    let buf = "";
    socket.on("error", () => {});
    socket.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      const len = parseInt(buf.slice(0, 4), 16);
      if (buf.length < 4 + len) return;
      if (mode === "refused") socket.write("FAIL0004nope");
      else {
        socket.write("OKAY");
        socket.write("debug : " + debugPort + "\n");
      }
    });
  });
  const port = await listen(server);
  return { port: port, close: () => closeServer(server) };
}

function startProxy(env) {
  const child = spawn(process.execPath, [path.join(ROOT, "tests", "support", "proxy-harness.cjs")], {
    env: Object.assign({}, process.env, env),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const out = { text: "" };
  child.stdout.on("data", (c) => { out.text += c.toString("utf8"); });
  child.stderr.on("data", (c) => { out.text += c.toString("utf8"); });
  out.child = child;
  out.stop = () => new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.on("exit", () => resolve());
    child.kill("SIGKILL");
  });
  return out;
}

async function waitForProxy() {
  const end = Date.now() + 20000;
  while (Date.now() < end) {
    const ok = await new Promise((resolve) => {
      const req = http.get("http://127.0.0.1:8081/axotube/health", (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      });
      req.on("error", () => resolve(false));
      req.setTimeout(1000, () => { req.abort(); resolve(false); });
    });
    if (ok) return;
    await sleep(200);
  }
  throw new Error("the proxy did not start on 8081");
}

// The page under test: the real index.html, with a Tizen stand-in. exit() is reported
// to the test site, which counts it. The count does not depend on which origin the
// page ends up on.
const TIZEN_STUB = `
(function () {
  window.tizen = {
    websetting: { setUserAgentString: function () {} },
    tvinputdevice: { registerKey: function () {} },
    ApplicationControl: function () {},
    application: {
      getCurrentApplication: function () {
        return {
          appInfo: { packageId: "axotubeapp" },
          getRequestedAppControl: function () { throw new Error("no app control"); },
          // A real exit ends the app, and the next start runs index.html again. A
          // reload stands in for that fresh start.
          exit: function () {
            try {
              var x = new XMLHttpRequest();
              x.open("GET", "/__exit", false);
              x.send();
            } catch (e) {}
            // Long enough for a successful CDP navigation to cancel the restart, which
            // a real exit would never race with.
            setTimeout(function () { location.reload(); }, 2000);
          },
        };
      },
      launchAppControl: function (control, id, ok) { if (ok) ok(); },
    },
  };
})();
`;

function pageTargets(debugPort) {
  return new Promise((resolve, reject) => {
    cdp.getJson("127.0.0.1", debugPort, "/json/list", (err, list) => {
      if (err) return reject(err);
      resolve(list.filter((t) => t.type === "page"));
    });
  });
}

// The launcher attaches to the first page target, so the page under test has to be
// the only one. Closes every other page target.
function closeOtherPages(debugPort, keepId) {
  return pageTargets(debugPort).then((list) => Promise.all(list
    .filter((t) => t.id !== keepId)
    .map((t) => new Promise((resolve) => {
      http.get({ host: "127.0.0.1", port: debugPort, path: "/json/close/" + t.id }, (res) => {
        res.resume();
        res.on("end", resolve);
      }).on("error", resolve);
    }))));
}

async function startChromeWithPage(debugPort) {
  const browser = await pw.chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--remote-debugging-port=" + debugPort],
  });
  const context = await browser.newContext();
  const before = (await pageTargets(debugPort)).map((t) => t.id);
  const page = await context.newPage();
  await page.addInitScript(TIZEN_STUB);
  const created = (await pageTargets(debugPort)).filter((t) => before.indexOf(t.id) === -1);
  if (created.length === 1) await closeOtherPages(debugPort, created[0].id);
  return { browser: browser, page: page };
}

function serveSite() {
  const indexHtml = fs.readFileSync(path.join(ROOT, "standalone", "index.html"), "utf8");
  const counter = { exits: 0 };
  const server = http.createServer((req, res) => {
    const url = req.url.split("?")[0];
    if (url === "/__exit") {
      counter.exits += 1;
      res.writeHead(204);
      return res.end();
    }
    if (url === "/index.html") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.end(indexHtml);
    }
    if (url === "/yt.html") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.end("<!doctype html><html><head><title>yt</title></head><body>yt stand-in</body></html>");
    }
    res.writeHead(404);
    res.end();
  });
  return listen(server).then((port) => ({ port: port, exits: () => counter.exits, close: () => closeServer(server) }));
}

// Runs one scenario and returns what happened.
async function scenario(opts) {
  await lock.acquire();
  try {
    return await runScenario(opts);
  } finally {
    lock.release();
  }
}

async function runScenario(opts) {
  // The launch mode the user chose. The debugger launch is the one under test
  // unless a scenario asks for the default proxy path.
  const launchFile = path.join(os.tmpdir(), "axotube-launch-test-" + process.pid + "-" + Date.now() + ".json");
  fs.writeFileSync(launchFile, JSON.stringify({ debugger: opts.launchMode !== "proxy", revision: 1 }));
  const site = await serveSite();
  const base = "http://127.0.0.1:" + site.port;
  const debugPort = await freePort();
  const api = await deviceApi(opts.device);
  const sdbStub = await sdbStandIn(opts.sdb || "ok", debugPort);
  const proxy = startProxy({
    AXOTUBE_LAUNCH_FILE: launchFile,
    AXOTUBE_TEST_API_PORT: String(api.port),
    AXOTUBE_TEST_SDB_PORT: String(sdbStub.port),
    AXOTUBE_TEST_YOUTUBE_URL: opts.youtubeUrl || base + "/yt.html",
    AXOTUBE_TEST_WGT_RUNNING: opts.wgtRunning ? "1" : "0",
  });
  let chrome = null;
  const result = { proxyLog: "" };
  try {
    await waitForProxy();
    chrome = await startChromeWithPage(debugPort);
    await chrome.page.goto(base + "/index.html");
    result.landed = await waitFor(async () => {
      const url = chrome.page.url();
      return url.indexOf("/yt.html") !== -1 || url.indexOf("localhost:8081/tv") !== -1 ? url : null;
    }, opts.timeoutMs || 30000);
    result.url = chrome.page.url();
    result.exitCalls = site.exits();
    if (opts.youtubeUrl) result.youtubeUrl = opts.youtubeUrl;
    if (result.url.indexOf("/yt.html") !== -1) {
      result.cdpRan = await waitFor(() => chrome.page.evaluate(() => window.__axotubeCdp === true ? true : null), 15000);
    }
  } finally {
    result.proxyLog = proxy.text;
    if (process.env.CDP_TEST_DEBUG) process.stdout.write("---- proxy log ----\n" + proxy.text + "\n---- end ----\n");
    if (chrome) await chrome.browser.close().catch(() => {});
    await proxy.stop();
    try { fs.rmSync(launchFile, { force: true }); } catch (e) { /* temp file */ }
    await api.close();
    await sdbStub.close();
    await site.close();
  }
  return result;
}

async function waitFor(fn, ms) {
  const end = Date.now() + (ms || 15000);
  let last = null;
  while (Date.now() < end) {
    try {
      last = await fn();
      if (last) return last;
    } catch (e) {
      last = e.message;
    }
    await sleep(200);
  }
  return null;
}

const DEV_ON = { developerMode: "1", developerIP: "127.0.0.1", ip: "192.168.1.5" };

test("developer mode on: exit, SDB restart under the debugger, then CDP navigates to YouTube", { skip: SKIP, timeout: 90000 }, async () => {
  if (!(await portFree(8081))) throw new Error("port 8081 is busy");
  const r = await scenario({ device: DEV_ON, sdb: "ok" });
  assert.equal(r.exitCalls, 1, "the WGT was asked to exit exactly once");
  assert.ok(r.url.indexOf("/yt.html") !== -1, "landed on the CDP-navigated page, got " + r.url);
  assert.equal(r.cdpRan, true, "the injected wrapper ran in the page");
  assert.ok(/attached on port \d+; navigated to YouTube/.test(r.proxyLog), r.proxyLog);
});

test("default launch mode: YouTube opens through the proxy at once, with no exit", { skip: SKIP, timeout: 90000 }, async () => {
  if (!(await portFree(8081))) throw new Error("port 8081 is busy");
  const r = await scenario({ device: DEV_ON, sdb: "ok", launchMode: "proxy" });
  assert.equal(r.exitCalls, 0, "the WGT is never asked to exit");
  assert.ok(r.url.indexOf("localhost:8081/tv") !== -1, "landed on the proxy, got " + r.url);
  assert.ok(!/\[TEST\] launch/.test(r.proxyLog), "no debugger relaunch");
});

test("developer mode off: no exit, and the page falls back to the proxy", { skip: SKIP, timeout: 90000 }, async () => {
  if (!(await portFree(8081))) throw new Error("port 8081 is busy");
  const r = await scenario({ device: Object.assign({}, DEV_ON, { developerMode: "0" }) });
  assert.equal(r.exitCalls, 0, "the WGT is not asked to exit");
  assert.ok(r.url.indexOf("localhost:8081/tv") !== -1, "landed on the proxy, got " + r.url);
  assert.ok(/Developer mode is off\. Turn it on/.test(r.proxyLog), r.proxyLog);
  assert.ok(!/\[TEST\] launch/.test(r.proxyLog), "no relaunch");
});

test("developer IP set to the PC: no exit, and the page falls back to the proxy", { skip: SKIP, timeout: 90000 }, async () => {
  if (!(await portFree(8081))) throw new Error("port 8081 is busy");
  const r = await scenario({ device: Object.assign({}, DEV_ON, { developerIP: "192.168.1.20" }) });
  assert.equal(r.exitCalls, 0);
  assert.ok(r.url.indexOf("localhost:8081/tv") !== -1, "landed on the proxy, got " + r.url);
  assert.ok(/Developer IP is 192\.168\.1\.20\. Set it to 127\.0\.0\.1/.test(r.proxyLog), r.proxyLog);
});

test("device API unreachable: no exit, and the page falls back to the proxy", { skip: SKIP, timeout: 90000 }, async () => {
  if (!(await portFree(8081))) throw new Error("port 8081 is busy");
  const r = await scenario({ device: null });
  assert.equal(r.exitCalls, 0);
  assert.ok(r.url.indexOf("localhost:8081/tv") !== -1, "landed on the proxy, got " + r.url);
});

test("SDB refuses the debug launch: the WGT is started normally and the page falls back to the proxy", { skip: SKIP, timeout: 90000 }, async () => {
  if (!(await portFree(8081))) throw new Error("port 8081 is busy");
  const r = await scenario({ device: DEV_ON, sdb: "refused" });
  assert.equal(r.exitCalls, 1, "the exit was requested before SDB was tried");
  assert.ok(r.url.indexOf("localhost:8081/tv") !== -1, "landed on the proxy, got " + r.url);
  assert.ok(/\[TEST\] launch axotubeapp\.AxoTubeStandalone/.test(r.proxyLog), "the WGT was restarted normally");
});

test("the WGT does not exit: the service gives up and the page falls back to the proxy", { skip: SKIP, timeout: 90000 }, async () => {
  if (!(await portFree(8081))) throw new Error("port 8081 is busy");
  const r = await scenario({ device: DEV_ON, sdb: "ok", wgtRunning: true, timeoutMs: 60000 });
  assert.equal(r.exitCalls, 1);
  assert.ok(r.url.indexOf("localhost:8081/tv") !== -1, "landed on the proxy, got " + r.url);
  assert.ok(/the app did not exit/.test(r.proxyLog), r.proxyLog);
});

test("CDP navigation to YouTube fails: the page goes to the proxy, not the error page", { skip: SKIP, timeout: 90000 }, async () => {
  const r = await scenario({ device: DEV_ON, sdb: "ok", youtubeUrl: "http://no-such-host.invalid/yt.html", timeoutMs: 40000 });
  assert.ok(r.url.indexOf("localhost:8081/tv") !== -1, "the launcher sent the page to the proxy, got " + r.url);
  assert.ok(/Page\.navigate: net::ERR_NAME_NOT_RESOLVED/.test(r.proxyLog), r.proxyLog);
});
