// The loader decides which service the TV runs. These tests build a WGT-shaped
// folder with fake cores and run the loader in a child process, the same way the
// TV does, then check what it chose and what it recorded.
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const LOADER = path.join(ROOT, "service", "loader.js");

// A core that answers its health hook, then stays alive like the real service.
const HEALTHY_CORE = [
  'global.axotubeListenStarted = true;',
  'setTimeout(function () { global.axotubeOnHealthy(); }, 20);',
  'setInterval(function () {}, 1000);',
].join("\n");

// A core that never answers and stays alive, so only the loader's timer ends it.
const SILENT_CORE = "setInterval(function () {}, 1000);\n";

// A core that answers, then crashes shortly after.
const CRASHES_AFTER_HEALTH_CORE = [
  'global.axotubeListenStarted = true;',
  'setTimeout(function () { global.axotubeOnHealthy(); }, 10);',
  'setTimeout(function () { throw new Error("late crash"); }, 60);',
  'setInterval(function () {}, 1000);',
].join("\n");

// A core that reports a listen failure (another instance holds the port), then waits.
const PORT_BUSY_CORE = [
  'global.axotubeListenStarted = true;',
  'global.axotubeOnListenError("EADDRINUSE");',
  'setInterval(function () {}, 1000);',
].join("\n");

function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function makeLayout(options) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "axotube-loader-"));
  const dist = path.join(root, "service", "dist");
  fs.mkdirSync(dist, { recursive: true });
  fs.copyFileSync(LOADER, path.join(dist, "index.js"));
  fs.writeFileSync(path.join(dist, "core.js"), options.shippedCore || HEALTHY_CORE, "utf8");
  fs.writeFileSync(path.join(dist, "version.json"), JSON.stringify({ version: "1.0.0" }));

  if (options.cached) {
    const cache = path.join(dist, "service-cache");
    fs.mkdirSync(cache, { recursive: true });
    const file = "core-" + options.cached.version + ".js";
    fs.writeFileSync(path.join(cache, file), options.cached.source, "utf8");
    const meta = {
      version: options.cached.version,
      sha256: options.cached.sha256 || sha256(options.cached.source),
      file: file,
    };
    fs.writeFileSync(path.join(cache, "meta.json"), JSON.stringify(meta));
  }
  if (options.state) {
    const cache = path.join(dist, "service-cache");
    fs.mkdirSync(cache, { recursive: true });
    fs.writeFileSync(path.join(cache, "state.json"), options.state);
  }
  return { root, dist, cache: path.join(dist, "service-cache") };
}

// Runs the loader like the TV does. Healthy cores never exit, so a timeout ends them.
function runLoader(layout, options) {
  const opts = options || {};
  const result = spawnSync(process.execPath, ["index.js"], {
    cwd: layout.dist,
    encoding: "utf8",
    timeout: opts.timeout || 1500,
    env: Object.assign({}, process.env, {
      AXOTUBE_HEALTH_TIMEOUT_MS: String(opts.healthTimeoutMs || 45000),
    }),
  });
  return {
    out: (result.stdout || "") + (result.stderr || ""),
    status: result.status,
  };
}

function readState(layout) {
  return JSON.parse(fs.readFileSync(path.join(layout.cache, "state.json"), "utf8"));
}

function cleanup(layout) {
  fs.rmSync(layout.root, { recursive: true, force: true });
}

test("runs the shipped core when nothing is cached", () => {
  const layout = makeLayout({});
  try {
    const run = runLoader(layout);
    assert.match(run.out, /1\.0\.0 \(shipped\) is answering/);
    assert.equal(fs.existsSync(layout.cache), true, "the cache folder is created for later downloads");
  } finally {
    cleanup(layout);
  }
});

test("a newer cached core that answers is kept and recorded as healthy", () => {
  const layout = makeLayout({ cached: { version: "1.1.0", source: HEALTHY_CORE } });
  try {
    const run = runLoader(layout);
    assert.match(run.out, /1\.1\.0 \(downloaded\) is answering/);
    const state = readState(layout);
    assert.equal(state.lastHealthy, "1.1.0");
    assert.equal(state.pending, null);
    assert.equal(state.attempts, 0);
  } finally {
    cleanup(layout);
  }
});

test("a cached core that fails to load is rolled back and the shipped core starts in its place", () => {
  const layout = makeLayout({
    cached: { version: "1.2.0", source: 'throw new Error("broken on load");\n' },
  });
  try {
    const run = runLoader(layout);
    assert.match(run.out, /1\.2\.0 failed to load/);
    assert.match(run.out, /starting the shipped core in its place/);
    assert.match(run.out, /1\.0\.0 \(shipped\) is answering/);
    const state = readState(layout);
    assert.deepEqual(state.bad, ["1.2.0"]);
    assert.equal(fs.existsSync(path.join(layout.cache, "meta.json")), false, "the rejected copy is removed");
    assert.equal(fs.existsSync(path.join(layout.cache, "core-1.2.0.js")), false);
  } finally {
    cleanup(layout);
  }
});

test("a cached core that loads but never answers gets two more starts, then is rolled back", () => {
  const layout = makeLayout({ cached: { version: "1.3.0", source: SILENT_CORE } });
  try {
    const first = runLoader(layout, { healthTimeoutMs: 300 });
    assert.equal(first.status, 1, "the first start is ended by the health timeout");
    assert.match(first.out, /1\.3\.0 did not answer within/);
    assert.equal(readState(layout).attempts, 1);

    const second = runLoader(layout, { healthTimeoutMs: 300 });
    assert.equal(second.status, 1);
    assert.equal(readState(layout).attempts, 2);

    const third = runLoader(layout, { healthTimeoutMs: 300 });
    assert.match(third.out, /1\.3\.0 did not answer on 2 starts/);
    assert.match(third.out, /1\.3\.0 was rolled back/);
    assert.match(third.out, /1\.0\.0 \(shipped\) is answering/);
    assert.deepEqual(readState(layout).bad, ["1.3.0"]);
  } finally {
    cleanup(layout);
  }
});

test("a port that is still in use does not count against the copy", () => {
  const layout = makeLayout({ cached: { version: "1.4.0", source: PORT_BUSY_CORE } });
  try {
    for (let i = 0; i < 3; i++) {
      const run = runLoader(layout, { healthTimeoutMs: 300 });
      assert.equal(run.status, 1);
    }
    const state = readState(layout);
    assert.deepEqual(state.bad, [], "an old instance holding the ports is not the copy's fault");
    assert.equal(state.attempts, 1);
  } finally {
    cleanup(layout);
  }
});

test("a copy whose bytes fail the checksum is discarded before it can run", () => {
  const layout = makeLayout({
    cached: { version: "1.5.0", source: HEALTHY_CORE, sha256: "0".repeat(64) },
  });
  try {
    const run = runLoader(layout);
    assert.match(run.out, /1\.5\.0 failed its checksum; discarding it/);
    assert.match(run.out, /1\.0\.0 \(shipped\) is answering/);
    assert.equal(fs.existsSync(path.join(layout.cache, "core-1.5.0.js")), false);
  } finally {
    cleanup(layout);
  }
});

test("an older or equal cached copy is ignored and left in place", () => {
  const layout = makeLayout({ cached: { version: "1.0.0", source: HEALTHY_CORE } });
  try {
    const run = runLoader(layout);
    assert.match(run.out, /1\.0\.0 \(shipped\) is answering/);
    assert.equal(fs.existsSync(path.join(layout.cache, "meta.json")), true);
  } finally {
    cleanup(layout);
  }
});

test("a version already rolled back is never started again", () => {
  const layout = makeLayout({
    cached: { version: "1.2.0", source: HEALTHY_CORE },
    state: JSON.stringify({ bad: ["1.2.0"], pending: null, attempts: 0, crashes: [] }),
  });
  try {
    const run = runLoader(layout);
    assert.match(run.out, /1\.0\.0 \(shipped\) is answering/);
    assert.doesNotMatch(run.out, /1\.2\.0 \(downloaded\)/);
  } finally {
    cleanup(layout);
  }
});

test("a copy that keeps crashing after it answers is rolled back on the third crash", () => {
  const layout = makeLayout({ cached: { version: "1.6.0", source: CRASHES_AFTER_HEALTH_CORE } });
  try {
    const first = runLoader(layout);
    assert.equal(first.status, 1);
    assert.match(first.out, /1\.6\.0 \(downloaded\) is answering/);
    assert.match(first.out, /uncaught error in service 1\.6\.0/);
    assert.deepEqual(readState(layout).bad, [], "one crash is not enough");

    runLoader(layout);
    assert.deepEqual(readState(layout).bad, [], "two crashes are not enough");

    const third = runLoader(layout);
    assert.match(third.out, /1\.6\.0 was rolled back/);
    assert.deepEqual(readState(layout).bad, ["1.6.0"]);
  } finally {
    cleanup(layout);
  }
});

test("a damaged state file is treated as a fresh start, not a crash", () => {
  const layout = makeLayout({
    cached: { version: "1.7.0", source: HEALTHY_CORE },
    state: "{ this is not json",
  });
  try {
    const run = runLoader(layout);
    assert.match(run.out, /1\.7\.0 \(downloaded\) is answering/);
  } finally {
    cleanup(layout);
  }
});

test("if the shipped core fails to load, the loader exits with an error instead of hiding it", () => {
  const layout = makeLayout({ shippedCore: 'throw new Error("shipped is broken");\n' });
  try {
    const run = runLoader(layout);
    assert.notEqual(run.status, 0);
    assert.match(run.out, /shipped is broken/);
  } finally {
    cleanup(layout);
  }
});

test("a checksum-valid but unknown-shape state file cannot break the decision", () => {
  const layout = makeLayout({
    cached: { version: "1.8.0", source: HEALTHY_CORE },
    state: JSON.stringify({ bad: "not-a-list", attempts: "x", crashes: [1, "2"], pending: 5 }),
  });
  try {
    const run = runLoader(layout);
    assert.match(run.out, /1\.8\.0 \(downloaded\) is answering/);
  } finally {
    cleanup(layout);
  }
});
