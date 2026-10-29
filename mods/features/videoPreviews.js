// Video previews (inline playback on focus).
import { configRead, cloneJSON } from "../config.js";

export function addPreviews(items) {
  if (!configRead("enablePreviews")) return;
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
