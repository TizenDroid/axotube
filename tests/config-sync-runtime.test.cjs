const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");

const ROOT = path.resolve(__dirname, "..");
const SERVICE_PATH = path.join(ROOT, "service", "service.js");
const SERVICE_REQUIRE = createRequire(SERVICE_PATH);
const DEFAULTS = JSON.parse(fs.readFileSync(path.join(ROOT, "config-schema.json"), "utf8")).defaults;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function openService({ config = {}, revision = 0 } = {}) {
  let stored = JSON.stringify({ config, revision, authToken: "a".repeat(64) });
  let staged = null;
  let failWrites = false;
  let server;
  const memoryFs = {
    constants: fs.constants,
    accessSync() {},
    readFileSync() { return stored; },
    writeFileSync(_name, value) {
      if (failWrites) throw new Error("simulated disk failure");
      staged = value;
    },
    renameSync() {
      if (failWrites) throw new Error("simulated rename failure");
      stored = staged;
      staged = null;
    },
    existsSync() { return staged !== null; },
    unlinkSync() { staged = null; },
  };
  const express = SERVICE_REQUIRE("express");
  function testExpress() {
    const app = express();
    const listen = app.listen.bind(app);
    app.listen = (_port, callback) => {
      server = listen(0, "127.0.0.1", callback);
      return server;
    };
    return app;
  }
  Object.assign(testExpress, express);
  const tizen = {
    systeminfo: { getCapability() { return ""; } },
    application: {
      getAppInfo() { return { packageId: "axotube.test" }; },
      getAppsContext() {},
      launchAppControl() {},
    },
  };
  const context = {
    require(name) {
      if (name === "fs") return memoryFs;
      if (name === "express") return testExpress;
      if (name === "./webConfigPage.js") return { webConfigPage: "<html></html>" };
      if (name === "@patrickkfkan/peer-dial") {
        return { Server: class { start() {} } };
      }
      return SERVICE_REQUIRE(name);
    },
    __dirname: path.dirname(SERVICE_PATH),
    tizen,
    global: { isAxoTubeStandalone: true },
    Buffer,
    URL,
    setInterval() { return 1; },
    console: { log() {}, warn() {}, error() {} },
  };
  vm.runInNewContext(fs.readFileSync(SERVICE_PATH, "utf8"), context, { filename: SERVICE_PATH });
  if (!server.listening) await new Promise((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;

  async function request(method, url, body, additionalHeaders = {}) {
    const response = await fetch(origin + url, {
      method,
      headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...additionalHeaders },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  }
  return {
    origin, request,
    impersonateLanClient() {
      vm.runInNewContext('remoteAddress = () => "192.0.2.123"', context);
    },
    setFailWrites(value) { failWrites = value; },
    persisted() { return JSON.parse(stored); },
    async close() { await new Promise((resolve) => server.close(resolve)); },
  };
}

async function waitUntil(check, message) {
  for (let i = 0; i < 100; i += 1) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  assert.fail(message);
}

function openTvClient(origin, initialConfig) {
  const state = clone(initialConfig);
  const listeners = new Map();
  const emitter = {
    addEventListener(name, listener) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(listener);
    },
    dispatchEvent(name, detail) {
      for (const listener of listeners.get(name) || []) listener({ detail });
    },
  };
  let boot;
  let pushTimer;
  let interval;
  let timerId = 0;
  const timeouts = new Map();
  function testSetTimeout(fn, delay) {
    const id = ++timerId;
    if (delay === 3000) boot = fn;
    else if (delay === 250) pushTimer = fn;
    else if (delay !== 1200) timeouts.set(id, fn);
    return id;
  }
  function configWrite(key, value) {
    if (!Object.prototype.hasOwnProperty.call(DEFAULTS, key)) return false;
    state[key] = clone(value);
    emitter.dispatchEvent("configChange", { key, value });
    return true;
  }
  const source = fs.readFileSync(path.join(ROOT, "mods", "features", "webConfig.js"), "utf8")
    .replace(/import\s*\{[\s\S]*?\}\s*from\s*"[^"]+";/g, "")
    .replace(/^import\s+[^\n;]+;\s*$/gm, "")
    .replace("http://127.0.0.1:8085", origin);
  const context = vm.createContext({
    configRead(key) { return state[key]; },
    configWrite,
    configSnapshot() { return clone(state); },
    nativeJSONStringify: JSON.stringify.bind(JSON),
    configChangeEmitter: emitter,
    hasNativeResolver() { return true; },
    dispatchNativeCommandWhenReady() { return Promise.resolve(true); },
    fetchWithTimeout: (url, opts) => fetch(url, opts),
    showToast() {},
    window: { h5vcc: { tizentube: {} }, _yttv: {} },
    document: { querySelector() { return null; } },
    location: { hash: "" },
    Promise, Object, Array, Number, Set,
    setTimeout: testSetTimeout,
    clearTimeout(id) { timeouts.delete(id); },
    setInterval(fn) { interval = fn; return 1; },
    console,
  });
  vm.runInContext(source, context, { filename: "mods/features/webConfig.js" });
  assert.equal(typeof boot, "function");
  return {
    state,
    write: configWrite,
    start() { boot(); },
    firePush() { const fn = pushTimer; pushTimer = null; if (fn) fn(); },
    poll() { if (interval) interval(); },
    appliedRevision() { return vm.runInContext("appliedRevision", context); },
    dirty() { return Array.from(vm.runInContext("dirtyKeys", context)); },
  };
}

test("TV CAS increments only for changed snapshots, and stale pushes never overwrite", async (t) => {
  const host = await openService();
  t.after(() => host.close());
  const initial = await host.request("GET", "/api/config");
  assert.equal(initial.body.revision, 0);

  const accepted = await host.request("POST", "/api/config/push", {
    revision: 0, config: { videoSpeed: 1.25 },
  });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.applied, true);
  assert.equal(accepted.body.revision, 1);
  assert.equal(host.persisted().revision, 1);

  const noOp = await host.request("POST", "/api/config/push", {
    revision: 1, config: { videoSpeed: 1.25 },
  });
  assert.equal(noOp.body.changed, false);
  assert.equal(noOp.body.revision, 1);

  const stale = await host.request("POST", "/api/config/push", {
    revision: 0, config: { videoSpeed: 2 },
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.applied, false);
  assert.equal((await host.request("GET", "/api/config")).body.config.videoSpeed, 1.25);
});

test("revision-aware phone saves reject stale snapshots; legacy phone clients still work", async (t) => {
  const host = await openService({ config: { videoSpeed: 1 }, revision: 3 });
  t.after(() => host.close());
  const phone = await host.request("POST", "/api/config", {
    revision: 3, config: { videoSpeed: 1.5 },
  });
  assert.equal(phone.body.revision, 4);
  const stalePhone = await host.request("POST", "/api/config", {
    revision: 3, config: { videoSpeed: 2 },
  });
  assert.equal(stalePhone.status, 409);
  assert.equal((await host.request("GET", "/api/config")).body.config.videoSpeed, 1.5);
  const legacy = await host.request("POST", "/api/config", { videoSpeed: 1.75 });
  assert.equal(legacy.status, 200);
  assert.equal(legacy.body.revision, 5);
});

test("pairing still permits a second phone and requires the token for LAN access", async (t) => {
  const host = await openService();
  t.after(() => host.close());
  const code = (await host.request("GET", "/api/pairing-code")).body.code;
  assert.match(code, /^\d{6}$/);
  const first = await host.request("POST", "/api/pair", { code });
  const second = await host.request("POST", "/api/pair", { code });
  assert.equal(first.status, 200);
  assert.equal(second.body.token, first.body.token);
  assert.equal(host.persisted().authToken, first.body.token);
  host.impersonateLanClient();
  assert.equal((await host.request("GET", "/api/config")).status, 401);
  assert.equal((await host.request("GET", "/api/config", undefined, {
    Authorization: `Bearer ${first.body.token}`,
  })).status, 200);
});

test("failed disk writes never advance committed revision or acknowledge TV/phone saves", async (t) => {
  const host = await openService({ config: { videoSpeed: 1 }, revision: 5 });
  t.after(() => host.close());
  host.setFailWrites(true);
  const tv = await host.request("POST", "/api/config/push", {
    revision: 5, config: { videoSpeed: 1.5 },
  });
  assert.equal(tv.status, 503);
  const phone = await host.request("POST", "/api/config", {
    revision: 5, config: { videoSpeed: 2 },
  });
  assert.equal(phone.status, 503);
  assert.deepEqual((await host.request("GET", "/api/config")).body, {
    revision: 5, config: { videoSpeed: 1 },
  });
  host.setFailWrites(false);
  const retry = await host.request("POST", "/api/config/push", {
    revision: 5, config: { videoSpeed: 1.5 },
  });
  assert.equal(retry.body.revision, 6);
});

test("TV detects stale push and rebases only unsent local edits over newer phone settings", async (t) => {
  const host = await openService({ config: clone(DEFAULTS), revision: 7 });
  t.after(() => host.close());
  const tv = openTvClient(host.origin, DEFAULTS);
  tv.start();
  await waitUntil(() => tv.appliedRevision() === 7, "TV did not complete initial pull");

  tv.write("videoSpeed", 1.5);
  const phoneConfig = clone(DEFAULTS);
  phoneConfig.themePreset = "navy";
  phoneConfig.routeColor = "#0d1b2a";
  const phone = await host.request("POST", "/api/config", {
    revision: 7, config: phoneConfig,
  });
  assert.equal(phone.body.revision, 8);
  tv.firePush(); // Sends stale revision 7 and must fetch/rebase revision 8.
  await waitUntil(async () => {
    const read = (await host.request("GET", "/api/config")).body;
    return read.revision === 9 &&
      read.config.videoSpeed === 1.5 &&
      read.config.themePreset === "navy";
  }, "TV did not rebase local videoSpeed over updated phone theme");
  assert.equal(tv.state.routeColor, "#0d1b2a");
  assert.equal(tv.appliedRevision(), 9);
  assert.deepEqual(tv.dirty(), []);
  tv.poll();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal((await host.request("GET", "/api/config")).body.revision, 9);
});

test("first TV connects to an empty store without losing its existing local settings", async (t) => {
  const host = await openService();
  t.after(() => host.close());
  const local = clone(DEFAULTS);
  local.videoSpeed = 1.75;
  const tv = openTvClient(host.origin, local);
  tv.start();
  await waitUntil(async () => {
    const read = (await host.request("GET", "/api/config")).body;
    return read.revision === 1 && read.config.videoSpeed === 1.75;
  }, "TV failed to populate an initially empty config store");
  assert.equal(tv.state.videoSpeed, 1.75);
  assert.deepEqual(tv.dirty(), []);
});

test("clean TV adopts newer phone settings without a redundant revision bump", async (t) => {
  const host = await openService({ config: clone(DEFAULTS), revision: 11 });
  t.after(() => host.close());
  const tv = openTvClient(host.origin, DEFAULTS);
  tv.start();
  await waitUntil(() => tv.appliedRevision() === 11, "TV initial revision missing");
  const phoneConfig = clone(DEFAULTS);
  phoneConfig.videoSpeed = 1.25;
  const save = await host.request("POST", "/api/config", { revision: 11, config: phoneConfig });
  assert.equal(save.body.revision, 12);
  tv.poll();
  await waitUntil(() => tv.appliedRevision() === 12, "TV missed phone revision");
  assert.equal(tv.state.videoSpeed, 1.25);
  assert.deepEqual(tv.dirty(), []);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal((await host.request("GET", "/api/config")).body.revision, 12);
});
