// Keeps the standalone service current through jsDelivr, the same way the page
// bundles update. A newer core is downloaded into the service cache and checked
// against its published checksum. Nothing is swapped while the service runs: the
// loader (index.js) starts the new core on the next service start, and rolls it
// back if it does not answer.
//
// ES5 on purpose, like the loader: it runs on the TV's Node 4 runtime.
"use strict";

var crypto = require("crypto");
var fs = require("fs");
var path = require("path");
var bundleUpdates = require("./bundleUpdates.cjs");

var CDN = "https://cdn.jsdelivr.net/npm/";
var PACKAGE = "axotube";
var CORE_FILE = "service-core.js";
var MANIFEST_FILE = "service-core.json";
var META_FILE = "meta.json";
var VERSION_RE = /^[0-9]+\.[0-9]+\.[0-9]+$/;
var SHA256_RE = /^[0-9a-f]{64}$/;
var CACHED_CORE_RE = /^core-.*\.js$/;
var MIN_CORE_BYTES = 200 * 1000;
var MAX_CORE_BYTES = 5 * 1024 * 1024;
var FIRST_CHECK_DELAY_MS = 90 * 1000;
var CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

function sha256Hex(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    return null;
  }
}

function mkdirp(dir) {
  if (fs.existsSync(dir)) return;
  var parent = path.dirname(dir);
  if (parent !== dir) mkdirp(parent);
  fs.mkdirSync(dir);
}

function parseRemoteVersion(text) {
  var parsed = JSON.parse(text);
  if (!parsed || !VERSION_RE.test(String(parsed.version || ""))) {
    throw new Error("remote package.json has no usable version");
  }
  return String(parsed.version);
}

function parseManifest(text, version) {
  var manifest = JSON.parse(text);
  if (!manifest || manifest.version !== version) {
    throw new Error("manifest version does not match " + version);
  }
  if (typeof manifest.sha256 !== "string" || !SHA256_RE.test(manifest.sha256)) {
    throw new Error("manifest has no usable checksum");
  }
  return manifest;
}

function createServiceUpdater(options) {
  var cacheDir = options.cacheDir || null;
  var shippedVersion = options.shippedVersion || "0.0.0";
  var fetchText = options.fetchText;
  var fetchBytes = options.fetchBytes;
  var isRejected = options.isRejected || function () {
    return false;
  };
  var notify = options.notify || function () {};
  var log = options.log || function () {};
  var base = options.cdn || CDN;
  var packageName = options.packageName || PACKAGE;

  var inFlight = null;
  var timers = [];
  var announced = null;
  var status = { state: cacheDir ? "idle" : "disabled", latest: null, error: null, checkedAt: null };

  function cachedVersion() {
    var meta = readJson(path.join(cacheDir, META_FILE));
    return meta && VERSION_RE.test(String(meta.version || "")) ? String(meta.version) : null;
  }

  // Writes the new core under its own name, then points meta.json at it. The
  // loader only trusts what meta.json names, so a half-written download is never used.
  function install(version, bytes, digest) {
    mkdirp(cacheDir);
    var file = "core-" + version + ".js";
    var target = path.join(cacheDir, file);
    fs.writeFileSync(target + ".tmp", bytes);
    fs.renameSync(target + ".tmp", target);

    var meta = { version: version, sha256: digest, file: file };
    var metaPath = path.join(cacheDir, META_FILE);
    fs.writeFileSync(metaPath + ".tmp", JSON.stringify(meta), "utf8");
    fs.renameSync(metaPath + ".tmp", metaPath);

    fs.readdirSync(cacheDir).forEach(function (name) {
      if (CACHED_CORE_RE.test(name) && name !== file) {
        try {
          fs.unlinkSync(path.join(cacheDir, name));
        } catch (err) {
          // Harmless: an unused old copy.
        }
      }
    });
  }

  function download(version) {
    var prefix = base + packageName + "@" + version + "/dist/";
    return fetchText(prefix + MANIFEST_FILE).then(function (manifestText) {
      var manifest = parseManifest(manifestText, version);
      return fetchBytes(prefix + CORE_FILE).then(function (bytes) {
        if (!bytes || typeof bytes.length !== "number") throw new Error("core download was empty");
        if (bytes.length < MIN_CORE_BYTES || bytes.length > MAX_CORE_BYTES) {
          throw new Error("core download has a suspicious size (" + bytes.length + " bytes)");
        }
        if (typeof manifest.bytes === "number" && manifest.bytes !== bytes.length) {
          throw new Error("core download is truncated");
        }
        var digest = sha256Hex(bytes);
        if (digest !== manifest.sha256) throw new Error("core download failed its checksum");
        install(version, bytes, digest);
        return version;
      });
    });
  }

  function run() {
    status.checkedAt = Date.now();
    status.error = null;
    return fetchText(base + packageName + "@latest/package.json").then(function (text) {
      var remote = parseRemoteVersion(text);
      status.latest = remote;
      if (bundleUpdates.compareSemver(remote, shippedVersion) <= 0) {
        status.state = "current";
        return status;
      }
      if (isRejected(remote)) {
        status.state = "rejected";
        return status;
      }
      var have = cachedVersion();
      if (have && bundleUpdates.compareSemver(remote, have) <= 0) {
        status.state = "ready";
        return status;
      }
      return download(remote).then(function (version) {
        status.state = "ready";
        log("service " + version + " downloaded; it starts on the next service start");
        if (announced !== version) {
          announced = version;
          notify("AxoTube service " + version + " is ready. Restart AxoTube or the TV to finish the update.");
        }
        return status;
      });
    });
  }

  // Never rejects: a failed check only updates the status and waits for the next one.
  function check() {
    if (!cacheDir) return Promise.resolve(status);
    if (inFlight) return inFlight;
    inFlight = run().then(
      function (result) {
        inFlight = null;
        return result;
      },
      function (err) {
        inFlight = null;
        status.state = "error";
        status.error = String((err && err.message) || err);
        log("update check failed: " + status.error);
        return status;
      }
    );
    return inFlight;
  }

  function start() {
    if (!cacheDir) return;
    timers.push(
      setTimeout(function () {
        check();
        timers.push(setInterval(check, CHECK_INTERVAL_MS));
      }, FIRST_CHECK_DELAY_MS)
    );
  }

  function stop() {
    timers.forEach(function (timer) {
      clearTimeout(timer);
      clearInterval(timer);
    });
    timers = [];
  }

  return {
    check: check,
    start: start,
    stop: stop,
    status: function () {
      return status;
    },
  };
}

module.exports = { createServiceUpdater: createServiceUpdater, sha256Hex: sha256Hex };
