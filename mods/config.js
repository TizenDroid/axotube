import { nativeHost } from "./shared/nativeHost.js";
import configSchema from "../config-schema.json";
import configPolicy from "../shared/configPolicy.js";

const CONFIG_KEY = "ytaf-configuration";
const nativeJSONParse = JSON.parse;
const nativeJSONStringify = JSON.stringify;
// Deep copy through the native JSON functions captured at load, so copies are
// never run through the response filters installed on JSON.parse later.
const clone = (value) => nativeJSONParse(nativeJSONStringify(value));
export const cloneJSON = clone;

const defaultConfig = clone(configSchema.defaults);
// Outside the real Tizen host keep the existing browser/dev default.
defaultConfig.enableFixedUI =
  nativeHost() ? configSchema.defaults.enableFixedUI : true;

export const validateConfigValue = configPolicy.validateConfigValue;

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
    console.warn("[AxoTube:config] Config read failed; using defaults:", err);
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
      console.warn("[AxoTube:config] localStorage quota exceeded; replacing axotube config only");
      try {
        if (typeof window.localStorage.removeItem === "function") {
          window.localStorage.removeItem(CONFIG_KEY);
        } else {
          delete window.localStorage[CONFIG_KEY];
        }
        window.localStorage[CONFIG_KEY] = nativeJSONStringify(localConfig);
        return true;
      } catch (e2) {
        console.error("[AxoTube:config] Failed to persist axotube config:", e2);
        return false;
      }
    }
    console.error("[AxoTube:config] Failed to persist config:", err);
    return false;
  }
}

// Values are validated on load (initConfig) and on write (configWrite), so a
// read is a plain lookup. configRead runs per tile and per response filter, and
// re-validating on every call was pure overhead.
export function configRead(key) {
  if (!Object.prototype.hasOwnProperty.call(defaultConfig, key)) {
    console.warn("[AxoTube:config] Unknown config key", key);
    return undefined;
  }
  if (localConfig[key] === undefined) localConfig[key] = clone(defaultConfig[key]);
  return localConfig[key];
}

export function configWrite(key, value) {
  if (!validateConfigValue(key, value)) {
    console.warn("[AxoTube:config] Rejected invalid config value", key, value);
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
