// The platform's native host object. The TV's native layer exposes its
// capabilities (frame rate, picture-in-picture, system features) through it.
// The name is the platform's own, so it appears here and nowhere else.
// Returns null when the layer is absent, for example in a plain browser.
export function nativeHost() {
  if (typeof window === "undefined" || !window.h5vcc) return null;
  return window.h5vcc.tizentube || null;
}
