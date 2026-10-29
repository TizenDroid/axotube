// Pauses playback when the app goes to the background, for example when the TV
// shows its own system UI. Off by default. While enabled, the visibility change
// is stopped before YouTube's own handlers see it, so the two never both act on
// playback. Resuming is left to the viewer. Ported from VacuumTube's pause-on-blur.
import { configRead } from "../config.js";
import { getCurrentPlayer, getCurrentVideo } from "../shared/playerLifecycle.js";

function pausePlayback() {
  const player = getCurrentPlayer();
  if (player && typeof player.pauseVideo === "function") {
    try {
      player.pauseVideo();
      return;
    } catch (err) {
      // Fall through to the media element.
    }
  }
  const video = getCurrentVideo();
  if (video && !video.paused) video.pause();
}

// Capture on window: runs before the document's own listeners, so the stop
// takes effect for YouTube's handlers too.
window.addEventListener(
  "visibilitychange",
  (event) => {
    if (!configRead("enablePauseOnBlur")) return;
    if (!document.hidden) return;
    event.stopImmediatePropagation();
    pausePlayback();
  },
  true,
);
