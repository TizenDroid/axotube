import sha256 from "../tiny-sha256.js";
import { configRead, configChangeEmitter } from "../config.js";
import { showToast } from "../ui/ytUI.js";
import { t } from "i18next";

const FETCH_TIMEOUT = 5000;
const SEGMENT_SKIP_COOLDOWN = 500;

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
  nextSkipTimeout = null;
  sliderInterval = null;
  attachVideoAttempts = 0;
  lastSkippedSegmentUUID = null;
  lastSkipTime = 0;
  observer = null;
  scheduleSkipHandler = null;
  durationChangeHandler = null;
  segments = null;
  skippableCategories = [];
  manualSkippableCategories = [];
  skippedCategories = new Map();
  nextSegment = null;
  scheduledSegment = null;
  repositionFrame = null;
  mutationFrame = null;

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

    let timeoutId = null;
    try {
      const controller = new AbortController();
      timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
      const resp = await fetch(
        `${sponsorblockAPI}/skipSegments/${videoHash}?categories=${encodeURIComponent(JSON.stringify(categories))}`,
        { signal: controller.signal },
      );
      if (!resp.ok) throw new Error(`SponsorBlock HTTP ${resp.status}`);
      const results = await resp.json();
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
      this.durationChangeHandler = () => this.buildOverlay();
      this.attachVideo();
    } catch (err) {
      if (err?.name !== "AbortError") console.error("SponsorBlock init error:", err);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
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

  detachVideo() {
    if (!this.video) return;
    try {
      this.video.removeEventListener("play", this.scheduleSkipHandler);
      this.video.removeEventListener("pause", this.scheduleSkipHandler);
      this.video.removeEventListener("timeupdate", this.scheduleSkipHandler);
      this.video.removeEventListener("durationchange", this.durationChangeHandler);
    } catch (e) {}
  }

  attachVideo() {
    clearTimeout(this.attachVideoTimeout);
    this.attachVideoTimeout = null;
    if (!this.active) return;

    const nextVideo = document.querySelector("video");
    if (!nextVideo) {
      this.attachVideoAttempts += 1;
      if (this.attachVideoAttempts <= 600) {
        this.attachVideoTimeout = setTimeout(() => this.attachVideo(), 100);
      }
      return;
    }

    if (nextVideo !== this.video) {
      this.detachVideo();
      this.video = nextVideo;
      this.attachVideoAttempts = 0;
      this.video.addEventListener("play", this.scheduleSkipHandler);
      this.video.addEventListener("pause", this.scheduleSkipHandler);
      this.video.addEventListener("timeupdate", this.scheduleSkipHandler);
      this.video.addEventListener("durationchange", this.durationChangeHandler);
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

  clearScheduledSkip() {
    if (this.nextSkipTimeout) clearTimeout(this.nextSkipTimeout);
    this.nextSkipTimeout = null;
    this.scheduledSegment = null;
  }

  scheduleSkip() {
    if (!this.active || !configRead("enableSponsorBlock") || !this.segments) {
      this.clearScheduledSkip();
      return;
    }

    const currentVideo = document.querySelector("video");
    if (currentVideo && currentVideo !== this.video) {
      this.attachVideo();
      return;
    }
    if (!this.video) return;

    this.refreshConfig();
    if (this.video.paused) {
      this.clearScheduledSkip();
      return;
    }

    const currentTime = this.video.currentTime;
    const stillRelevant = this.nextSegment && this.nextSegment.segment[1] > currentTime + 0.05;
    if (!stillRelevant) {
      const nextSegments = this.segments
        .filter((seg) => seg.segment[1] > currentTime + 0.05)
        .sort((a, b) => {
          const aDelay = Math.max(0, a.segment[0] - currentTime);
          const bDelay = Math.max(0, b.segment[0] - currentTime);
          return aDelay - bDelay || a.segment[0] - b.segment[0];
        });
      this.nextSegment = nextSegments[0] || null;
    }

    if (!this.nextSegment) {
      this.clearScheduledSkip();
      return;
    }
    this.armSkip(this.nextSegment, currentTime);
  }

  armSkip(segment, currentTime) {
    if (segment === this.scheduledSegment && this.nextSkipTimeout) return;
    this.clearScheduledSkip();
    const [start, end] = segment.segment;
    const delayMs = Math.max(0, (start - currentTime) * 1000);
    this.scheduledSegment = segment;
    this.nextSkipTimeout = setTimeout(() => {
      this.nextSkipTimeout = null;
      this.performSkip(segment, end);
    }, delayMs);
  }

  performSkip(segment, end) {
    if (!this.active || !this.video) return;
    if (this.video.paused) {
      this.scheduledSegment = null;
      return;
    }

    this.refreshConfig();
    const now = Date.now();
    if (segment.UUID === this.lastSkippedSegmentUUID && now - this.lastSkipTime < SEGMENT_SKIP_COOLDOWN) {
      this.scheduledSegment = null;
      this.scheduleSkip();
      return;
    }
    if (!this.skippableCategories.includes(segment.category)) {
      this.scheduledSegment = null;
      this.nextSegment = null;
      this.scheduleSkip();
      return;
    }

    const skipName = barTypes[segment.category]?.name || segment.category;
    if (!this.manualSkippableCategories.includes(segment.category)) {
      const wasSkippedBefore = this.skippedCategories.get(segment.UUID);
      if (wasSkippedBefore) {
        wasSkippedBefore.count++;
        wasSkippedBefore.lastSkipped = Date.now();
        this.skippedCategories.set(segment.UUID, wasSkippedBefore);
        if (wasSkippedBefore.lastSkipped - wasSkippedBefore.firstSkipped < 1000) {
          if (!wasSkippedBefore.hasShownToast) {
            if (configRead("enableSponsorBlockToasts")) {
              showToast("SponsorBlock", t("sponsorblock.toasts.notSkipping", { segment: skipName, count: wasSkippedBefore.count }));
            }
            wasSkippedBefore.hasShownToast = true;
            this.skippedCategories.set(segment.UUID, wasSkippedBefore);
          }
          this.scheduledSegment = null;
          this.nextSegment = null;
          return;
        }
      } else {
        this.skippedCategories.set(segment.UUID, {
          count: 1,
          firstSkipped: Date.now(),
          lastSkipped: Date.now(),
          hasShownToast: false,
        });
      }

      if (configRead("enableSponsorBlockToasts")) {
        showToast("SponsorBlock", t("sponsorblock.toasts.skipping", { segment: skipName }));
      }
      const skipTarget = this.video.duration - end < 1 ? Math.max(end - 1, 0) : end;
      this.video.currentTime = skipTarget;
      this.lastSkippedSegmentUUID = segment.UUID;
      this.lastSkipTime = Date.now();
    }

    this.nextSegment = null;
    this.scheduledSegment = null;
    this.scheduleSkip();
  }

  destroy() {
    this.active = false;
    this.clearScheduledSkip();
    if (this.attachVideoTimeout) clearTimeout(this.attachVideoTimeout);
    this.attachVideoTimeout = null;
    if (this.sliderInterval) clearInterval(this.sliderInterval);
    this.sliderInterval = null;
    if (this.observer) this.observer.disconnect();
    this.observer = null;
    if (this.segmentsoverlay) this.segmentsoverlay.remove();
    this.segmentsoverlay = null;
    this.detachVideo();
    this.video = null;
    this.skippedCategories.clear();
    this.nextSegment = null;
    if (this.repositionFrame) cancelAnimationFrame(this.repositionFrame);
    this.repositionFrame = null;
    if (this.mutationFrame) cancelAnimationFrame(this.mutationFrame);
    this.mutationFrame = null;
  }
}

window.sponsorblock = null;

function currentVideoId() {
  const match = /[?&]v=([^&]+)/.exec(location.hash);
  return match ? match[1] : null;
}

function syncSponsorBlockForCurrentRoute() {
  const videoID = currentVideoId();
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
