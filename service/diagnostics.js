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

module.exports = {
  record: record,
  snapshot: snapshot,
  setLaunchStatus: setLaunchStatus,
  getLaunchStatus: getLaunchStatus,
  uptimeSeconds: uptimeSeconds,
  setBundle: setBundle,
  setServiceVersion: setServiceVersion,
  summary: summary,
};
