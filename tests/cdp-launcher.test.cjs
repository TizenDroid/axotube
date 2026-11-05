"use strict";
// The CDP launch path: SDB reply parsing, the injected source (run in a VM), the
// CDP client against a local fake debugger, and the launcher's state machine.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const acorn = require(path.join(ROOT, "mods", "node_modules", "acorn"));
const ws = require(path.join(ROOT, "service", "cdp", "websocket.js"));
const cdp = require(path.join(ROOT, "service", "cdp", "cdp.js"));
const sdb = require(path.join(ROOT, "service", "cdp", "sdb.js"));
const launcher = require(path.join(ROOT, "service", "cdp", "launcher.js"));
const diagnostics = require(path.join(ROOT, "service", "diagnostics.js"));

test("the SDB reply yields the debug port, and nothing else", () => {
  assert.equal(sdb.parseDebugPort("debug  :  26101\n"), 26101);
  assert.equal(sdb.parseDebugPort("debug : 9222"), 9222);
  assert.equal(sdb.parseDebugPort("shell output: 1234"), null, "no debug word");
  assert.equal(sdb.parseDebugPort("debug : 99999"), null, "out of range");
  assert.equal(sdb.parseDebugPort("debug : 80"), null, "too short for a debug port");
});

test("the injected source is ES5 and runs its bundles in order, in the main frame only", () => {
  const early = "globalThis.order = ['early']; var EARLY_GLOBAL = '  ok';";
  const main = "globalThis.order.push('main');";
  const source = launcher.buildInjectedSource(early, main);
  acorn.parse(source, { ecmaVersion: 5 });

  const sandbox = { console, order: undefined, EARLY_GLOBAL: undefined };
  sandbox.window = sandbox;
  sandbox.window.top = sandbox;
  sandbox.document = { readyState: "complete", addEventListener() {} };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  assert.deepEqual(Array.from(sandbox.order), ["early", "main"]);
  assert.equal(sandbox.EARLY_GLOBAL, "  ok", "U+2028 survives the literal");
  assert.equal(sandbox.__axotubeServiceUrl, "http://127.0.0.1:8090");

  // An iframe: its window.top is the parent, not itself.
  const frame = { document: { readyState: "complete", addEventListener() {} }, order: [] };
  frame.window = frame;
  frame.top = {};
  vm.createContext(frame);
  vm.runInContext(source, frame);
  assert.equal(frame.order.length, 0, "an iframe runs nothing");
});

test("the main bundle waits for DOMContentLoaded when the page is still loading", () => {
  const listeners = [];
  const sandbox = { console, ran: false };
  sandbox.window = sandbox;
  sandbox.window.top = sandbox;
  sandbox.document = {
    readyState: "loading",
    addEventListener(name, fn) { listeners.push([name, fn]); },
  };
  vm.createContext(sandbox);
  vm.runInContext(launcher.buildInjectedSource("", "ran = true;"), sandbox);
  assert.equal(sandbox.ran, false);
  assert.equal(listeners[0][0], "DOMContentLoaded");
  listeners[0][1]();
  assert.equal(sandbox.ran, true);
});

test("sanitizeArgs keeps safe key=value pairs only", () => {
  assert.equal(launcher.sanitizeArgs("?a=1&b=two words&bad key=x&../=y"), "a=1&b=two%20words");
  assert.equal(launcher.sanitizeArgs(""), "");
});

test("pickPage takes the first page target that has a socket", () => {
  const page = cdp.pickPage([
    { type: "iframe", webSocketDebuggerUrl: "ws://x/devtools/frame/0" },
    { type: "page", webSocketDebuggerUrl: "ws://x/devtools/page/7" },
  ]);
  assert.equal(page.webSocketDebuggerUrl, "ws://x/devtools/page/7");
  assert.equal(cdp.pickPage([]), null);
  assert.equal(cdp.pathOf("ws://127.0.0.1:9/devtools/page/7"), "/devtools/page/7");
});

// A fake debugger: /json/list for discovery, and a WebSocket that answers CDP calls.
// Every connection is tracked, upgraded ones included, so a test can tear the
// server down without leaving the event loop waiting on a socket.
function track(server) {
  const sockets = new Set();
  server.on("connection", (s) => sockets.add(s));
  server.killAll = () => {
    for (const s of sockets) s.destroy();
    server.close();
  };
  return server;
}

function startFakeDebugger() {
  const server = track(http.createServer((req, res) => {
    if (req.url !== "/json/list") {
      res.writeHead(404);
      return res.end();
    }
    const port = server.address().port;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify([{ type: "page", webSocketDebuggerUrl: "ws://127.0.0.1:" + port + "/devtools/page/1" }]));
  }));
  server.on("upgrade", (req, socket) => {
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
        "Sec-WebSocket-Accept: " + ws.acceptKey(req.headers["sec-websocket-key"]) + "\r\n\r\n",
    );
    let buf = Buffer.alloc(0);
    socket.on("error", () => {});
    socket.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      const parsed = ws.readFrames(buf);
      buf = parsed.rest;
      for (const f of parsed.frames) {
        if (f.opcode !== 1) continue;
        const msg = JSON.parse(f.payload.toString("utf8"));
        const reply = msg.method === "Bad.method"
          ? { id: msg.id, error: { message: "nope" } }
          : { id: msg.id, result: { method: msg.method } };
        const body = Buffer.from(JSON.stringify(reply));
        socket.write(Buffer.concat([Buffer.from([0x81, body.length]), body]));
      }
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

test("the CDP client finds the page, correlates replies and maps errors", async () => {
  const server = await startFakeDebugger();
  const port = server.address().port;
  const session = await new Promise((resolve, reject) => {
    cdp.attach({ host: "127.0.0.1", port }, (err, s) => (err ? reject(err) : resolve(s)));
  });
  const ok = await new Promise((resolve, reject) => {
    session.send("Page.enable", {}, (err, result) => (err ? reject(err) : resolve(result)));
  });
  assert.deepEqual(ok, { method: "Page.enable" });
  const failed = await new Promise((resolve) => {
    session.send("Bad.method", {}, (err) => resolve(err));
  });
  assert.equal(failed.message, "nope");
  session.close();
  server.killAll();
});

// A launcher wired to fakes. Scheduled work runs when flush() is called, and the
// clock advances by the requested delay, so deadlines work without real waiting.
function fakeDeps(overrides) {
  const queue = [];
  const sent = [];
  const attachHosts = [];
  const state = { t: 0, running: true, debugCalls: 0, launched: [], attachFails: false, session: null };
  const session = {
    closed: false,
    onClose: null,
    send(method, params, cb) {
      sent.push([method, params]);
      const fail = overrides && overrides.failOn;
      if (fail && fail.method === method) {
        if (fail.errorText) return cb(null, { errorText: fail.errorText });
        return cb(new Error("refused by the fake"), null);
      }
      cb(null, { identifier: "script-" + sent.length });
    },
    setOnClose(fn) { this.onClose = fn; },
    close() { this.closed = true; },
  };
  state.session = session;
  const deps = Object.assign({
    supported: () => true,
    appId: () => "axotubeapp.AxoTubeStandalone",
    appRunning: (id, cb) => cb(null, state.running),
    debugLaunch: (id, cb) => { state.debugCalls += 1; cb(null, 26101); },
    checkDeveloperMode: (cb) => cb(null, { ok: true, ip: "192.168.1.5" }),
    attach: (opts, cb) => {
      attachHosts.push(opts.host);
      if (state.attachFails) cb(new Error("refused"), null);
      else cb(null, session);
    },
    launchNormal: (id) => state.launched.push(id),
    readBundle: (name) => (name === "early.js" ? "EARLY_BUNDLE" : "MAIN_BUNDLE"),
    readSettings: () => ({ debugger: true, revision: 0 }),
    schedule: (fn, ms) => queue.push([fn, ms]),
    now: () => state.t,
  }, overrides || {});
  function flush(limit) {
    let n = 0;
    while (queue.length && n < (limit || 1000)) {
      const [fn, ms] = queue.shift();
      state.t += ms || 0;
      fn();
      n += 1;
    }
  }
  return { deps, state, sent, attachHosts, session, flush };
}

function ask(l, rawArgs) {
  let body = null;
  l.next(rawArgs || "", (b) => { body = b; });
  return body;
}

test("launch runs exit, debug start, attach, script registration and navigation in order", () => {
  const f = fakeDeps();
  const l = launcher.createLauncher(f.deps);
  assert.equal(ask(l, "?lang=en").action, "exit");
  assert.equal(ask(l).action, "wait", "the WGT still runs, so the service waits");
  f.state.running = false;
  f.flush();
  assert.equal(f.state.debugCalls, 1);
  assert.equal(ask(l).action, "attached");
  assert.deepEqual(f.sent.map((s) => s[0]), [
    "Page.enable",
    "Page.setBypassCSP",
    "Page.addScriptToEvaluateOnNewDocument",
    "Page.navigate",
  ]);
  const source = f.sent[2][1].source;
  assert.ok(source.indexOf('"EARLY_BUNDLE"') !== -1 && source.indexOf('"MAIN_BUNDLE"') !== -1);
  assert.equal(f.sent[3][1].url, "https://www.youtube.com/tv?additionalDataUrl=http%3A%2F%2Flocalhost%3A8090%2Fdial%2Fapps%2FYouTube&lang=en");
});

test("without developer mode the launch goes straight to the proxy", () => {
  const f = fakeDeps({ checkDeveloperMode: (cb) => cb(null, { ok: false, ip: null }) });
  const l = launcher.createLauncher(f.deps);
  assert.equal(ask(l).action, "proxy");
  assert.equal(f.state.debugCalls, 0);
  assert.equal(ask(l).action, "proxy", "the failure is sticky for this service run");
});

test("off-TV the launcher never tries the debugger", () => {
  const f = fakeDeps({ supported: () => false });
  const l = launcher.createLauncher(f.deps);
  assert.equal(ask(l).action, "proxy");
  assert.equal(f.state.debugCalls, 0);
});

test("a failed debug launch restarts the WGT normally and falls back", () => {
  const f = fakeDeps({ debugLaunch: (id, cb) => cb(new Error("SDB refused"), null) });
  const l = launcher.createLauncher(f.deps);
  assert.equal(ask(l).action, "exit");
  f.state.running = false;
  f.flush();
  assert.deepEqual(f.state.launched, ["axotubeapp.AxoTubeStandalone"]);
  assert.equal(ask(l).action, "proxy");
});

test("attach retries alternate hosts until the deadline, then fall back", () => {
  const f = fakeDeps();
  f.state.attachFails = true;
  f.state.running = false;
  const l = launcher.createLauncher(f.deps);
  ask(l);
  f.flush(5000);
  assert.ok(f.attachHosts.length > 2, "several attempts");
  assert.equal(f.attachHosts[0], "127.0.0.1");
  assert.equal(f.attachHosts[1], "192.168.1.5");
  assert.equal(ask(l).action, "proxy");
});

test("a closed debugger connection starts the next launch from the beginning", () => {
  const f = fakeDeps();
  f.state.running = false;
  const l = launcher.createLauncher(f.deps);
  ask(l);
  f.flush();
  assert.equal(ask(l).action, "attached");
  f.session.closed = true;
  f.session.onClose(new Error("WGT closed"));
  assert.equal(ask(l).action, "exit");
});

test("bundles that cannot be read fall back instead of attaching", () => {
  const f = fakeDeps({ readBundle: () => { throw new Error("missing"); } });
  f.state.running = false;
  const l = launcher.createLauncher(f.deps);
  ask(l);
  f.flush();
  assert.equal(ask(l).action, "proxy");
  assert.equal(f.sent.length, 0, "nothing is sent to the page");
});

test("a refused Page.setBypassCSP falls back to the proxy before any script is registered", () => {
  const f = fakeDeps({ failOn: { method: "Page.setBypassCSP" } });
  f.state.running = false;
  const l = launcher.createLauncher(f.deps);
  ask(l);
  f.flush();
  assert.equal(ask(l).action, "proxy");
  assert.deepEqual(f.sent.map((x) => x[0]), ["Page.enable", "Page.setBypassCSP"]);
});

test("a navigation Chromium refuses sends the page to the proxy itself", () => {
  const f = fakeDeps({ failOn: { method: "Page.navigate", errorText: "net::ERR_NAME_NOT_RESOLVED" } });
  f.state.running = false;
  const l = launcher.createLauncher(f.deps);
  ask(l);
  f.flush();
  assert.equal(ask(l).action, "proxy");
  const last = f.sent[f.sent.length - 1];
  assert.equal(last[0], "Page.navigate");
  assert.equal(last[1].url, "http://localhost:8081/tv?additionalDataUrl=http%3A%2F%2Flocalhost%3A8090%2Fdial%2Fapps%2FYouTube");
});

test("refreshScripts replaces the registered script, and the page gets the new bundle", () => {
  let version = "v1";
  const f = fakeDeps({ readBundle: (name) => name + "@" + version });
  f.state.running = false;
  const l = launcher.createLauncher(f.deps);
  ask(l);
  f.flush();
  assert.equal(ask(l).action, "attached");
  const firstAdd = f.sent.find((x) => x[0] === "Page.addScriptToEvaluateOnNewDocument");
  const before = f.sent.length;
  version = "v2";
  l.refreshScripts();
  const after = f.sent.slice(before).map((x) => x[0]);
  assert.deepEqual(after, [
    "Page.removeScriptToEvaluateOnNewDocument",
    "Page.addScriptToEvaluateOnNewDocument",
  ], "remove the old script, then register the new one");
  const remove = f.sent[before];
  assert.deepEqual(remove[1], { identifier: "script-3" }, "the identifier returned for the first add is removed");
  assert.equal(firstAdd[1].source.indexOf("early.js@v1") !== -1, true, "first registration had v1");
  const added = f.sent[before + 1][1].source;
  assert.ok(added.indexOf('"early.js@v2"') !== -1, "the new bundle is registered");
  assert.ok(added.indexOf("@v1") === -1, "no v1 text in the new registration");
});

test("refreshScripts does nothing before a page is attached", () => {
  const f = fakeDeps();
  const l = launcher.createLauncher(f.deps);
  l.refreshScripts();
  assert.equal(f.sent.length, 0);
});

test("debugger launch off: every answer is the proxy, and the debugger is never started", () => {
  const f = fakeDeps({ readSettings: () => ({ debugger: false, revision: 0 }) });
  const l = launcher.createLauncher(f.deps);
  const body = ask(l);
  assert.equal(body.action, "proxy");
  assert.equal(body.mode, "proxy");
  assert.equal(body.reason, "", "nothing to explain when the user chose the proxy");
  assert.equal(f.state.debugCalls, 0);
  assert.equal(f.sent.length, 0);
});

test("a developer IP other than 127.0.0.1 is named, with the fix", () => {
  const f = fakeDeps({
    checkDeveloperMode: (cb) => cb(null, { ok: false, ip: "192.168.1.5", developerIP: "192.168.1.20", developerMode: "1" }),
  });
  const l = launcher.createLauncher(f.deps);
  const body = ask(l);
  assert.equal(body.action, "proxy");
  assert.equal(body.mode, "debugger");
  assert.match(body.reason, /^Developer IP is 192\.168\.1\.20\. Set it to 127\.0\.0\.1 in the TV's Developer mode settings/);
});

test("developer mode switched off is explained with the setting to change", () => {
  const f = fakeDeps({
    checkDeveloperMode: (cb) => cb(null, { ok: false, ip: "192.168.1.5", developerIP: "127.0.0.1", developerMode: "0" }),
  });
  const body = ask(launcher.createLauncher(f.deps));
  assert.match(body.reason, /^Developer mode is off\. Turn it on/);
});

test("a failed launch can be reset, but not while YouTube is attached", () => {
  const f = fakeDeps({ debugLaunch: (id, cb) => cb(new Error("SDB refused"), null) });
  const l = launcher.createLauncher(f.deps);
  assert.equal(ask(l).action, "exit");
  f.state.running = false;
  f.flush();
  assert.equal(ask(l).action, "proxy");
  assert.equal(diagnostics.getLaunchStatus().state, "failed");
  assert.equal(l.reset(), true);
  assert.equal(diagnostics.getLaunchStatus().state, "idle");
  assert.equal(ask(l).action, "exit", "the next answer starts a new attempt");
});

test("reset is refused while the debugger session is attached", () => {
  const f = fakeDeps();
  f.state.running = false;
  const l = launcher.createLauncher(f.deps);
  ask(l);
  f.flush();
  assert.equal(ask(l).action, "attached");
  assert.equal(l.reset(), false);
  assert.equal(ask(l).action, "attached", "the session is untouched");
});

test("turning the debugger launch on again clears an earlier failure", () => {
  const settings = { debugger: true, revision: 1 };
  const f = fakeDeps({
    readSettings: () => settings,
    debugLaunch: (id, cb) => cb(new Error("SDB refused"), null),
  });
  const l = launcher.createLauncher(f.deps);
  assert.equal(ask(l).action, "exit");
  f.state.running = false;
  f.flush();
  assert.equal(ask(l).action, "proxy");
  settings.revision = 2;
  assert.equal(ask(l).action, "exit", "a new choice is a new attempt");
});

test("the diagnostics status follows the launcher's state", () => {
  const f = fakeDeps();
  const l = launcher.createLauncher(f.deps);
  assert.equal(l.status().state, "idle");
  ask(l);
  assert.equal(diagnostics.getLaunchStatus().state, "exiting");
});
