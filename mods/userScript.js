/**
 * userScript.js – axotube entry point.
 *
 * Import order matters for Tizen 4 (N5470) compatibility:
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
// Before the client reads window.environment, so the memory-saving switch lands.
import "./features/lowMemoryMode.js";
// Before the player reads the container size and codec support.
import "./features/experimentalResolution.js";
import "./features/codecPreference.js";
import "./translations/index.js";
import "./domrect-polyfill";

import "./features/adblock.js";
import "./features/featureTweaks.js";
import "./features/hqThumbnailsFocusObserver.js";
import "./features/sponsorblock.js";
import "./features/remainingTime.js";
import "./features/pauseOnBlur.js";
import "./features/onePressMode.js";
import "./features/autoSubtitles.js";
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
import "./features/castDiscovery.js";
import "./features/clock.js";
import "./features/panelShrink.js";
import "./ui/customUI.js";
// Guide filtering is registered alongside AdBlock in the response pipeline.
import "./features/autoFrameRate.js";
