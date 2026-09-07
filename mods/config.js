import configSchema from "../config-schema.json";

const CONFIG_KEY = "ytaf-configuration";
const nativeJSONParse = JSON.parse;
const nativeJSONStringify = JSON.stringify;
const clone = (value) => nativeJSONParse(nativeJSONStringify(value));

const defaultConfig = clone(configSchema.defaults);
// Outside the real Tizen host keep the existing browser/dev default.
defaultConfig.enableFixedUI = window.h5vcc && window.h5vcc.tizentube
  ? configSchema.defaults.enableFixedUI
  : true;

export function validateConfigValue(key, value) {
  if (!Object.prototype.hasOwnProperty.call(defaultConfig, key)) return false;
  const expected = defaultConfig[key];

  if (expected === null) return value === null || typeof value === "string";
  if (Array.isArray(expected)) {
    return Array.isArray(value) && value.every((item) => typeof item === "string");
  }
  if (typeof expected === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) return false;
    const range = configSchema.ranges[key];
    return !range || (value >= range[0] && value <= range[1]);
  }
  if (typeof value !== typeof expected) return false;

  const allowed = configSchema.enums[key];
  if (allowed && !allowed.includes(value)) return false;
  if (key === "routeColor" && !/^#[0-9a-f]{6}$/i.test(value)) return false;
  if (key === "routeBackgroundUrl" && value) {
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    } catch (e) {
      return false;
    }
  }
  return true;
}

let localConfig;

function initConfig() {
  localConfig = clone(defaultConfig);
  try {
    if (!window.localStorage || !window.localStorage[CONFIG_KEY]) return;
    const parsed = nativeJSONParse(window.localStorage[CONFIG_KEY]);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
    Object.keys(parsed).forEach((key) => {
      if (validateConfigValue(key, parsed[key])) localConfig[key] = clone(parsed[key]);
    });
  } catch (err) {
    console.warn("Config read failed; using defaults:", err);
  }
}

initConfig();

function tryPersistConfig() {
  try {
    if (!window.localStorage) return false;
    window.localStorage[CONFIG_KEY] = nativeJSONStringify(localConfig);
    return true;
  } catch (err) {
    if (err.name === "QuotaExceededError") {
      console.warn("localStorage quota exceeded; replacing axotube config only");
      try {
        if (typeof window.localStorage.removeItem === "function") {
          window.localStorage.removeItem(CONFIG_KEY);
        } else {
          delete window.localStorage[CONFIG_KEY];
        }
        window.localStorage[CONFIG_KEY] = nativeJSONStringify(localConfig);
        return true;
      } catch (e2) {
        console.error("Failed to persist axotube config:", e2);
        return false;
      }
    }
    console.error("Failed to persist config:", err);
    return false;
  }
}

export function configRead(key) {
  if (!Object.prototype.hasOwnProperty.call(defaultConfig, key)) {
    console.warn("Unknown config key", key);
    return undefined;
  }
  if (!validateConfigValue(key, localConfig[key])) localConfig[key] = clone(defaultConfig[key]);
  return localConfig[key];
}

export function configWrite(key, value) {
  if (!validateConfigValue(key, value)) {
    console.warn("Rejected invalid config value", key, value);
    return false;
  }
  localConfig[key] = clone(value);
  const persisted = tryPersistConfig();
  configChangeEmitter.dispatchEvent(
    new CustomEvent("configChange", { detail: { key, value: clone(value) } }),
  );
  return persisted;
}

export const configChangeEmitter = new EventTarget();

export function configSnapshot() {
  return clone(localConfig);
}

export { nativeJSONParse, nativeJSONStringify };
