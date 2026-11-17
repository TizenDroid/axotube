// Thumbnails YouTube does not have at the requested size. Every tile starts at the preferred
// size. When that file is missing (an error, or the 120x90 placeholder YouTube returns), the
// tile steps down one size at a time until a file exists. This covers every tile on the page,
// not only the focused one, and needs no request ahead of time: the page's own image load is
// the check.
import {
  extractVideoIdFromThumbnailUrl,
  fileOfThumbnailUrl,
  isPlaceholderImage,
  nextLowerFile,
} from "../shared/hqThumbnails.js";

export function onThumbnailImageEvent(event) {
  const img = event && event.target;
  if (!img || img.tagName !== "IMG") return false;
  const src = img.getAttribute("src") || "";
  const file = fileOfThumbnailUrl(src);
  if (!file) return false;
  const missing =
    event.type === "error" ||
    (event.type === "load" && isPlaceholderImage(img.naturalWidth, img.naturalHeight, file));
  if (!missing) return false;
  const lower = nextLowerFile(file);
  const videoId = extractVideoIdFromThumbnailUrl(src);
  if (!lower || !videoId) return false;
  img.setAttribute("src", "https://i.ytimg.com/vi/" + videoId + "/" + lower);
  return true;
}

// Capture phase: image load and error events do not bubble.
export function installThumbnailFallback(doc) {
  if (!doc || typeof doc.addEventListener !== "function") return false;
  doc.addEventListener("error", onThumbnailImageEvent, true);
  doc.addEventListener("load", onThumbnailImageEvent, true);
  return true;
}
