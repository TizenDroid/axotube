// Fetches the pinned Node 4 binary from the npm registry (node-linux-x64) and checks its
// version. CI and the local checks use the same binary, so a Node 4 result is reproducible.
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function fetchNode4(version) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "axotube-node4-"));
  execFileSync("npm", ["pack", "node-linux-x64@" + version], { cwd: work, stdio: "pipe" });
  const tarball = path.join(work, "node-linux-x64-" + version + ".tgz");
  execFileSync("tar", ["xzf", tarball, "-C", work]);
  const binary = path.join(work, "package", "bin", "node");
  fs.chmodSync(binary, 0o755);
  const got = execFileSync(binary, ["-v"]).toString().trim();
  if (got !== "v" + version) throw new Error("expected Node " + version + ", got " + got);
  return binary;
}

module.exports = { fetchNode4 };
