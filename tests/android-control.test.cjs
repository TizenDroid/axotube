// Compiles and runs the Android control server (android/app/.../ControlServer.java)
// on a host JVM. Skips when no JDK is installed.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const JAVA_DIR = path.join(ROOT, "android/app/src/main/java/org/axotube/tv");
const SOURCES = [
  path.join(JAVA_DIR, "Json.java"),
  path.join(JAVA_DIR, "ConfigStore.java"),
  path.join(JAVA_DIR, "ControlServer.java"),
  path.join(ROOT, "tests/android/ControlServerTest.java"),
];

const hasJdk = spawnSync("javac", ["-version"]).status === 0 && spawnSync("java", ["-version"]).status === 0;

test("Android control server passes its route checks on a host JVM", { skip: !hasJdk && "no JDK on this machine" }, () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "axo-control-"));
  const classes = path.join(work, "classes");
  fs.mkdirSync(classes);
  const compile = spawnSync("javac", ["-d", classes, "-encoding", "UTF-8", ...SOURCES], { encoding: "utf8" });
  assert.equal(compile.status, 0, compile.stderr);
  const run = spawnSync(
    "java",
    ["-cp", classes, "org.axotube.tv.ControlServerTest", path.join(ROOT, "config-schema.json"), path.join(work, "store.json")],
    { encoding: "utf8", timeout: 60000 },
  );
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /0 failed/);
});
