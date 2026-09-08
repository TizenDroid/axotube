/**
 * userScript.js – axotube entry point.
 *
 * Import order matters for Tizen 4 (N5470 / Cobalt) compatibility:
 *  1. polyfills.js    – browser-API + ES-builtin polyfills for Chromium 47
 *                       (EventTarget ctor, AbortController, CustomEvent,
 *                       Object.entries/values, Array.flat, …)
 *  2. polyfillCorrections.js – behavior corrections for legacy shims
 *  3. whatwg-fetch    – fetch() polyfill
 *  4. app modules     – everything else
 */

// ── 1. Browser-API + ES-builtin polyfills (EventTarget ctor, AbortController, …) ─
import "./polyfills.js";
import "./polyfillCorrections.js";

// ── 2. Fetch polyfill ─────────────────────────────────────────────────────────
import "whatwg-fetch";

// ── 3. Boot loader (hold native splash until axotube is ready) ────────────────
import "./ui/bootLoader.js";

// ── 4. Application modules ────────────────────────────────────────────────────
import "./features/userAgentSpoofing.js";
import "./translations/index.js";
import "./domrect-polyfill";

import "./features/adblock.js";
import "./features/featureTweaks.js";
import "./features/hqThumbnailsFocusObserver.js";
import "./features/sponsorblock.js";
import "./ui/ui.js";
import "./ui/speedUI.js";
import "./ui/theme.js";
import "./ui/settings.js";
import "./ui/disableWhosWatching.js";
import "./features/moreSubtitles.js";
import "./features/updater.js";
import "./features/pictureInPicture.js";
import "./features/preferredVideoQuality.js";
import "./features/videoQueuing.js";
import "./features/enableFeatures.js";
import "./features/webConfig.js";
import "./features/castReceiver.js";
import "./ui/customUI.js";
import "./ui/customGuideAction.js";
import "./features/autoFrameRate.js";
