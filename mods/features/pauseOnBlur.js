// Out-of-focus pause. Pauses playback in two cases, both behind one setting:
//   1. The page goes to the background (for example the TV shows its own system UI).
//   2. A menu or panel opens over the video (settings dropdown, description,
//      comments, and similar). The app can't really be left, so this is the
//      case that matters most on the TV.
// Off by default. Resuming is left to the viewer.
import { configRead } from "../config.js";
import { getCurrentPlayer, getCurrentVideo } from "../shared/playerLifecycle.js";
import { isOverlayOpenCommand } from "./overlayState.js";

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

// Called by the resolver for every command, before it is dispatched.
export function pauseForOpenedOverlay(cmd) {
  if (!configRead("enablePauseOnBlur")) return;
  if (isOverlayOpenCommand(cmd)) pausePlayback();
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
