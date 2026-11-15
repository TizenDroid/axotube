// UI string lookup over the English resource file. Replaces i18next: the app only ever
// used it for English lookups with {{name}} interpolation, with no plurals, nesting,
// contexts or default values. A missing key returns the key itself, as i18next did, so
// a gap shows as readable text rather than an error.
import en from "./resources/en.json";

var PLACEHOLDER = /\{\{\s*([\w.]+)\s*\}\}/g;

function lookup(key) {
  var node = en;
  var parts = key.split(".");
  for (var i = 0; i < parts.length; i++) {
    if (node === null || typeof node !== "object" || !Object.prototype.hasOwnProperty.call(node, parts[i])) {
      return undefined;
    }
    node = node[parts[i]];
  }
  return typeof node === "string" ? node : undefined;
}

export function t(key, values) {
  var text = lookup(key);
  if (text === undefined) return key;
  if (!values) return text;
  return text.replace(PLACEHOLDER, function (match, name) {
    return Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : match;
  });
}
