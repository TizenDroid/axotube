// One validation policy for the TV browser and the paired Node config store.
// CommonJS is intentional: the service can require it, while Rollup bundles
// the same implementation into the Chromium 47 browser script. Plain ES5 on
// purpose: both runtimes run it as written.
var configSchema = require("../config-schema.json");

function validateConfigValue(key, value) {
  var defaults = configSchema.defaults;
  if (!Object.prototype.hasOwnProperty.call(defaults, key)) return false;
  var expected = defaults[key];

  if (expected === null) return value === null || typeof value === "string";
  if (Array.isArray(expected)) {
    return Array.isArray(value) && value.every(function (item) { return typeof item === "string"; });
  }
  if (typeof expected === "number") {
    if (typeof value !== "number" || !isFinite(value)) return false;
    var range = configSchema.ranges[key];
    return !range || (value >= range[0] && value <= range[1]);
  }
  if (typeof value !== typeof expected) return false;

  var allowed = configSchema.enums[key];
  // Array.prototype.includes is Node 6+; the TV service runs Node 4.
  if (allowed && allowed.indexOf(value) === -1) return false;
  if (key === "routeColor" && !/^#[0-9a-f]{6}$/i.test(value)) return false;
  // The global URL constructor is missing on Node 4, so check the scheme directly.
  if (key === "routeBackgroundUrl" && value) {
    if (!/^https?:\/\/\S+$/i.test(value)) return false;
  }
  return true;
}

module.exports = { validateConfigValue: validateConfigValue };
