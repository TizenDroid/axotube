// Writes tests/fixtures/chrome47-gaps.json (run: npm run generate:chrome47 --prefix mods): every JavaScript built-in that MDN says Chrome 47
// does not have (version_added later than 47, or false). Each entry is "Owner.member" or
// "Owner.Sub.member"; instance methods appear under their constructor, so the test removes
// both the static and the prototype form. Run after updating @mdn/browser-compat-data.
const fs = require("fs");
const path = require("path");
const bcd = require("@mdn/browser-compat-data");

const TARGET = 47;
function chromeVersion(compat) {
  const support = compat && compat.support && compat.support.chrome;
  const entries = Array.isArray(support) ? support : [support];
  const entry = entries.find((e) => e && e.version_added !== undefined && !e.flags && !e.prefix && !e.alternative_name);
  if (!entry) return null;
  if (entry.version_added === false) return false;
  if (entry.version_added === true) return 0;
  const n = parseFloat(String(entry.version_added).replace(/[≤~]/g, ""));
  return Number.isNaN(n) ? null : n;
}

const gaps = new Set();
(function walk(node, trail) {
  for (const key of Object.keys(node)) {
    if (key === "__compat" || key.startsWith("@@")) continue;
    const child = node[key];
    if (!child || typeof child !== "object") continue;
    const here = trail.concat(key);
    if (child.__compat) {
      const v = chromeVersion(child.__compat);
      if (v === false || (v !== null && v > TARGET)) gaps.add(here.join("."));
    }
    if (here.length < 3) walk(child, here);
  }
})(bcd.javascript.builtins, []);

const out = path.join(__dirname, "..", "..", "tests", "fixtures", "chrome47-gaps.json");
fs.writeFileSync(out, JSON.stringify([...gaps].sort(), null, 1) + "\n");
console.log("wrote", path.relative(process.cwd(), out), "with", gaps.size, "entries");

// DOM interfaces (top-level names in MDN's api tree). Chromium 47 has some of them; the rest read as undefined.
const dom = { supported: [], unsupported: [] };
for (const name of Object.keys(bcd.api).sort()) {
  const node = bcd.api[name];
  if (!/^[A-Z]/.test(name) || !node || typeof node !== "object") continue;
  const v = node.__compat ? chromeVersion(node.__compat) : null;
  if (v === false || (v !== null && v > TARGET)) dom.unsupported.push(name);
  else dom.supported.push(name);
}
const domOut = path.join(__dirname, "..", "..", "tests", "fixtures", "chrome47-dom.json");
fs.writeFileSync(domOut, JSON.stringify(dom, null, 1) + "\n");
console.log("wrote", path.relative(process.cwd(), domOut), "with", dom.supported.length, "supported and", dom.unsupported.length, "unsupported interfaces");
