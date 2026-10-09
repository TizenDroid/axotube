// One validation policy for the TV browser and the paired Node config store.
// CommonJS is intentional: the service can require it, while Rollup bundles
// the same implementation into the Chromium 47 browser script.
const configSchema = require("../config-schema.json");

function validateConfigValue(key, value) {
  const defaults = configSchema.defaults;
  if (!Object.prototype.hasOwnProperty.call(defaults, key)) return false;
  const expected = defaults[key];

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
    } catch (err) {
      return false;
    }
  }
  return true;
}

module.exports = { validateConfigValue };
