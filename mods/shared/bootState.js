// Whether the native splash is still held. Set by ui/bootLoader.js; read by features that must not
// start on the first screen while the splash is up (a preview would start its timer then).
let held = false;

export function setBootHeld(value) {
  held = !!value;
}

export function isBootHeld() {
  return held;
}
