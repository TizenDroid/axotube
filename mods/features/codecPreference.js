import { configRead, configChangeEmitter } from "../config.js";

// Preferred video codec. When a family is chosen, the other families are
// refused through MediaSource.isTypeSupported, so YouTube's adaptive selection
// only sees the preferred one. Same idea as h264ify (adapted from its MIT
// licensed approach). "any" changes nothing.
//
// Read at load and applied through the MediaSource chain, so a change reloads.

const FAMILY_CODECS = {
  avc1: ["avc1"],
  vp9: ["vp09", "vp9"],
  av01: ["av01"],
};

function blockedPrefixes(preference) {
  if (!FAMILY_CODECS[preference]) return [];
  let blocked = [];
  Object.keys(FAMILY_CODECS).forEach((family) => {
    if (family !== preference) blocked = blocked.concat(FAMILY_CODECS[family]);
  });
  return blocked;
}

function installCodecPreference(preference) {
  if (!window.MediaSource || typeof MediaSource.isTypeSupported !== "function") return;
  const blocked = blockedPrefixes(preference);
  if (blocked.length === 0) return;

  const nativeIsTypeSupported = MediaSource.isTypeSupported.bind(MediaSource);
  MediaSource.isTypeSupported = function (type) {
    const lower = String(type).toLowerCase();
    if (lower.indexOf("codecs") !== -1) {
      for (let i = 0; i < blocked.length; i++) {
        if (lower.indexOf(blocked[i]) !== -1) return false;
      }
    }
    return nativeIsTypeSupported(type);
  };
}

const OWNER_KEY = "__axotubeCodecOwner";
if (!window[OWNER_KEY]) {
  window[OWNER_KEY] = true;
  try {
    installCodecPreference(configRead("videoPreferredCodec"));
  } catch (e) {
    console.warn("[AxoTube:codecPreference] Could not install codec preference:", e);
  }

  configChangeEmitter.addEventListener("configChange", (event) => {
    if ((event.detail?.key || "") === "videoPreferredCodec") {
      setTimeout(() => location.reload(), 300);
    }
  });
}
