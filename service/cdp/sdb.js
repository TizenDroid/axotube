"use strict";

// SDB client for the one command the CDP launcher needs: "shell:0 debug <appId>",
// which starts the app under the TV's debugger and reports the Chromium debug
// port. Same command and reply handling as the TizenTube standalone (3f28fc3).
// The shell is on 127.0.0.1:26101, and it only answers while developer mode is on
// with the developer IP set to 127.0.0.1.

var net = require("net");
var fetch = require("node-fetch");

var SDB_HOST = "127.0.0.1";
var SDB_PORT = 26101;
// Test-only seam: the real values above are used unless a test overrides them.
var endpoints = { sdbPort: SDB_PORT, apiPort: 8001 };
var REPLY_TIMEOUT_MS = 20000;
var STREAM_CLOSE_DELAY_MS = 1000;
var PORT_MIN = 1024;
var PORT_MAX = 65535;

function hex4(n) {
  var s = n.toString(16);
  while (s.length < 4) s = "0" + s;
  return s;
}

// The reply names the debug port after the word "debug", as "...: 26101".
// Only text after "debug" is read, so an earlier colon cannot be mistaken for it.
function parseDebugPort(text) {
  var at = text.indexOf("debug");
  if (at === -1) return null;
  var m = /[:\s]\s*(\d{4,5})\b/.exec(text.slice(at + "debug".length));
  if (!m) return null;
  var port = Number(m[1]);
  return port >= PORT_MIN && port <= PORT_MAX ? port : null;
}

// What SDB sent, shortened for a diagnostics line: control characters escaped,
// at most REPLY_EXCERPT_CHARS characters. An empty reply reads as "(no reply)".
var REPLY_EXCERPT_CHARS = 200;
function excerpt(text) {
  if (!text) return "(no reply)";
  var shown = String(text).replace(/[\x00-\x1f\x7f]/g, function (c) {
    return c === "\n" ? "\\n" : c === "\r" ? "\\r" : "\\x" + ("0" + c.charCodeAt(0).toString(16)).slice(-2);
  });
  return shown.length > REPLY_EXCERPT_CHARS ? shown.slice(0, REPLY_EXCERPT_CHARS) + "..." : shown;
}

// An error that names the stage it failed at and what SDB sent, so the diagnostics
// page says what happened rather than only that it did.
function sdbError(message, stage, startedAt, reply) {
  var err = new Error(message + " (stage " + stage + ", " + (Date.now() - startedAt) + " ms; reply: " + excerpt(reply) + ")");
  err.stage = stage;
  err.reply = excerpt(reply);
  return err;
}

// callback(err, port). Ends the SDB stream a second after the port is read, as
// the upstream standalone does.
function debugLaunch(appId, options, callback) {
  var command = "shell:0 debug " + appId + (options && options.tizen3 ? " 0" : "");
  var socket = net.connect(endpoints.sdbPort, SDB_HOST);
  var raw = "";
  var stage = "status";
  var finished = false;
  var startedAt = Date.now();

  var timer = setTimeout(function () {
    finish(sdbError("SDB sent no debug port within " + REPLY_TIMEOUT_MS / 1000 + " s", stage, startedAt, raw));
  }, REPLY_TIMEOUT_MS);

  function finish(err, port) {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    if (err) socket.destroy();
    else setTimeout(function () { socket.destroy(); }, STREAM_CLOSE_DELAY_MS);
    callback(err || null, port || null);
  }

  socket.on("connect", function () {
    socket.write(hex4(command.length) + command);
  });

  socket.on("data", function (chunk) {
    raw += chunk.toString("utf8");
    if (stage === "status") {
      if (raw.length < 4) return;
      var status = raw.slice(0, 4);
      if (status === "FAIL") {
        if (raw.length < 8) return;
        var len = parseInt(raw.slice(4, 8), 16);
        if (isNaN(len)) return finish(sdbError("SDB sent a malformed failure", "status", startedAt, raw));
        if (raw.length < 8 + len) return;
        return finish(sdbError("SDB refused the command: " + raw.slice(8, 8 + len), "status", startedAt, raw));
      }
      if (status !== "OKAY") return finish(sdbError("SDB sent an unexpected status " + excerpt(status), "status", startedAt, raw));
      raw = raw.slice(4);
      stage = "data";
    }
    var port = parseDebugPort(raw);
    if (port) finish(null, port);
  });

  socket.on("error", function (err) {
    var code = err && err.code ? err.code : "error";
    var hint = code === "ECONNREFUSED"
      ? "nothing is listening on " + SDB_HOST + ":" + endpoints.sdbPort + ", so the TV's shell is down or developer mode is off"
      : String(err && err.message ? err.message : err);
    finish(sdbError("cannot use SDB (" + code + "): " + hint, stage, startedAt, raw));
  });
  socket.on("close", function () {
    // The stream ended without a port. The reply says in what form, which is the
    // only evidence of a format this parser does not read.
    finish(sdbError("SDB closed without a debug port", stage, startedAt, raw));
  });
}

// Reads the device API (the same source as the standalone's getState). The
// debugger path needs developer mode on and the developer IP set to 127.0.0.1
// (or the 1.0.0.127 spelling the TV uses for that setting).
// callback(err, info) with info = { ok, ip }.
function checkDeveloperMode(callback) {
  fetch("http://127.0.0.1:" + endpoints.apiPort + "/api/v2/", { timeout: 3000 })
    .then(function (res) { return res.json(); })
    .then(function (json) {
      var device = (json && json.device) || {};
      var local = device.developerIP === "127.0.0.1" || device.developerIP === "1.0.0.127";
      callback(null, {
        ok: local && String(device.developerMode) === "1",
        ip: device.ip || null,
        developerIP: device.developerIP || null,
        developerMode: String(device.developerMode),
      });
    })
    .catch(function (err) { callback(err, null); });
}

function setEndpoints(overrides) {
  endpoints = {
    sdbPort: (overrides && overrides.sdbPort) || SDB_PORT,
    apiPort: (overrides && overrides.apiPort) || 8001,
  };
}

module.exports = {
  setEndpoints: setEndpoints,
  debugLaunch: debugLaunch,
  checkDeveloperMode: checkDeveloperMode,
  parseDebugPort: parseDebugPort,
  SDB_PORT: SDB_PORT,
};
