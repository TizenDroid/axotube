// Shared thumbnail-quality helpers.
//
// YouTube serves each video's thumbnail in fixed sizes. The preferred size (from settings)
// is where a tile starts. When that file is missing, the tile steps down one size at a time
// until a file exists. Tiles never get a size above the preference.
import { createBoundedCache } from "./boundedCache.js";

// Largest first. The sizes are the real pixel sizes of each file: YouTube does not serve
// 1080p thumbnails, so 720p is the largest.
export const THUMBNAIL_FILES = [
  { id: "max", file: "maxresdefault.jpg", width: 1280, height: 720 },
  { id: "sd", file: "sddefault.jpg", width: 640, height: 480 },
  { id: "hq", file: "hqdefault.jpg", width: 480, height: 360 },
  { id: "mq", file: "mqdefault.jpg", width: 320, height: 180 },
  { id: "default", file: "default.jpg", width: 120, height: 90 },
];

export const THUMBNAIL_URLS = THUMBNAIL_FILES.map((entry) => entry.file);
export const THUMBNAIL_SIZES = {};
THUMBNAIL_FILES.forEach((entry) => {
  THUMBNAIL_SIZES[entry.file] = { width: entry.width, height: entry.height };
});

export const DEFAULT_THUMBNAIL_QUALITY = "max";

export function resolveThumbnailQuality(value) {
  for (let i = 0; i < THUMBNAIL_FILES.length; i++) {
    if (THUMBNAIL_FILES[i].id === value) return value;
  }
  return DEFAULT_THUMBNAIL_QUALITY;
}

// The preferred size and every smaller one, in order. Never larger than the preference.
export function thumbnailChain(preferredId) {
  const id = resolveThumbnailQuality(preferredId);
  let start = 0;
  for (let i = 0; i < THUMBNAIL_FILES.length; i++) {
    if (THUMBNAIL_FILES[i].id === id) start = i;
  }
  return THUMBNAIL_FILES.slice(start);
}

export function buildThumbnailArray(videoID, preferredId) {
  return thumbnailChain(preferredId).map((entry) => ({
    url: `https://i.ytimg.com/vi/${videoID}/${entry.file}`,
    width: entry.width,
    height: entry.height,
  }));
}

export const MAX_HQ_CACHE_ENTRIES = 256;
// Resolved file per preferred size and video, so a file is looked up once.
export const hqQualityCache = createBoundedCache(MAX_HQ_CACHE_ENTRIES);

export function extractVideoIdFromThumbnailUrl(url) {
  if (!url || !url.includes("i.ytimg.com/vi/")) return null;
  const match = url.match(/\/vi\/([a-zA-Z0-9_-]+)\//);
  return match ? match[1] : null;
}

// The thumbnail file a URL names (for example "sddefault.jpg"), or null for any other URL.
export function fileOfThumbnailUrl(url) {
  if (!url || url.indexOf("i.ytimg.com/vi/") === -1) return null;
  const match = /\/(maxresdefault|sddefault|hqdefault|mqdefault|default)\.jpg/.exec(url);
  return match ? match[1] + ".jpg" : null;
}

// The next smaller file, or null when the file is already the smallest.
export function nextLowerFile(file) {
  for (let i = 0; i < THUMBNAIL_FILES.length - 1; i++) {
    if (THUMBNAIL_FILES[i].file === file) return THUMBNAIL_FILES[i + 1].file;
  }
  return null;
}

// YouTube answers a missing maxresdefault or sddefault with a 120x90 placeholder rather than an
// error. default.jpg is 120x90 by design, so it is never a placeholder.
export function isPlaceholderImage(width, height, file) {
  return file !== "default.jpg" && width === 120 && height === 90;
}

// The file to show for a video at the preferred size: the preferred file when it loads, else
// the next size down. The image that is loaded here is the one the tile then shows, so there is
// no separate check request. onResolved gets the file name.
export function resolveThumbnailFile(videoId, preferredId, onResolved, ImageCtor) {
  const chain = thumbnailChain(preferredId);
  const key = chain[0].id + "|" + videoId;
  const cached = hqQualityCache.get(key);
  if (cached) {
    onResolved(cached);
    return;
  }
  const tryAt = function (index) {
    const entry = chain[index];
    const img = new ImageCtor();
    img.onload = function () {
      if (isPlaceholderImage(this.naturalWidth, this.naturalHeight, entry.file) && index + 1 < chain.length) {
        tryAt(index + 1);
        return;
      }
      hqQualityCache.set(key, entry.file);
      onResolved(entry.file);
    };
    img.onerror = function () {
      if (index + 1 < chain.length) tryAt(index + 1);
      else onResolved(entry.file);
    };
    img.src = "https://i.ytimg.com/vi/" + videoId + "/" + entry.file;
  };
  tryAt(0);
}

// Background warm-up of the preferred thumbnail for each new tile. The image is not attached
// to the page, so the browser fetches the bytes without decoding them for display. At most
// PREFETCH_CONCURRENCY requests run at once, each URL is requested once per PREFETCH_MEMORY
// recent URLs, and when the queue is full the oldest waiting request is dropped.
export const PREFETCH_CONCURRENCY = 2;
export const PREFETCH_MEMORY = 600;
export const PREFETCH_QUEUE_MAX = 120;

export function createPrefetcher(ImageCtor) {
  const seenOrder = [];
  const seen = {};
  const queue = [];
  let active = 0;

  function remember(url) {
    seen[url] = true;
    seenOrder.push(url);
    if (seenOrder.length > PREFETCH_MEMORY) delete seen[seenOrder.shift()];
  }

  function pump() {
    while (active < PREFETCH_CONCURRENCY && queue.length > 0) {
      const url = queue.shift();
      active += 1;
      const img = new ImageCtor();
      const done = function () {
        active -= 1;
        pump();
      };
      img.onload = done;
      img.onerror = done;
      img.src = url;
    }
  }

  return {
    enqueue: function (urls) {
      for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        if (!url || seen[url]) continue;
        remember(url);
        if (queue.length >= PREFETCH_QUEUE_MAX) queue.shift();
        queue.push(url);
      }
      pump();
    },
    pending: function () {
      return queue.length + active;
    },
  };
}

export function isVideoThumbnailArray(thumbnails) {
  return (
    Array.isArray(thumbnails) &&
    thumbnails.length > 0 &&
    thumbnails[0].width &&
    thumbnails[0].width > 100
  );
}
