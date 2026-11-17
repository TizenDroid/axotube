// SponsorBlock: skips the segments the community marked, and draws them on the progress bar.
//
// How it works:
//  - One request per video, by its full ID, sent the moment the video opens. Both
//    servers are asked at once and the first answer wins.
//  - Every category has one mode, read from the settings that already exist:
//    skip (skipped automatically), show (a skip button, see sponsorBlockActions.js)
//    or off. The settings UI is unchanged.
//  - A skip is one seek to the end of the segment, extended over any segment that
//    touches it. A run of segments is one seek and one toast.
//  - A segment is skipped at most once per pass. A viewer seek back before it
//    re-arms it, so rewinding past a skipped segment skips it again.
//  - The progress bar is redrawn after every seek, on duration changes and once a
//    second, so the segments come back when YouTube redraws its bar.
//
// The module is loaded through the userScript bundle; it only touches the DOM and
// the <video> element, so it runs on the Chromium the TV ships with.
import { configRead, configChangeEmitter } from "../config.js";
import { showToast } from "../ui/ytUI.js";
import { t } from "../translations/t.js";
import { getCurrentVideo, watchVideo } from "../shared/playerLifecycle.js";
import { getJSON } from "../shared/getJSON.js";
import { createBoundedCache } from "../shared/boundedCache.js";

// Times are in media seconds.
// A segment is skipped this far before its start, so its first frames never play.
const LEAD_S = 0.1;
// Segments starting this close to where a skip lands are part of the same jump.
const CHAIN_GAP_S = 0.25;
// A jump shorter than this is not worth a seek.
const MIN_MOVE_S = 0.25;
// A jump never lands in the last half second; the video then ends on its own.
const END_CLAMP_S = 0.5;
// A viewer seek this far before a segment re-arms it.
const REARM_MARGIN_S = 1;
// Within this of the next segment, the check runs every frame instead of per timeupdate.
const NEAR_S = 1.5;
// The TV seeks to the keyframe at or before the time asked for, so a skip can land short
// of its target, back before the segment it skips. The landing is verified, and each retry
// aims later by the next margin. Every retry target is strictly later than the one before,
// so the same timestamp is never asked for twice. The margins stop at a keyframe interval
// (KEYFRAME_SLACK_S): past that the skip gives up and the segment plays, rather than the
// seek going further into the video.
const SEEK_RETRY_MARGINS_S = [2, 5, 10];
const KEYFRAME_SLACK_S = 10;
// A landing this close to the target counts as landed.
const LANDING_TOLERANCE_S = 0.5;
// A seek that has not reported `seeked` by now is abandoned; the segment stays done.
const LANDING_MAX_MS = 4000;
// Back undoes the last skip only this long (media seconds) after it landed.
const UNDO_WINDOW_S = 10;
// A seek that never reports `seeked` stops blocking the check that runs each tick.
const SEEK_STUCK_MS = 2000;
// After a verified landing, a `seeked` report back before the skip's start (within a
// keyframe interval) is the decoder settling, not the viewer. Only for this long.
const SETTLE_MS = 3000;
// The segments of a video are the same when the element plays a video this long.
const DURATION_TOLERANCE_S = 3;
const FETCH_TIMEOUT_MS = 4000;
// While playing, the bar is checked from timeupdate at most this often (no timers).
const BAR_REFRESH_MS = 1000;
// Samsung TV remote Back key.
const KEY_BACK = 10009;

const SERVERS = ["https://sponsor.ajay.app/api", "https://sponsorblock.inf.re/api"];
const CATEGORIES = [
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
// The settings key that enables each skippable category.
const ENABLE_KEYS = {
  sponsor: "enableSponsorBlockSponsor",
  intro: "enableSponsorBlockIntro",
  outro: "enableSponsorBlockOutro",
  interaction: "enableSponsorBlockInteraction",
  selfpromo: "enableSponsorBlockSelfPromo",
  preview: "enableSponsorBlockPreview",
  filler: "enableSponsorBlockFiller",
  music_offtopic: "enableSponsorBlockMusicOfftopic",
};
const COLORS = {
  sponsor: "#00d400",
  intro: "#00ffff",
  outro: "#0202ed",
  interaction: "#cc00ff",
  selfpromo: "#ffff00",
  preview: "#008fd6",
  filler: "#7300FF",
  music_offtopic: "#ff9900",
  poi_highlight: "#9b044c",
};

const segmentCache = createBoundedCache(20);

// Segments are drawn with CSS on the progress bar's slider, the same way
// VacuumTube does it. The rules live in a <style> element in <head>, so a bar
// that leanback re-renders keeps them.
const STYLE_ID = "axotube-sponsorblock-segments";
const SLIDER_SELECTOR = 'ytlr-progress-bar [idomkey="slider"]';
const CHAPTER_PIECE_SELECTOR =
  'ytlr-multi-markers-player-bar-renderer [idomkey="progress-bar"] > [idomkey^="chapter-"]';
const CHAPTER_SELECTOR = 'ytlr-multi-markers-player-bar-renderer [idomkey^="chapter-"]';
const BAR_BASE_RULE = `${SLIDER_SELECTOR}::after, ${CHAPTER_SELECTOR}::after { content: ''; position: absolute; top: 0; right: 0; bottom: 0; left: 0; pointer-events: none; opacity: 0.7; }`;

function colorOf(category) {
  return COLORS[category] || "blue";
}

function categoryName(category) {
  return t(`sponsorblock.segments.${category}`) || category;
}

// Names without repeats, joined for a toast: "sponsored segment, self-promotion".
function joinNames(names) {
  const unique = [];
  for (let i = 0; i < names.length; i++) {
    if (unique.indexOf(names[i]) === -1) unique.push(names[i]);
  }
  return unique.join(", ");
}

// What a category does now. A category the settings disable is "off"; one listed in
// sponsorBlockManualSkips is "show"; the rest are "skip".
function modeOf(category, manual) {
  if (category === "poi_highlight") {
    return configRead("enableSponsorBlockHighlight") ? "highlight" : "off";
  }
  const key = ENABLE_KEYS[category];
  if (!key || !configRead(key)) return "off";
  return manual.indexOf(category) !== -1 ? "show" : "skip";
}

// Keeps only usable segments from the API's answer for one video, sorted by start
// (then longest first, so an enclosing segment comes before the ones inside it).
// Mutes and full-video labels are not segments to skip, and a segment the community
// has voted down is hidden, as the extension hides it.
function normalize(entries) {
  const out = [];
  let videoDuration = 0;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry || typeof entry.category !== "string" || !Array.isArray(entry.segment)) continue;
    const start = entry.segment[0];
    const end = entry.segment[1];
    if (typeof start !== "number" || typeof end !== "number") continue;
    if (!(start >= 0) || !(end > start)) continue;
    if (entry.actionType && entry.actionType !== "skip") continue;
    if (typeof entry.votes === "number" && entry.votes < 0) continue;
    if (typeof entry.videoDuration === "number" && entry.videoDuration > videoDuration) {
      videoDuration = entry.videoDuration;
    }
    out.push({
      key: String(entry.UUID || `${entry.category}:${start}:${end}`),
      category: entry.category,
      segment: [start, end],
      start,
      end,
      mode: "off",
    });
  }
  out.sort((a, b) => a.start - b.start || b.end - a.end);
  out.videoDuration = videoDuration;
  return out;
}

// Asks both servers for the segments of one video, by its full ID. The first answer
// wins: a 404 is an answer (no segments), a list is an answer, a failure is not.
// Resolves null only when neither server answered. abort() drops both requests.
function requestSegments(videoID) {
  const requests = [];
  let settled = false;
  const abortAll = () => {
    for (let i = 0; i < requests.length; i++) requests[i].abort();
  };
  const query = `videoID=${encodeURIComponent(videoID)}&service=YouTube&categories=${encodeURIComponent(
    JSON.stringify(CATEGORIES),
  )}`;

  const promise = new Promise((resolve) => {
    let failures = 0;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      abortAll();
      resolve(value);
    };
    const fail = () => {
      failures += 1;
      if (failures === SERVERS.length) finish(null);
    };
    for (let i = 0; i < SERVERS.length; i++) {
      const request = getJSON(`${SERVERS[i]}/skipSegments?${query}`, FETCH_TIMEOUT_MS);
      requests.push(request);
      request.promise.then((data) => {
        if (data === null) finish([]);
        else if (Array.isArray(data)) finish(data);
        else fail();
      }, fail);
    }
  });

  return {
    promise,
    abort() {
      settled = true;
      abortAll();
    },
  };
}

// The progress bar: the CSS rules for the segments, and where its chapter pieces are.
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

// Gradient stops for the segments inside [from, to] of the bar, as percentages of that range.
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

function buildSegmentCss(items, duration, chapters) {
  if (!items || items.length === 0 || !(duration > 0)) return "";
  // Shorter segments on top, so a long one does not hide the short ones inside it.
  const sorted = items.slice().sort((a, b) => a.end - a.start - (b.end - b.start));
  let css = `${BAR_BASE_RULE} ${SLIDER_SELECTOR}::after { background: ${layersFor(sorted, 0, duration)}; }`;
  if (chapters) {
    for (let i = 0; i < chapters.length; i++) {
      const key = String(chapters[i].key).replace(/["\\]/g, "\\$&");
      css += ` ytlr-multi-markers-player-bar-renderer [idomkey="${key}"]::after { background: ${layersFor(
        sorted,
        chapters[i].from,
        chapters[i].to,
      )}; }`;
    }
  }
  return css;
}

// Identifies the chapter pieces the bar is drawn in, so a redraw can tell whether they moved.
function chapterKey(chapters) {
  if (!chapters) return "-";
  let key = "";
  for (let i = 0; i < chapters.length; i++) {
    key += chapters[i].key + ":" + chapters[i].from + ":" + chapters[i].to + ";";
  }
  return key;
}

class SponsorBlockHandler {
  constructor(videoID) {
    this.videoID = videoID;
    this.destroyed = false;
    // Every segment the API gave, sorted, each with its mode.
    this.segments = [];
    // The segments the engine acts on (skip or show), in start order.
    this.active = [];
    // The segments the bar shows.
    this.drawn = [];
    // Identifies this.drawn (keys, edges and categories), and the CSS built for the bar.
    this.drawnKey = "";
    this.barKey = null;
    this.barCss = "";
    // key -> true once a segment has been skipped (or played through) in this pass.
    this.done = {};
    // { from, to, names } of the last skip, for Back.
    this.lastSkip = null;
    // The seek this engine issued and has not verified yet (see startSeek).
    this.pending = null;
    // { from, to, until }: the window in which the decoder may settle after a verified skip.
    this.settle = null;
    this.lastT = 0;
    this.videoDuration = 0;
    this.video = null;
    this.listeners = null;
    this.request = null;
    this.frameId = null;
    this.seekIssuedAt = 0;
    this.barAt = 0;

    this.onTick = () => this.tick();
    this.onSeeked = () => this.handleSeeked();
    this.onDuration = () => {
      this.redrawBar();
      this.tick();
    };
    this.frame = () => {
      this.frameId = null;
      this.tick();
    };

    this.refresh();
  }

  // Fetches the segments, or reuses the ones already fetched for this video.
  load() {
    const cached = segmentCache.get(this.videoID);
    if (cached) {
      this.apply(cached);
      return;
    }
    const request = requestSegments(this.videoID);
    this.request = request;
    request.promise.then(
      (entries) => {
        if (this.request !== request) return;
        this.request = null;
        if (this.destroyed || !entries) return;
        const segments = normalize(entries);
        segmentCache.set(this.videoID, segments);
        this.apply(segments);
      },
      () => {
        if (this.request === request) this.request = null;
      },
    );
  }

  apply(segments) {
    if (this.destroyed) return;
    this.segments = segments;
    this.videoDuration = segments.videoDuration || 0;
    this.refresh();
    this.tick();
  }

  // Recomputes each segment's mode from the settings. Called on load and on any
  // SponsorBlock setting change.
  refresh() {
    const manual = configRead("sponsorBlockManualSkips");
    const list = Array.isArray(manual) ? manual : [];
    const active = [];
    const drawn = [];
    for (let i = 0; i < this.segments.length; i++) {
      const seg = this.segments[i];
      seg.mode = modeOf(seg.category, list);
      if (seg.mode === "skip" || seg.mode === "show") active.push(seg);
      if (seg.mode !== "off") drawn.push(seg);
    }
    this.active = active;
    this.drawn = drawn;
    this.drawnKey = drawn.map((seg) => seg.key + ":" + seg.start + ":" + seg.end + ":" + seg.category).join(",");
    this.redrawBar();
  }

  // Follows the <video> element. Called when YouTube replaces it, and on creation.
  attach(video) {
    if (this.destroyed || video === this.video) return;
    this.detach();
    if (!video) return;
    this.video = video;
    this.lastT = video.currentTime || 0;
    this.listeners = [
      ["timeupdate", this.onTick],
      ["play", this.onTick],
      ["playing", this.onTick],
      ["ratechange", this.onTick],
      ["seeked", this.onSeeked],
      ["durationchange", this.onDuration],
      ["loadedmetadata", this.onDuration],
    ];
    for (let i = 0; i < this.listeners.length; i++) {
      video.addEventListener(this.listeners[i][0], this.listeners[i][1]);
    }
    this.redrawBar();
    this.tick();
  }

  detach() {
    if (this.video && this.listeners) {
      for (let i = 0; i < this.listeners.length; i++) {
        this.video.removeEventListener(this.listeners[i][0], this.listeners[i][1]);
      }
    }
    this.listeners = null;
    this.video = null;
    if (this.frameId !== null) {
      cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
  }

  // The one decision point. Runs on timeupdate, play, seeked and, near a segment,
  // every frame. Every decision is made from the current media time.
  tick() {
    const video = this.video;
    if (this.destroyed || !video) return;
    this.refreshBar();
    if (video.paused) return;
    if (video.seeking && Date.now() - this.seekIssuedAt < SEEK_STUCK_MS) return;
    const time = video.currentTime;
    if (!(time >= 0)) return;
    // A different media element (an ad, or the video restarted) is not this video.
    if (
      this.videoDuration > 0 &&
      isFinite(video.duration) &&
      Math.abs(video.duration - this.videoDuration) > DURATION_TOLERANCE_S
    ) {
      return;
    }
    // A seek this engine issued owns the playhead until it is verified. Nothing else is decided
    // meanwhile: a second skip from here would be a decision made on a position not yet trusted.
    if (this.pending) {
      if (Date.now() - this.pending.issuedAt < LANDING_MAX_MS) return;
      this.pending = null;
    }
    // Time going backwards with no seek event is a replay: segments ahead are armed again.
    if (time < this.lastT - REARM_MARGIN_S && !this.settling(time)) this.rearm(time);
    this.lastT = time;

    const index = this.dueIndex(time);
    if (index !== -1) this.skipAt(index, time);

    if (this.video && this.frameId === null && this.nearNext(this.video.currentTime)) {
      this.frameId = requestAnimationFrame(this.frame);
    }
  }

  // The first segment to skip at `time`, or -1. Sorted by start, so the scan stops at
  // the first segment still ahead of the lead window. While the playhead is inside a
  // manual ("show") segment nothing is skipped: the viewer is being shown that one.
  dueIndex(time) {
    if (this.inManual(time)) return -1;
    for (let i = 0; i < this.active.length; i++) {
      const seg = this.active[i];
      if (seg.start - LEAD_S > time) break;
      if (seg.mode !== "skip" || seg.end <= time || this.done[seg.key]) continue;
      return i;
    }
    return -1;
  }

  inManual(time) {
    for (let i = 0; i < this.active.length; i++) {
      const seg = this.active[i];
      if (seg.start > time) break;
      if (seg.mode === "show" && seg.end > time) return true;
    }
    return false;
  }

  // Where a skip at `index` lands: the end of that segment, extended over the skip
  // segments that follow it closely. A manual ("show") segment ahead of the playhead
  // ends the jump at its start, so it is shown rather than skipped; a segment the jump
  // only partly covers is left to be skipped after the manual one.
  jumpTarget(index, time) {
    const first = this.active[index];
    let to = first.end;
    let cut = false;
    const members = [first];
    for (let j = index + 1; j < this.active.length; j++) {
      const next = this.active[j];
      if (next.start > to + CHAIN_GAP_S) break;
      if (next.mode === "show") {
        if (next.start > time && next.start < to && next.start > first.start) {
          to = next.start;
          cut = true;
        }
        break;
      }
      members.push(next);
      if (next.end > to) to = next.end;
    }
    const duration = this.video ? this.video.duration : NaN;
    if (duration > 0 && to >= duration - END_CLAMP_S) {
      to = Math.max(0, duration - END_CLAMP_S);
    }
    const keys = [];
    const names = [];
    for (let m = 0; m < members.length; m++) {
      const seg = members[m];
      if (seg.start >= to) continue;
      names.push(categoryName(seg.category));
      if (!cut || seg.end <= to) keys.push(seg.key);
    }
    return { to, keys, names };
  }

  skipAt(index, time) {
    const seg = this.active[index];
    const jump = this.jumpTarget(index, time);
    for (let i = 0; i < jump.keys.length; i++) this.done[jump.keys[i]] = true;
    if (jump.to <= time + MIN_MOVE_S) return;
    this.startSeek({ kind: "skip", to: jump.to, from: seg.start, names: jump.names });
  }

  // Starts a seek the engine owns. The request is a target, not a position: the TV may land
  // earlier than asked, so handleSeeked checks where it landed before anything else happens.
  startSeek(seek) {
    seek.attempt = 0;
    seek.lastTarget = seek.to;
    seek.issuedAt = Date.now();
    this.pending = seek;
    this.seekTo(seek.to);
  }

  // A landing came up short: asks again, later than before. False when no later target is
  // left to ask for, so the caller gives up on this seek.
  retrySeek(seek) {
    if (seek.attempt >= SEEK_RETRY_MARGINS_S.length) return false;
    seek.attempt += 1;
    let target = seek.to + SEEK_RETRY_MARGINS_S[seek.attempt - 1];
    const duration = this.video ? this.video.duration : NaN;
    if (duration > 0 && target > duration - END_CLAMP_S) target = duration - END_CLAMP_S;
    if (!(target > seek.lastTarget + MIN_MOVE_S)) return false;
    seek.lastTarget = target;
    seek.issuedAt = Date.now();
    this.pending = seek;
    this.seekTo(target);
    return true;
  }

  // A skip is announced and becomes undoable once it has landed. Nothing else is announced.
  landed(seek) {
    if (seek.kind !== "skip") return;
    this.lastSkip = { from: seek.from, to: seek.to, names: seek.names };
    this.settle = { from: seek.from, to: seek.to, until: Date.now() + SETTLE_MS };
    if (configRead("enableSponsorBlockToasts")) {
      showToast(t("app.name"), t("sponsorblock.toasts.skipping", { segment: joinNames(seek.names) }));
    }
  }

  seekTo(target) {
    this.seekIssuedAt = Date.now();
    this.video.currentTime = target;
  }

  // A seek ends. A seek the engine issued is verified: it landed, or it is asked for again
  // at a later target. Any other seek is the viewer's: segments ahead of it are armed again.
  handleSeeked() {
    const video = this.video;
    if (this.destroyed || !video) return;
    const time = video.currentTime;
    const pending = this.pending;

    if (pending) {
      if (pending.kind === "undo") {
        // Back goes to before the segment. Landing early is what it asks for; the segment stays done.
        this.pending = null;
      } else if (time >= pending.to - LANDING_TOLERANCE_S) {
        this.pending = null;
        this.landed(pending);
      } else if (!this.retrySeek(pending)) {
        // No target in reach holds. The segment stays done and plays through: no loop, no toast.
        this.pending = null;
      }
    } else if (this.settling(time)) {
      // The decoder settled back before the skip's start by itself. Put the playhead back at the
      // landing, once per skip; the segments the skip covered stay done.
      const settle = this.settle;
      this.settle = null;
      this.startSeek({ kind: "settle", to: settle.to, from: settle.from, names: [] });
    } else {
      this.rearm(time);
      this.lastSkip = null;
      this.settle = null;
    }
    this.lastT = time;
    this.redrawBar();
    this.tick();
  }

  // Whether a time report belongs to the decoder settling after a verified skip: back before
  // the skip's start, within a keyframe interval, and inside the settle window.
  settling(time) {
    const settle = this.settle;
    if (!settle || Date.now() > settle.until) return false;
    return time >= settle.from - KEYFRAME_SLACK_S && time < settle.to - LANDING_TOLERANCE_S;
  }

  // A viewer seek back before a segment makes it skippable again.
  rearm(time) {
    for (let i = 0; i < this.active.length; i++) {
      const seg = this.active[i];
      if (seg.start > time + REARM_MARGIN_S) delete this.done[seg.key];
    }
  }

  // Whether the next segment still to skip is close enough to check every frame.
  nearNext(time) {
    for (let i = 0; i < this.active.length; i++) {
      const seg = this.active[i];
      if (seg.mode !== "skip" || seg.end <= time || this.done[seg.key]) continue;
      return seg.start - time < NEAR_S;
    }
    return false;
  }

  // Back, once after a skip: returns to where the skip began, and the segments it
  // covered play through. Returns false (and does nothing) when there is nothing to undo.
  tryUndoLastSkip() {
    const last = this.lastSkip;
    if (this.destroyed || !this.video || !last) return false;
    const since = this.video.currentTime - last.to;
    if (since < 0 || since > UNDO_WINDOW_S) return false;
    this.lastSkip = null;
    this.settle = null;
    this.startSeek({ kind: "undo", to: last.from, from: last.from, names: [] });
    if (configRead("enableSponsorBlockToasts")) {
      showToast(t("app.name"), t("sponsorblock.toasts.undone", { segment: joinNames(last.names) }));
    }
    return true;
  }

  // Re-draws the bar when the player may have rebuilt it. Runs from timeupdate, so it
  // needs no timer of its own.
  refreshBar() {
    const now = Date.now();
    if (now - this.barAt < BAR_REFRESH_MS) return;
    this.barAt = now;
    this.redrawBar();
  }

  // The bar's CSS depends only on the drawn segments, the duration and the chapter pieces, so
  // it is built again only when one of those changes. A redraw that finds nothing changed is
  // one query of the chapter pieces and one string comparison, not a rebuild of every gradient.
  redrawBar() {
    if (this.destroyed) return;
    const video = this.video || getCurrentVideo();
    const duration = video ? video.duration : 0;
    const chapters = getChapters(duration);
    const key = this.drawnKey + "|" + duration + "|" + chapterKey(chapters);
    if (key !== this.barKey) {
      const items = [];
      for (let i = 0; i < this.drawn.length; i++) {
        const seg = this.drawn[i];
        items.push({ start: seg.start, end: seg.end, color: colorOf(seg.category) });
      }
      this.barKey = key;
      this.barCss = buildSegmentCss(items, duration, chapters);
    }
    // Still compared on every redraw: if the page removes the rules, they come back here.
    setSegmentStyle(this.barCss);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    const request = this.request;
    this.request = null;
    if (request) request.abort();
    this.detach();
    setSegmentStyle("");
    this.done = {};
    this.lastSkip = null;
    this.pending = null;
    this.settle = null;
  }
}

window.sponsorblock = null;

// Back undoes a skip only while there is one to undo. Any other Back press goes to
// leanback unchanged. The keyup of a handled Back is swallowed too.
let backKeyUndone = false;
window.addEventListener(
  "keydown",
  function (event) {
    if (event.keyCode !== KEY_BACK) return;
    const handler = window.sponsorblock;
    if (!handler || !handler.tryUndoLastSkip()) return;
    backKeyUndone = true;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  },
  true,
);
window.addEventListener(
  "keyup",
  function (event) {
    if (event.keyCode !== KEY_BACK || !backKeyUndone) return;
    backKeyUndone = false;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  },
  true,
);

function currentVideoID() {
  const match = /[?&]v=([^&]+)/.exec(location.hash);
  return match ? match[1] : null;
}

function destroyCurrent() {
  const handler = window.sponsorblock;
  if (!handler) return;
  window.sponsorblock = null;
  try {
    handler.destroy();
  } catch (err) {}
}

// One handler per watched video, none off the watch page or while disabled.
function syncSponsorBlockForCurrentRoute() {
  const videoID = currentVideoID();
  if (!videoID || !configRead("enableSponsorBlock")) {
    destroyCurrent();
    return;
  }
  if (window.sponsorblock && window.sponsorblock.videoID === videoID) return;

  destroyCurrent();
  const handler = new SponsorBlockHandler(videoID);
  window.sponsorblock = handler;
  handler.load();
  handler.attach(getCurrentVideo());
}

window.addEventListener("hashchange", syncSponsorBlockForCurrentRoute, false);

watchVideo((video) => {
  const handler = window.sponsorblock;
  if (handler) handler.attach(video);
});

configChangeEmitter.addEventListener("configChange", (event) => {
  const key = (event.detail && event.detail.key) || "";
  if (key.indexOf("enableSponsorBlock") !== 0 && key !== "sponsorBlockManualSkips") return;
  const handler = window.sponsorblock;
  if (!handler || key === "enableSponsorBlock") {
    syncSponsorBlockForCurrentRoute();
    return;
  }
  handler.refresh();
  handler.tick();
});

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", syncSponsorBlockForCurrentRoute);
} else {
  syncSponsorBlockForCurrentRoute();
}
