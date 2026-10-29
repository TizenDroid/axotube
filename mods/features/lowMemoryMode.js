// Asks YouTube's client for its memory-saving mode (feature switch
// enable_memory_saving_mode), the same switch VacuumTube sets for limited-memory
// devices. The switch is written to window.environment, the config object the
// client reads at startup. Off by default.
//
// The setting is read when YouTube assigns window.environment. If that happens
// before the config has loaded, the change applies on the next page load.
import { configRead } from "../config.js";

function applyLowMemory(environment) {
  if (!environment || typeof environment !== "object") return;
  if (!configRead("enableLowMemoryMode")) return;
  if (!environment.feature_switches || typeof environment.feature_switches !== "object") {
    environment.feature_switches = {};
  }
  environment.feature_switches.enable_memory_saving_mode = true;
}

let environment;
try {
  const existing = window.environment;
  Object.defineProperty(window, "environment", {
    configurable: true,
    get() {
      return environment;
    },
    set(value) {
      applyLowMemory(value);
      environment = value;
    },
  });
  environment = existing;
  applyLowMemory(existing);
} catch (err) {
  console.warn("[AxoTube:lowMemoryMode] low memory mode unavailable:", err);
}
