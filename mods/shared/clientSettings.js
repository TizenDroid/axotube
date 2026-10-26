// One rule set for writing a client setting. Used by the setting endpoints that
// YouTube-style commands carry (resolveCommand) and by the settings overlay, so
// side effects such as theme presets behave the same from either path.
import { configRead, configWrite } from "../config.js";
import configSchema from "../../config-schema.json";

// valName is the settingData field that carries the value: boolValue,
// stringValue, intValue or arrayValue. An arrayValue toggles membership.
export function writeClientSetting(itemName, valName, value) {
  if (valName === "arrayValue") {
    const current = configRead(itemName);
    const arr = Array.isArray(current) ? current.slice() : [];
    if (arr.includes(value)) arr.splice(arr.indexOf(value), 1);
    else arr.push(value);
    return configWrite(itemName, arr);
  }
  if (itemName === "themePreset") {
    const preset =
      typeof value === "string" &&
      Object.prototype.hasOwnProperty.call(configSchema.themePresetColors, value)
        ? configSchema.themePresetColors[value]
        : null;
    if (typeof preset === "string" && /^#[0-9a-f]{6}$/i.test(preset)) {
      configWrite("routeColor", preset);
      return configWrite("themePreset", value);
    }
    return false;
  }
  return configWrite(itemName, value);
}
