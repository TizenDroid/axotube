// Playback fix: while stringifying a playback-context request, the no-ad flag is
// set to true, and the caller's object is restored afterwards.
export function installPlaybackStringifyFix() {
  const origStringify = JSON.stringify;
  JSON.stringify = function (value, replacer, space) {
    const playbackContext = value?.playbackContext?.contentPlaybackContext;
    if (playbackContext && !playbackContext.isInlinePlaybackNoAd) {
      const hadOwnValue = Object.prototype.hasOwnProperty.call(playbackContext, "isInlinePlaybackNoAd");
      const previousValue = playbackContext.isInlinePlaybackNoAd;
      try {
        playbackContext.isInlinePlaybackNoAd = true;
        return origStringify.apply(this, arguments);
      } finally {
        if (hadOwnValue) playbackContext.isInlinePlaybackNoAd = previousValue;
        else delete playbackContext.isInlinePlaybackNoAd;
      }
    }
    return origStringify.apply(this, arguments);
  };
  window.JSON.stringify = JSON.stringify;
}
