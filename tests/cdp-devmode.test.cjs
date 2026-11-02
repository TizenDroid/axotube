"use strict";
// Developer mode on and off, against local stand-ins for the TV's device API (8001)
// and SDB (26101). The real sdb.js and launcher code run; only the endpoints differ.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const sdb = require(path.join(ROOT, "service", "cdp", "sdb.js"));
const launcher = require(path.join(ROOT, "service", "cdp", "launcher.js"));

const APP_ID = "axotubeapp.AxoTubeStandalone";

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

function closeAll(servers) {
  return Promise.all(servers.map((s) => new Promise((r) => s.close(() => r()))));
}

// A device API answering /api/v2/ with the given developer settings.
function fakeDeviceApi(device) {
  const server = http.createServer((req, res) => {
    if (req.url !== "/api/v2/") {
      res.writeHead(404);
      return res.end();
    }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ device: device }));
  });
  return server;
}

// A fake SDB. It replies in the wire format the client expects, split across
// writes to exercise the reader. `reply` is a function(command) returning the
// chunks to send, or null to close without answering.
function fakeSdb(reply) {
  const commands = [];
  const server = net.createServer((socket) => {
    let buf = "";
    socket.on("error", () => {});
    socket.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      if (buf.length < 4) return;
      const len = parseInt(buf.slice(0, 4), 16);
      if (buf.length < 4 + len) return;
      const command = buf.slice(4, 4 + len);
      commands.push(command);
      const chunks = reply(command);
      if (!chunks) return socket.destroy();
      let delay = 0;
      chunks.forEach((c) => {
        delay += 5;
        setTimeout(() => { if (!socket.destroyed) socket.write(c); }, delay);
      });
    });
  });
  server.commands = commands;
  return server;
}

function withEndpoints(apiPort, sdbPort) {
  sdb.setEndpoints({ apiPort: apiPort, sdbPort: sdbPort });
}

test("developer mode on with the developer IP at 127.0.0.1 is accepted", async () => {
  const api = fakeDeviceApi({ developerMode: "1", developerIP: "127.0.0.1", ip: "192.168.1.5" });
  const apiPort = await listen(api);
  withEndpoints(apiPort, 1);
  const info = await new Promise((resolve, reject) => {
    sdb.checkDeveloperMode((err, r) => (err ? reject(err) : resolve(r)));
  });
  assert.deepEqual(info, { ok: true, ip: "192.168.1.5", developerIP: "127.0.0.1", developerMode: "1" });
  await closeAll([api]);
});

test("the 1.0.0.127 spelling of the local developer IP is accepted", async () => {
  const api = fakeDeviceApi({ developerMode: "1", developerIP: "1.0.0.127", ip: "10.0.0.2" });
  withEndpoints(await listen(api), 1);
  const info = await new Promise((resolve) => sdb.checkDeveloperMode((err, r) => resolve(r)));
  assert.equal(info.ok, true);
  await closeAll([api]);
});

test("developer mode off is refused", async () => {
  const api = fakeDeviceApi({ developerMode: "0", developerIP: "127.0.0.1", ip: "192.168.1.5" });
  withEndpoints(await listen(api), 1);
  const info = await new Promise((resolve) => sdb.checkDeveloperMode((err, r) => resolve(r)));
  assert.equal(info.ok, false);
  await closeAll([api]);
});

test("a developer IP set to the PC is refused, even with developer mode on", async () => {
  const api = fakeDeviceApi({ developerMode: "1", developerIP: "192.168.1.20", ip: "192.168.1.5" });
  withEndpoints(await listen(api), 1);
  const info = await new Promise((resolve) => sdb.checkDeveloperMode((err, r) => resolve(r)));
  assert.equal(info.ok, false);
  await closeAll([api]);
});

test("an unreachable device API is an error, not a yes", async () => {
  const dead = net.createServer();
  const deadPort = await listen(dead);
  await closeAll([dead]);
  withEndpoints(deadPort, 1);
  const result = await new Promise((resolve) => sdb.checkDeveloperMode((err, r) => resolve({ err: err, info: r })));
  assert.ok(result.err, "an error is reported");
  assert.equal(result.info, null);
});

test("SDB gets the exact shell command, with the Tizen 3 suffix when needed", async () => {
  const sdbServer = fakeSdb((command) => ["OKAY", "debug : 9222\n"]);
  const sdbPort = await listen(sdbServer);
  withEndpoints(1, sdbPort);
  const port1 = await new Promise((resolve, reject) => {
    sdb.debugLaunch(APP_ID, {}, (err, p) => (err ? reject(err) : resolve(p)));
  });
  assert.equal(port1, 9222);
  const port2 = await new Promise((resolve, reject) => {
    sdb.debugLaunch(APP_ID, { tizen3: true }, (err, p) => (err ? reject(err) : resolve(p)));
  });
  assert.equal(port2, 9222);
  assert.deepEqual(sdbServer.commands, ["shell:0 debug " + APP_ID, "shell:0 debug " + APP_ID + " 0"]);
  await closeAll([sdbServer]);
});

test("a reply split across writes is still read", async () => {
  const sdbServer = fakeSdb(() => ["OK", "AY", "debug  :  26101", "\n"]);
  withEndpoints(1, await listen(sdbServer));
  const got = await new Promise((resolve, reject) => {
    sdb.debugLaunch(APP_ID, {}, (err, p) => (err ? reject(err) : resolve(p)));
  });
  assert.equal(got, 26101);
  await closeAll([sdbServer]);
});

test("an SDB refusal is reported with its message", async () => {
  const sdbServer = fakeSdb(() => ["FAIL0011app not installed"]);
  withEndpoints(1, await listen(sdbServer));
  const err = await new Promise((resolve) => sdb.debugLaunch(APP_ID, {}, (e) => resolve(e)));
  assert.ok(err && /refused the command/.test(err.message), String(err && err.message));
  await closeAll([sdbServer]);
});

test("an SDB that closes without a port is an error", async () => {
  const sdbServer = fakeSdb(() => null);
  withEndpoints(1, await listen(sdbServer));
  const err = await new Promise((resolve) => sdb.debugLaunch(APP_ID, {}, (e) => resolve(e)));
  assert.ok(err, "an error is reported");
  await closeAll([sdbServer]);
});

test("a closed SDB port is an error", async () => {
  const tmp = net.createServer();
  const closedPort = await listen(tmp);
  await closeAll([tmp]);
  withEndpoints(1, closedPort);
  const err = await new Promise((resolve) => sdb.debugLaunch(APP_ID, {}, (e) => resolve(e)));
  assert.ok(err, "an error is reported");
});

// Full decision path with the real device checks: the launcher answers "proxy" and
// never touches SDB when developer mode is not on for this IP.
function launcherWithRealChecks(overrides) {
  const sent = { debug: 0, launched: [] };
  const deps = Object.assign({
    supported: () => true,
    appId: () => APP_ID,
    appRunning: (id, cb) => cb(null, false),
    debugLaunch: (id, cb) => {
      sent.debug += 1;
      sdb.debugLaunch(id, {}, cb);
    },
    checkDeveloperMode: (cb) => sdb.checkDeveloperMode(cb),
    attach: (opts, cb) => cb(new Error("not reached in this test"), null),
    launchNormal: (id) => sent.launched.push(id),
    readBundle: () => "",
    readSettings: () => ({ debugger: true, revision: 0 }),
    schedule: (fn) => setTimeout(fn, 0),
    now: () => Date.now(),
  }, overrides || {});
  return { l: launcher.createLauncher(deps), sent: sent };
}

function ask(l) {
  return new Promise((resolve) => l.next("", resolve));
}

test("launcher with developer mode off answers proxy and never starts SDB", async () => {
  const api = fakeDeviceApi({ developerMode: "0", developerIP: "127.0.0.1", ip: "192.168.1.5" });
  const sdbServer = fakeSdb(() => ["OKAY", "debug : 9222\n"]);
  withEndpoints(await listen(api), await listen(sdbServer));
  const { l, sent } = launcherWithRealChecks();
  const body = await ask(l);
  assert.equal(body.action, "proxy");
  assert.equal(sent.debug, 0);
  assert.equal(sdbServer.commands.length, 0, "SDB was never contacted");
  await closeAll([api, sdbServer]);
});

test("launcher with developer mode on answers exit, then restarts the WGT under the debugger", async () => {
  const api = fakeDeviceApi({ developerMode: "1", developerIP: "127.0.0.1", ip: "192.168.1.5" });
  const sdbServer = fakeSdb(() => ["OKAY", "debug : 9222\n"]);
  withEndpoints(await listen(api), await listen(sdbServer));
  const { l, sent } = launcherWithRealChecks({
    attach: (opts, cb) => { sent.attachedTo = opts.port; cb(new Error("stop after the debug port"), null); },
  });
  const body = await ask(l);
  assert.equal(body.action, "exit");
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(sent.debug, 1);
  assert.equal(sent.attachedTo, 9222, "the port SDB reported is the one attached");
  assert.deepEqual(sdbServer.commands, ["shell:0 debug " + APP_ID]);
  await closeAll([api, sdbServer]);
});

test("developer mode on but SDB refused: the WGT is relaunched normally and the answer is proxy", async () => {
  const api = fakeDeviceApi({ developerMode: "1", developerIP: "127.0.0.1", ip: "192.168.1.5" });
  const sdbServer = fakeSdb(() => ["FAIL0004nope"]);
  withEndpoints(await listen(api), await listen(sdbServer));
  const { l, sent } = launcherWithRealChecks();
  assert.equal((await ask(l)).action, "exit");
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual(sent.launched, [APP_ID]);
  assert.equal((await ask(l)).action, "proxy");
  await closeAll([api, sdbServer]);
});
