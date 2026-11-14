"use strict";
// SDB failures say what happened: the stage, the elapsed time, and what SDB sent.
const test = require("node:test");
const assert = require("node:assert/strict");
const net = require("node:net");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const sdb = require(path.join(ROOT, "service", "cdp", "sdb.js"));
const diagnostics = require(path.join(ROOT, "service", "diagnostics.js"));

// A fake SDB that answers the one command once, with the given bytes, then closes.
function fakeSdb(reply) {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => {
      let got = "";
      socket.on("data", (chunk) => {
        got += chunk.toString("utf8");
        if (got.length >= 4) {
          socket.write(reply);
          socket.end();
        }
      });
      socket.on("error", () => {});
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function launch(port) {
  sdb.setEndpoints({ sdbPort: port });
  return new Promise((resolve) => {
    sdb.debugLaunch("axotubeapp.AxoTubeStandalone", {}, (err, p) => resolve({ err, port: p }));
  });
}

test("a silent close says the stage and the reply, not only that it closed", async () => {
  const server = await fakeSdb("OKAY");
  const { err, port } = await launch(server.address().port);
  server.close();
  assert.equal(port, null);
  assert.match(err.message, /SDB closed without a debug port \(stage data, \d+ ms; reply: \(no reply\)\)/);
  assert.equal(err.stage, "data");
});

test("a refusal carries the device's own reason", async () => {
  const reason = "no such app";
  const hex = ("000" + reason.length.toString(16)).slice(-4);
  const server = await fakeSdb("FAIL" + hex + reason);
  const { err } = await launch(server.address().port);
  server.close();
  assert.match(err.message, /SDB refused the command: no such app/);
});

test("a reply that is not OKAY or FAIL shows its text escaped", async () => {
  const server = await fakeSdb("WHAT\n");
  const { err } = await launch(server.address().port);
  server.close();
  assert.match(err.message, /unexpected status WHAT/);
  assert.equal(err.reply, "WHAT\\n");
});

test("nothing listening says the shell is down, not a bare connection error", async () => {
  // A port nothing is bound to: connect is refused.
  const probe = net.createServer();
  await new Promise((r) => probe.listen(0, "127.0.0.1", r));
  const closed = probe.address().port;
  await new Promise((r) => probe.close(r));
  const { err } = await launch(closed);
  assert.match(err.message, /cannot use SDB \(ECONNREFUSED\)/);
  assert.match(err.message, /the TV's shell is down or developer mode is off/);
});

test("the text export lists every recorded event, oldest first, with its time", () => {
  diagnostics.record("error", "first thing that failed");
  diagnostics.record("info", "a later note");
  const text = diagnostics.exportText("192.168.1.5");
  assert.match(text, /^axotube diagnostics report/);
  assert.match(text, /export address: 192\.168\.1\.5/);
  const first = text.indexOf("first thing that failed");
  const later = text.indexOf("a later note");
  assert.ok(first !== -1 && later > first, "both events, in order");
  assert.match(text, /\d{4}-\d{2}-\d{2}T[\d:.]+Z error first thing that failed/);
});
