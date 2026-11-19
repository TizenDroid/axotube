import { configRead, configChangeEmitter } from "../config.js";
import { getCurrentPlayer, watchPlayer, watchVideoId } from "../shared/playerLifecycle.js";

const EVENTS = { YT_STATE_CHANGE: "onStateChange", CONFIG_CHANGE: "configChange" };
const CONFIG_KEYS = { QUALITY: "preferredVideoQuality", PREVIEW_CAP: "previewMaxQuality" };
// A preview on a browse page is capped here. The watch page keeps the preferred quality.
function onWatchRoute() {
  return /#\/watch/.test(location.hash || "");
}
function previewCap() {
  const cap = configRead(CONFIG_KEYS.PREVIEW_CAP);
  return cap === "480p" || cap === "720p" ? cap : null;
}
const MAX_APPLY_RETRIES = 10;
const APPLY_RETRY_DELAY_MS = 500;

class PreferredQualityHandler {
  #player = null;
  #applyRetryTimer = null;
  #applyRetryAttempts = 0;
  #lastVideoId = null;
  #hasAppliedQuality = false;
  // The video and range last sent to the player. A repeat would restart the stream.
  #appliedRange = null;

  constructor() {
    // The route decides the cap. When it changes between browse and watch the quality is applied
    // again, so a preview cap never stays on a watch video. Other hash changes (the watch page
    // updates its hash several times) change nothing.
    let routeIsWatch = onWatchRoute();
    if (window.addEventListener) {
      window.addEventListener("hashchange", () => {
        const nowWatch = onWatchRoute();
        if (nowWatch === routeIsWatch) return;
        routeIsWatch = nowWatch;
        this.#resetApplyState();
        this.#handleStateChange();
      });
    }
    this.#setupConfigListener();
    watchPlayer((player) => this.#attachPlayer(player));
    // A player node may be reused for another video without an onStateChange.
    watchVideoId((id) => {
      if (id === this.#lastVideoId) return;
      this.#lastVideoId = id;
      this.#resetApplyState();
      this.#handleStateChange();
    });
  }

  #clearApplyRetry() {
    if (this.#applyRetryTimer) {
      clearTimeout(this.#applyRetryTimer);
      this.#applyRetryTimer = null;
    }
  }

  #setRange(quality) {
    const videoId = this.#currentVideoId();
    const key = videoId + "|" + quality;
    if (this.#appliedRange === key) return;
    this.#appliedRange = key;
    this.#player.setPlaybackQualityRange(quality, quality);
  }

  #currentVideoId() {
    try {
      const data = this.#player && this.#player.getVideoData ? this.#player.getVideoData() : null;
      return data && data.video_id ? data.video_id : "";
    } catch (e) {
      return "";
    }
  }

  #resetApplyState() {
    this.#clearApplyRetry();
    this.#applyRetryAttempts = 0;
    this.#hasAppliedQuality = false;
  }

  #attachPlayer(playerElement) {
    // watchPlayer reports the next player, so there is no polling here.
    if (!playerElement) {
      if (this.#player) {
        try {
          this.#player.removeEventListener(EVENTS.YT_STATE_CHANGE, this.#handleStateChange);
        } catch (e) {}
      }
      this.#player = null;
      this.#lastVideoId = null;
      this.#resetApplyState();
      return;
    }
    if (playerElement === this.#player) return;

    if (this.#player) {
      try {
        this.#player.removeEventListener(EVENTS.YT_STATE_CHANGE, this.#handleStateChange);
      } catch (e) {}
    }
    this.#player = playerElement;
    this.#lastVideoId = null;
    this.#resetApplyState();
    try {
      this.#player.addEventListener(EVENTS.YT_STATE_CHANGE, this.#handleStateChange);
    } catch (e) {
      console.warn("[AxoTube:preferredVideoQuality] Could not attach state change listener:", e);
    }
    this.#handleStateChange();
  }

  #setupConfigListener() {
    configChangeEmitter.addEventListener(EVENTS.CONFIG_CHANGE, (ev) => {
      if (ev.detail?.key === CONFIG_KEYS.QUALITY) {
        this.#resetApplyState();
        this.#hasAppliedQuality = this.#applyQuality();
        if (!this.#hasAppliedQuality) this.#scheduleApplyRetry();
      }
    });
  }

  #scheduleApplyRetry() {
    if (
      this.#applyRetryTimer ||
      this.#hasAppliedQuality ||
      this.#applyRetryAttempts >= MAX_APPLY_RETRIES
    )
      return;

    this.#applyRetryAttempts += 1;
    this.#applyRetryTimer = setTimeout(() => {
      this.#applyRetryTimer = null;
      try {
        const state = this.#player?.getPlayerStateObject?.();
        if (!state?.isPlaying || this.#player !== getCurrentPlayer()) return;
        this.#hasAppliedQuality = this.#applyQuality();
        if (!this.#hasAppliedQuality) this.#scheduleApplyRetry();
      } catch (e) {
        console.warn("[AxoTube:preferredVideoQuality] Retry failed:", e);
      }
    }, APPLY_RETRY_DELAY_MS);
  }

  #handleStateChange = () => {
    try {
      const state = this.#player?.getPlayerStateObject?.();
      const videoData = this.#player?.getVideoData?.();
      const videoId = videoData?.video_id;
      if (videoId !== this.#lastVideoId) {
        this.#lastVideoId = videoId;
        this.#resetApplyState();
      }
      const isShorts = Object.values(this.#player?.getVideoStats?.() || {}).find(
        (a) => a && a === "shortspage",
      );
      if (state?.isPlaying && !this.#hasAppliedQuality && !isShorts) {
        this.#hasAppliedQuality = this.#applyQuality();
        if (!this.#hasAppliedQuality) this.#scheduleApplyRetry();
      }
    } catch (e) {
      console.warn("[AxoTube:preferredVideoQuality] State change handler failed:", e);
    }
  };

  #applyQuality() {
    if (!this.#player || typeof this.#player.setPlaybackQualityRange !== "function") return false;
    const preferredQuality = configRead(CONFIG_KEYS.QUALITY);
    const cap = onWatchRoute() ? null : previewCap();
    try {
      if (cap) {
        // A preview never plays above the cap. A lower preference is kept as it is.
        const capValue = parseInt(cap, 10);
        const prefValue = parseInt(preferredQuality, 10) || 0;
        const target = prefValue && prefValue < capValue ? preferredQuality : cap;
        const quality = this.#determineQuality(target);
        if (!quality) return false;
        this.#setRange(quality);
        return true;
      }
      if (!preferredQuality || preferredQuality === "auto") {
        this.#setRange("auto");
        return true;
      }
      const quality = this.#determineQuality(preferredQuality);
      if (!quality) return false;
      this.#setRange(quality);
      return true;
    } catch (e) {
      console.warn("[AxoTube:preferredVideoQuality] Failed to apply quality:", e);
      return false;
    }
  }

  #determineQuality(preference) {
    try {
      const availableQualities = this.#player.getAvailableQualityData?.();
      if (!Array.isArray(availableQualities) || availableQualities.length === 0) return null;
      const getQualityValue = (label) => parseInt(label, 10) || 0;
      const targetValue = getQualityValue(preference);
      const exact = availableQualities.find((q) => getQualityValue(q.qualityLabel) === targetValue);
      if (exact) return exact.quality;

      // Prefer the closest quality at or below the requested resolution. If none
      // exists, use the closest available value above it.
      const sorted = availableQualities.slice().sort((a, b) => {
        const aVal = getQualityValue(a.qualityLabel);
        const bVal = getQualityValue(b.qualityLabel);
        const aAbove = aVal > targetValue ? 1 : 0;
        const bAbove = bVal > targetValue ? 1 : 0;
        if (aAbove !== bAbove) return aAbove - bAbove;
        return Math.abs(aVal - targetValue) - Math.abs(bVal - targetValue);
      });
      return sorted[0]?.quality || null;
    } catch (e) {
      console.warn("[AxoTube:preferredVideoQuality] Quality determination failed:", e);
      return null;
    }
  }
}

try {
  window.preferredVideoQualityHandler = new PreferredQualityHandler();
} catch (e) {
  console.error(
    "[AxoTube:preferredVideoQuality] PreferredQualityHandler initialization failed:",
    e,
  );
}
