const dial = require("@patrickkfkan/peer-dial");
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const uuid = require("uuid");
const configSchema = require("../config-schema.json");
const { webConfigPage } = require("./webConfigPage.js");
const app = express();

function tizenGetCapability(capability) {
  try {
    return tizen.systeminfo.getCapability(capability);
  } catch (err) {
    console.warn("tizen.systeminfo.getCapability failed:", err.message);
    return "";
  }
}

function tizenGetPackageId() {
  try {
    return tizen.application.getAppInfo().packageId;
  } catch (err) {
    console.warn("tizen.application.getAppInfo failed:", err.message);
    return null;
  }
}

function tizenLaunchAppControl(appControl, appId) {
  try {
    tizen.application.launchAppControl(appControl, appId);
    return true;
  } catch (err) {
    console.warn("tizen.application.launchAppControl failed:", err.message);
    return false;
  }
}

function buildYouTubeAppControl(launchData) {
  try {
    return new tizen.ApplicationControl(
      "http://tizen.org/appcontrol/operation/view",
      null,
      null,
      null,
      [
        new tizen.ApplicationControlData("module", [
          JSON.stringify({
            moduleName: "@foxreis/tizentube",
            moduleType: "npm",
            args: launchData,
          }),
        ]),
      ],
    );
  } catch (err) {
    console.warn("Could not build Tizen app control:", err.message);
    return null;
  }
}

app.use(
  cors({
    origin: "*",
    methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
    credentials: false,
    optionsSuccessStatus: 204,
  }),
);
app.use(express.json({ limit: "64kb" }));

const PORT = 8085;
const STORE_DIR = (() => {
  try {
    fs.accessSync(__dirname, fs.constants.W_OK);
    return __dirname;
  } catch (err) {
    return os.tmpdir();
  }
})();
const STORE_PATH = path.join(STORE_DIR, "axotube-config-store.json");
const STORE_TMP_PATH = `${STORE_PATH}.tmp`;

function newToken() {
  return crypto.randomBytes(32).toString("hex");
}

function newPairingCode() {
  const n = crypto.randomBytes(4).readUInt32BE(0) % 1000000;
  return String(n).padStart(6, "0");
}

function validateConfigValue(key, value) {
  const defaults = configSchema.defaults;
  if (!Object.prototype.hasOwnProperty.call(defaults, key)) return false;
  const expected = defaults[key];
  if (expected === null) return value === null || typeof value === "string";
  if (Array.isArray(expected)) {
    return Array.isArray(value) && value.every((item) => typeof item === "string");
  }
  if (typeof expected === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) return false;
    const range = configSchema.ranges[key];
    return !range || (value >= range[0] && value <= range[1]);
  }
  if (typeof value !== typeof expected) return false;
  const allowed = configSchema.enums[key];
  if (allowed && !allowed.includes(value)) return false;
  if (key === "routeColor" && !/^#[0-9a-f]{6}$/i.test(value)) return false;
  if (key === "routeBackgroundUrl" && value) {
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    } catch (err) {
      return false;
    }
  }
  return true;
}

function sanitizeConfig(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out = {};
  for (const key of Object.keys(value)) {
    if (!validateConfigValue(key, value[key])) return null;
    out[key] = value[key];
  }
  return out;
}

function migrateStoredConfig(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out = {};
  for (const key of Object.keys(value)) {
    let candidate = value[key];

    // Older Web Config builds could persist this command as an object while
    // the TV-side settings format has always been a serialized command.
    if (
      key === "launchToOnStartup" &&
      candidate &&
      typeof candidate === "object" &&
      !Array.isArray(candidate)
    ) {
      try {
        candidate = JSON.stringify(candidate);
      } catch (err) {
        continue;
      }
    }

    // Migration is intentionally tolerant: preserve every independently valid
    // setting and ignore only stale/unknown/invalid entries. Live API writes
    // continue to use sanitizeConfig(), which stays strict.
    if (!validateConfigValue(key, candidate)) continue;
    out[key] = candidate;
  }
  return out;
}

function loadStore() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
    if (parsed && typeof parsed === "object") {
      return {
        config: migrateStoredConfig(parsed.config),
        revision: typeof parsed.revision === "number" ? parsed.revision : 0,
        authToken:
          typeof parsed.authToken === "string" && parsed.authToken.length >= 32
            ? parsed.authToken
            : newToken(),
      };
    }
  } catch (err) {}
  return { config: {}, revision: 0, authToken: newToken() };
}

const initialStore = loadStore();
let storedConfig = initialStore.config;
let configRevision = initialStore.revision;
let authToken = initialStore.authToken;
let pairingCode = newPairingCode();

function saveStore() {
  try {
    const body = JSON.stringify({
      config: storedConfig,
      revision: configRevision,
      authToken,
    });
    fs.writeFileSync(STORE_TMP_PATH, body, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(STORE_TMP_PATH, STORE_PATH);
  } catch (err) {
    try {
      if (fs.existsSync(STORE_TMP_PATH)) fs.unlinkSync(STORE_TMP_PATH);
    } catch (e) {}
    console.warn("Failed to persist config store:", err.message);
  }
}
saveStore();

function remoteAddress(req) {
  return String(req.socket?.remoteAddress || req.connection?.remoteAddress || "");
}

function isLoopback(req) {
  const addr = remoteAddress(req).toLowerCase();
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
}

function safeTokenEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch (err) {
    return false;
  }
}

function suppliedToken(req) {
  const auth = String(req.get("authorization") || "");
  if (auth.indexOf("Bearer ") === 0) return auth.slice(7).trim();
  return String(req.get("x-axotube-token") || "").trim();
}

function requireApiAuth(req, res, next) {
  if (isLoopback(req) || safeTokenEqual(suppliedToken(req), authToken)) return next();
  res.status(401).json({ ok: false, error: "Pairing required" });
}

let pairWindowStarted = 0;
let pairAttempts = 0;
function allowPairAttempt() {
  const now = Date.now();
  if (now - pairWindowStarted > 60 * 1000) {
    pairWindowStarted = now;
    pairAttempts = 0;
  }
  pairAttempts += 1;
  return pairAttempts <= 10;
}

app.get("/", (req, res) => {
  res.type("html").send(webConfigPage);
});

app.get("/api/pairing-code", (req, res) => {
  if (!isLoopback(req)) {
    res.status(403).json({ ok: false, error: "Loopback only" });
    return;
  }
  res.json({ ok: true, code: pairingCode });
});

app.post("/api/pair", (req, res) => {
  if (!allowPairAttempt()) {
    res.status(429).json({ ok: false, error: "Too many pairing attempts" });
    return;
  }
  const code = req.body && String(req.body.code || "").trim();
  if (!code || code !== pairingCode) {
    res.status(403).json({ ok: false, error: "Invalid pairing code" });
    return;
  }
  pairAttempts = 0;
  pairWindowStarted = Date.now();
  res.json({ ok: true, token: authToken });
});

app.use("/api", requireApiAuth);

app.get("/api/config", (req, res) => {
  res.json({ revision: configRevision, config: storedConfig });
});

app.post("/api/config", (req, res) => {
  const clean = sanitizeConfig(req.body);
  if (!clean) {
    res.status(400).json({ ok: false, error: "Invalid config payload" });
    return;
  }
  storedConfig = clean;
  configRevision += 1;
  saveStore();
  res.json({ ok: true, revision: configRevision });
});

app.post("/api/config/push", (req, res) => {
  const body = req.body;
  const rev = body && typeof body.revision === "number" ? body.revision : -1;
  const clean = body ? sanitizeConfig(body.config) : null;
  if (!clean) {
    res.status(400).json({ ok: false, error: "Invalid config push" });
    return;
  }
  if (rev === configRevision) {
    storedConfig = clean;
    saveStore();
  }
  res.json({ ok: true, revision: configRevision });
});

const MAX_COMMAND_QUEUE = 50;
let commandQueue = [];
let nextCommandId = 1;
let nowPlaying = null;

function normalizeCommand(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const { action, videoId, playlistId, query, browseId } = body;
  if (action === "play" && typeof videoId === "string" && videoId.trim()) {
    return {
      action: "play",
      videoId: videoId.trim(),
      playlistId: typeof playlistId === "string" && playlistId ? playlistId : undefined,
    };
  }
  if (action === "search" && typeof query === "string" && query.trim()) {
    return { action: "search", query: query.trim() };
  }
  if (action === "browse" && typeof browseId === "string" && browseId.trim()) {
    return { action: "browse", browseId: browseId.trim() };
  }
  if (action === "reload") return { action: "reload" };
  return null;
}

app.post("/api/command", (req, res) => {
  const command = normalizeCommand(req.body);
  if (!command) {
    res.status(400).json({ ok: false, error: "Unsupported command" });
    return;
  }
  if (commandQueue.length >= MAX_COMMAND_QUEUE) {
    res.status(429).json({ ok: false, error: "Command queue full" });
    return;
  }
  const queued = { id: nextCommandId++, command };
  commandQueue.push(queued);
  res.json({ ok: true, id: queued.id, command: queued.command });
});

app.get("/api/command", (req, res) => {
  const queued = commandQueue[0] || null;
  res.json(queued || { id: null, command: null });
});

app.post("/api/command/ack", (req, res) => {
  const id = req.body && Number(req.body.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ ok: false, error: "Invalid command id" });
    return;
  }
  if (commandQueue.length && commandQueue[0].id === id) {
    commandQueue.shift();
    res.json({ ok: true });
    return;
  }
  res.status(409).json({ ok: false, error: "Command is no longer pending" });
});

app.post("/api/nowplaying", (req, res) => {
  const body = req.body;
  nowPlaying = body && typeof body === "object" && !Array.isArray(body) ? body : null;
  res.json({ ok: true });
});

app.get("/api/nowplaying", (req, res) => {
  res.json({ nowPlaying });
});

app.use((err, req, res, next) => {
  res.status(err.status || 400).json({ ok: false, error: err.message || "Bad request" });
});

const apps = {
  YouTube: {
    name: "YouTube",
    state: "stopped",
    allowStop: true,
    pid: null,
    additionalData: {},
    launch(launchData) {
      const tbPackageId = tizenGetPackageId();
      if (!tbPackageId) return;
      const control = buildYouTubeAppControl(launchData);
      if (!control) return;
      tizenLaunchAppControl(
        control,
        `${tbPackageId}.${global.isAxoTubeStandalone ? "AxoTubeStandalone" : "TizenBrewStandalone"}`,
      );
    },
  },
};

const deviceUuid = (() => {
  try {
    const tizenid = tizen.systeminfo.getCapability("http://tizen.org/system/tizenid");
    if (tizenid) return uuid.v5(tizenid, "4bcbc514-bdd6-4163-8215-316526fd1d9b");
  } catch (err) {
    console.warn("Could not read tizenid for stable uuid:", err.message);
  }
  return uuid.v4();
})();

const modelName = tizenGetCapability("http://tizen.org/system/model_name");

function parseLaunchData(launchData) {
  const out = {};
  String(launchData || "")
    .split("&")
    .forEach((part) => {
      if (!part) return;
      const eq = part.indexOf("=");
      const rawKey = eq === -1 ? part : part.slice(0, eq);
      const rawValue = eq === -1 ? "" : part.slice(eq + 1);
      try {
        out[decodeURIComponent(rawKey.replace(/\+/g, " "))] = decodeURIComponent(rawValue.replace(/\+/g, " "));
      } catch (err) {
        out[rawKey] = rawValue;
      }
    });
  return out;
}

const dialServer = new dial.Server({
  expressApp: app,
  port: PORT,
  prefix: "/dial",
  manufacturer: "Reis Can",
  modelName: "TizenBrew",
  friendlyName: modelName ? `axotube (${modelName})` : "axotube",
  uuid: deviceUuid,
  delegate: {
    getApp(appName) {
      return apps[appName];
    },
    launchApp(appName, launchData, callback) {
      console.log(`Got request to launch ${appName} with launch data: ${launchData}`);
      const appEntry = apps[appName];
      if (!appEntry) {
        callback(null);
        return;
      }
      const parsedData = parseLaunchData(launchData);
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
    stopApp(appName, pid, callback) {
      const appEntry = apps[appName];
      if (appEntry && appEntry.pid === pid) {
        appEntry.pid = null;
        appEntry.state = "stopped";
        callback(true);
      } else {
        callback(false);
      }
    },
  },
});

setInterval(() => {
  try {
    tizen.application.getAppsContext((appsContext) => {
      const tbPackageId = tizenGetPackageId();
      if (!tbPackageId) return;
      const running = appsContext.find(
        (entry) =>
          entry.appId ===
          `${tbPackageId}.${global.isAxoTubeStandalone ? "AxoTubeStandalone" : "TizenBrewStandalone"}`,
      );
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

app.listen(PORT, () => {
  dialServer.start();
});