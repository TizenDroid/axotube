// Entry point of the standalone service (service/dist/index.js in the WGT).
//
// This file only decides which service to run. The service itself is core.js,
// shipped in the WGT, or a newer copy the service updater downloaded into the
// service cache. A newer copy is kept only once it proves it works: its content
// proxy must answer on 127.0.0.1:8081. A copy that fails to load, crashes, or
// never answers is rolled back, and the shipped core runs instead.
//
// Written in ES5 on purpose. It runs on the TV's Node 4 runtime, the same as the
// service, and it must keep working even when the code it starts is broken.
"use strict";

var fs = require("fs");
var os = require("os");
var path = require("path");
var crypto = require("crypto");

var SHIPPED_DIR = __dirname;
var SHIPPED_CORE = path.join(SHIPPED_DIR, "core.js");
var SHIPPED_META = path.join(SHIPPED_DIR, "version.json");
var CACHE_DIR_NAME = "service-cache";
var FALLBACK_CACHE_NAME = "axotube-service-cache";
var STATE_NAME = "state.json";
var CACHE_META_NAME = "meta.json";
var VERSION_RE = /^[0-9]+\.[0-9]+\.[0-9]+$/;
var CORE_FILE_RE = /^core-[0-9]+\.[0-9]+\.[0-9]+\.js$/;

// Starts allowed without the service answering before a cached copy is rolled back.
var MAX_STARTS_WITHOUT_HEALTH = 2;
// A cached copy that has not answered after this long is restarted. The environment
// override exists for the tests only; nothing on the TV sets it.
var HEALTH_TIMEOUT_MS = Number(process.env.AXOTUBE_HEALTH_TIMEOUT_MS) > 0
  ? Number(process.env.AXOTUBE_HEALTH_TIMEOUT_MS)
  : 45 * 1000;
// This many crashes inside the window roll a cached copy back, even after it answered.
var CRASH_WINDOW_MS = 10 * 60 * 1000;
var CRASH_LIMIT = 3;
// Listen errors that say another instance still holds the ports.
var PORT_BUSY_ERRORS = ["EADDRINUSE"];

function log(message) {
  console.log("[AxoTube:loader] " + message);
}

function warn(message) {
  console.error("[AxoTube:loader] " + message);
}

function isVersion(value) {
  return typeof value === "string" && VERSION_RE.test(value);
}

function isTimestamp(value) {
  return typeof value === "number" && isFinite(value);
}

// Semver-style compare on major.minor.patch, the same rule as the page bundles.
function compareSemver(a, b) {
  var pa = String(a || "0").split("-")[0].split(".");
  var pb = String(b || "0").split("-")[0].split(".");
  for (var i = 0; i < 3; i++) {
    var x = parseInt(pa[i] || "0", 10) || 0;
    var y = parseInt(pb[i] || "0", 10) || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    return null;
  }
}

function writeJson(file, value) {
  var tmp = file + ".tmp";
  try {
    fs.writeFileSync(tmp, JSON.stringify(value), "utf8");
    fs.renameSync(tmp, file);
    return true;
  } catch (err) {
    warn("could not write " + path.basename(file) + ": " + err.message);
    return false;
  }
}

// Node 4 has no mkdirSync({ recursive: true }), so create the folders by hand.
function mkdirp(dir) {
  if (fs.existsSync(dir)) return;
  var parent = path.dirname(dir);
  if (parent !== dir) mkdirp(parent);
  fs.mkdirSync(dir);
}

// The writable check uses fs.W_OK: fs.constants does not exist on Node 4.
function canWrite(dir) {
  try {
    fs.accessSync(dir, fs.W_OK);
    return true;
  } catch (err) {
    return false;
  }
}

function chooseCacheDir() {
  var preferred = path.join(SHIPPED_DIR, CACHE_DIR_NAME);
  try {
    mkdirp(preferred);
    if (canWrite(preferred)) return preferred;
  } catch (err) {
    // Fall through to the temp folder.
  }
  var fallback = path.join(os.tmpdir(), FALLBACK_CACHE_NAME);
  try {
    mkdirp(fallback);
    if (canWrite(fallback)) return fallback;
  } catch (err) {
    // No writable place at all: run the shipped core without a cache.
  }
  return null;
}

function emptyState() {
  return {
    pending: null,
    attempts: 0,
    bad: [],
    crashes: [],
    lastHealthy: null,
    lastListenError: null,
  };
}

// Reads state.json defensively: a damaged file means a fresh start, not a crash.
function loadState(dir) {
  var raw = readJson(path.join(dir, STATE_NAME));
  var state = emptyState();
  if (!raw || typeof raw !== "object") return state;
  if (isVersion(raw.pending)) state.pending = raw.pending;
  if (typeof raw.attempts === "number" && isFinite(raw.attempts) && raw.attempts >= 0) {
    state.attempts = Math.floor(raw.attempts);
  }
  if (Array.isArray(raw.bad)) state.bad = raw.bad.filter(isVersion);
  if (Array.isArray(raw.crashes)) state.crashes = raw.crashes.filter(isTimestamp);
  if (isVersion(raw.lastHealthy)) state.lastHealthy = raw.lastHealthy;
  if (typeof raw.lastListenError === "string") state.lastListenError = raw.lastListenError;
  return state;
}

function saveState(dir, state) {
  writeJson(path.join(dir, STATE_NAME), state);
}

// Removes the cached copy for one version, and only that version, so a newer
// download that landed meanwhile is left alone.
function removeCache(dir, version) {
  var meta = readJson(path.join(dir, CACHE_META_NAME));
  if (!meta || meta.version !== version) return;
  try {
    fs.unlinkSync(path.join(dir, CACHE_META_NAME));
  } catch (err) {
    // Already gone.
  }
  if (typeof meta.file === "string" && CORE_FILE_RE.test(meta.file)) {
    try {
      fs.unlinkSync(path.join(dir, meta.file));
    } catch (err) {
      // Already gone.
    }
  }
}

// Returns the cached copy only if its bytes match the checksum recorded for it.
function readCache(dir) {
  var meta = readJson(path.join(dir, CACHE_META_NAME));
  if (
    !meta ||
    !isVersion(meta.version) ||
    typeof meta.sha256 !== "string" ||
    typeof meta.file !== "string" ||
    !CORE_FILE_RE.test(meta.file)
  ) {
    return null;
  }
  var file = path.join(dir, meta.file);
  var data;
  try {
    data = fs.readFileSync(file);
  } catch (err) {
    return null;
  }
  var digest = crypto.createHash("sha256").update(data).digest("hex");
  if (digest !== meta.sha256) {
    warn("cached service " + meta.version + " failed its checksum; discarding it");
    removeCache(dir, meta.version);
    return null;
  }
  return { version: meta.version, file: file };
}

function rejectVersion(dir, state, version) {
  if (state.bad.indexOf(version) === -1) state.bad.push(version);
  state.pending = null;
  state.attempts = 0;
  state.crashes = [];
  if (dir) {
    saveState(dir, state);
    removeCache(dir, version);
  }
  warn("service " + version + " was rolled back; the shipped core will run");
}

function decide(shippedVersion, cacheDir, state) {
  var shipped = { version: shippedVersion, file: SHIPPED_CORE, cached: false };
  if (!cacheDir) return shipped;

  var cached = readCache(cacheDir);
  if (!cached) {
    state.pending = null;
    state.attempts = 0;
    return shipped;
  }
  if (compareSemver(cached.version, shippedVersion) <= 0) {
    state.pending = null;
    state.attempts = 0;
    return shipped;
  }
  if (state.bad.indexOf(cached.version) !== -1) {
    state.pending = null;
    state.attempts = 0;
    return shipped;
  }

  // The last start of this copy may have been killed or may have failed to answer.
  var priorListenError = state.lastListenError;
  state.lastListenError = null;
  if (state.pending === cached.version) {
    if (PORT_BUSY_ERRORS.indexOf(priorListenError) === -1) state.attempts += 1;
  } else {
    state.pending = cached.version;
    state.attempts = 1;
  }

  if (state.attempts > MAX_STARTS_WITHOUT_HEALTH) {
    warn("service " + cached.version + " did not answer on " + (state.attempts - 1) + " starts");
    rejectVersion(cacheDir, state, cached.version);
    return shipped;
  }
  return { version: cached.version, file: cached.file, cached: true };
}

function start() {
  var shippedMeta = readJson(SHIPPED_META);
  var shippedVersion = shippedMeta && isVersion(shippedMeta.version) ? shippedMeta.version : "0.0.0";

  var cacheDir = null;
  var state = emptyState();
  var choice;
  try {
    cacheDir = chooseCacheDir();
    if (cacheDir) state = loadState(cacheDir);
    choice = decide(shippedVersion, cacheDir, state);
    if (cacheDir) saveState(cacheDir, state);
  } catch (err) {
    // Any surprise while deciding: run the shipped core and skip the cache.
    warn("could not choose a service version (" + (err && err.message) + "); running the shipped core");
    cacheDir = null;
    choice = { version: shippedVersion, file: SHIPPED_CORE, cached: false };
  }

  var healthy = false;
  var healthTimer = null;
  var stateFile = cacheDir ? path.join(cacheDir, STATE_NAME) : null;

  // The core reports through these hooks. They must never throw into the service.
  global.axotubeServiceVersion = choice.version;
  global.axotubeServiceShippedVersion = shippedVersion;
  global.axotubeServiceCacheDir = cacheDir;
  global.axotubeServiceIsRejected = function (version) {
    if (!cacheDir) return false;
    return loadState(cacheDir).bad.indexOf(version) !== -1;
  };
  global.axotubeOnHealthy = function () {
    if (healthy) return;
    healthy = true;
    if (healthTimer) clearTimeout(healthTimer);
    if (choice.cached && stateFile) {
      state.pending = null;
      state.attempts = 0;
      // Crashes are not cleared here: a copy that answers and then crashes must still
      // reach the crash limit. The window in the crash handler ages them out.
      state.lastHealthy = choice.version;
      state.lastListenError = null;
      saveState(cacheDir, state);
    }
    log("service " + choice.version + (choice.cached ? " (downloaded)" : " (shipped)") + " is answering");
  };
  global.axotubeOnListenError = function (code) {
    if (!stateFile) return;
    state.lastListenError = String(code || "");
    saveState(cacheDir, state);
  };

  // Anything that escapes the service is fatal. A copy that has not answered, or
  // that keeps crashing, is rolled back so the next start uses the shipped core.
  process.on("uncaughtException", function (err) {
    warn("uncaught error in service " + choice.version + ": " + (err && err.stack ? err.stack : err));
    if (choice.cached && cacheDir) {
      var now = Date.now();
      state.crashes = state.crashes
        .filter(function (time) {
          return now - time < CRASH_WINDOW_MS;
        })
        .concat([now]);
      if (!healthy || state.crashes.length >= CRASH_LIMIT) {
        rejectVersion(cacheDir, state, choice.version);
      } else {
        saveState(cacheDir, state);
      }
    }
    process.exit(1);
  });

  if (choice.cached) {
    healthTimer = setTimeout(function () {
      if (healthy) return;
      warn("service " + choice.version + " did not answer within " + HEALTH_TIMEOUT_MS / 1000 + "s; restarting");
      process.exit(1);
    }, HEALTH_TIMEOUT_MS);
  }

  try {
    require(choice.file);
  } catch (err) {
    warn("service " + choice.version + " failed to load: " + (err && err.message));
    if (!choice.cached) throw err;
    if (healthTimer) clearTimeout(healthTimer);
    rejectVersion(cacheDir, state, choice.version);
    if (global.axotubeListenStarted) {
      // Ports may already be bound by the broken copy. Exit, and the restart
      // runs the shipped core cleanly.
      process.exit(1);
    }
    choice = { version: shippedVersion, file: SHIPPED_CORE, cached: false };
    global.axotubeServiceVersion = shippedVersion;
    log("starting the shipped core in its place");
    require(SHIPPED_CORE);
  }
}

start();
