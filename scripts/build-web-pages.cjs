// Turns the HTML pages in service/web/ into ES5 modules that the service loads.
// Each page becomes an array of JSON string literals, joined with newlines, so the
// generated file uses no template literals and parses on old engines.
//
//   node scripts/build-web-pages.cjs           write the generated modules
//   node scripts/build-web-pages.cjs --check  exit 1 if a module is out of date
//
// Edit the HTML in service/web/, never the generated modules.
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PAGES = [
  { source: "service/web/config.html", out: "service/webConfigPage.js", name: "webConfigPage", schema: true },
  { source: "service/web/diagnostics.html", out: "service/diagnosticsPage.js", name: "diagnosticsPage", schema: false },
];

// A JS string literal that is valid ES5: U+2028 and U+2029 are escaped.
function literal(text) {
  return JSON.stringify(text).split(String.fromCharCode(0x2028)).join("\\u2028").split(String.fromCharCode(0x2029)).join("\\u2029");
}

function render(page) {
  let html = fs.readFileSync(path.join(ROOT, page.source), "utf8");
  if (page.schema) {
    const schema = JSON.stringify(require(path.join(ROOT, "config-schema.json")))
      .replace(/</g, "\\u003c");
    html = html.split("__SCHEMA__").join(schema);
  }
  if (html.indexOf("__SCHEMA__") !== -1) throw new Error(page.source + ": unreplaced __SCHEMA__");
  const lines = html.split("\n").map((line) => "  " + literal(line));
  return [
    '"use strict";',
    "// Generated from " + page.source + " by scripts/build-web-pages.cjs. Edit the source, not this file.",
    "module.exports." + page.name + " = [",
    lines.join(",\n"),
    '].join("\\n");',
    "",
  ].join("\n");
}

function main() {
  const check = process.argv.indexOf("--check") !== -1;
  let stale = false;
  for (const page of PAGES) {
    const text = render(page);
    const target = path.join(ROOT, page.out);
    const current = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
    if (check) {
      if (current !== text) {
        console.error("stale: " + page.out + " (run node scripts/build-web-pages.cjs)");
        stale = true;
      }
    } else {
      fs.writeFileSync(target, text, "utf8");
      console.log("wrote " + page.out);
    }
  }
  if (stale) process.exit(1);
}

module.exports = { render: render, PAGES: PAGES };

if (require.main === module) main();
