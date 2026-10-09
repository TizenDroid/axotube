// Web config sync + phone control bridge.
import {
  configRead,
  configWrite,
  configSnapshot,
  nativeJSONStringify,
  configChangeEmitter,
} from "../config.js";
import { hasNativeResolver, dispatchNativeCommandWhenReady } from "../shared/nativeCommand.js";
import { showToast } from "../ui/ytUI.js";
import { fetchWithTimeout } from "../shared/fetch.js";

const WEB_CONFIG_URL = "http://127.0.0.1:8085";
const POLL_INTERVAL_MS = 5000;

let appliedRevision = -1;
let configSyncing = false;
let commandPolling = false;
let nowPlayingPushing = false;
let serverConfig = null;
const dirtyKeys = new Set();
let applyingServerConfig = false;
let lastNowPlaying = "";
let pushTimer = null;
let serviceToastShown = false;
let pairingCodeShown = false;
let lastExecutedCommandId = null;
let lastExecutedCommandNeedsReload = false;

function isTizen() {
  return typeof window !== "undefined" && window.h5vcc && window.h5vcc.tizentube;
}

const hasResolver = hasNativeResolver;
const dispatchWhenReady = dispatchNativeCommandWhenReady;

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
        const url = Array.isArray(data.urls) && data.urls.length ? data.urls[0] : null;
        showToast(
          "axotube Web Config",
          url ? `Open ${url} on your phone · code ${data.code}` : `Phone pairing code: ${data.code}`,
        );
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

function differsFromServer(snapshot) {
  if (!serverConfig) return false;
  const localKeys = Object.keys(snapshot);
  const remoteKeys = Object.keys(serverConfig);
  return localKeys.length !== remoteKeys.length || localKeys.some((key) =>
    !Object.prototype.hasOwnProperty.call(serverConfig, key) ||
    !valuesEqual(snapshot[key], serverConfig[key]));
}

function pushIfChanged() {
  if (!isTizen() || configSyncing || appliedRevision < 0 || !serverConfig) return;
  const snapshot = configSnapshot();
  if (!differsFromServer(snapshot)) {
    dirtyKeys.clear();
    return;
  }

  configSyncing = true;
  fetchWithTimeout(`${WEB_CONFIG_URL}/api/config/push`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: nativeJSONStringify({ revision: appliedRevision, config: snapshot }),
  })
    .then((res) => {
      if (res.status === 409) return { conflict: true };
      if (!res.ok) throw new Error(`config push HTTP ${res.status}`);
      return res.json();
    })
    .then((data) => {
      if (data?.conflict) return "conflict";
      if (!data || !data.applied || !Number.isSafeInteger(data.revision)) {
        throw new Error("Config push was not acknowledged");
      }
      appliedRevision = data.revision;
      serverConfig = snapshot;
      const current = configSnapshot();
      for (const key of dirtyKeys) {
        if (valuesEqual(current[key], snapshot[key])) dirtyKeys.delete(key);
      }
      return "accepted";
    })
    .catch(() => "failed")
    .then((outcome) => {
      configSyncing = false;
      if (outcome === "conflict") pullAndApply();
      else if (outcome === "accepted" && differsFromServer(configSnapshot())) schedulePush();
    });
}

function schedulePush() {
  if (!isTizen()) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushIfChanged, 250);
}
configChangeEmitter.addEventListener("configChange", (event) => {
  if (applyingServerConfig) return;
  if (typeof event?.detail?.key === "string") dirtyKeys.add(event.detail.key);
  schedulePush();
});

function pullAndApply() {
  if (!isTizen() || configSyncing) return;
  configSyncing = true;
  fetchWithTimeout(`${WEB_CONFIG_URL}/api/config`)
    .then((res) => {
      if (!res.ok) throw new Error(`config pull HTTP ${res.status}`);
      return res.json();
    })
    .then((data) => {
      if (!data || !Number.isSafeInteger(data.revision) || data.revision < 0 ||
          !data.config || typeof data.config !== "object" || Array.isArray(data.config)) return;
      showServiceToast();
      const remote = data.config;
      // On a stale push, preserve only keys edited locally. Everything else
      // comes from the latest server snapshot before a new full push is sent.
      applyingServerConfig = true;
      try {
        Object.keys(remote).forEach((key) => {
          if (dirtyKeys.has(key) || typeof remote[key] === "undefined") return;
          try {
            if (!valuesEqual(configRead(key), remote[key])) configWrite(key, remote[key]);
          } catch (err) {}
        });
      } finally {
        applyingServerConfig = false;
      }
      const current = configSnapshot();
      Object.keys(current).forEach((key) => {
        if (!Object.prototype.hasOwnProperty.call(remote, key)) dirtyKeys.add(key);
        else if (valuesEqual(current[key], remote[key])) dirtyKeys.delete(key);
      });
      serverConfig = remote;
      appliedRevision = data.revision;
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

function ackCommand(id) {
  if (!id) return Promise.resolve(false);
  return fetchWithTimeout(`${WEB_CONFIG_URL}/api/command/ack`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: nativeJSONStringify({ id }),
  })
    .then((res) => {
      if (!res.ok) throw new Error(`command ACK HTTP ${res.status}`);
      return true;
    })
    .catch(() => false);
}

function acknowledgeExecutedCommand(id) {
  return ackCommand(id).then((acked) => {
    if (!acked || lastExecutedCommandId !== id) return acked;
    const shouldReload = lastExecutedCommandNeedsReload;
    lastExecutedCommandId = null;
    lastExecutedCommandNeedsReload = false;
    if (shouldReload) {
      try { window.location.reload(); } catch (err) {}
    }
    return true;
  });
}

function consumeCommand() {
  if (!isTizen() || commandPolling) return;
  commandPolling = true;
  fetchWithTimeout(`${WEB_CONFIG_URL}/api/command`)
    .then((res) => {
      if (!res.ok) throw new Error(`command poll HTTP ${res.status}`);
      return res.json();
    })
    .then((data) => {
      if (!data || !data.command || !data.id) return;
      const id = data.id;

      if (data.id === lastExecutedCommandId) {
        return acknowledgeExecutedCommand(id);
      }

      if (data.command.action === "reload") {
        lastExecutedCommandId = id;
        lastExecutedCommandNeedsReload = true;
        return acknowledgeExecutedCommand(id);
      }

      const cmd = buildCommand(data.command);
      if (!cmd) return;
      return dispatchWhenReady(cmd).then((ok) => {
        if (!ok) return;
        lastExecutedCommandId = id;
        lastExecutedCommandNeedsReload = false;
        try { showToast("axotube", "Command received"); } catch (err) {}
        return acknowledgeExecutedCommand(id);
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
    .then((res) => {
      if (!res.ok) throw new Error(`now playing HTTP ${res.status}`);
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
