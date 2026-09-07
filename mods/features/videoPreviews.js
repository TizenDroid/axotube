// Video previews (inline playback on focus).
import { configRead, nativeJSONParse, nativeJSONStringify } from "../config.js";

export function addPreviews(items) {
  if (!configRead("enablePreviews")) return;
  for (const item of items) {
    if (!item.tileRenderer) continue;
    const watchEndpoint = item.tileRenderer.onSelectCommand?.watchEndpoint;
    if (!watchEndpoint) continue;
    if (item.tileRenderer?.onFocusCommand?.playbackEndpoint) continue;
    if (item.tileRenderer?.onFocusCommand?.commandExecutorCommand) continue;

    const copiedEndpoint = nativeJSONParse(nativeJSONStringify({ watchEndpoint }));
    item.tileRenderer.onFocusCommand = {
      startInlinePlaybackCommand: {
        blockAdoption: true,
        caption: false,
        delayMs: 3000,
        durationMs: 40000,
        muted: false,
        restartPlaybackBeforeSeconds: 10,
        resumeVideo: true,
        playbackEndpoint: copiedEndpoint,
      },
    };
  }
}
