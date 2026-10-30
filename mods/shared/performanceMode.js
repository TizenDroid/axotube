// Performance mode is one switch that turns on the lighter behaviour across the
// app: less animation, lower memory use, thumbnails that upgrade on focus instead
// of up front, and no inline previews.
//
// Older builds had separate "reduce motion" and "low memory" switches. Those keys
// still count as on, so existing users keep their behaviour. Turning performance
// mode off also clears them, so nobody is left in a state they can't see or change.
import { configRead, configWrite, configChangeEmitter } from "../config.js";

export function isPerformanceMode() {
  return !!configRead("enablePerformanceMode");
}

export function isReducedMotion() {
  return isPerformanceMode() || !!configRead("enableReducedMotion");
}

export function isLowMemory() {
  return isPerformanceMode() || !!configRead("enableLowMemoryMode");
}

export function previewsEnabled() {
  return !!configRead("enablePreviews") && !isPerformanceMode();
}

// "eager": every tile gets high-quality art when the response is parsed.
// "hover": only the focused tile is upgraded, when it gets focus.
// "off":   default-quality art only.
export function hqThumbnailMode() {
  if (!configRead("enableHqThumbnails")) return "off";
  return isReducedMotion() || isLowMemory() ? "hover" : "eager";
}

configChangeEmitter.addEventListener("configChange", (event) => {
  if (event.detail?.key !== "enablePerformanceMode") return;
  if (configRead("enablePerformanceMode")) return;
  configWrite("enableReducedMotion", false);
  configWrite("enableLowMemoryMode", false);
});
