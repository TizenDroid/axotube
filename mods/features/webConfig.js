import { nativeHost } from "../shared/nativeHost.js";
// Web config sync + phone control bridge.
import { t } from "i18next";
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
import { setPairingInfo, pairingInfoAge } from "../shared/pairingInfo.js";

const WEB_CONFIG_URL = "http://127.0.0.1:8090";
const POLL_INTERVAL_MS = 5000;
// How often the pairing code is re-read while the service answers. It changes only
// when the service restarts, but the phone address can change with the network.
const PAIRING_REFRESH_MS = 60000;

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

// True when the AxoTube service answers from this page. Decided by what the
// environment provides, not by the user agent: the proxy marks every page it
// serves (APK and WGT alike); the native host and the Tizen web API cover the
// Tizen module. Youtube.com with Tampermonkey has none of these, so it stays off.
function serviceHost() {
  if (typeof window === "undefined") return false;
  return typeof window.__axotubeServiceUrl === "string" || !!nativeHost() || typeof window.tizen !== "undefined";
}

const hasResolver = hasNativeResolver;
const dispatchWhenReady = dispatchNativeCommandWhenReady;

// Reads the pairing code and phone addresses into the settings panel's store.
// Never throws: a missing service just leaves the store empty.
function fetchPairingInfo() {
  return fetchWithTimeout(`${WEB_CONFIG_URL}/api/pairing-code`)
    .then((res) => {
      if (!res.ok) throw new Error(`pairing code HTTP ${res.status}`);
      return res.json();
    })
    .then((data) => {
      setPairingInfo(data);
      return data;
    })
    .catch(() => {
      setPairingInfo(null);
      return null;
    });
}

function showPairingCode() {
  if (pairingCodeShown || !hasResolver()) return;
  fetchPairingInfo().then((data) => {
      if (!data || !data.code || pairingCodeShown) return;
      pairingCodeShown = true;
      try {
        const url = Array.isArray(data.urls) && data.urls.length ? data.urls[0] : null;
        showToast(
          t("app.name"),
          url
            ? t("toasts.pairingWithUrl", { url, code: data.code })
            : t("toasts.pairingCodeOnly", { code: data.code }),
        );
      } catch (err) {}
  });
}

function showServiceToast() {
  if (serviceToastShown || !serviceHost() || !hasResolver()) return;
  try {
    showToast(t("app.name"), t("toasts.serviceConnected"));
    serviceToastShown = true;
    setTimeout(showPairingCode, 1200);
  } catch (err) {}
}

function valuesEqual(a, b) {
  if (a === b) return true;
  try {
    return nativeJSONStringify(a) === nativeJSONStringify(b);
  } catch (err) {
    return false;
  }
}

function differsFromServer(snapshot) {
  if (!serverConfig) return false;
  const localKeys = Object.keys(snapshot);
  const remoteKeys = Object.keys(serverConfig);
  return (
    localKeys.length !== remoteKeys.length ||
    localKeys.some(
      (key) =>
        !Object.prototype.hasOwnProperty.call(serverConfig, key) ||
        !valuesEqual(snapshot[key], serverConfig[key]),
    )
  );
}

function pushIfChanged() {
  if (!serviceHost() || configSyncing || appliedRevision < 0 || !serverConfig) return;
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
  if (!serviceHost()) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushIfChanged, 250);
}
configChangeEmitter.addEventListener("configChange", (event) => {
  if (applyingServerConfig) return;
  if (typeof event?.detail?.key === "string") dirtyKeys.add(event.detail.key);
  schedulePush();
});

function pullAndApply() {
  if (!serviceHost() || configSyncing) return;
  configSyncing = true;
  fetchWithTimeout(`${WEB_CONFIG_URL}/api/config`)
    .then((res) => {
      if (!res.ok) throw new Error(`config pull HTTP ${res.status}`);
      return res.json();
    })
    .then((data) => {
      if (
        !data ||
        !Number.isSafeInteger(data.revision) ||
        data.revision < 0 ||
        !data.config ||
        typeof data.config !== "object" ||
        Array.isArray(data.config)
      )
        return;
      showServiceToast();
      pollFailures = 0;
      const remote = data.config;
      // On a stale push, preserve only keys edited locally. Everything else
      // comes from the latest server snapshot before a new full push is sent.
      applyingServerConfig = true;
      let appliedSuccessfully = true;
      try {
        Object.keys(remote).forEach((key) => {
          if (dirtyKeys.has(key) || typeof remote[key] === "undefined") return;
          try {
            if (!valuesEqual(configRead(key), remote[key]) && !configWrite(key, remote[key])) {
              appliedSuccessfully = false;
            }
          } catch (err) {
            appliedSuccessfully = false;
          }
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
      if (appliedSuccessfully) appliedRevision = data.revision;
    })
    .catch(() => {
      // Service unreachable: the poll loop backs off instead of hammering it.
      pollFailures += 1;
    })
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
  if (command.action === "search" && command.query)
    return { searchEndpoint: { query: command.query } };
  if (command.action === "browse" && command.browseId)
    return { browseEndpoint: { browseId: command.browseId } };
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
      try {
        window.location.reload();
      } catch (err) {}
    }
    return true;
  });
}

function consumeCommand() {
  if (!serviceHost() || commandPolling) return;
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

      // Service messages (update check, startup). They never reload or navigate.
      if (data.command.action === "toast") {
        lastExecutedCommandId = id;
        lastExecutedCommandNeedsReload = false;
        try {
          showToast(t("app.name"), String(data.command.text || "").slice(0, 200));
        } catch (err) {}
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
        try {
          showToast(t("app.name"), t("toasts.commandReceived"));
        } catch (err) {}
        return acknowledgeExecutedCommand(id);
      });
    })
    .catch(() => {})
    .then(() => {
      commandPolling = false;
    });
}

function pushNowPlaying() {
  if (!serviceHost() || nowPlayingPushing) return;
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
    body: serialized === "none" ? "{}" : serialized,
  })
    .then((res) => {
      if (!res.ok) throw new Error(`now playing HTTP ${res.status}`);
    })
    .catch(() => {
      lastNowPlaying = "";
    })
    .then(() => {
      nowPlayingPushing = false;
    });
}

// Poll every POLL_INTERVAL_MS while the service answers. Each failed pull
// doubles the wait (capped), so a missing service or phone costs little.
const MAX_POLL_INTERVAL_MS = 30000;
let pollFailures = 0;

function nextPollDelayMs() {
  if (pollFailures === 0) return POLL_INTERVAL_MS;
  const backoff = POLL_INTERVAL_MS * Math.pow(2, Math.min(pollFailures, 3));
  return Math.min(backoff, MAX_POLL_INTERVAL_MS);
}

function pollOnce() {
  pullAndApply();
  consumeCommand();
  pushNowPlaying();
  // Own timer, not gated on pollFailures: one failed config pull must not leave the
  // phone-sync code empty for as long as the pulls keep failing.
  if (serviceHost() && pairingInfoAge() > PAIRING_REFRESH_MS) fetchPairingInfo();
  setTimeout(pollOnce, nextPollDelayMs());
}

setTimeout(pollOnce, 3000);
