// Web config sync + phone control bridge.
import {
  configRead,
  configWrite,
  configSnapshot,
  nativeJSONStringify,
  configChangeEmitter,
} from "../config.js";
import resolveCommand from "../resolveCommand.js";
import { showToast } from "../ui/ytUI.js";
import { fetchWithTimeout } from "../shared/fetch.js";

const WEB_CONFIG_URL = "http://127.0.0.1:8085";
const POLL_INTERVAL_MS = 5000;

let appliedRevision = -1;
let configSyncing = false;
let commandPolling = false;
let nowPlayingPushing = false;
let lastPushed = "";
let lastNowPlaying = "";
let pushTimer = null;
let serviceToastShown = false;
let pairingCodeShown = false;

function isTizen() {
  return typeof window !== "undefined" && window.h5vcc && window.h5vcc.tizentube;
}

function hasResolver() {
  if (typeof window === "undefined" || !window._yttv) return false;
  try {
    for (const key in window._yttv) {
      const candidate = window._yttv[key];
      if (candidate && candidate.instance && typeof candidate.instance.resolveCommand === "function") return true;
    }
  } catch (err) {}
  return false;
}

function showPairingCode() {
  if (pairingCodeShown || !hasResolver()) return;
  fetchWithTimeout(`${WEB_CONFIG_URL}/api/pairing-code`)
    .then((res) => {
      if (!res.ok) throw new Error(`pairing code HTTP ${res.status}`);
      return res.json();
    })
    .then((data) => {
      if (!data || !data.code || pairingCodeShown) return;
      pairingCodeShown = true;
      try {
        showToast("axotube", `Phone pairing code: ${data.code}`);
      } catch (err) {}
    })
    .catch(() => {});
}

function showServiceToast() {
  if (serviceToastShown || !isTizen() || !hasResolver()) return;
  try {
    showToast("axotube", "Service connected");
    serviceToastShown = true;
    setTimeout(showPairingCode, 1200);
  } catch (err) {}
}

function valuesEqual(a, b) {
  if (a === b) return true;
  try { return nativeJSONStringify(a) === nativeJSONStringify(b); } catch (err) { return false; }
}

function pushIfChanged() {
  if (!isTizen() || configSyncing) return;
  let serialized;
  try {
    serialized = nativeJSONStringify({ revision: appliedRevision, config: configSnapshot() });
  } catch (err) {
    return;
  }
  if (typeof serialized !== "string" || serialized === lastPushed) return;

  lastPushed = serialized;
  configSyncing = true;
  fetchWithTimeout(`${WEB_CONFIG_URL}/api/config/push`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: serialized,
  })
    .then((res) => {
      if (!res.ok) throw new Error(`config push HTTP ${res.status}`);
    })
    .catch(() => { lastPushed = ""; })
    .then(() => { configSyncing = false; });
}

function schedulePush() {
  if (!isTizen()) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushIfChanged, 250);
}
configChangeEmitter.addEventListener("configChange", schedulePush);

function pullAndApply() {
  if (!isTizen() || configSyncing) return;
  configSyncing = true;
  fetchWithTimeout(`${WEB_CONFIG_URL}/api/config`)
    .then((res) => {
      if (!res.ok) throw new Error(`config pull HTTP ${res.status}`);
      return res.json();
    })
    .then((data) => {
      if (!data || typeof data.revision !== "number") return;
      showServiceToast();
      if (data.revision === appliedRevision) return;
      appliedRevision = data.revision;
      const remote = data.config;
      if (!remote || typeof remote !== "object" || Array.isArray(remote)) return;
      Object.keys(remote).forEach((key) => {
        if (typeof remote[key] === "undefined") return;
        try {
          if (!valuesEqual(configRead(key), remote[key])) configWrite(key, remote[key]);
        } catch (err) {}
      });
    })
    .catch(() => {})
    .then(() => {
      configSyncing = false;
      pushIfChanged();
    });
}

function buildCommand(command) {
  if (!command || typeof command !== "object") return null;
  if (command.action === "play" && command.videoId) {
    const watch = { videoId: command.videoId };
    if (command.playlistId) watch.playlistId = command.playlistId;
    return { watchEndpoint: watch };
  }
  if (command.action === "search" && command.query) return { searchEndpoint: { query: command.query } };
  if (command.action === "browse" && command.browseId) return { browseEndpoint: { browseId: command.browseId } };
  return null;
}

function dispatchWhenReady(cmd) {
  return new Promise((resolve) => {
    if (!cmd) return resolve(false);
    let attempts = 0;
    const attempt = () => {
      if (hasResolver()) {
        try {
          resolveCommand(cmd);
          resolve(true);
        } catch (err) {
          resolve(false);
        }
        return;
      }
      attempts += 1;
      if (attempts > 50) return resolve(false);
      setTimeout(attempt, 200);
    };
    attempt();
  });
}

function ackCommand(id) {
  if (!id) return Promise.resolve();
  return fetchWithTimeout(`${WEB_CONFIG_URL}/api/command/ack`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: nativeJSONStringify({ id }),
  }).catch(() => {});
}

function consumeCommand() {
  if (!isTizen() || commandPolling) return;
  commandPolling = true;
  fetchWithTimeout(`${WEB_CONFIG_URL}/api/command`)
    .then((res) => res.json())
    .then((data) => {
      if (!data || !data.command) return;
      const id = data.id;
      if (data.command.action === "reload") {
        return ackCommand(id).then(() => {
          try { window.location.reload(); } catch (err) {}
        });
      }
      const cmd = buildCommand(data.command);
      if (!cmd) return;
      return dispatchWhenReady(cmd).then((ok) => {
        if (!ok) return;
        try { showToast("axotube", "Command received"); } catch (err) {}
        return ackCommand(id);
      });
    })
    .catch(() => {})
    .then(() => { commandPolling = false; });
}

function pushNowPlaying() {
  if (!isTizen() || nowPlayingPushing) return;
  let info = null;
  try {
    const video = document.querySelector("video");
    if (video && video.currentSrc) {
      const match = location.hash.match(/[?&]v=([^&]+)/);
      info = {
        videoId: match ? match[1] : null,
        title: document.querySelector("ytlr-player-header-title")?.textContent || document.title,
        state: video.paused ? "paused" : "playing",
        progress: video.currentTime,
        duration: video.duration,
      };
    }
  } catch (err) {
    return;
  }

  const serialized = info ? nativeJSONStringify(info) : "none";
  if (serialized === lastNowPlaying) return;
  lastNowPlaying = serialized;
  nowPlayingPushing = true;
  fetchWithTimeout(`${WEB_CONFIG_URL}/api/nowplaying`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: serialized === "none" ? "null" : serialized,
  })
    .catch(() => { lastNowPlaying = ""; })
    .then(() => { nowPlayingPushing = false; });
}

setTimeout(() => {
  pullAndApply();
  consumeCommand();
  pushNowPlaying();
  setInterval(() => {
    pullAndApply();
    consumeCommand();
    pushNowPlaying();
  }, POLL_INTERVAL_MS);
}, 3000);
