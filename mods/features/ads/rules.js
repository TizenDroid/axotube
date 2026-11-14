/**
 * Recognition rules for ad, banner, promo and optional-shelf content. Pure
 * functions: no config reads and no side effects.
 */
export const SHORTS_SHELF_TYPE = "TVHTML5_SHELF_RENDERER_TYPE_SHORTS";

// Any response that contains none of these substrings cannot contain the ad
// structures below, so the ad pass can be skipped for it. Keep in sync with the
// keys the filters test for.
const AD_TEXT_MARKERS = [
  "adSlot",
  "adPlacements",
  "playerAds",
  "promo",
  "Promo",
  "hideLogo",
  "tvMasthead",
  "attestation",
  "adBreak",
  "adClientParams",
];

// Top-level response keys the orchestrator cares about. A response with none
// of them is returned before any other work.
export const KNOWN_TOP_LEVEL_KEYS = [
  "adPlacements",
  "playerAds",
  "adSlots",
  "paidContentOverlay",
  "streamingData",
  "contents",
  "endscreen",
  "messages",
  "entries",
  "title",
  "continuationContents",
  "playerOverlays",
  "transportControls",
  "attestation",
  "adBreakHeartbeatParams",
  "playerResponse",
];

export function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

export function hasKnownTopLevelKey(r) {
  for (let i = 0; i < KNOWN_TOP_LEVEL_KEYS.length; i++) {
    if (r[KNOWN_TOP_LEVEL_KEYS[i]]) return true;
  }
  return false;
}

/** True when the raw text might hold ad structures. No text means "unknown", so scan. */
export function textMayHaveAds(text) {
  if (typeof text !== "string") return true;
  for (let i = 0; i < AD_TEXT_MARKERS.length; i++) {
    if (text.indexOf(AD_TEXT_MARKERS[i]) !== -1) return true;
  }
  return false;
}

export function dropItemsWithKey(list, key) {
  return list.filter((el) => !(el && el[key]));
}

export function isAdItem(item) {
  return !!(item && item.adSlotRenderer);
}

export function isShortsItem(item) {
  return !!(
    item &&
    item.tileRenderer &&
    (item.tileRenderer.tvhtml5ShelfRendererType === "TVHTML5_TILE_RENDERER_TYPE_SHORTS" ||
      (item.tileRenderer.onSelectCommand && item.tileRenderer.onSelectCommand.reelWatchEndpoint))
  );
}

export function isAdShelf(shelve) {
  if (!shelve || typeof shelve !== "object") return false;
  // promoShelfRenderer and similar promotional containers.
  const keys = Object.keys(shelve);
  for (let i = 0; i < keys.length; i++) {
    if (keys[i].toLowerCase().indexOf("promo") !== -1) return true;
  }
  // Premium upsell shelves are flagged with hideLogo.
  return !!(shelve.shelfRenderer && shelve.shelfRenderer.tvhtml5Metadata &&
    shelve.shelfRenderer.tvhtml5Metadata.hideLogo);
}

/** The full-width home banner (tvMastheadRenderer). */
export function isBannerShelf(shelve) {
  return !!(shelve && typeof shelve === "object" && shelve.tvMastheadRenderer);
}

/** English shelf title text, or "" when the shape is not recognised. */
export function shelfTitle(shelfRenderer) {
  if (!shelfRenderer) return "";
  const title =
    shelfRenderer.title ||
    (shelfRenderer.headerRenderer && shelfRenderer.headerRenderer.tvHeaderRenderer &&
      shelfRenderer.headerRenderer.tvHeaderRenderer.title);
  if (!title) return "";
  if (typeof title.simpleText === "string") return title.simpleText;
  if (title.runs && title.runs[0] && typeof title.runs[0].text === "string") {
    return title.runs[0].text;
  }
  return "";
}

/**
 * Which optional shelf a title belongs to, or null. A title that mentions
 * recommendations is never matched, so recommendation shelves cannot be removed
 * by these toggles.
 */
export function optionalShelfKind(title) {
  if (!title) return null;
  if (/recommend/i.test(title)) return null;
  if (/top\s+live\s+games?/i.test(title)) return "topLiveGames";
  if (/most\s+relevant/i.test(title)) return "mostRelevant";
  if (/^live(\s+now)?$/i.test(title.trim())) return "live";
  return null;
}
