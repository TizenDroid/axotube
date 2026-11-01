// Ports are fixed: control 8080 (phones and the settings panel), content proxy 8081.
// A stale port in any form (plain, URL-encoded as %3A8085, or inside a URL) breaks
// one side silently, so scan every tracked source file rather than trusting a regex
// with word boundaries, which misses %3A8085.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const OLD = /(?<!\d)(8085|8099|19080|19081)(?!\d)/;
// dist/ is generated and holds unrelated Unicode tables that contain these numbers.
const SKIP = /^(dist\/|.*\.lock$|package-lock\.json$)/;

test("no old or experimental port appears in any tracked source file", () => {
  const files = execSync("git ls-files", { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
  const hits = [];
  for (const file of files) {
    if (SKIP.test(file) || file.includes("node_modules")) continue;
    let text;
    try { text = fs.readFileSync(path.join(ROOT, file), "utf8"); } catch (e) { continue; }
    if (OLD.test(text)) hits.push(file);
  }
  assert.deepEqual(hits, [], "stale port in: " + hits.join(", "));
});

test("the splash and package.json send YouTube to the control port", () => {
  const html = fs.readFileSync(path.join(ROOT, "standalone/index.html"), "utf8");
  assert.match(html, /var DIAL_URL = "http%3A%2F%2Flocalhost%3A8080%2Fdial%2Fapps%2FYouTube"/);
  const pkg = fs.readFileSync(path.join(ROOT, "package.json"), "utf8");
  assert.match(pkg, /localhost%3A8080%2Fdial%2Fapps%2FYouTube/);
});
