import { configRead } from "../config.js";
import { getCurrentPlayer, getCurrentVideo } from "../shared/playerLifecycle.js";

// One-press remote mode. On the watch page, with the controls hidden, OK
// toggles play/pause and left/right jump 10 seconds at once, with no scrub UI.
//
// Leanback keeps its normal behaviour whenever the press is not ours:
//  - the player controls are visible (arrows move the progress bar, OK
//    activates the focused control),
//  - focus is on a tile (arrows move around the grid),
//  - Shorts are showing.
// When the press is ours, its keydown and matching keyup are both stopped in
// the capture phase, so leanback never sees half a press.
// Adapted from the single-tap seek approach used in community userscripts.

const SEEK_STEP_S = 10;
const KEY_OK = 13;
const KEY_LEFT = 37;
const KEY_RIGHT = 39;
const CONTROL_SELECTORS = ["ytlr-player-page", "ytlr-player-actions-container", "ytlr-progress-bar"];

// Keys whose keydown we handled, so the matching keyup is swallowed too.
const handledKeys = {};

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

function seekBy(video, deltaSeconds) {
  const duration = video.duration;
  if (!(duration > 0)) return;
  const target = Math.max(0, Math.min(duration, video.currentTime + deltaSeconds));
  video.currentTime = target;
}

function stopPress(event) {
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
}

function onKeyDown(event) {
  const code = event.keyCode;
  if (code !== KEY_OK && code !== KEY_LEFT && code !== KEY_RIGHT) return;
  if (!configRead("enableOnePressMode") || !isWatching()) return;
  // Leanback owns the press in these cases, so it is not stopped here.
  if (focusIsOnTile(event.target) || controlsVisible()) return;

  const video = getCurrentVideo();
  if (!video) return;

  if (code === KEY_OK) togglePlayback(video);
  else seekBy(video, code === KEY_LEFT ? -SEEK_STEP_S : SEEK_STEP_S);

  handledKeys[code] = true;
  stopPress(event);
}

function onKeyUp(event) {
  const code = event.keyCode;
  if (!handledKeys[code]) return;
  delete handledKeys[code];
  stopPress(event);
}

window.addEventListener("keydown", onKeyDown, true);
window.addEventListener("keyup", onKeyUp, true);
