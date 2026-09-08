import { configRead, configChangeEmitter } from "../config.js";

const SELECTORS = { PLAYER: ".html5-video-player" };
const EVENTS = { YT_STATE_CHANGE: "onStateChange", CONFIG_CHANGE: "configChange" };
const CONFIG_KEYS = { QUALITY: "preferredVideoQuality" };
const MAX_PLAYER_POLL_ATTEMPTS = 50;
const PLAYER_POLL_DELAY_MS = 200;
const MAX_APPLY_RETRIES = 10;
const APPLY_RETRY_DELAY_MS = 500;

class PreferredQualityHandler {
  #player = null;
  #pollTimer = null;
  #watchTimer = null;
  #applyRetryTimer = null;
  #pollAttempts = 0;
  #applyRetryAttempts = 0;
  #lastVideoId = null;
  #hasAppliedQuality = false;

  constructor() {
    this.#pollForPlayer(true);
    this.#setupConfigListener();
    if (window.addEventListener) {
      window.addEventListener("hashchange", () => this.#pollForPlayer(true));
    }
    this.#watchTimer = setInterval(() => this.#ensureCurrentPlayer(), 2000);
  }

  #ensureCurrentPlayer() {
    const current = document.querySelector(SELECTORS.PLAYER);
    if (current !== this.#player) this.#attachPlayer(current);
  }

  #pollForPlayer(resetBudget = false) {
    clearTimeout(this.#pollTimer);
    this.#pollTimer = null;
    if (resetBudget) this.#pollAttempts = 0;

    const playerElement = document.querySelector(SELECTORS.PLAYER);
    if (!playerElement) {
      if (this.#pollAttempts >= MAX_PLAYER_POLL_ATTEMPTS) return;
      this.#pollAttempts += 1;
      this.#pollTimer = setTimeout(() => this.#pollForPlayer(false), PLAYER_POLL_DELAY_MS);
      return;
    }
    this.#pollAttempts = 0;
    this.#attachPlayer(playerElement);
  }

  #clearApplyRetry() {
    if (this.#applyRetryTimer) {
      clearTimeout(this.#applyRetryTimer);
      this.#applyRetryTimer = null;
    }
  }

  #resetApplyState() {
    this.#clearApplyRetry();
    this.#applyRetryAttempts = 0;
    this.#hasAppliedQuality = false;
  }

  #attachPlayer(playerElement) {
    if (!playerElement) {
      if (this.#player) {
        try { this.#player.removeEventListener(EVENTS.YT_STATE_CHANGE, this.#handleStateChange); } catch (e) {}
      }
      this.#player = null;
      this.#lastVideoId = null;
      this.#resetApplyState();
      this.#pollForPlayer(true);
      return;
    }
    if (playerElement === this.#player) return;

    if (this.#player) {
      try { this.#player.removeEventListener(EVENTS.YT_STATE_CHANGE, this.#handleStateChange); } catch (e) {}
    }
    this.#player = playerElement;
    this.#lastVideoId = null;
    this.#resetApplyState();
    try {
      this.#player.addEventListener(EVENTS.YT_STATE_CHANGE, this.#handleStateChange);
    } catch (e) {
      console.warn("Could not attach state change listener:", e);
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
    ) return;

    this.#applyRetryAttempts += 1;
    this.#applyRetryTimer = setTimeout(() => {
      this.#applyRetryTimer = null;
      try {
        const state = this.#player?.getPlayerStateObject?.();
        if (!state?.isPlaying) return;
        this.#hasAppliedQuality = this.#applyQuality();
        if (!this.#hasAppliedQuality) this.#scheduleApplyRetry();
      } catch (e) {
        console.warn("[PreferredQuality] Retry failed:", e);
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
      console.warn("State change handler failed:", e);
    }
  };

  #applyQuality() {
    if (!this.#player || typeof this.#player.setPlaybackQualityRange !== "function") return false;
    const preferredQuality = configRead(CONFIG_KEYS.QUALITY);
    try {
      if (!preferredQuality || preferredQuality === "auto") {
        this.#player.setPlaybackQualityRange("auto", "auto");
        return true;
      }
      const quality = this.#determineQuality(preferredQuality);
      if (!quality) return false;
      this.#player.setPlaybackQualityRange(quality, quality);
      return true;
    } catch (e) {
      console.warn("[PreferredQuality] Failed to apply quality:", e);
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
      console.warn("[PreferredQuality] Quality determination failed:", e);
      return null;
    }
  }
}

try {
  window.preferredVideoQualityHandler = new PreferredQualityHandler();
} catch (e) {
  console.error("PreferredQualityHandler initialization failed:", e);
}
