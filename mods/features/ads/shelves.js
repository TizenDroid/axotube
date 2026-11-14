import { hqify } from "../hqThumbnails.js";
import { deArrowify } from "../deArrow.js";
import { addLongPress } from "../longPressMenu.js";
import { addPreviews } from "../videoPreviews.js";
import { hideVideo } from "../hideWatchedVideos.js";
import {
  SHORTS_SHELF_TYPE,
  isAdItem,
  isShortsItem,
  isAdShelf,
  isBannerShelf,
  shelfTitle,
  optionalShelfKind,
} from "./rules.js";
import { bump } from "./stats.js";

// Per-item enhancements, in their existing order. Ad and Shorts removal happens
// before this runs, so no thumbnail or preview work is spent on dropped items.
export function decorateItems(items, previews) {
  hqify(items);
  deArrowify(items);
  addLongPress(items);
  if (previews) addPreviews(items);
  return hideVideo(items);
}

/**
 * opts: { removeAds, removeShorts, addPreviews, optional: { live, topLiveGames, mostRelevant } }
 *
 * A shelf is removed when this pass empties it. A shelf that YouTube already
 * sent empty is left alone.
 */
export function processShelves(shelves, opts) {
  const o = opts || {};
  const optional = o.optional || {};
  for (let i = shelves.length - 1; i >= 0; i--) {
    const shelve = shelves[i];
    if (!shelve || typeof shelve !== "object") continue;

    if (o.removeAds && (isAdShelf(shelve) || isBannerShelf(shelve))) {
      bump(isBannerShelf(shelve) ? "bannerRemoved" : "shelfRemoved");
      shelves.splice(i, 1);
      continue;
    }
    if (!shelve.shelfRenderer) continue;
    const sr = shelve.shelfRenderer;

    const kind = optionalShelfKind(shelfTitle(sr));
    if (kind && optional[kind]) {
      bump("optionalShelfRemoved");
      shelves.splice(i, 1);
      continue;
    }

    const list = sr.content && sr.content.horizontalListRenderer;
    if (!list || !list.items) continue;

    if (o.removeShorts && sr.tvhtml5ShelfRendererType === SHORTS_SHELF_TYPE) {
      shelves.splice(i, 1);
      continue;
    }

    let items = list.items;
    let dropped = 0;
    if (o.removeAds || o.removeShorts) {
      const before = items.length;
      items = items.filter(
        (item) => !(o.removeAds && isAdItem(item)) && !(o.removeShorts && isShortsItem(item)),
      );
      dropped = before - items.length;
      if (dropped) {
        list.items = items;
        bump("itemRemoved", dropped);
      }
    }

    if (dropped > 0 && items.length === 0) {
      bump("emptyShelfRemoved");
      shelves.splice(i, 1);
      continue;
    }

    list.items = decorateItems(items, o.addPreviews !== false);
  }
}
