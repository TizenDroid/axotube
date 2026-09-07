// Hide watched videos.
import { configRead } from "../config.js";

function parseHashParams(hash) {
  const params = {};
  const q = hash.indexOf("?");
  if (q === -1) return params;
  const query = hash.slice(q + 1).split("&");
  for (let i = 0; i < query.length; i++) {
    if (!query[i]) continue;
    const eq = query[i].indexOf("=");
    const rawKey = eq === -1 ? query[i] : query[i].slice(0, eq);
    const rawValue = eq === -1 ? "" : query[i].slice(eq + 1);
    try {
      params[decodeURIComponent(rawKey)] = decodeURIComponent(rawValue);
    } catch (e) {
      params[rawKey] = rawValue;
    }
  }
  return params;
}

export function hideVideo(items) {
  if (!configRead("enableHideWatchedVideos")) return items;
  const pages = configRead("hideWatchedVideosPages");
  if (!pages || !pages.length) return items;
  const threshold = configRead("hideWatchedVideosThreshold");
  const hash = location.hash.substring(1);
  const params = parseHashParams(hash);
  const browseId = params.browseId || params.browse_id || "";
  const pageName =
    hash === "/"
      ? "home"
      : hash.startsWith("/search")
        ? "search"
        : browseId.replace("FE", "").replace("topics_", "");
  if (!pages.includes(pageName)) return items;

  return items.filter((item) => {
    if (!item.tileRenderer) return true;
    const progressBar =
      item.tileRenderer.header?.tileHeaderRenderer?.thumbnailOverlays?.find(
        (overlay) => overlay.thumbnailOverlayResumePlaybackRenderer,
      )?.thumbnailOverlayResumePlaybackRenderer;
    if (!progressBar) return true;
    const percentWatched = progressBar.percentDurationWatched || 0;
    return percentWatched <= threshold;
  });
}
