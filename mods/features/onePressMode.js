import { configRead } from "../config.js";
import { getCurrentPlayer, getCurrentVideo } from "../shared/playerLifecycle.js";

// One-press remote mode. On the watch page, with the controls hidden:
//   OK                  toggles play/pause (only while focus is on the player).
//   Left / right tap    seeks. Presses that follow each other within the
//                       streak window stack: 10s, then 30s, then 60s, and the
//                       target keeps moving from where the last press aimed.
//   Right, held         after HOLD_MS, plays at HOLD_RATE until release.
//   Left, held          after HOLD_MS, rewinds REWIND_STEP_S every
//                       REWIND_TICK_MS until release (a rate cannot rewind).
//
// Leanback keeps its normal behaviour whenever the press is not ours: the
// controls are visible (arrows move the progress bar), focus is on a tile, or
// Shorts are showing. When the press is ours, its keydown and keyup are both
// stopped in the capture phase, so leanback never sees half a press.
//
// Every number is a constant here. The thresholds come from how the remote
// behaves: a repeat within MIN_PRESS_MS is contact bounce, not a new press, and
// a press held past HOLD_MS is a hold.

const KEY_OK = 13;
const KEY_LEFT = 37;
const KEY_RIGHT = 39;
const CONTROL_SELECTORS = ["ytlr-player-page", "ytlr-player-actions-container", "ytlr-progress-bar"];

const TAP_STEPS_S = [10, 30, 60];
const STREAK_WINDOW_MS = 1000;
const MIN_PRESS_MS = 100;
const HOLD_MS = 1000;
const HOLD_RATE = 2;
const REWIND_STEP_S = 10;
const REWIND_TICK_MS = 300;

// Keys we handled on keydown: their keyup is swallowed too.
const handledKeys = {};
// Presses in progress, keyed by key code.
const held = {};
const lastDownAt = {};
// Streak state for tap stacking.
let streakDir = 0;
let streakCount = 0;
let streakEndedAt = -Infinity;
let pendingTarget = null;

function isWatching() {
  if (!/[?&]v=[^&]+/.test(window.location.hash || "")) return false;
  const shorts = document.querySelector("ytlr-shorts-page");
  if (shorts && shorts.classList && shorts.classList.contains("zylon-focus")) return false;
  return true;
}

function isHiddenByAncestor(el) {
  for (let node = el; node && node !== document; node = node.parentNode) {
    if (node.getAttribute && node.getAttribute("aria-hidden") === "true") return true;
    if (node.classList && node.classList.contains("zylon-hidden")) return true;
    const style = window.getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") return true;
  }
  return false;
}

function controlsVisible() {
  for (let i = 0; i < CONTROL_SELECTORS.length; i++) {
    const el = document.querySelector(CONTROL_SELECTORS[i]);
    if (!el || isHiddenByAncestor(el)) continue;
    const style = window.getComputedStyle(el);
    if (
      style.visibility !== "hidden" &&
      parseFloat(style.opacity) > 0 &&
      el.getClientRects().length > 0
    ) {
      return true;
    }
  }
  return false;
}

function focusIsOnTile(target) {
  const tile = target && target.closest ? target.closest("ytlr-tile-renderer") : null;
  return !!tile && !isHiddenByAncestor(tile);
}

// Leanback marks the focused element with zylon-focus. If that focus is anywhere
// outside the player (a settings item, a sidebar tile, a suggestion), the press
// belongs to that element and must not seek or pause this video. This is what
// keeps arrows working in menus and OK from pausing while you browse.
function focusIsOutsidePlayer() {
  const focused = document.querySelectorAll(".zylon-focus");
  for (let i = 0; i < focused.length; i++) {
    const el = focused[i];
    if (isHiddenByAncestor(el)) continue;
    const inPlayer = el.closest && el.closest("ytlr-player-page, ytlr-player-actions-container, ytlr-progress-bar");
    if (!inPlayer) return true;
  }
  return false;
}

function togglePlayback(video) {
  const player = getCurrentPlayer();
  let playing = !video.paused;
  try {
    const state = player && player.getPlayerStateObject && player.getPlayerStateObject();
    if (state && typeof state.isPlaying === "boolean") playing = state.isPlaying;
  } catch (e) {}

  try {
    if (player && typeof (playing ? player.pauseVideo : player.playVideo) === "function") {
      if (playing) player.pauseVideo();
      else player.playVideo();
      return;
    }
  } catch (e) {}

  if (playing) video.pause();
  else video.play();
}

function setRate(video, rate) {
  const player = getCurrentPlayer();
  try {
    if (player && typeof player.setPlaybackRate === "function") {
      player.setPlaybackRate(rate);
      return;
    }
  } catch (e) {}
  video.playbackRate = rate;
}

function clampTarget(video, t) {
  const duration = video.duration;
  if (!(duration > 0)) return null;
  return Math.max(0, Math.min(duration, t));
}

function seekTo(video, t) {
  const target = clampTarget(video, t);
  if (target === null) return;
  video.currentTime = target;
}

function stopPress(event) {
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
}

function tapStep(dir, now) {
  const continuing = dir === streakDir && now - streakEndedAt <= STREAK_WINDOW_MS;
  streakCount = continuing ? streakCount + 1 : 0;
  streakDir = dir;
  if (!continuing) pendingTarget = null;
  return TAP_STEPS_S[Math.min(streakCount, TAP_STEPS_S.length - 1)];
}

function onHoldStart(code, video) {
  const entry = held[code];
  if (!entry) return;
  entry.timer = null;
  if (code === KEY_RIGHT) {
    if (video.paused) return;
    entry.rateBefore = video.playbackRate || 1;
    setRate(video, HOLD_RATE);
  } else if (code === KEY_LEFT) {
    entry.ticker = setInterval(() => {
      const v = getCurrentVideo();
      if (!v) return;
      pendingTarget = null;
      seekTo(v, v.currentTime - REWIND_STEP_S);
    }, REWIND_TICK_MS);
  }
}

function onKeyDown(event) {
  const code = event.keyCode;
  if (code !== KEY_OK && code !== KEY_LEFT && code !== KEY_RIGHT) return;
  if (!configRead("enableOnePressMode") || !isWatching()) return;
  // Leanback owns the press in these cases, so it is not stopped here.
  if (focusIsOnTile(event.target) || focusIsOutsidePlayer() || controlsVisible()) return;

  const video = getCurrentVideo();
  if (!video) return;

  // Auto-repeat while the key is already down: the hold is running, nothing new.
  if (held[code]) {
    stopPress(event);
    return;
  }

  const now = Date.now();
  // Contact bounce right after a press is not a new press.
  if (lastDownAt[code] !== undefined && now - lastDownAt[code] < MIN_PRESS_MS) {
    stopPress(event);
    return;
  }
  lastDownAt[code] = now;

  if (code === KEY_OK) {
    togglePlayback(video);
    held[code] = { timer: null };
  } else {
    const dir = code === KEY_LEFT ? -1 : 1;
    const step = tapStep(dir, now) * dir;
    const base = streakCount > 0 && pendingTarget !== null ? pendingTarget : video.currentTime;
    const target = clampTarget(video, base + step);
    if (target !== null) {
      pendingTarget = target;
      video.currentTime = target;
    }
    held[code] = { timer: setTimeout(() => onHoldStart(code, getCurrentVideo()), HOLD_MS) };
  }

  handledKeys[code] = true;
  stopPress(event);
}

function onKeyUp(event) {
  const code = event.keyCode;
  if (!handledKeys[code]) return;
  delete handledKeys[code];
  stopPress(event);

  const entry = held[code];
  delete held[code];
  if (!entry) return;
  if (entry.timer) clearTimeout(entry.timer);
  if (entry.ticker) clearInterval(entry.ticker);
  if (entry.rateBefore !== undefined) {
    const v = getCurrentVideo();
    if (v) setRate(v, entry.rateBefore);
  }
  if (code !== KEY_OK) streakEndedAt = Date.now();
}

window.addEventListener("keydown", onKeyDown, true);
window.addEventListener("keyup", onKeyUp, true);
