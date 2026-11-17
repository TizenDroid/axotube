// Shared thumbnail-quality helpers.
//
// YouTube serves each video's thumbnail in fixed sizes. The user picks the size they
// want (the preferred size); tiles get that size and the sizes below it, never anything
// larger, so a small tile does not download a 1280x720 image it cannot show.
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

// Every video has these files. maxresdefault and sddefault can be missing (older or
// unlisted uploads), so only those are checked before they are used.
const ALWAYS_PRESENT = { hq: true, mq: true, default: true };
export const DEFAULT_THUMBNAIL_QUALITY = "hq";

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
// Keyed by preferred size and video, so changing the preference never reuses a stale answer.
export const hqQualityCache = createBoundedCache(MAX_HQ_CACHE_ENTRIES);
// key -> callbacks waiting on an in-flight check.
export const hqPendingTesters = new Map();

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

export function extractVideoIdFromThumbnailUrl(url) {
  if (!url || !url.includes("i.ytimg.com/vi/")) return null;
  const match = url.match(/\/vi\/([a-zA-Z0-9_-]+)\//);
  return match ? match[1] : null;
}

// The file to show for a video at the preferred size: the preferred file when it exists,
// otherwise the next size down. Files that always exist need no request at all. Only
// maxresdefault and sddefault are checked, once per video and preference, and the answer
// is cached. The 120x90 image YouTube returns for a missing file counts as missing.
export function probeBestThumbnailQuality(videoId, preferredId, onResult) {
  if (!videoId || typeof onResult !== "function") return;
  const chain = thumbnailChain(preferredId);
  const key = chain[0].id + "|" + videoId;

  const cached = hqQualityCache.get(key);
  if (cached) {
    onResult(cached);
    return;
  }

  if (hqPendingTesters.has(key)) {
    hqPendingTesters.get(key).push(onResult);
    return;
  }

  hqPendingTesters.set(key, [onResult]);
  const finish = (file) => {
    const waiters = hqPendingTesters.get(key) || [];
    hqPendingTesters.delete(key);
    hqQualityCache.set(key, file);
    waiters.forEach((cb) => {
      try {
        cb(file);
      } catch (e) {}
    });
  };

  // Walks down the chain. A file that always exists ends the walk without a request.
  const check = (index) => {
    const entry = chain[index];
    if (ALWAYS_PRESENT[entry.id]) {
      finish(entry.file);
      return;
    }
    const tester = new Image();
    tester.onload = function () {
      const isPlaceholder = this.naturalWidth === 120 && this.naturalHeight === 90;
      if (isPlaceholder) check(index + 1);
      else finish(entry.file);
    };
    tester.onerror = () => check(index + 1);
    tester.src = `https://i.ytimg.com/vi/${videoId}/${entry.file}`;
  };
  check(0);
}

export function isVideoThumbnailArray(thumbnails) {
  return (
    Array.isArray(thumbnails) &&
    thumbnails.length > 0 &&
    thumbnails[0].width &&
    thumbnails[0].width > 100
  );
}
