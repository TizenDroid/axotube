import sha256 from "../tiny-sha256.js";
import { configRead, configChangeEmitter } from "../config.js";
import { showToast } from "../ui/ytUI.js";
import { t } from "i18next";
import { getCurrentVideo, watchVideo } from "../shared/playerLifecycle.js";
import { getJSON } from "../shared/getJSON.js";
import { createBoundedCache } from "../shared/boundedCache.js";
// Segments are judged against media time, never wall-clock timers, so playback
// speed, buffering stalls and AFR pauses cannot shift where a skip lands.
// A segment starting within this window of the playhead is skipped now, which
// compensates for coarse timeupdate cadence on the TV.
const SKIP_LOOKAHEAD_S = 0.5;
const END_EPSILON_S = 0.05;
// Our own seeks can land a little off target after keyframe snapping.
const OWN_SEEK_TOLERANCE_S = 1.5;
const REVERT_TOAST_WINDOW_MS = 1000;
// A skip whose landing snapped back inside its own segment is retried this many
// times before we accept the landing. Bounded so a stuck seek cannot loop.
const MAX_LANDING_RETRIES = 2;
// A seek we did not make may re-arm the same segment at most this many times.
const MAX_REARMS_PER_SEGMENT = 3;
// Re-check interval used only while a segment is still ahead. It backs up
// timeupdate, so a slow update cadence cannot make a skip land late.
// Wakeups are scheduled for the next segment, not polled. MIN_WAKE_MS keeps a
// burst of timeupdates from producing a flood of tiny timers.
const MIN_WAKE_MS = 50;
// A seek we issued is treated as ours until its seeked event. This is the
// fallback clear, so a seek that never reports seeked cannot leave the flag set.
const OWN_SEEK_PENDING_MAX_MS = 1500;
// The API request waits this long after a video opens, so a video closed
// within a second never reaches the network at all.
const FETCH_DELAY_MS = 1000;
const FETCH_TIMEOUT_MS = 5000;
// Results are reused when the same video is opened again.
const SEGMENT_CACHE_SIZE = 20;
// The bar is re-checked while chapter pieces may still be rendering.
// Chapter pieces can render after the bar; retry a few times, then stop.
const BAR_RETRY_MS = 1000;
const MAX_BAR_RETRIES = 4;
// Bumped when SponsorBlock config changes, so handlers re-read their cache.
let configGeneration = 0;

const barTypes = {
  sponsor: { color: "#00d400", name: t("sponsorblock.segments.sponsor") || "sponsored segment" },
  intro: { color: "#00ffff", name: t("sponsorblock.segments.intro") || "intro" },
  outro: { color: "#0202ed", name: t("sponsorblock.segments.outro") || "outro" },
  interaction: {
    color: "#cc00ff",
    name: t("sponsorblock.segments.interaction") || "interaction reminder",
  },
  selfpromo: { color: "#ffff00", name: t("sponsorblock.segments.selfpromo") || "self-promotion" },
  preview: { color: "#008fd6", name: t("sponsorblock.segments.preview") || "recap or preview" },
  filler: { color: "#7300FF", name: t("sponsorblock.segments.filler") || "tangents" },
  music_offtopic: {
    color: "#ff9900",
    name: t("sponsorblock.segments.music_offtopic") || "non-music part",
  },
  poi_highlight: {
    color: "#9b044c",
    name: t("sponsorblock.segments.poi_highlight") || "highlight",
  },
};

const sponsorblockAPI = "https://sponsor.ajay.app/api";
const segmentCache = createBoundedCache(SEGMENT_CACHE_SIZE);

// Segments are drawn with CSS on the progress bar's slider, the same way
// VacuumTube does it. The rules live in a <style> element in <head>, so a bar
// that leanback re-renders on seek keeps them; an element appended to the bar
// (the previous approach) was lost whenever that subtree was replaced.
const STYLE_ID = "axotube-sponsorblock-segments";
const SLIDER_SELECTOR = 'ytlr-progress-bar [idomkey="slider"]';
const CHAPTER_PIECE_SELECTOR =
  'ytlr-multi-markers-player-bar-renderer [idomkey="progress-bar"] > [idomkey^="chapter-"]';
const CHAPTER_SELECTOR = 'ytlr-multi-markers-player-bar-renderer [idomkey^="chapter-"]';
const BAR_BASE_RULE = `${SLIDER_SELECTOR}::after, ${CHAPTER_SELECTOR}::after { content: ''; position: absolute; inset: 0; pointer-events: none; opacity: 0.7; }`;

function setSegmentStyle(css) {
  let style = document.getElementById(STYLE_ID);
  if (!css) {
    if (style) style.textContent = "";
    return;
  }
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    (document.head || document.documentElement).appendChild(style);
  }
  if (style.textContent !== css) style.textContent = css;
}

// Gradient stops for the segments inside [from, to] of the bar, as percentages
// of that range. Earlier layers paint on top, so the caller sorts shortest first.
function layersFor(items, from, to) {
  const layers = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.end <= from || item.start >= to) continue;
    const start = Math.max(0, ((item.start - from) / (to - from)) * 100);
    const end = Math.min(100, ((item.end - from) / (to - from)) * 100);
    layers.push(
      `linear-gradient(to right, transparent ${start}%, ${item.color} ${start}%, ${item.color} ${end}%, transparent ${end}%)`,
    );
  }
  return layers.length ? layers.join(", ") : "none";
}

// Videos with chapters draw the bar as separate pieces, so segments are placed
// within each piece instead of across the whole bar. Null when there are none.
function getChapters(duration) {
  const pieces = document.querySelectorAll(CHAPTER_PIECE_SELECTOR);
  if (!pieces || pieces.length === 0 || !(duration > 0)) return null;

  let total = 0;
  for (let i = 0; i < pieces.length; i++) total += parseFloat(pieces[i].style.width);
  if (!(total > 0)) return null;

  const chapters = [];
  let start = 0;
  for (let i = 0; i < pieces.length; i++) {
    const width = parseFloat(pieces[i].style.width);
    chapters.push({
      key: pieces[i].getAttribute("idomkey"),
      from: (start / total) * duration,
      to: ((start + width) / total) * duration,
    });
    start += width;
  }
  return chapters;
}

function buildSegmentCss(segments, duration, chapters) {
  if (!segments || segments.length === 0 || !(duration > 0)) return "";

  const items = segments
    .map((seg) => ({
      start: seg.segment[0],
      end: seg.segment[1],
      color: barTypes[seg.category] ? barTypes[seg.category].color : "blue",
    }))
    .sort((a, b) => a.end - a.start - (b.end - b.start)); // shorter segments on top

  let css = `${BAR_BASE_RULE} ${SLIDER_SELECTOR}::after { background: ${layersFor(items, 0, duration)}; }`;
  if (chapters) {
    for (let i = 0; i < chapters.length; i++) {
      const key = String(chapters[i].key).replace(/["\\]/g, "\\$&");
      css += ` ytlr-multi-markers-player-bar-renderer [idomkey="${key}"]::after { background: ${layersFor(items, chapters[i].from, chapters[i].to)}; }`;
    }
  }
  return css;
}

// Keeps only usable segments from the API's response for this video.
// A missing or empty response (including 404) yields no segments.
function pickSegments(results, videoID) {
  if (!Array.isArray(results)) return [];
  const result = results.find((v) => v.videoID === videoID);
  if (!result || !Array.isArray(result.segments)) return [];
  return result.segments.filter((seg) => {
    if (!seg.segment || seg.segment.length < 2) return false;
    const [start, end] = seg.segment;
    return typeof start === "number" && typeof end === "number" && start < end && start >= 0;
  });
}

class SponsorBlockHandler {
  video = null;
  active = true;
  configGen = -1;
  pendingSeekTimer = null;
  fetchTimer = null;
  request = null;
  barRetryTimer = null;
  barRetries = 0;
  barCss = "";
  wakeTimer = null;
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
  // True from the moment we set currentTime until its seeked event arrives.
  ownSeekPending = false;
  lastSkipSegment = null;
  landingRetries = 0;
  // UUID -> number of times a seek we did not make re-armed that segment.
  rearms = new Map();

  constructor(videoID) {
    this.videoID = videoID;
    this.scheduleSkipHandler = () => this.scheduleSkip();
    this.seekedHandler = () => this.onSeeked();
    this.durationChangeHandler = () => this.renderSegmentBar();
  }

  // Re-reads config only when it changed. Called on every timeupdate, so the
  // category lists are cached rather than rebuilt each time.
  refreshConfig() {
    if (this.configGen === configGeneration) return;
    const manual = configRead("sponsorBlockManualSkips");
    this.manualSkippableCategories = Array.isArray(manual) ? manual : [];
    this.skippableCategories = this.getSkippableCategories();
    this.configGen = configGeneration;
  }

  // Schedules the lookup. Nothing is requested until the video has stayed
  // open for FETCH_DELAY_MS; destroy() cancels a pending lookup.
  init() {
    this.fetchTimer = setTimeout(() => {
      this.fetchTimer = null;
      this.fetchSegments();
    }, FETCH_DELAY_MS);
  }

  // At most one request per handler. destroy() aborts it, so leaving a video
  // (or the API being down) never leaves a response waiting to arrive.
  fetchSegments() {
    if (!this.active) return;

    const cached = segmentCache.get(this.videoID);
    if (cached) {
      this.applySegments(cached);
      return;
    }

    const videoHash = sha256(this.videoID).substring(0, 4);
    const categories = [
      "sponsor",
      "intro",
      "outro",
      "interaction",
      "selfpromo",
      "preview",
      "filler",
      "music_offtopic",
      "poi_highlight",
    ];
    const request = getJSON(
      `${sponsorblockAPI}/skipSegments/${videoHash}?categories=${encodeURIComponent(JSON.stringify(categories))}`,
      FETCH_TIMEOUT_MS,
    );
    this.request = request;

    request.promise
      .then((results) => {
        if (this.request === request) this.request = null;
        if (!this.active) return;
        const segments = pickSegments(results, this.videoID);
        segmentCache.set(this.videoID, segments);
        this.applySegments(segments);
      })
      .catch((err) => {
        if (this.request === request) this.request = null;
        if (this.active) console.error("[AxoTube:sponsorblock] SponsorBlock init error:", err);
      });
  }

  applySegments(segments) {
    if (!this.active || segments.length === 0) return;
    this.segments = segments;
    this.refreshConfig();
    this.attachVideo();
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
    return (
      this.skippableCategories.includes(category) &&
      !this.manualSkippableCategories.includes(category)
    );
  }

  detachVideo() {
    this.stopWake();
    this.stopBarRetry();
    if (!this.video) return;
    try {
      this.video.removeEventListener("ratechange", this.scheduleSkipHandler);
      this.video.removeEventListener("play", this.scheduleSkipHandler);
      this.video.removeEventListener("pause", this.scheduleSkipHandler);
      this.video.removeEventListener("timeupdate", this.scheduleSkipHandler);
      this.video.removeEventListener("seeked", this.seekedHandler);
      this.video.removeEventListener("durationchange", this.durationChangeHandler);
    } catch (e) {}
  }

  // Keeps "already skipped" state only for segments the playhead has not yet
  // moved before. A new media element that resumes inside a segment we skipped
  // must not skip it again, while one restarting before it must.
  pruneHandled(now) {
    for (const [uuid, range] of this.handled) {
      if (now < range.start) this.handled.delete(uuid);
    }
  }

  attachVideo(nextVideo = getCurrentVideo()) {
    if (!this.active) return;
    if (currentSponsorVideoId() !== this.videoID) return;

    if (nextVideo !== this.video) {
      this.detachVideo();
      this.video = nextVideo;
      this.notSkippingToasted.clear();
      this.ownSeekTarget = null;
      this.barRetries = 0;
      if (nextVideo) {
        this.pruneHandled(nextVideo.currentTime);
        nextVideo.addEventListener("ratechange", this.scheduleSkipHandler);
        nextVideo.addEventListener("play", this.scheduleSkipHandler);
        nextVideo.addEventListener("pause", this.scheduleSkipHandler);
        nextVideo.addEventListener("timeupdate", this.scheduleSkipHandler);
        nextVideo.addEventListener("seeked", this.seekedHandler);
        nextVideo.addEventListener("durationchange", this.durationChangeHandler);
      }
    }

    if (!nextVideo) {
      // No element yet. watchVideo calls attachVideo again when one appears.
      this.stopWake();
      return;
    }

    this.renderSegmentBar();
    this.scheduleBarRetry();
    this.scheduleSkip();
  }

  // Re-renders the bar a few times at most, for chapter pieces that appear late.
  scheduleBarRetry() {
    if (this.barRetryTimer !== null || this.barRetries >= MAX_BAR_RETRIES) return;
    this.barRetries += 1;
    this.barRetryTimer = setTimeout(() => {
      this.barRetryTimer = null;
      this.renderSegmentBar();
      this.scheduleBarRetry();
    }, BAR_RETRY_MS);
  }

  stopBarRetry() {
    if (this.barRetryTimer !== null) clearTimeout(this.barRetryTimer);
    this.barRetryTimer = null;
  }

  // Rewrites the segment rules only when they change, so the bar timer and the
  // duration handler cost one string comparison when nothing moved.
  renderSegmentBar() {
    if (!this.active || !this.segments) return;
    const video = this.video || getCurrentVideo();
    const duration = video ? video.duration : 0;
    const css = buildSegmentCss(this.segments, duration, getChapters(duration));
    if (css === this.barCss) return;
    this.barCss = css;
    setSegmentStyle(css);
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
      this.stopWake();
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

    this.scheduleWake(now);
  }

  // One timer for the next segment that still needs a skip, at its start minus
  // the lookahead, scaled by playback rate. timeupdate still re-checks, so a
  // coarse update cadence cannot make a skip land late.
  scheduleWake(now) {
    this.stopWake();
    let nextStart = Infinity;
    for (const seg of this.segments) {
      const [start, end] = seg.segment;
      if (end <= now + END_EPSILON_S || start <= now + SKIP_LOOKAHEAD_S) continue;
      if (!this.isAutoSkippable(seg.category) || this.handled.has(seg.UUID)) continue;
      if (start < nextStart) nextStart = start;
    }
    if (nextStart === Infinity) return;
    const rate = Math.max(this.video.playbackRate || 1, 0.25);
    const delayMs = Math.max(MIN_WAKE_MS, ((nextStart - SKIP_LOOKAHEAD_S - now) / rate) * 1000);
    this.wakeTimer = setTimeout(() => {
      this.wakeTimer = null;
      this.scheduleSkip();
    }, delayMs);
  }

  stopWake() {
    if (this.wakeTimer !== null) clearTimeout(this.wakeTimer);
    this.wakeTimer = null;
  }

  // Shows the "not skipping" notice once when playback re-enters a segment
  // we just skipped (something reverted our seek).
  maybeToastRevert(segment, now) {
    const [start, end] = segment.segment;
    if (segment.UUID !== this.lastSkipUUID) return;
    if (Date.now() - this.lastSkipAt >= REVERT_TOAST_WINDOW_MS) return;
    if (now < start || now >= end) return;
    // Our own landing position is not a revert (tail segments land at end - 1).
    if (this.ownSeekTarget === null && Math.abs(now - this.lastSkipTarget) <= OWN_SEEK_TOLERANCE_S)
      return;
    if (this.notSkippingToasted.has(segment.UUID)) return;
    this.notSkippingToasted.add(segment.UUID);
    if (configRead("enableSponsorBlockToasts")) {
      const skipName = barTypes[segment.category]?.name || segment.category;
      showToast(
        t("app.name"),
        t("sponsorblock.toasts.notSkipping", { segment: skipName, count: 2 }),
      );
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
    this.lastSkipSegment = { start, end, UUID: segment.UUID };
    if (segment.UUID !== this.lastSkipUUID) this.landingRetries = 0;
    this.lastSkipUUID = segment.UUID;
    this.lastSkipAt = Date.now();
    this.seekToSegmentEnd(end);
    this.scheduleSkip();
  }

  // Our own skip seek. The flag stays set until its seeked event, however far
  // the landing is from the target.
  seekToSegmentEnd(end) {
    const skipTarget = this.video.duration - end < 1 ? Math.max(end - 1, 0) : end;
    this.ownSeekTarget = skipTarget;
    this.lastSkipTarget = skipTarget;
    this.ownSeekPending = true;
    if (this.pendingSeekTimer !== null) clearTimeout(this.pendingSeekTimer);
    this.pendingSeekTimer = setTimeout(() => {
      this.pendingSeekTimer = null;
      this.ownSeekPending = false;
    }, OWN_SEEK_PENDING_MAX_MS);
    this.video.currentTime = skipTarget;
  }

  // A seek we did not make re-arms handled segments the playhead landed inside.
  // Our own seek is recognised by the pending flag, not by distance, because
  // keyframe snapping can land it well before the target.
  onSeeked() {
    if (!this.video) return;
    const now = this.video.currentTime;
    if (this.ownSeekPending) {
      this.ownSeekPending = false;
      this.ownSeekTarget = null;
      if (this.pendingSeekTimer !== null) clearTimeout(this.pendingSeekTimer);
      this.pendingSeekTimer = null;
      const seg = this.lastSkipSegment;
      // A snap-back into the segment is not a rewind: seek to the end again,
      // a bounded number of times.
      if (
        seg &&
        now >= seg.start &&
        now < this.lastSkipTarget - OWN_SEEK_TOLERANCE_S &&
        this.landingRetries < MAX_LANDING_RETRIES
      ) {
        this.landingRetries += 1;
        this.seekToSegmentEnd(seg.end);
      }
      return;
    }
    for (const [uuid, range] of this.handled) {
      if (now >= range.end - END_EPSILON_S) continue;
      const count = this.rearms.get(uuid) || 0;
      if (count >= MAX_REARMS_PER_SEGMENT) continue;
      this.rearms.set(uuid, count + 1);
      this.handled.delete(uuid);
      this.notSkippingToasted.delete(uuid);
    }
    this.scheduleSkip();
  }

  destroy() {
    this.active = false;
    this.stopWake();
    this.stopBarRetry();
    if (this.pendingSeekTimer !== null) clearTimeout(this.pendingSeekTimer);
    this.pendingSeekTimer = null;
    if (this.fetchTimer !== null) {
      clearTimeout(this.fetchTimer);
      this.fetchTimer = null;
    }
    if (this.request) {
      const request = this.request;
      this.request = null;
      request.abort();
    }
    this.detachVideo();
    this.video = null;
    this.segments = null;
    this.barCss = "";
    setSegmentStyle("");
    this.handled.clear();
    this.rearms.clear();
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
      try {
        window.sponsorblock.destroy();
      } catch (err) {}
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
    try {
      window.sponsorblock.destroy();
    } catch (err) {}
  }
  window.sponsorblock = new SponsorBlockHandler(videoID);
  window.sponsorblock.init();
}

window.addEventListener("hashchange", syncSponsorBlockForCurrentRoute, false);
watchVideo((video) => {
  const handler = window.sponsorblock;
  if (handler && video && handler.segments) handler.attachVideo(video);
});
configChangeEmitter.addEventListener("configChange", (event) => {
  const key = event.detail?.key || "";
  if (
    key === "enableSponsorBlock" ||
    key === "sponsorBlockManualSkips" ||
    key.indexOf("enableSponsorBlock") === 0
  ) {
    configGeneration += 1;
    syncSponsorBlockForCurrentRoute();
  }
});

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", syncSponsorBlockForCurrentRoute);
} else {
  syncSponsorBlockForCurrentRoute();
}
