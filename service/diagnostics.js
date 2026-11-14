"use strict";

var launchSettings = require("./launchSettings.js");

// What the launcher and the proxy did recently, for the diagnostics page and the
// config page. Kept in memory: it is cleared on restart. Nothing here may hold a
// token, a cookie or a request body; entries are short, fixed sentences.

var MAX_EVENTS = 100;
var MAX_TEXT = 300;
var events = [];
var launchStatus = { state: "idle", reason: "" };
var bundle = { current: null, latest: null, available: false, error: null };
var serviceVersion = "unknown";
var startedAt = Date.now();

function record(level, message) {
  events.push({
    t: Date.now(),
    level: level || "info",
    message: String(message || "").slice(0, MAX_TEXT),
  });
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
}

function snapshot() {
  return events.slice();
}

function setLaunchStatus(status) {
  launchStatus = { state: status.state, reason: status.reason || "" };
}

function getLaunchStatus() {
  return { state: launchStatus.state, reason: launchStatus.reason };
}

function uptimeSeconds() {
  return Math.floor((Date.now() - startedAt) / 1000);
}

function setBundle(status) {
  bundle = {
    current: status.current || null,
    latest: status.latest || null,
    available: !!status.available,
    error: status.error || null,
  };
}

function setServiceVersion(version) {
  serviceVersion = version || "unknown";
}

// Everything the diagnostics page shows, as one object.
function summary() {
  var settings = launchSettings.read();
  return {
    service: {
      version: serviceVersion,
      node: process.version,
      uptimeSeconds: uptimeSeconds(),
    },
    bundle: bundle,
    launch: {
      debugger: settings.debugger,
      state: launchStatus.state,
      reason: launchStatus.reason,
    },
    events: snapshot(),
  };
}

// The same facts as summary(), as plain text for copying or a phone: versions,
// launch and bundle state, then every recorded event, oldest first, with its time.
// Built only from fixed sentences and the events, so it holds nothing secret.
function exportText(lanAddress) {
  var data = summary();
  var lines = [];
  lines.push("axotube diagnostics report");
  lines.push("generated: " + new Date().toISOString());
  lines.push("service: " + data.service.version + " (node " + data.service.node + ", up " + data.service.uptimeSeconds + " s)");
  lines.push("bundle: current " + (data.bundle.current || "?") + ", latest " + (data.bundle.latest || "?") +
    (data.bundle.error ? ", error " + data.bundle.error : ""));
  lines.push("launch: mode " + (data.launch.debugger ? "debugger" : "proxy") + ", state " + data.launch.state +
    (data.launch.reason ? ", reason " + data.launch.reason : ""));
  lines.push("export address: " + (lanAddress || "unknown (no LAN address found)"));
  lines.push("");
  lines.push("events (oldest first):");
  if (data.events.length === 0) lines.push("(none)");
  for (var i = 0; i < data.events.length; i++) {
    var e = data.events[i];
    lines.push(new Date(e.t).toISOString() + " " + e.level + " " + e.message);
  }
  return lines.join("\n") + "\n";
}

// The TV's first IPv4 address off loopback, which a phone on the same network can
// reach. Null when there is none (the TV is not on a network yet).
function lanAddress() {
  var nets = require("os").networkInterfaces();
  var names = Object.keys(nets);
  for (var i = 0; i < names.length; i++) {
    var list = nets[names[i]] || [];
    for (var j = 0; j < list.length; j++) {
      var a = list[j];
      if (a && a.family === "IPv4" && !a.internal) return a.address;
    }
  }
  return null;
}

// The link a phone opens to read the report, and the QR code of that link.
var EXPORT_PORT = 8090;
function exportUrl() {
  var host = lanAddress();
  return host ? "http://" + host + ":" + EXPORT_PORT + "/api/diagnostics/export" : null;
}

// The QR code of the export link as GIF bytes, or null when there is no link or no code.
function qrGif() {
  var link = exportUrl();
  if (!link) return null;
  var qr = require("qrcode-npm").qrcode(6, "H");
  qr.addData(link);
  qr.make();
  var match = qr.createImgTag(8, 8).match(/src="data:image\/gif;base64,([^"]+)"/);
  return match ? new Buffer(match[1], "base64") : null;
}

module.exports = {
  exportText: exportText,
  exportUrl: exportUrl,
  qrGif: qrGif,
  lanAddress: lanAddress,
  record: record,
  snapshot: snapshot,
  setLaunchStatus: setLaunchStatus,
  getLaunchStatus: getLaunchStatus,
  uptimeSeconds: uptimeSeconds,
  setBundle: setBundle,
  setServiceVersion: setServiceVersion,
  summary: summary,
};
