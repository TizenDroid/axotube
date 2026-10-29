import { configRead, configChangeEmitter } from "../config.js";

// Experimental: lets YouTube offer 1440p and 2160p on a TV whose screen is
// smaller. Ported from VacuumTube (h5vcc container size override and the
// MediaSource.isTypeSupported checks), which it reads as the TV's real
// capability. Off by default, and separate from the preferred quality setting.
//
// Two parts, both read once at load, so a change reloads the app:
//  1. YouTube sizes its offered formats from the video container size. The
//     TV screen is usually 1920x1080, so 1440p and 2160p never appear in the
//     list and the quality setting silently falls back. Reporting a larger
//     container makes them available.
//  2. Chromium accepts every mime parameter and ignores width, height, frame
//     rate and so on. YouTube reads that as "no HFR/HDR support" and caps at
//     720p30. Sane values are kept and absurd ones rejected, as on Cobalt.
//
// Whether the TV can actually decode the chosen resolution is not checked
// here. A 2160p VP9 stream can stutter on a Full HD model, which is why the
// cap defaults to 1440p.

const CAP_SIZES = { "1440p": "2560x1440", "2160p": "3840x2160" };

const checks = {
  width: (value) => Number(value) > 0 && Number(value) <= 7680,
  height: (value) => Number(value) > 0 && Number(value) <= 4320,
  framerate: (value) => Number(value) > 0 && Number(value) <= 60,
  bitrate: (value) => Number(value) > 0 && Number(value) <= 200000000,
  eotf: (value) =>
    value === "bt709" || ((value === "smpte2084" || value === "arib-std-b67") && isHdrDisplay()),
  channels: (value) => Number(value) > 0 && Number(value) <= 8,
  cryptoblockformat: (value) => value === "subsample",
  "decode-to-texture": (value) => value === "true" || value === "false",
};

function isHdrDisplay() {
  return !!(window.matchMedia && window.matchMedia("(dynamic-range: high)").matches);
}

function isHdrCodec(codec) {
  const parts = codec.split(".");
  const transfer =
    parts[0] === "vp09" ? parts[6] : parts[0] === "av01" ? parts[7] : undefined;
  return transfer === "16" || transfer === "18";
}

function installContainerOverride() {
  window.h5vcc = window.h5vcc || {};
  window.h5vcc.system = window.h5vcc.system || {};
  window.h5vcc.system.getVideoContainerSizeOverride = function () {
    const cap = configRead("experimentalMaxResolution");
    return CAP_SIZES[cap] || CAP_SIZES["1440p"];
  };
}

function installCapabilityChecks() {
  if (!window.MediaSource || typeof MediaSource.isTypeSupported !== "function") return;
  const nativeIsTypeSupported = MediaSource.isTypeSupported.bind(MediaSource);

  MediaSource.isTypeSupported = function (type) {
    const parts = String(type).split(";");
    const kept = [parts[0].trim()];

    for (let i = 1; i < parts.length; i++) {
      const param = parts[i].trim();
      const eq = param.indexOf("=");
      const key = (eq === -1 ? param : param.slice(0, eq)).trim().toLowerCase();
      const value = (eq === -1 ? "" : param.slice(eq + 1))
        .trim()
        .replace(/^"|"$/g, "");

      if (key === "codecs") {
        const codecs = value.split(",");
        for (let c = 0; c < codecs.length; c++) {
          if (isHdrCodec(codecs[c].trim()) && !isHdrDisplay()) return false;
        }
        kept.push(param);
      } else if (checks[key]) {
        // Sane values are validated above and then dropped, so the native check
        // sees only the base type and codecs. Absurd values are rejected.
        if (!checks[key](value)) return false;
      } else {
        kept.push(param);
      }
    }

    return nativeIsTypeSupported(kept.join("; "));
  };
}

// Installed once, by whichever bundle loads first. The early bundle wins when
// the proxy injects it, so the late userscript does not wrap things again.
const OWNER_KEY = "__axotubeResolutionOwner";
if (!window[OWNER_KEY]) {
  window[OWNER_KEY] = true;
  if (configRead("enableExperimentalResolution")) {
    try {
      installContainerOverride();
      installCapabilityChecks();
    } catch (e) {
      console.warn("[AxoTube:experimentalResolution] Could not install overrides:", e);
    }
  }

  // Both settings are read at load, so a change restarts the app to apply it.
  // The max setting only matters while the unlock is on, so it does not reload
  // otherwise.
  configChangeEmitter.addEventListener("configChange", (event) => {
    const key = event.detail?.key || "";
    if (key === "enableExperimentalResolution") {
      setTimeout(() => location.reload(), 300);
    } else if (key === "experimentalMaxResolution" && configRead("enableExperimentalResolution")) {
      setTimeout(() => location.reload(), 300);
    }
  });
}
