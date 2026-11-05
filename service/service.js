require("./node4-compat.js");
function ownKeys(e, r) { var t = Object.keys(e); if (Object.getOwnPropertySymbols) { var o = Object.getOwnPropertySymbols(e); r && (o = o.filter(function (r) { return Object.getOwnPropertyDescriptor(e, r).enumerable; })), t.push.apply(t, o); } return t; }
function _objectSpread(e) { for (var r = 1; r < arguments.length; r++) { var t = null != arguments[r] ? arguments[r] : {}; r % 2 ? ownKeys(Object(t), !0).forEach(function (r) { _defineProperty(e, r, t[r]); }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function (r) { Object.defineProperty(e, r, Object.getOwnPropertyDescriptor(t, r)); }); } return e; }
function _defineProperty(e, r, t) { return (r = _toPropertyKey(r)) in e ? Object.defineProperty(e, r, { value: t, enumerable: !0, configurable: !0, writable: !0 }) : e[r] = t, e; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == _typeof(i) ? i : i + ""; }
function _toPrimitive(t, r) { if ("object" != _typeof(t) || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != _typeof(i)) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); }
function _slicedToArray(r, e) { return _arrayWithHoles(r) || _iterableToArrayLimit(r, e) || _unsupportedIterableToArray(r, e) || _nonIterableRest(); }
function _nonIterableRest() { throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }
function _iterableToArrayLimit(r, l) { var t = null == r ? null : "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"]; if (null != t) { var e, n, i, u, a = [], f = !0, o = !1; try { if (i = (t = t.call(r)).next, 0 === l) { if (Object(t) !== t) return; f = !1; } else for (; !(f = (e = i.call(t)).done) && (a.push(e.value), a.length !== l); f = !0); } catch (r) { o = !0, n = r; } finally { try { if (!f && null != t.return && (u = t.return(), Object(u) !== u)) return; } finally { if (o) throw n; } } return a; } }
function _arrayWithHoles(r) { if (Array.isArray(r)) return r; }
function _createForOfIteratorHelper(r, e) { var t = "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"]; if (!t) { if (Array.isArray(r) || (t = _unsupportedIterableToArray(r)) || e && r && "number" == typeof r.length) { t && (r = t); var _n = 0, F = function F() {}; return { s: F, n: function n() { return _n >= r.length ? { done: !0 } : { done: !1, value: r[_n++] }; }, e: function e(r) { throw r; }, f: F }; } throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); } var o, a = !0, u = !1; return { s: function s() { t = t.call(r); }, n: function n() { var r = t.next(); return a = r.done, r; }, e: function e(r) { u = !0, o = r; }, f: function f() { try { a || null == t.return || t.return(); } finally { if (u) throw o; } } }; }
function _unsupportedIterableToArray(r, a) { if (r) { if ("string" == typeof r) return _arrayLikeToArray(r, a); var t = {}.toString.call(r).slice(8, -1); return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0; } }
function _arrayLikeToArray(r, a) { (null == a || a > r.length) && (a = r.length); for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e]; return n; }
function _typeof(o) { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) { return typeof o; } : function (o) { return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o; }, _typeof(o); }
var dial = require("@patrickkfkan/peer-dial");
var express = require("express");
var cors = require("cors");
var fs = require("fs");
var path = require("path");
var os = require("os");
var crypto = require("crypto");
var _require = require("../shared/configPolicy.js"),
  validateConfigValue = _require.validateConfigValue;
var _require2 = require("./webConfigPage.js"),
  webConfigPage = _require2.webConfigPage;
var launchSettings = require("./launchSettings.js");
var diagnostics = require("./diagnostics.js");
var app = express();

// The Tizen APIs exist only on a Tizen TV. Elsewhere (plain node on a PC, or an
// Android host) these helpers return their fallback quietly instead of warning.
function hasTizen() {
  return typeof tizen !== "undefined";
}
function tizenGetCapability(capability) {
  if (!hasTizen()) return "";
  try {
    return tizen.systeminfo.getCapability(capability);
  } catch (err) {
    console.warn("tizen.systeminfo.getCapability failed:", err.message);
    return "";
  }
}
function tizenGetPackageId() {
  if (!hasTizen()) return null;
  try {
    return tizen.application.getAppInfo().packageId;
  } catch (err) {
    console.warn("tizen.application.getAppInfo failed:", err.message);
    return null;
  }
}
function tizenLaunchAppControl(appControl, appId) {
  if (!hasTizen()) return false;
  try {
    tizen.application.launchAppControl(appControl, appId);
    return true;
  } catch (err) {
    console.warn("tizen.application.launchAppControl failed:", err.message);
    return false;
  }
}
function buildYouTubeAppControl(launchData) {
  if (!hasTizen()) return null;
  try {
    return new tizen.ApplicationControl("http://tizen.org/appcontrol/operation/view", null, null, null, [new tizen.ApplicationControlData("module", [JSON.stringify({
      moduleName: "@foxreis/tizentube",
      moduleType: "npm",
      args: launchData
    })])]);
  } catch (err) {
    console.warn("Could not build Tizen app control:", err.message);
    return null;
  }
}
app.use(cors({
  origin: "*",
  methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
  credentials: false,
  optionsSuccessStatus: 204
}));
app.use(express.json({
  limit: "64kb"
}));
var PORT = 8090;
var STORE_DIR = function () {
  try {
    fs.accessSync(__dirname, fs.W_OK); // fs.constants is missing on Node 4
    return __dirname;
  } catch (err) {
    return os.tmpdir();
  }
}();
var STORE_PATH = path.join(STORE_DIR, "axotube-config-store.json");
var STORE_TMP_PATH = "".concat(STORE_PATH, ".tmp");
function newToken() {
  return crypto.randomBytes(32).toString("hex");
}
function newPairingCode() {
  var n = crypto.randomBytes(4).readUInt32BE(0) % 1000000;
  // Node 4 (the TV service runtime) has no String.padStart.
  return ("000000" + n).slice(-6);
}
function sanitizeConfig(value) {
  if (!value || _typeof(value) !== "object" || Array.isArray(value)) return null;
  var out = {};
  for (var _i = 0, _Object$keys = Object.keys(value); _i < _Object$keys.length; _i++) {
    var key = _Object$keys[_i];
    if (!validateConfigValue(key, value[key])) return null;
    out[key] = value[key];
  }
  return out;
}
function migrateStoredConfig(value) {
  if (!value || _typeof(value) !== "object" || Array.isArray(value)) return {};
  var out = {};
  for (var _i2 = 0, _Object$keys2 = Object.keys(value); _i2 < _Object$keys2.length; _i2++) {
    var key = _Object$keys2[_i2];
    var candidate = value[key];
    if (key === "launchToOnStartup" && candidate && _typeof(candidate) === "object" && !Array.isArray(candidate)) {
      try {
        candidate = JSON.stringify(candidate);
      } catch (err) {
        continue;
      }
    }
    if (!validateConfigValue(key, candidate)) continue;
    out[key] = candidate;
  }
  return out;
}
function loadStore() {
  try {
    var parsed = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
    if (parsed && _typeof(parsed) === "object") {
      return {
        config: migrateStoredConfig(parsed.config),
        revision: Number.isSafeInteger(parsed.revision) && parsed.revision >= 0 ? parsed.revision : 0,
        authToken: typeof parsed.authToken === "string" && parsed.authToken.length >= 32 ? parsed.authToken : newToken()
      };
    }
  } catch (err) {}
  return {
    config: {},
    revision: 0,
    authToken: newToken()
  };
}

// Settings saved before this build live in the temp folder: the writable check used
// to throw on Node 4, so the store always fell back there. Carry them over once, so
// an update does not reset the phone-synced settings. An existing store wins.
function carryOverLegacyStore() {
  var legacy = path.join(os.tmpdir(), "axotube-config-store.json");
  if (STORE_DIR === os.tmpdir() || legacy === STORE_PATH) return;
  try {
    if (fs.existsSync(STORE_PATH) || !fs.existsSync(legacy)) return;
    var body = fs.readFileSync(legacy, "utf8");
    JSON.parse(body); // only a real store is copied
    fs.writeFileSync(STORE_TMP_PATH, body, {
      encoding: "utf8",
      mode: 384
    });
    fs.renameSync(STORE_TMP_PATH, STORE_PATH);
  } catch (err) {
    // Nothing to carry over, or the copy failed: start from defaults, as before.
  }
}
carryOverLegacyStore();
var initialStore = loadStore();
var storedConfig = initialStore.config;
var configRevision = initialStore.revision;
var authToken = initialStore.authToken;
var pairingCode = newPairingCode();
function saveStore() {
  var config = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : storedConfig;
  var revision = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : configRevision;
  try {
    var body = JSON.stringify({
      config: config,
      revision: revision,
      authToken: authToken
    });
    fs.writeFileSync(STORE_TMP_PATH, body, {
      encoding: "utf8",
      mode: 384
    });
    fs.renameSync(STORE_TMP_PATH, STORE_PATH);
    return true;
  } catch (err) {
    try {
      if (fs.existsSync(STORE_TMP_PATH)) fs.unlinkSync(STORE_TMP_PATH);
    } catch (e) {}
    console.warn("Failed to persist config store:", err.message);
    return false;
  }
}
var storePersisted = saveStore();
function configEquals(a, b) {
  var keysA = Object.keys(a).sort();
  var keysB = Object.keys(b).sort();
  return keysA.length === keysB.length && keysA.every(function (key, index) {
    return key === keysB[index] && JSON.stringify(a[key]) === JSON.stringify(b[key]);
  });
}

// Persist the next complete state before publishing its new revision to readers.
// Both writers share this commit path; a failed disk write never gets an ACK.
function commitConfig(clean) {
  var changed = !configEquals(storedConfig, clean);
  if (!changed && storePersisted) return {
    ok: true,
    changed: false
  };
  var revision = changed ? configRevision + 1 : configRevision;
  if (!Number.isSafeInteger(revision) || !saveStore(clean, revision)) {
    return {
      ok: false
    };
  }
  storedConfig = clean;
  configRevision = revision;
  storePersisted = true;
  return {
    ok: true,
    changed: changed
  };
}
function remoteAddress(req) {
  var _req$socket, _req$connection;
  return String(((_req$socket = req.socket) === null || _req$socket === void 0 ? void 0 : _req$socket.remoteAddress) || ((_req$connection = req.connection) === null || _req$connection === void 0 ? void 0 : _req$connection.remoteAddress) || "");
}
function isLoopback(req) {
  var addr = remoteAddress(req).toLowerCase();
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
}
function safeTokenEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  // Constant-time compare without crypto.timingSafeEqual (Node 6.6+).
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function suppliedToken(req) {
  var auth = String(req.get("authorization") || "");
  if (auth.indexOf("Bearer ") === 0) return auth.slice(7).trim();
  return String(req.get("x-axotube-token") || "").trim();
}
function requireApiAuth(req, res, next) {
  if (isLoopback(req) || safeTokenEqual(suppliedToken(req), authToken)) return next();
  res.status(401).json({
    ok: false,
    error: "Pairing required"
  });
}
function getLanWebConfigUrls() {
  var urls = [];
  try {
    var interfaces = os.networkInterfaces();
    for (var _i3 = 0, _Object$keys3 = Object.keys(interfaces); _i3 < _Object$keys3.length; _i3++) {
      var name = _Object$keys3[_i3];
      var entries = interfaces[name] || [];
      var _iterator = _createForOfIteratorHelper(entries),
        _step;
      try {
        for (_iterator.s(); !(_step = _iterator.n()).done;) {
          var entry = _step.value;
          var family = entry && entry.family;
          if (!entry || entry.internal || family !== "IPv4" && family !== 4) continue;
          if (!entry.address) continue;
          var url = "http://".concat(entry.address, ":").concat(PORT);
          if (urls.indexOf(url) === -1) urls.push(url);
        }
      } catch (err) {
        _iterator.e(err);
      } finally {
        _iterator.f();
      }
    }
  } catch (err) {}
  return urls;
}
var pairAttemptsByAddress = new Map();
function pairAttemptKey(req) {
  return remoteAddress(req).toLowerCase() || "unknown";
}
function allowPairAttempt(req) {
  var now = Date.now();
  var key = pairAttemptKey(req);
  var state = pairAttemptsByAddress.get(key);
  if (!state || now - state.startedAt > 60 * 1000) {
    state = {
      startedAt: now,
      attempts: 0
    };
  }
  state.attempts += 1;
  pairAttemptsByAddress.set(key, state);
  if (pairAttemptsByAddress.size > 256) {
    var _iterator2 = _createForOfIteratorHelper(pairAttemptsByAddress),
      _step2;
    try {
      for (_iterator2.s(); !(_step2 = _iterator2.n()).done;) {
        var _step2$value = _slicedToArray(_step2.value, 2),
          address = _step2$value[0],
          value = _step2$value[1];
        if (now - value.startedAt > 60 * 1000) pairAttemptsByAddress.delete(address);
      }
    } catch (err) {
      _iterator2.e(err);
    } finally {
      _iterator2.f();
    }
  }
  return state.attempts <= 10;
}
function resetPairAttempts(req) {
  pairAttemptsByAddress.delete(pairAttemptKey(req));
}

// Browsers request this automatically; answer it so the console stays clean.
app.get("/favicon.ico", function (req, res) {
  res.status(204).end();
});
app.get("/", function (req, res) {
  res.type("html").send(webConfigPage);
});
app.get("/api/pairing-code", function (req, res) {
  if (!isLoopback(req)) {
    res.status(403).json({
      ok: false,
      error: "Loopback only"
    });
    return;
  }
  res.json({
    ok: true,
    code: pairingCode,
    urls: getLanWebConfigUrls()
  });
});
app.post("/api/pair", function (req, res) {
  if (!allowPairAttempt(req)) {
    res.status(429).json({
      ok: false,
      error: "Too many pairing attempts"
    });
    return;
  }
  var code = req.body && String(req.body.code || "").trim();
  if (!code || code !== pairingCode) {
    res.status(403).json({
      ok: false,
      error: "Invalid pairing code"
    });
    return;
  }
  resetPairAttempts(req);
  res.json({
    ok: true,
    token: authToken
  });
});
app.use("/api", requireApiAuth);

// Launch mode: "proxy" (default, YouTube opens at once) or the debugger launch,
// which makes the WGT exit and restart. Read and saved from the config page.
app.get("/api/launch", function (req, res) {
  res.json({
    debugger: launchSettings.read().debugger
  });
});
app.post("/api/launch", function (req, res) {
  var value = req.body && req.body.debugger;
  if (typeof value !== "boolean") {
    res.status(400).json({
      ok: false,
      error: "debugger must be true or false"
    });
    return;
  }
  if (!launchSettings.setDebugger(value)) {
    res.status(500).json({
      ok: false,
      error: "could not save the launch mode"
    });
    return;
  }
  res.json({
    ok: true,
    debugger: value
  });
});

// The same data as the TV's diagnostics page, for the phone.
app.get("/api/diagnostics", function (req, res) {
  res.json(diagnostics.summary());
});
app.get("/api/config", function (req, res) {
  res.json({
    revision: configRevision,
    config: storedConfig
  });
});
app.post("/api/config", function (req, res) {
  // Revision-aware phone clients supply an envelope. Legacy clients may still
  // send a plain config object and retain their previous last-write behavior.
  var envelope = req.body && Object.prototype.hasOwnProperty.call(req.body, "config");
  var clean = sanitizeConfig(envelope ? req.body.config : req.body);
  if (!clean) {
    res.status(400).json({
      ok: false,
      error: "Invalid config payload"
    });
    return;
  }
  if (envelope && (!Number.isSafeInteger(req.body.revision) || req.body.revision < 0)) {
    res.status(400).json({
      ok: false,
      error: "Invalid config revision"
    });
    return;
  }
  if (envelope && req.body.revision !== configRevision) {
    res.status(409).json({
      ok: false,
      error: "Settings changed on TV; reload before saving",
      revision: configRevision
    });
    return;
  }
  var result = commitConfig(clean);
  if (!result.ok) {
    res.status(503).json({
      ok: false,
      error: "Unable to save settings"
    });
    return;
  }
  res.json({
    ok: true,
    applied: true,
    changed: result.changed,
    revision: configRevision
  });
});
app.post("/api/config/push", function (req, res) {
  var body = req.body;
  var rev = body && Number.isSafeInteger(body.revision) ? body.revision : -1;
  var clean = body ? sanitizeConfig(body.config) : null;
  if (!clean) {
    res.status(400).json({
      ok: false,
      error: "Invalid config push"
    });
    return;
  }
  if (rev !== configRevision) {
    res.status(409).json({
      ok: false,
      applied: false,
      error: "Stale config revision",
      revision: configRevision
    });
    return;
  }
  var result = commitConfig(clean);
  if (!result.ok) {
    res.status(503).json({
      ok: false,
      applied: false,
      error: "Unable to save settings"
    });
    return;
  }
  res.json({
    ok: true,
    applied: true,
    changed: result.changed,
    revision: configRevision
  });
});
var MAX_COMMAND_QUEUE = 50;
var commandQueue = [];
var nextCommandId = 1;
var nowPlaying = null;

// Service-side messages for the page's toast. They share the phone command queue,
// but only this code can add them: normalizeCommand() never accepts "toast".
function queueToast(text) {
  if (commandQueue.length >= MAX_COMMAND_QUEUE) return;
  var shown = String(text).slice(0, 200);
  commandQueue.push({
    id: nextCommandId++,
    command: {
      action: "toast",
      text: shown
    }
  });
}
function normalizeCommand(body) {
  if (!body || _typeof(body) !== "object" || Array.isArray(body)) return null;
  var action = body.action,
    videoId = body.videoId,
    playlistId = body.playlistId,
    query = body.query,
    browseId = body.browseId;
  if (action === "play" && typeof videoId === "string" && videoId.trim()) {
    return {
      action: "play",
      videoId: videoId.trim(),
      playlistId: typeof playlistId === "string" && playlistId ? playlistId : undefined
    };
  }
  if (action === "search" && typeof query === "string" && query.trim()) {
    return {
      action: "search",
      query: query.trim()
    };
  }
  if (action === "browse" && typeof browseId === "string" && browseId.trim()) {
    return {
      action: "browse",
      browseId: browseId.trim()
    };
  }
  if (action === "reload") return {
    action: "reload"
  };
  return null;
}
app.post("/api/command", function (req, res) {
  var command = normalizeCommand(req.body);
  if (!command) {
    res.status(400).json({
      ok: false,
      error: "Unsupported command"
    });
    return;
  }
  if (commandQueue.length >= MAX_COMMAND_QUEUE) {
    res.status(429).json({
      ok: false,
      error: "Command queue full"
    });
    return;
  }
  var queued = {
    id: nextCommandId++,
    command: command
  };
  commandQueue.push(queued);
  res.json({
    ok: true,
    id: queued.id,
    command: queued.command
  });
});
app.get("/api/command", function (req, res) {
  var queued = commandQueue[0] || null;
  res.json(queued || {
    id: null,
    command: null
  });
});
app.post("/api/command/ack", function (req, res) {
  var id = req.body && Number(req.body.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({
      ok: false,
      error: "Invalid command id"
    });
    return;
  }
  if (commandQueue.length && commandQueue[0].id === id) {
    commandQueue.shift();
    res.json({
      ok: true
    });
    return;
  }
  res.status(409).json({
    ok: false,
    error: "Command is no longer pending"
  });
});
app.post("/api/nowplaying", function (req, res) {
  var body = req.body;
  // {} means nothing is playing. The client sends {} rather than null, because
  // the strict JSON parser rejects a bare null body with a 400 on every poll.
  var hasFields = body && _typeof(body) === "object" && !Array.isArray(body) && Object.keys(body).length > 0;
  nowPlaying = hasFields ? body : null;
  res.json({
    ok: true
  });
});
app.get("/api/nowplaying", function (req, res) {
  res.json({
    nowPlaying: nowPlaying
  });
});
app.use(function (err, req, res, next) {
  res.status(err.status || 400).json({
    ok: false,
    error: err.message || "Bad request"
  });
});
var apps = {
  YouTube: {
    name: "YouTube",
    state: "stopped",
    allowStop: true,
    pid: null,
    additionalData: {},
    launch: function launch(launchData) {
      // In standalone mode AxoTube is already the running app, so launching
      // itself through an app-control is pointless. launchApp still sets the
      // state and returns a pid, so the DIAL handshake keeps working.
      if (global.isAxoTubeStandalone) return;
      var tbPackageId = tizenGetPackageId();
      if (!tbPackageId) return;
      var control = buildYouTubeAppControl(launchData);
      if (!control) return;
      tizenLaunchAppControl(control, "".concat(tbPackageId, ".").concat(global.isAxoTubeStandalone ? "AxoTubeStandalone" : "TizenBrewStandalone"));
    }
  }
};

// Random UUID v4 from crypto.randomBytes, which exists on Node 4. uuid.v4()
// needs crypto.getRandomValues / randomFillSync, which Node 4 lacks.
function randomUuidV4() {
  var b = crypto.randomBytes(16);
  b[6] = b[6] & 0x0f | 0x40;
  b[8] = b[8] & 0x3f | 0x80;
  var h = b.toString("hex");
  return "".concat(h.slice(0, 8), "-").concat(h.slice(8, 12), "-").concat(h.slice(12, 16), "-").concat(h.slice(16, 20), "-").concat(h.slice(20));
}
// UUID v5 (name-based, SHA-1), the same bytes the uuid package produced. The package
// is ES2015+ and does not load on Node 4, so the device identity fell back to a random
// UUID on every start. This keeps the identity stable across restarts.
function sha1Uuid(name, namespace) {
  var ns = new Buffer(namespace.replace(/-/g, ""), "hex");
  var hash = crypto.createHash("sha1").update(ns).update(new Buffer(String(name), "utf8")).digest();
  hash[6] = hash[6] & 0x0f | 0x50;
  hash[8] = hash[8] & 0x3f | 0x80;
  var h = hash.toString("hex", 0, 16);
  return "".concat(h.slice(0, 8), "-").concat(h.slice(8, 12), "-").concat(h.slice(12, 16), "-").concat(h.slice(16, 20), "-").concat(h.slice(20));
}
var deviceUuid = function () {
  try {
    var tizenid = tizen.systeminfo.getCapability("http://tizen.org/system/tizenid");
    if (tizenid) return sha1Uuid(tizenid, "4bcbc514-bdd6-4163-8215-316526fd1d9b");
  } catch (err) {
    console.warn("Could not read tizenid for stable uuid:", err.message);
  }
  return randomUuidV4();
}();
var modelName = tizenGetCapability("http://tizen.org/system/model_name");
function parseLaunchData(launchData) {
  var out = {};
  String(launchData || "").split("&").forEach(function (part) {
    if (!part) return;
    var eq = part.indexOf("=");
    var rawKey = eq === -1 ? part : part.slice(0, eq);
    var rawValue = eq === -1 ? "" : part.slice(eq + 1);
    try {
      out[decodeURIComponent(rawKey.replace(/\+/g, " "))] = decodeURIComponent(rawValue.replace(/\+/g, " "));
    } catch (err) {
      out[rawKey] = rawValue;
    }
  });
  return out;
}
var dialServer = new dial.Server({
  expressApp: app,
  port: PORT,
  prefix: "/dial",
  manufacturer: "Reis Can",
  modelName: "AxoTube",
  friendlyName: modelName ? "axotube (".concat(modelName, ")") : "axotube",
  uuid: deviceUuid,
  delegate: {
    getApp: function getApp(appName) {
      return apps[appName];
    },
    launchApp: function launchApp(appName, launchData, callback) {
      console.log("Got request to launch ".concat(appName, " with launch data: ").concat(launchData));
      var appEntry = apps[appName];
      if (!appEntry) {
        callback(null);
        return;
      }
      var parsedData = parseLaunchData(launchData);
      if (typeof parsedData.yumi !== "undefined") {
        appEntry.additionalData = parsedData;
        appEntry.state = "running";
        callback("");
        return;
      }
      appEntry.pid = "run";
      appEntry.state = "starting";
      appEntry.launch(launchData);
      appEntry.state = "running";
      callback(appEntry.pid);
    },
    stopApp: function stopApp(appName, pid, callback) {
      var appEntry = apps[appName];
      if (appEntry && appEntry.pid === pid) {
        appEntry.pid = null;
        appEntry.state = "stopped";
        callback(true);
      } else {
        callback(false);
      }
    }
  }
});
setInterval(function () {
  // No Tizen runtime (the service run with plain node on a PC): there are no
  // apps to check, so skip instead of logging the same error every 5 seconds.
  if (typeof tizen === "undefined") return;
  try {
    tizen.application.getAppsContext(function (appsContext) {
      var tbPackageId = tizenGetPackageId();
      if (!tbPackageId) return;
      var running = appsContext.find(function (entry) {
        return entry.appId === "".concat(tbPackageId, ".").concat(global.isAxoTubeStandalone ? "AxoTubeStandalone" : "TizenBrewStandalone");
      });
      if (!running) {
        apps.YouTube.state = "stopped";
        apps.YouTube.pid = null;
        apps.YouTube.additionalData = {};
      }
    });
  } catch (err) {
    console.warn("App context check failed:", err.message);
  }
}, 5000);

// Cast presence. Phones can drop the TV from their cast menu after a Wi-Fi band
// change or standby. Restarting the DIAL/SSDP advertiser makes the TV announce
// itself again, so nobody has to unplug it.
//
// dialServer.stop() sends byebye and closes the SSDP sockets only after those
// sends finish. Starting again before that close completes could let the old
// close shut the new sockets, so start waits a short gap.
var CAST_RESTART_MIN_INTERVAL_MS = 15000;
var CAST_RESTART_GAP_MS = 2000;
var WAKE_TICK_MS = 10000;
var WAKE_GAP_MS = 30000;
var dialStarted = false;
var castRestartTimer = null;
var lastCastRestartAt = 0;
function restartCastDiscovery(reason) {
  if (!dialStarted) return {
    restarted: false,
    reason: "discovery-not-running"
  };
  if (castRestartTimer) return {
    restarted: false,
    reason: "in-progress"
  };
  if (Date.now() - lastCastRestartAt < CAST_RESTART_MIN_INTERVAL_MS) {
    return {
      restarted: false,
      reason: "too-soon"
    };
  }
  lastCastRestartAt = Date.now();
  console.log("[AxoTube:service] restarting cast discovery (".concat(reason, ")"));
  try {
    dialServer.stop();
  } catch (err) {
    console.warn("[AxoTube:service] cast discovery stop failed:", err.message);
  }
  castRestartTimer = setTimeout(function () {
    castRestartTimer = null;
    try {
      dialServer.start();
    } catch (err) {
      console.warn("[AxoTube:service] cast discovery start failed:", err.message);
    }
  }, CAST_RESTART_GAP_MS);
  return {
    restarted: true,
    reason: "restarting"
  };
}
var CAST_RESTART_REASONS = ["wake", "focus", "manual"];
app.post("/api/cast/restart", function (req, res) {
  if (!isLoopback(req)) {
    res.status(403).json({
      ok: false,
      error: "Loopback only"
    });
    return;
  }
  var requested = req.body && String(req.body.reason || "");
  var reason = CAST_RESTART_REASONS.indexOf(requested) !== -1 ? requested : "manual";
  var result = restartCastDiscovery(reason);
  res.json(_objectSpread({
    ok: true
  }, result));
});

// A timer that fires long after it was due means the machine was asleep (TV
// standby). Re-announce then, even if the app is not in front.
var lastWakeTick = Date.now();
setInterval(function () {
  var now = Date.now();
  var gap = now - lastWakeTick;
  lastWakeTick = now;
  if (gap > WAKE_GAP_MS) restartCastDiscovery("wake");
}, WAKE_TICK_MS);
var dialListener = app.listen(PORT, function () {
  dialStarted = true;
  dialServer.start();
});
// Without this, a busy port (for example an earlier instance still running) is an
// unhandled 'error' event and takes the whole service down. Logging keeps the
// content proxy on 8081 alive; DIAL and phone pairing simply stay off.
dialListener.on("error", function (err) {
  console.error("[AxoTube:service] could not listen on port ".concat(PORT, ": ").concat(err.code));
  diagnostics.record("error", "control port " + PORT + " is not available (" + err.code + "); phone pairing and DIAL casting are off");
});

// Only the standalone app has a page to show toasts. The proxy reaches the queue
// through this hook, and the startup message tells the user the service is up.
if (global.isAxoTubeStandalone) {
  global.axotubeNotify = queueToast;
  queueToast("AxoTube service is running");
}