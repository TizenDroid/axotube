// DeArrow – community-approved video titles & thumbnails.
//
// This module also keeps each video's original title and thumbnail, and the
// DeArrow data, even when both DeArrow settings are off. The long-press peek
// (deArrowPeek.js) needs both versions to show the one that is not on screen.
import { configRead } from "../config.js";
import { fetchWithTimeout } from "../shared/fetch.js";
import { createBoundedCache } from "../shared/boundedCache.js";

export const MAX_DEARROW_CACHE_ENTRIES = 256;
const deArrowCache = createBoundedCache(MAX_DEARROW_CACHE_ENTRIES);
const originalByVideoId = createBoundedCache(MAX_DEARROW_CACHE_ENTRIES);

export function deArrowTitleFor(data) {
  if (!data || !data.titles || data.titles.length === 0) return null;
  return data.titles.reduce((max, title) => (max.votes > title.votes ? max : title)).title;
}

// Returns the thumbnail array DeArrow would show, or null.
export function deArrowThumbnailsFor(videoId, data) {
  if (!data || !data.thumbnails || data.thumbnails.length === 0) return null;
  const best = data.thumbnails.reduce((max, thumbnail) =>
    max.votes > thumbnail.votes ? max : thumbnail,
  );
  if (best.timestamp === undefined || best.timestamp === null) return null;
  if (!Number.isFinite(Number(best.timestamp))) return null;
  return [
    {
      url: `https://dearrow-thumb.ajay.app/api/v1/getThumbnail?videoID=${videoId}&time=${best.timestamp}`,
      width: 1280,
      height: 640,
    },
  ];
}

// The DeArrow data for a video, once it has been fetched. Null before that.
export function getDeArrowData(videoId) {
  const entry = deArrowCache.get(videoId);
  return entry && entry.data ? entry.data : null;
}

// The original title and thumbnails as YouTube sent them, recorded before DeArrow changed them.
export function getOriginalTile(videoId) {
  return originalByVideoId.get(videoId) || null;
}

function applyDeArrow(item, videoId, data, titlesEnabled, thumbnailsEnabled) {
  try {
    if (titlesEnabled && data.titles && data.titles.length > 0) {
      const title = deArrowTitleFor(data);
      if (item.tileRenderer?.metadata?.tileMetadataRenderer?.title) {
        item.tileRenderer.metadata.tileMetadataRenderer.title.simpleText = title;
      }
    }

    if (thumbnailsEnabled) {
      const thumbnails = deArrowThumbnailsFor(videoId, data);
      if (thumbnails && item.tileRenderer?.header?.tileHeaderRenderer?.thumbnail) {
        item.tileRenderer.header.tileHeaderRenderer.thumbnail.thumbnails = thumbnails;
      }
    }
  } catch (e) {
    console.warn("[AxoTube:deArrow] Error processing DeArrow data:", e);
  }
}

function recordOriginal(item, videoId) {
  if (originalByVideoId.get(videoId)) return;
  const tile = item.tileRenderer;
  originalByVideoId.set(videoId, {
    title: tile?.metadata?.tileMetadataRenderer?.title?.simpleText ?? null,
    thumbnails: tile?.header?.tileHeaderRenderer?.thumbnail?.thumbnails ?? null,
  });
}

export function deArrowify(items) {
  const titlesEnabled = configRead("enableDeArrowTitles");
  const thumbnailsEnabled = configRead("enableDeArrowThumbnails");
  // The fetch also runs when DeArrow is off, so the peek has data to show.
  const peekEnabled = configRead("enableDeArrowPeek");
  if (!titlesEnabled && !thumbnailsEnabled && !peekEnabled) return;

  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.adSlotRenderer) {
      items.splice(i, 1);
      continue;
    }
    if (!item.tileRenderer) continue;
    const videoId = item.tileRenderer.contentId;
    if (!videoId) continue;

    recordOriginal(item, videoId);

    const waiter = { item, titlesEnabled, thumbnailsEnabled };
    const cached = deArrowCache.get(videoId);
    if (cached) {
      if (cached.data) {
        applyDeArrow(item, videoId, cached.data, titlesEnabled, thumbnailsEnabled);
      } else if (Array.isArray(cached.waiters)) {
        cached.waiters.push(waiter);
      }
      continue;
    }

    const entry = { data: null, waiters: [waiter] };
    deArrowCache.set(videoId, entry);

    fetchWithTimeout(`https://sponsor.ajay.app/api/branding?videoID=${videoId}`)
      .then((res) => {
        if (!res.ok) throw new Error(`DeArrow HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        entry.data = data;
        const waiters = entry.waiters.slice();
        entry.waiters.length = 0;
        for (const pending of waiters) {
          applyDeArrow(
            pending.item,
            videoId,
            data,
            pending.titlesEnabled,
            pending.thumbnailsEnabled,
          );
        }
      })
      .catch(() => {
        if (deArrowCache.get(videoId) === entry) deArrowCache.delete(videoId);
      });
  }
}

export function resetDeArrowCache(videoID) {
  if (videoID) {
    deArrowCache.delete(videoID);
    return;
  }
  deArrowCache.clear();
}
