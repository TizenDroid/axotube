import sha256 from "../tiny-sha256.js";
import { configRead, configChangeEmitter } from "../config.js";
import { showToast } from "../ui/ytUI.js";
import { t } from "i18next";
import { getCurrentVideo, watchVideo } from "../shared/playerLifecycle.js";
import { fetchWithTimeout } from "../shared/fetch.js";
// Segments are judged against media time, never wall-clock timers, so playback
// speed, buffering stalls and AFR pauses cannot shift where a skip lands.
// A segment starting within this window of the playhead is skipped now, which
// compensates for coarse timeupdate cadence on the TV.
const SKIP_LOOKAHEAD_S = 0.5;
const END_EPSILON_S = 0.05;
// Our own seeks can land a little off target after keyframe snapping.
const OWN_SEEK_TOLERANCE_S = 1.5;
const REVERT_TOAST_WINDOW_MS = 1000;
// Re-check interval used only while a segment is still ahead. It backs up
// timeupdate, so a slow update cadence cannot make a skip land late.
const BACKSTOP_INTERVAL_MS = 250;

const barTypes = {
  sponsor: { color: "#00d400", opacity: "0.7", name: t("sponsorblock.segments.sponsor") || "sponsored segment" },
  intro: { color: "#00ffff", opacity: "0.7", name: t("sponsorblock.segments.intro") || "intro" },
  outro: { color: "#0202ed", opacity: "0.7", name: t("sponsorblock.segments.outro") || "outro" },
  interaction: { color: "#cc00ff", opacity: "0.7", name: t("sponsorblock.segments.interaction") || "interaction reminder" },
  selfpromo: { color: "#ffff00", opacity: "0.7", name: t("sponsorblock.segments.selfpromo") || "self-promotion" },
  preview: { color: "#008fd6", opacity: "0.7", name: t("sponsorblock.segments.preview") || "recap or preview" },
  filler: { color: "#7300FF", opacity: "0.9", name: t("sponsorblock.segments.filler") || "tangents" },
  music_offtopic: { color: "#ff9900", opacity: "0.7", name: t("sponsorblock.segments.music_offtopic") || "non-music part" },
  poi_highlight: { color: "#9b044c", opacity: "0.7", name: t("sponsorblock.segments.poi_highlight") || "highlight" },
};

const sponsorblockAPI = "https://sponsor.ajay.app/api";

class SponsorBlockHandler {
  video = null;
  active = true;
  attachVideoTimeout = null;
  sliderInterval = null;
  backstopTimer = null;
  attachVideoAttempts = 0;
  observer = null;
  scheduleSkipHandler = null;
  durationChangeHandler = null;
  seekedHandler = null;
  segments = null;
  skippableCategories = [];
  manualSkippableCategories = [];
  // UUID -> { start, end } for segments already skipped in this playback pass.
  // A segment stays here until the viewer seeks back before its end, so a
  // skip can never re-trigger on its own landing position.
  handled = new Map();
  ownSeekTarget = null;
  notSkippingToasted = new Set();
  lastSkipAt = 0;
  lastSkipUUID = null;
  lastSkipTarget = null;
  repositionFrame = null;
  mutationFrame = null;
  segmentsoverlay = null;
  slider = null;

  constructor(videoID) {
    this.videoID = videoID;
  }

  refreshConfig() {
    const manual = configRead("sponsorBlockManualSkips");
    this.manualSkippableCategories = Array.isArray(manual) ? manual : [];
    this.skippableCategories = this.getSkippableCategories();
  }

  async init() {
    const videoHash = sha256(this.videoID).substring(0, 4);
    const categories = [
      "sponsor", "intro", "outro", "interaction", "selfpromo",
      "preview", "filler", "music_offtopic", "poi_highlight",
    ];

    try {
      // fetchWithTimeout enforces the deadline with Promise.race, which also
      // works on TV builds whose fetch ignores AbortController.
      const resp = await fetchWithTimeout(
        `${sponsorblockAPI}/skipSegments/${videoHash}?categories=${encodeURIComponent(JSON.stringify(categories))}`,
      );
      if (!resp.ok) throw new Error(`SponsorBlock HTTP ${resp.status}`);
      const results = await resp.json();
      if (!this.active) return;
      if (!Array.isArray(results)) return;
      const result = results.find((v) => v.videoID === this.videoID);
      if (!result || !Array.isArray(result.segments) || !result.segments.length) return;

      this.segments = result.segments.filter((seg) => {
        if (!seg.segment || seg.segment.length < 2) return false;
        const [start, end] = seg.segment;
        return typeof start === "number" && typeof end === "number" && start < end && start >= 0;
      });
      if (!this.segments.length) return;

      this.refreshConfig();
      this.scheduleSkipHandler = () => this.scheduleSkip();
      this.seekedHandler = () => this.onSeeked();
      this.durationChangeHandler = () => this.buildOverlay();
      this.attachVideo();
    } catch (err) {
      console.error("SponsorBlock init error:", err);
    }
  }

  getSkippableCategories() {
    const categories = [];
    if (configRead("enableSponsorBlockSponsor")) categories.push("sponsor");
    if (configRead("enableSponsorBlockIntro")) categories.push("intro");
    if (configRead("enableSponsorBlockOutro")) categories.push("outro");
    if (configRead("enableSponsorBlockInteraction")) categories.push("interaction");
    if (configRead("enableSponsorBlockSelfPromo")) categories.push("selfpromo");
    if (configRead("enableSponsorBlockPreview")) categories.push("preview");
    if (configRead("enableSponsorBlockFiller")) categories.push("filler");
    if (configRead("enableSponsorBlockMusicOfftopic")) categories.push("music_offtopic");
    return categories;
  }

  isAutoSkippable(category) {
    return this.skippableCategories.includes(category) &&
      !this.manualSkippableCategories.includes(category);
  }

  detachVideo() {
    this.stopBackstop();
    if (!this.video) return;
    try {
      this.video.removeEventListener("play", this.scheduleSkipHandler);
      this.video.removeEventListener("pause", this.scheduleSkipHandler);
      this.video.removeEventListener("timeupdate", this.scheduleSkipHandler);
      this.video.removeEventListener("seeked", this.seekedHandler);
      this.video.removeEventListener("durationchange", this.durationChangeHandler);
    } catch (e) {}
  }

  clearVideoOverlay() {
    if (this.sliderInterval) clearInterval(this.sliderInterval);
    this.sliderInterval = null;
    if (this.observer) this.observer.disconnect();
    this.observer = null;
    if (this.segmentsoverlay) this.segmentsoverlay.remove();
    this.segmentsoverlay = null;
    this.slider = null;
    if (this.repositionFrame) cancelAnimationFrame(this.repositionFrame);
    this.repositionFrame = null;
    if (this.mutationFrame) cancelAnimationFrame(this.mutationFrame);
    this.mutationFrame = null;
  }

  attachVideo(nextVideo = getCurrentVideo()) {
    clearTimeout(this.attachVideoTimeout);
    this.attachVideoTimeout = null;
    if (!this.active) return;
    if (currentSponsorVideoId() !== this.videoID) return;

    if (nextVideo !== this.video) {
      this.clearVideoOverlay();
      this.detachVideo();
      this.video = nextVideo;
      this.handled.clear();
      this.notSkippingToasted.clear();
      this.ownSeekTarget = null;
      if (nextVideo) {
        this.attachVideoAttempts = 0;
        nextVideo.addEventListener("play", this.scheduleSkipHandler);
        nextVideo.addEventListener("pause", this.scheduleSkipHandler);
        nextVideo.addEventListener("timeupdate", this.scheduleSkipHandler);
        nextVideo.addEventListener("seeked", this.seekedHandler);
        nextVideo.addEventListener("durationchange", this.durationChangeHandler);
      }
    }

    if (!nextVideo) {
      this.attachVideoAttempts += 1;
      if (this.attachVideoAttempts <= 600) {
        this.attachVideoTimeout = setTimeout(() => this.attachVideo(), 100);
      }
      return;
    }

    this.buildOverlay();
    this.scheduleSkip();
  }

  repositionOverlay() {
    if (this.repositionFrame || !this.segmentsoverlay) return;
    this.repositionFrame = requestAnimationFrame(() => {
      this.repositionFrame = null;
      if (!this.segmentsoverlay) return;
      const slider = document.querySelector('div[idomkey="slider"]');
      const sliderRect = slider?.getBoundingClientRect();
      const isOldUI = !document.querySelector('div[idomkey="Metadata-Section"]');
      if (isOldUI && sliderRect) {
        this.segmentsoverlay.style.setProperty("top", `${sliderRect.top}px`, "important");
      }
    });
  }

  buildOverlay() {
    if (this.segmentsoverlay) return;
    if (!this.video || !this.video.duration) return;
    const videoDuration = this.video.duration;
    const slider = document.querySelector('div[idomkey="slider"]');
    if (!slider) return;

    this.segmentsoverlay = document.createElement("div");
    this.segmentsoverlay.classList.add("ytLrProgressBarSlider", "ytLrProgressBarSliderRectangularProgressBar");
    this.segmentsoverlay.style.setProperty("z-index", "10", "important");
    this.segmentsoverlay.style.setProperty("background-color", "rgba(0, 0, 0, 0)", "important");
    this.segmentsoverlay.style.setProperty("width", "72rem", "important");
    this.segmentsoverlay.style.setProperty("left", "4rem", "important");
    const sliderRect = slider.getBoundingClientRect();
    if (!slider.classList.contains("ytLrProgressBarSlider")) {
      for (let i = 0; i < slider.classList.length; i++) this.segmentsoverlay.classList.add(slider.classList[i]);
      this.segmentsoverlay.style.setProperty("height", `${sliderRect.height}px`, "important");
      this.segmentsoverlay.style.setProperty("bottom", `${sliderRect.bottom - sliderRect.top}px`, "important");
    }

    this.segments.forEach((segment) => {
      const [start, end] = segment.segment;
      const barType = barTypes[segment.category] || { color: "blue", opacity: 0.7 };
      const leftPercent = videoDuration ? (100.0 * start) / videoDuration : 0;
      const widthPercent = videoDuration ? (100.0 * (end - start)) / videoDuration : 0;
      const elm = document.createElement("div");
      elm.style.setProperty("background-color", barType.color, "important");
      elm.style.setProperty("opacity", barType.opacity, "important");
      elm.style.setProperty("height", "100%", "important");
      elm.style.setProperty("width", `${segment.category === "poi_highlight" ? 1 : widthPercent}%`, "important");
      elm.style.setProperty("left", `${leftPercent}%`, "important");
      elm.style.setProperty("position", "absolute", "important");
      this.segmentsoverlay.appendChild(elm);
    });

    this.observer = new MutationObserver((mutations) => {
      if (this.mutationFrame) return;
      this.mutationFrame = requestAnimationFrame(() => {
        this.mutationFrame = null;
        if (!this.segmentsoverlay) return;
        let needsReappend = false;
        mutations.forEach((m) => {
          if (!m.removedNodes) return;
          for (const node of m.removedNodes) {
            if (node === this.segmentsoverlay) needsReappend = true;
          }
        });
        if (needsReappend && this.slider) this.slider.appendChild(this.segmentsoverlay);
        this.repositionOverlay();
        const progressBar = document.querySelector("ytlr-progress-bar");
        if (progressBar && this.segmentsoverlay) {
          this.segmentsoverlay.style.setProperty(
            "display",
            progressBar.getAttribute("hybridnavfocusable") === "false" ? "none" : "block",
            "important",
          );
        }
      });
    });

    let sliderPollAttempts = 0;
    this.sliderInterval = setInterval(() => {
      sliderPollAttempts += 1;
      if (sliderPollAttempts > 120) {
        clearInterval(this.sliderInterval);
        this.sliderInterval = null;
        return;
      }
      this.slider = document.querySelector("ytlr-redux-connect-ytlr-progress-bar");
      if (this.slider) {
        clearInterval(this.sliderInterval);
        this.sliderInterval = null;
        this.observer.observe(this.slider, { childList: true, subtree: true });
        this.slider.appendChild(this.segmentsoverlay);
      }
    }, 500);
  }

  // Called on play, pause, timeupdate and attach. Finds the first unhandled
  // segment the playhead has reached (or is about to reach) and skips it.
  // No timers: every decision is made from current media time.
  scheduleSkip() {
    if (!this.active || !configRead("enableSponsorBlock") || !this.segments) return;
    if (currentSponsorVideoId() !== this.videoID) return;

    const currentVideo = getCurrentVideo();
    if (currentVideo && currentVideo !== this.video) {
      this.attachVideo();
      return;
    }
    if (!this.video || this.video.paused) {
      this.stopBackstop();
      return;
    }

    this.refreshConfig();
    const now = this.video.currentTime;
    for (const seg of this.segments) {
      const [start, end] = seg.segment;
      if (end <= now + END_EPSILON_S) continue;
      if (start > now + SKIP_LOOKAHEAD_S) continue;
      if (!this.isAutoSkippable(seg.category)) continue;
      if (this.handled.has(seg.UUID)) {
        this.maybeToastRevert(seg, now);
        continue;
      }
      this.performSkip(seg, end);
      return;
    }

    const pending = this.segments.some(
      (seg) =>
        seg.segment[1] > now + END_EPSILON_S &&
        this.isAutoSkippable(seg.category) &&
        !this.handled.has(seg.UUID),
    );
    if (!pending) this.stopBackstop();
    else if (this.backstopTimer === null) {
      this.backstopTimer = setInterval(this.scheduleSkipHandler, BACKSTOP_INTERVAL_MS);
    }
  }

  stopBackstop() {
    if (this.backstopTimer === null) return;
    clearInterval(this.backstopTimer);
    this.backstopTimer = null;
  }

  // Shows the "not skipping" notice once when playback re-enters a segment
  // we just skipped (something reverted our seek).
  maybeToastRevert(segment, now) {
    const [start, end] = segment.segment;
    if (segment.UUID !== this.lastSkipUUID) return;
    if (Date.now() - this.lastSkipAt >= REVERT_TOAST_WINDOW_MS) return;
    if (now < start || now >= end) return;
    // Our own landing position is not a revert (tail segments land at end - 1).
    if (this.ownSeekTarget === null && Math.abs(now - this.lastSkipTarget) <= OWN_SEEK_TOLERANCE_S) return;
    if (this.notSkippingToasted.has(segment.UUID)) return;
    this.notSkippingToasted.add(segment.UUID);
    if (configRead("enableSponsorBlockToasts")) {
      const skipName = barTypes[segment.category]?.name || segment.category;
      showToast(t("app.name"), t("sponsorblock.toasts.notSkipping", { segment: skipName, count: 2 }));
    }
  }

  performSkip(segment, end) {
    if (!this.active || !this.video) return;
    if (getCurrentVideo() !== this.video || currentSponsorVideoId() !== this.videoID) {
      this.attachVideo();
      return;
    }
    if (this.video.paused) return;

    this.refreshConfig();
    if (!this.isAutoSkippable(segment.category) || this.handled.has(segment.UUID)) return;

    const [start] = segment.segment;
    // Mark handled before seeking so no re-entrant check can skip it again.
    this.handled.set(segment.UUID, { start, end });

    const skipName = barTypes[segment.category]?.name || segment.category;
    if (configRead("enableSponsorBlockToasts")) {
      showToast(t("app.name"), t("sponsorblock.toasts.skipping", { segment: skipName }));
    }
    const skipTarget = this.video.duration - end < 1 ? Math.max(end - 1, 0) : end;
    this.ownSeekTarget = skipTarget;
    this.lastSkipTarget = skipTarget;
    this.lastSkipUUID = segment.UUID;
    this.lastSkipAt = Date.now();
    this.video.currentTime = skipTarget;
    this.scheduleSkip();
  }

  // A seek the viewer makes (not our own skip) re-arms every handled segment
  // whose end lies ahead of the new position, so rewinding into a sponsor
  // skips it again.
  onSeeked() {
    if (!this.video) return;
    const now = this.video.currentTime;
    if (this.ownSeekTarget !== null) {
      const ours = Math.abs(now - this.ownSeekTarget) <= OWN_SEEK_TOLERANCE_S;
      this.ownSeekTarget = null;
      if (ours) return;
    }
    for (const [uuid, range] of this.handled) {
      if (now < range.end - END_EPSILON_S) {
        this.handled.delete(uuid);
        this.notSkippingToasted.delete(uuid);
      }
    }
    this.scheduleSkip();
  }

  destroy() {
    this.active = false;
    this.stopBackstop();
    if (this.attachVideoTimeout) clearTimeout(this.attachVideoTimeout);
    this.attachVideoTimeout = null;
    this.clearVideoOverlay();
    this.detachVideo();
    this.video = null;
    this.handled.clear();
    this.notSkippingToasted.clear();
  }
}

window.sponsorblock = null;

function currentSponsorVideoId() {
  const match = /[?&]v=([^&]+)/.exec(location.hash);
  return match ? match[1] : null;
}

function syncSponsorBlockForCurrentRoute() {
  const videoID = currentSponsorVideoId();
  const enabled = !!configRead("enableSponsorBlock");

  if (!videoID || !enabled) {
    if (window.sponsorblock) {
      try { window.sponsorblock.destroy(); } catch (err) {}
      window.sponsorblock = null;
    }
    return;
  }

  if (window.sponsorblock && window.sponsorblock.videoID === videoID) {
    window.sponsorblock.refreshConfig();
    window.sponsorblock.scheduleSkip();
    return;
  }

  if (window.sponsorblock) {
    try { window.sponsorblock.destroy(); } catch (err) {}
  }
  window.sponsorblock = new SponsorBlockHandler(videoID);
  window.sponsorblock.init();
}

window.addEventListener("hashchange", syncSponsorBlockForCurrentRoute, false);
watchVideo((video) => {
  if (window.sponsorblock && window.sponsorblock.scheduleSkipHandler) {
    window.sponsorblock.attachVideo(video);
  }
});
configChangeEmitter.addEventListener("configChange", (event) => {
  const key = event.detail?.key || "";
  if (key === "enableSponsorBlock" || key === "sponsorBlockManualSkips" || key.indexOf("enableSponsorBlock") === 0) {
    syncSponsorBlockForCurrentRoute();
  }
});

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", syncSponsorBlockForCurrentRoute);
} else {
  syncSponsorBlockForCurrentRoute();
}
