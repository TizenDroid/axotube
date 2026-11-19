// Video previews (inline playback on focus).
import { configRead, cloneJSON } from "../config.js";
import { previewsEnabled } from "../shared/performanceMode.js";
import { isBootHeld } from "../shared/bootState.js";

// A preview plays muted unless "Preview sound" is on: audio decode runs on every browse page.

// Watch-page suggestions (including the continuation pages loaded while you
// scroll) must not preview: a preview starting over the suggestions takes over
// the video that is still playing.
function onWatchPage() {
  return /#\/watch/.test(location.hash || "");
}

let initialFocusHandled = false;

export function addPreviews(items) {
  if (!previewsEnabled()) return;
  if (onWatchPage()) return;
  // The tile that holds focus when the first screen appears (the first tile of the first batch,
  // while the splash is up) gets no preview. Its 3 s timer would otherwise run during the splash
  // and fire as soon as the splash clears. Every other tile keeps its preview.
  let initialFocusTile = isBootHeld() && !initialFocusHandled;
  const durationMs = configRead("previewLengthSeconds") * 1000; // read once, not per item
  for (const item of items) {
    if (!item.tileRenderer) continue;
    const watchEndpoint = item.tileRenderer.onSelectCommand?.watchEndpoint;
    if (!watchEndpoint) continue;
    if (item.tileRenderer?.onFocusCommand?.playbackEndpoint) continue;
    if (item.tileRenderer?.onFocusCommand?.commandExecutorCommand) continue;
    if (initialFocusTile) {
      initialFocusTile = false;
      initialFocusHandled = true;
      continue;
    }

    const copiedEndpoint = cloneJSON({ watchEndpoint });
    item.tileRenderer.onFocusCommand = {
      startInlinePlaybackCommand: {
        blockAdoption: true,
        caption: false,
        delayMs: 3000,
        durationMs,
        muted: !configRead("previewSound"),
        restartPlaybackBeforeSeconds: 10,
        resumeVideo: true,
        playbackEndpoint: copiedEndpoint,
      },
    };
  }
}
