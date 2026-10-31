// Bundle updater: runs the real service/bundleUpdates.cjs against temp
// directories and a fake jsDelivr.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const mod = require("../service/bundleUpdates.cjs");
const { compareSemver, createBundleUpdater, CDN, DEFAULT_PACKAGE } = mod;

const pad = (tag) => "AxoTube " + tag + " " + "x".repeat(2000);
const pkgUrl = (v) => CDN + DEFAULT_PACKAGE + "@" + v + "/package.json";
const fileUrl = (v, name) => CDN + DEFAULT_PACKAGE + "@" + v + "/dist/" + name;

function dirs(shippedVersion) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "axo-bundles-"));
  const bundledDir = path.join(root, "shipped");
  const cacheDir = path.join(root, "cache");
  fs.mkdirSync(bundledDir, { recursive: true });
  fs.writeFileSync(path.join(bundledDir, "version.json"), JSON.stringify({ version: shippedVersion }));
  fs.writeFileSync(path.join(bundledDir, "userScript.js"), pad("shipped-main"));
  fs.writeFileSync(path.join(bundledDir, "early.js"), pad("shipped-early"));
  return { bundledDir, cacheDir };
}

// routes: url -> string | Error. Anything else rejects like a 404.
function fakeFetch(routes) {
  const calls = [];
  const f = (url) => {
    calls.push(url);
    const r = routes[url];
    if (r === undefined) return Promise.reject(new Error("HTTP 404 for " + url));
    if (r instanceof Error) return Promise.reject(r);
    return Promise.resolve(r);
  };
  f.calls = calls;
  return f;
}

function remoteAt(version, overrides = {}) {
  return Object.assign(
    {
      [pkgUrl("latest")]: JSON.stringify({ version }),
      [fileUrl(version, "userScript.js")]: pad("remote-main-" + version),
      [fileUrl(version, "early.js")]: pad("remote-early-" + version),
    },
    overrides,
  );
}

test("compareSemver orders major, minor and patch", () => {
  assert.equal(compareSemver("1.24.0", "1.23.9"), 1);
  assert.equal(compareSemver("1.2.0", "1.10.0"), -1);
  assert.equal(compareSemver("2.0.0", "2.0.0"), 0);
  assert.equal(compareSemver("1.24.0-beta", "1.24.0"), 0);
});

test("first check installs the latest with no popup (nothing cached yet)", async () => {
  const d = dirs("1.23.0");
  const f = fakeFetch(remoteAt("1.24.0"));
  const u = createBundleUpdater({ ...d, packageName: DEFAULT_PACKAGE, fetchText: f });
  const result = await u.check();
  assert.equal(u.activeVersion(), "1.24.0");
  assert.equal(result.version, "1.24.0");
  assert.equal(u.status().available, false, "installed, so nothing to offer");
  assert.ok(u.filePath("userScript.js").startsWith(d.cacheDir), "served from the cache");
  assert.match(fs.readFileSync(u.filePath("userScript.js"), "utf8"), /remote-main-1\.24\.0/);
});

test("once a bundle is cached, a newer version is reported and only applied on request", async () => {
  const d = dirs("1.23.0");
  fs.mkdirSync(d.cacheDir, { recursive: true });
  fs.writeFileSync(path.join(d.cacheDir, "userScript.js"), pad("cached-main-1.24.0"));
  fs.writeFileSync(path.join(d.cacheDir, "early.js"), pad("cached-early-1.24.0"));
  fs.writeFileSync(path.join(d.cacheDir, "meta.json"), JSON.stringify({ version: "1.24.0" }));

  const f = fakeFetch(remoteAt("1.25.0"));
  const u = createBundleUpdater({ ...d, packageName: DEFAULT_PACKAGE, fetchText: f });
  await u.check();
  assert.equal(u.activeVersion(), "1.24.0", "not installed yet");
  assert.equal(u.status().available, true, "popup should show");
  assert.equal(u.status().latest, "1.25.0");
  assert.ok(!f.calls.some((c) => c.includes("1.25.0/dist/")), "no bundle downloaded on a report-only check");

  await u.apply();
  assert.equal(u.activeVersion(), "1.25.0");
  assert.equal(u.status().available, false);
  assert.match(fs.readFileSync(u.filePath("early.js"), "utf8"), /remote-early-1\.25\.0/);
});

test("the same or an older remote version downloads nothing", async () => {
  const d = dirs("1.23.0");
  const f = fakeFetch(remoteAt("1.23.0"));
  const u = createBundleUpdater({ ...d, packageName: DEFAULT_PACKAGE, fetchText: f });
  await u.check();
  assert.equal(u.activeVersion(), "1.23.0");
  assert.equal(u.status().available, false);
  assert.equal(f.calls.length, 1, "only package.json was read");
  assert.ok(u.filePath("userScript.js").startsWith(d.bundledDir), "still the shipped bundle");
});

test("a downloaded bundle that fails validation never replaces the shipped one", async () => {
  const d = dirs("1.23.0");
  const f = fakeFetch(remoteAt("1.24.0", { [fileUrl("1.24.0", "userScript.js")]: "tiny" }));
  const u = createBundleUpdater({ ...d, packageName: DEFAULT_PACKAGE, fetchText: f });
  await u.check();
  assert.equal(u.activeVersion(), "1.23.0");
  assert.ok(!fs.existsSync(path.join(d.cacheDir, "meta.json")), "no meta written");
  assert.ok(u.status().error && /validation/.test(u.status().error));
});

test("if the second bundle fails, the swap does not happen (meta is written last)", async () => {
  const d = dirs("1.23.0");
  const f = fakeFetch(remoteAt("1.24.0", { [fileUrl("1.24.0", "early.js")]: new Error("network down") }));
  const u = createBundleUpdater({ ...d, packageName: DEFAULT_PACKAGE, fetchText: f });
  await u.check();
  assert.equal(u.activeVersion(), "1.23.0");
  assert.ok(u.filePath("userScript.js").startsWith(d.bundledDir), "shipped files still served");
  assert.ok(!fs.existsSync(path.join(d.cacheDir, "meta.json")));
});

test("a network failure on package.json resolves without throwing and keeps the current bundle", async () => {
  const d = dirs("1.23.0");
  const f = fakeFetch({ [pkgUrl("latest")]: new Error("timeout") });
  const u = createBundleUpdater({ ...d, packageName: DEFAULT_PACKAGE, fetchText: f });
  await u.check();
  assert.equal(u.activeVersion(), "1.23.0");
  assert.match(u.status().error, /timeout/);
});

test("concurrent checks share one request", async () => {
  const d = dirs("1.23.0");
  const f = fakeFetch(remoteAt("1.23.0"));
  const u = createBundleUpdater({ ...d, packageName: DEFAULT_PACKAGE, fetchText: f });
  await Promise.all([u.check(), u.check(), u.check()]);
  assert.equal(f.calls.filter((c) => c.endsWith("package.json")).length, 1);
});

test("a cache older than the shipped bundle is ignored", () => {
  const d = dirs("1.24.0");
  fs.mkdirSync(d.cacheDir, { recursive: true });
  fs.writeFileSync(path.join(d.cacheDir, "userScript.js"), pad("old"));
  fs.writeFileSync(path.join(d.cacheDir, "early.js"), pad("old"));
  fs.writeFileSync(path.join(d.cacheDir, "meta.json"), JSON.stringify({ version: "1.22.0" }));
  const u = createBundleUpdater({ ...d, packageName: DEFAULT_PACKAGE, fetchText: fakeFetch({}) });
  assert.equal(u.activeVersion(), "1.24.0");
  assert.ok(u.filePath("userScript.js").startsWith(d.bundledDir));
});
