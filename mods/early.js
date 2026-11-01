// Early bundle. The standalone proxy injects this at the start of <head>, so
// it runs before YouTube's own scripts. Only features that must already be in
// place when the player starts belong here. Each feature installs once, from
// whichever bundle loads first (see the owner guards in those modules).
// Polyfills first, as in userScript.js. config.js (imported below) calls
// `new EventTarget()`, which older Tizen engines do not allow without this.
import "./polyfills.js";
import "./polyfillCorrections.js";
import "./features/experimentalResolution.js";
import "./features/codecPreference.js";
import { installCorsShim } from "./features/corsShim.js";

// Route runtime fetch/XHR to allowlisted hosts through the proxy (see corsShim.js).
installCorsShim(window);
