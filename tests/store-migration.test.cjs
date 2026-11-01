// Settings saved before this build lived in the temp folder. After the update the
// service must carry them over once, and must never overwrite a store it already has.
// TMPDIR points the child process at a temp folder, so no real store is touched.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const CORE = path.join(ROOT, "standalone", "service", "dist", "core.js");
const LEGACY_NAME = "axotube-config-store.json";

function legacyStore(revision) {
  return JSON.stringify({
    config: { enableAdBlock: false },
    revision: revision,
    authToken: "a".repeat(64),
  });
}

function healthy() {
  return new Promise(function (resolve) {
    const req = http.get({ host: "127.0.0.1", port: 8081, path: "/axotube/health", timeout: 1000 }, function (res) {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", function () {
      resolve(false);
    });
    req.on("timeout", function () {
      req.destroy();
      resolve(false);
    });
  });
}

async function runCore(wgt, tmp) {
  const child = spawn(process.execPath, [path.join(wgt, "core.js")], {
    cwd: wgt,
    // os.tmpdir() reads TEMP/TMP on Windows and TMPDIR elsewhere, so set all
    // three or the service looks at the real temp folder.
    env: Object.assign({}, process.env, { TMPDIR: tmp, TEMP: tmp, TMP: tmp }),
    stdio: "ignore",
  });
  const exited = new Promise(function (resolve) {
    child.on("exit", resolve);
  });
  try {
    const deadline = Date.now() + 15000;
    while (!(await healthy())) {
      if (Date.now() > deadline) throw new Error("the core did not start");
      await new Promise(function (resolve) {
        setTimeout(resolve, 200);
      });
    }
    // Give the store write, if any, a moment to land.
    await new Promise(function (resolve) {
      setTimeout(resolve, 300);
    });
  } finally {
    child.kill();
    // Wait for the process to let go of its files, or the cleanup below hits
    // EPERM on Windows.
    await Promise.race([exited, new Promise(function (resolve) { setTimeout(resolve, 5000); })]);
  }
}

// Windows keeps a handle briefly after exit; retry before giving up.
function rmrf(dir) {
  for (let i = 0; i < 10; i++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch (err) {
      if (i === 9) throw err;
      const until = Date.now() + 200;
      while (Date.now() < until) {}
    }
  }
}

function makeDirs() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "axotube-store-"));
  const wgt = path.join(base, "wgt");
  const tmp = path.join(base, "tmp");
  fs.mkdirSync(wgt);
  fs.mkdirSync(tmp);
  fs.copyFileSync(CORE, path.join(wgt, "core.js"));
  return { base: base, wgt: wgt, tmp: tmp };
}

test("settings in the legacy temp store are carried into the WGT folder once", { timeout: 40000 }, async () => {
  const dirs = makeDirs();
  try {
    fs.writeFileSync(path.join(dirs.tmp, LEGACY_NAME), legacyStore(7));
    await runCore(dirs.wgt, dirs.tmp);
    const carried = JSON.parse(fs.readFileSync(path.join(dirs.wgt, LEGACY_NAME), "utf8"));
    assert.equal(carried.revision, 7);
    assert.equal(carried.config.enableAdBlock, false);
    assert.equal(carried.authToken.length, 64, "the pairing token carries over too");
  } finally {
    rmrf(dirs.base);
  }
});

test("an existing store in the WGT folder is never overwritten by an old temp copy", { timeout: 40000 }, async () => {
  const dirs = makeDirs();
  try {
    fs.writeFileSync(path.join(dirs.wgt, LEGACY_NAME), legacyStore(9));
    fs.writeFileSync(path.join(dirs.tmp, LEGACY_NAME), legacyStore(3));
    await runCore(dirs.wgt, dirs.tmp);
    const kept = JSON.parse(fs.readFileSync(path.join(dirs.wgt, LEGACY_NAME), "utf8"));
    assert.equal(kept.revision, 9, "the newer store is kept");
  } finally {
    rmrf(dirs.base);
  }
});

test("a damaged legacy file is ignored and the service starts from defaults", { timeout: 40000 }, async () => {
  const dirs = makeDirs();
  try {
    fs.writeFileSync(path.join(dirs.tmp, LEGACY_NAME), "{ not a store");
    await runCore(dirs.wgt, dirs.tmp);
    // The service writes its own default store at startup; the damaged copy must not appear in it.
    const storePath = path.join(dirs.wgt, LEGACY_NAME);
    if (fs.existsSync(storePath)) {
      const written = JSON.parse(fs.readFileSync(storePath, "utf8"));
      assert.equal(written.revision, 0, "starts from defaults, not from the damaged copy");
      assert.deepEqual(written.config, {});
    }
  } finally {
    rmrf(dirs.base);
  }
});
