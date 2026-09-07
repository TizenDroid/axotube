import { configRead, configChangeEmitter } from "../config.js";

const SELECTORS = { PLAYER: ".html5-video-player" };
const EVENTS = { YT_STATE_CHANGE: "onStateChange", CONFIG_CHANGE: "configChange" };
const CONFIG_KEYS = { QUALITY: "preferredVideoQuality" };

class PreferredQualityHandler {
  #player = null;
  #pollTimer = null;
  #watchTimer = null;
  #lastVideoId = null;
  #hasAppliedQuality = false;

  constructor() {
    this.#pollForPlayer();
    this.#setupConfigListener();
    if (window.addEventListener) {
      window.addEventListener("hashchange", () => this.#pollForPlayer());
    }
    this.#watchTimer = setInterval(() => this.#ensureCurrentPlayer(), 2000);
  }

  #ensureCurrentPlayer() {
    const current = document.querySelector(SELECTORS.PLAYER);
    if (current !== this.#player) this.#attachPlayer(current);
  }

  #pollForPlayer() {
    clearTimeout(this.#pollTimer);
    const playerElement = document.querySelector(SELECTORS.PLAYER);
    if (!playerElement) {
      this.#pollTimer = setTimeout(() => this.#pollForPlayer(), 100);
      return;
    }
    this.#attachPlayer(playerElement);
  }

  #attachPlayer(playerElement) {
    if (!playerElement) {
      this.#player = null;
      this.#lastVideoId = null;
      this.#hasAppliedQuality = false;
      this.#pollForPlayer();
      return;
    }
    if (playerElement === this.#player) return;

    if (this.#player) {
      try { this.#player.removeEventListener(EVENTS.YT_STATE_CHANGE, this.#handleStateChange); } catch (e) {}
    }
    this.#player = playerElement;
    this.#lastVideoId = null;
    this.#hasAppliedQuality = false;
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
        this.#hasAppliedQuality = false;
        this.#applyQuality();
      }
    });
  }

  #handleStateChange = () => {
    try {
      const state = this.#player?.getPlayerStateObject?.();
      const videoData = this.#player?.getVideoData?.();
      const videoId = videoData?.video_id;
      if (videoId !== this.#lastVideoId) {
        this.#lastVideoId = videoId;
        this.#hasAppliedQuality = false;
      }
      const isShorts = Object.values(this.#player?.getVideoStats?.() || {}).find(
        (a) => a && a === "shortspage",
      );
      if (state?.isPlaying && !this.#hasAppliedQuality && !isShorts) {
        this.#applyQuality();
        this.#hasAppliedQuality = true;
      }
    } catch (e) {
      console.warn("State change handler failed:", e);
    }
  };

  #applyQuality() {
    if (!this.#player || typeof this.#player.setPlaybackQualityRange !== "function") return;
    const preferredQuality = configRead(CONFIG_KEYS.QUALITY);
    try {
      if (!preferredQuality || preferredQuality === "auto") {
        this.#player.setPlaybackQualityRange("auto", "auto");
        return;
      }
      const quality = this.#determineQuality(preferredQuality);
      if (quality) this.#player.setPlaybackQualityRange(quality, quality);
    } catch (e) {
      console.warn("[PreferredQuality] Failed to apply quality:", e);
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
