// The service updater downloads a newer core into the service cache. These tests
// run it against a fake CDN and check what it accepts, what it refuses, and that
// what it writes is exactly what the loader reads.
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const { createServiceUpdater } = require(path.join(ROOT, "service", "serviceUpdater.cjs"));

const CDN = "https://cdn.jsdelivr.net/npm/";
const MIN = 200 * 1000;

// A core-sized, loadable body: the loader will run this as a service.
function coreBody(version) {
  const head =
    "global.axotubeListenStarted = true;\n" +
    "setTimeout(function () { global.axotubeOnHealthy(); }, 20);\n" +
    "setInterval(function () {}, 1000);\n" +
    "// version " + version + "\n";
  return Buffer.from(head + "/* padding " + "x".repeat(MIN + 1000) + " */\n", "utf8");
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function manifestFor(version, bytes) {
  return JSON.stringify({
    version: version,
    file: "service-core.js",
    bytes: bytes.length,
    sha256: sha256(bytes),
  });
}

// A fake CDN: text and byte responses by URL, and a log of every request.
function fakeCdn(routes) {
  const requests = [];
  function lookup(url) {
    requests.push(url);
    if (!Object.prototype.hasOwnProperty.call(routes, url)) {
      return Promise.reject(new Error("404 " + url));
    }
    const value = routes[url];
    return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
  }
  return {
    requests: requests,
    fetchText: function (url) {
      return lookup(url).then(function (value) {
        return Buffer.isBuffer(value) ? value.toString("utf8") : String(value);
      });
    },
    fetchBytes: function (url) {
      return lookup(url).then(function (value) {
        return Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8");
      });
    },
  };
}

function makeCacheDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "axotube-updater-"));
  return { dir: dir, cache: path.join(dir, "service-cache") };
}

function remoteRoutes(remoteVersion, shippedBytesOverride) {
  const bytes = shippedBytesOverride || coreBody(remoteVersion);
  return {
    [CDN + "axotube@latest/package.json"]: JSON.stringify({ version: remoteVersion }),
    [CDN + "axotube@" + remoteVersion + "/dist/service-core.json"]: manifestFor(remoteVersion, bytes),
    [CDN + "axotube@" + remoteVersion + "/dist/service-core.js"]: bytes,
  };
}

function updaterFor(cache, cdn, extra) {
  const notes = [];
  const updater = createServiceUpdater(
    Object.assign(
      {
        cacheDir: cache,
        shippedVersion: "1.31.0",
        fetchText: cdn.fetchText,
        fetchBytes: cdn.fetchBytes,
        notify: function (text) {
          notes.push(text);
        },
        log: function () {},
      },
      extra || {},
    ),
  );
  return { updater: updater, notes: notes };
}

test("does nothing when the published version is not newer than the shipped one", async () => {
  const { dir, cache } = makeCacheDir();
  const cdn = fakeCdn(remoteRoutes("1.31.0"));
  const { updater, notes } = updaterFor(cache, cdn);
  const status = await updater.check();
  assert.equal(status.state, "current");
  assert.equal(
    cdn.requests.filter((u) => u.includes("service-core")).length,
    0,
    "no core is downloaded when nothing is newer",
  );
  assert.deepEqual(notes, []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("downloads a newer core, checks it, writes it, and tells the user once", async () => {
  const { dir, cache } = makeCacheDir();
  const bytes = coreBody("1.32.0");
  const cdn = fakeCdn(remoteRoutes("1.32.0", bytes));
  const { updater, notes } = updaterFor(cache, cdn);
  const status = await updater.check();
  assert.equal(status.state, "ready");
  assert.equal(status.latest, "1.32.0");

  const meta = JSON.parse(fs.readFileSync(path.join(cache, "meta.json"), "utf8"));
  assert.deepEqual(meta, { version: "1.32.0", sha256: sha256(bytes), file: "core-1.32.0.js" });
  assert.deepEqual(fs.readFileSync(path.join(cache, "core-1.32.0.js")), bytes);
  assert.equal(notes.length, 1);
  assert.match(notes[0], /1\.32\.0/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a second check does not download the same version again", async () => {
  const { dir, cache } = makeCacheDir();
  const cdn = fakeCdn(remoteRoutes("1.32.0"));
  const { updater, notes } = updaterFor(cache, cdn);
  await updater.check();
  const before = cdn.requests.length;
  const status = await updater.check();
  assert.equal(status.state, "ready");
  const later = cdn.requests.slice(before);
  assert.equal(later.filter((u) => u.includes("service-core")).length, 0);
  assert.equal(notes.length, 1, "the user is told once, not on every check");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("refuses a core whose bytes fail the published checksum, and writes nothing", async () => {
  const { dir, cache } = makeCacheDir();
  const honest = coreBody("1.32.0");
  const tampered = Buffer.from(honest.toString("utf8").replace("padding", "PADDING"), "utf8");
  const routes = remoteRoutes("1.32.0", honest);
  routes[CDN + "axotube@1.32.0/dist/service-core.js"] = tampered;
  const cdn = fakeCdn(routes);
  const { updater, notes } = updaterFor(cache, cdn);
  const status = await updater.check();
  assert.equal(status.state, "error");
  assert.match(status.error, /checksum/);
  assert.equal(fs.existsSync(path.join(cache, "meta.json")), false);
  assert.equal(fs.existsSync(path.join(cache, "core-1.32.0.js")), false);
  assert.deepEqual(notes, []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("refuses a truncated core (fewer bytes than the manifest says)", async () => {
  const { dir, cache } = makeCacheDir();
  const full = coreBody("1.32.0");
  const routes = remoteRoutes("1.32.0", full);
  const manifest = JSON.parse(routes[CDN + "axotube@1.32.0/dist/service-core.json"]);
  manifest.bytes = full.length + 5000;
  routes[CDN + "axotube@1.32.0/dist/service-core.json"] = JSON.stringify(manifest);
  const cdn = fakeCdn(routes);
  const { updater } = updaterFor(cache, cdn);
  const status = await updater.check();
  assert.equal(status.state, "error");
  assert.match(status.error, /truncated/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("refuses a core that is far too small to be the service", async () => {
  const { dir, cache } = makeCacheDir();
  const tiny = Buffer.from("setInterval(function () {}, 1000);\n", "utf8");
  const cdn = fakeCdn(remoteRoutes("1.32.0", tiny));
  const { updater } = updaterFor(cache, cdn);
  const status = await updater.check();
  assert.equal(status.state, "error");
  assert.match(status.error, /suspicious size/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("refuses a core that is far too large", async () => {
  const { dir, cache } = makeCacheDir();
  const huge = Buffer.alloc(5 * 1024 * 1024 + 10, "a");
  const cdn = fakeCdn(remoteRoutes("1.32.0", huge));
  const { updater } = updaterFor(cache, cdn);
  const status = await updater.check();
  assert.equal(status.state, "error");
  assert.match(status.error, /suspicious size/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("refuses a version that was already rolled back, without downloading it", async () => {
  const { dir, cache } = makeCacheDir();
  const cdn = fakeCdn(remoteRoutes("1.32.0"));
  const { updater } = updaterFor(cache, cdn, { isRejected: (v) => v === "1.32.0" });
  const status = await updater.check();
  assert.equal(status.state, "rejected");
  assert.equal(cdn.requests.filter((u) => u.includes("service-core")).length, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a manifest for a different version is refused", async () => {
  const { dir, cache } = makeCacheDir();
  const bytes = coreBody("1.32.0");
  const routes = remoteRoutes("1.32.0", bytes);
  routes[CDN + "axotube@1.32.0/dist/service-core.json"] = manifestFor("1.33.0", bytes);
  const cdn = fakeCdn(routes);
  const { updater } = updaterFor(cache, cdn);
  const status = await updater.check();
  assert.equal(status.state, "error");
  assert.match(status.error, /does not match/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a published package.json without a usable version is refused", async () => {
  const { dir, cache } = makeCacheDir();
  const routes = remoteRoutes("1.32.0");
  routes[CDN + "axotube@latest/package.json"] = JSON.stringify({ version: "latest" });
  const cdn = fakeCdn(routes);
  const { updater } = updaterFor(cache, cdn);
  const status = await updater.check();
  assert.equal(status.state, "error");
  assert.match(status.error, /no usable version/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a network failure is reported as a status and never rejects", async () => {
  const { dir, cache } = makeCacheDir();
  const routes = {};
  routes[CDN + "axotube@latest/package.json"] = new Error("ENOTFOUND cdn.jsdelivr.net");
  const cdn = fakeCdn(routes);
  const { updater } = updaterFor(cache, cdn);
  const status = await updater.check();
  assert.equal(status.state, "error");
  assert.match(status.error, /ENOTFOUND/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("concurrent checks share one request", async () => {
  const { dir, cache } = makeCacheDir();
  const cdn = fakeCdn(remoteRoutes("1.31.0"));
  const { updater } = updaterFor(cache, cdn);
  const a = updater.check();
  const b = updater.check();
  assert.equal(a, b, "the same in-flight promise is returned");
  await a;
  assert.equal(cdn.requests.filter((u) => u.endsWith("package.json")).length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("installing a newer core removes the older downloaded copies", async () => {
  const { dir, cache } = makeCacheDir();
  fs.mkdirSync(cache, { recursive: true });
  fs.writeFileSync(path.join(cache, "core-1.31.5.js"), "old");
  const cdn = fakeCdn(remoteRoutes("1.32.0"));
  const { updater } = updaterFor(cache, cdn);
  await updater.check();
  assert.equal(fs.existsSync(path.join(cache, "core-1.31.5.js")), false);
  assert.equal(fs.existsSync(path.join(cache, "core-1.32.0.js")), true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("without a cache folder the updater stays disabled and asks nothing", async () => {
  const cdn = fakeCdn(remoteRoutes("1.32.0"));
  const { updater } = updaterFor(null, cdn);
  const status = await updater.check();
  assert.equal(status.state, "disabled");
  assert.equal(cdn.requests.length, 0);
});

test("what the updater writes is what the loader starts", async () => {
  const { dir, cache } = makeCacheDir();
  const bytes = coreBody("1.32.0");
  const cdn = fakeCdn(remoteRoutes("1.32.0", bytes));
  const { updater } = updaterFor(cache, cdn);
  const status = await updater.check();
  assert.equal(status.state, "ready");

  // Lay out a WGT the way the TV has it, with the updater's cache in place.
  const dist = path.join(dir, "service", "dist");
  fs.mkdirSync(dist, { recursive: true });
  fs.copyFileSync(path.join(ROOT, "service", "loader.js"), path.join(dist, "index.js"));
  fs.writeFileSync(path.join(dist, "core.js"), coreBody("1.31.0"));
  fs.writeFileSync(path.join(dist, "version.json"), JSON.stringify({ version: "1.31.0" }));
  fs.renameSync(cache, path.join(dist, "service-cache"));

  const run = spawnSync(process.execPath, ["index.js"], {
    cwd: dist,
    encoding: "utf8",
    timeout: 1500,
    env: Object.assign({}, process.env, { AXOTUBE_HEALTH_TIMEOUT_MS: "45000" }),
  });
  const out = (run.stdout || "") + (run.stderr || "");
  assert.match(out, /1\.32\.0 \(downloaded\) is answering/);
  fs.rmSync(dir, { recursive: true, force: true });
});
