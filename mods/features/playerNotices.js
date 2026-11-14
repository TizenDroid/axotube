import { dropItemsWithKey } from "./ads/rules.js";

// Player and watch-page notices: paid-promotion overlay, end-screen cards,
// the "you there" prompt and sign-in reminders.
export function applyPlayerNotices(r, flags) {
  if (r.paidContentOverlay && !flags.paidPromo) r.paidContentOverlay = null;
  if (r.endscreen && flags.hideEndScreens) r.endscreen = null;
  if (r.messages && Array.isArray(r.messages) && !flags.youThere) {
    r.messages = r.messages.filter((msg) => !(msg && msg.youThereRenderer));
  }
}

export function applySigninPromptFilter(list, key, flags) {
  if (flags.signin) return list;
  return dropItemsWithKey(list, key);
}
