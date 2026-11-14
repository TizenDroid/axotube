import { isAdItem } from "./rules.js";

// Top-level ad fields on a response: ad placements, player ads, ad slots and
// the reel entries flagged as ads.
export function applyTopLevelAdFields(r) {
  if (r.adPlacements) r.adPlacements = [];
  if (r.playerAds) r.playerAds = false;
  if (r.adSlots) r.adSlots = [];
  if (!Array.isArray(r) && r.entries) {
    r.entries = r.entries.filter(
      (elm) => !(elm && elm.command && elm.command.reelWatchEndpoint &&
        elm.command.reelWatchEndpoint.adClientParams && elm.command.reelWatchEndpoint.adClientParams.isAd),
    );
  }
}

// Ad slot items placed directly in the browse section list. Items inside
// horizontal shelves are handled by processShelves, so the empty-shelf check
// sees the removal.
export function removeBrowseAdSlots(contents) {
  return contents.filter((el) => !isAdItem(el));
}
