// Whether the app's splash screen is still on screen.
//
// The boot loader holds the native splash until the app has finished starting. Features that
// react to the first responses (video previews) read this so they do not start work on a screen
// the viewer cannot see yet. Deliberately plain state with no imports, so importing it cannot
// pull UI code into a module that only needs the flag.

let held = false;

export function setBootHeld(value) {
  held = !!value;
}

export function isBootHeld() {
  return held;
}
