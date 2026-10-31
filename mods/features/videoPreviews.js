// Video previews (inline playback on focus).
import { configRead, cloneJSON } from "../config.js";
import { previewsEnabled } from "../shared/performanceMode.js";

// Watch-page suggestions (including the continuation pages loaded while you
// scroll) must not preview: a preview starting over the suggestions takes over
// the video that is still playing.
function onWatchPage() {
  return /#\/watch/.test(location.hash || "");
}

export function addPreviews(items) {
  if (!previewsEnabled()) return;
  if (onWatchPage()) return;
  const durationMs = configRead("previewLengthSeconds") * 1000; // read once, not per item
  for (const item of items) {
    if (!item.tileRenderer) continue;
    const watchEndpoint = item.tileRenderer.onSelectCommand?.watchEndpoint;
    if (!watchEndpoint) continue;
    if (item.tileRenderer?.onFocusCommand?.playbackEndpoint) continue;
    if (item.tileRenderer?.onFocusCommand?.commandExecutorCommand) continue;

    const copiedEndpoint = cloneJSON({ watchEndpoint });
    item.tileRenderer.onFocusCommand = {
      startInlinePlaybackCommand: {
        blockAdoption: true,
        caption: false,
        delayMs: 3000,
        durationMs,
        muted: false,
        restartPlaybackBeforeSeconds: 10,
        resumeVideo: true,
        playbackEndpoint: copiedEndpoint,
      },
    };
  }
}
