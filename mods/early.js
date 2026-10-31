// Early bundle. The standalone proxy injects this at the start of <head>, so
// it runs before YouTube's own scripts. Only features that must already be in
// place when the player starts belong here. Each feature installs once, from
// whichever bundle loads first (see the owner guards in those modules).
import "./features/experimentalResolution.js";
import "./features/codecPreference.js";
