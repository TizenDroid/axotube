"use strict";
// Port 8081 is fixed (the WGT and the launcher both use it), so the test files that
// start the proxy take turns. The lock is a file in the temp directory. A lock whose
// owner has exited is taken over.
const fs = require("fs");
const os = require("os");
const path = require("path");

const LOCK = path.join(os.tmpdir(), "axotube-test-8081.lock");

function ownerAlive(pid) {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}

async function acquire(timeoutMs) {
  const end = Date.now() + (timeoutMs || 300000);
  for (;;) {
    try {
      const fd = fs.openSync(LOCK, "wx");
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      return;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      let owner = null;
      try {
        owner = fs.readFileSync(LOCK, "utf8");
      } catch (readErr) {
        owner = null;
      }
      if (owner && !ownerAlive(owner)) {
        try { fs.unlinkSync(LOCK); } catch (unlinkErr) { /* raced with another taker */ }
        continue;
      }
      if (Date.now() > end) throw new Error("port 8081 is held by another test run");
      await new Promise((r) => setTimeout(r, 200));
    }
  }
}

function release() {
  try {
    fs.unlinkSync(LOCK);
  } catch (e) {
    // already released
  }
}

module.exports = { acquire: acquire, release: release };
