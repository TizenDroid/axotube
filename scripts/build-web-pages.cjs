// Turns the pages in service/web/ into ES5 modules that the service loads.
//
// The Web Config page is a thin HTML shell. Its stylesheet, script and settings
// metadata are served from jsDelivr at the package's release tag, and each is
// pinned with a Subresource Integrity hash computed here from the files on disk, so
// a CDN change cannot silently alter running code. The schema is injected inline.
//
// Each page becomes an array of JSON string literals, joined with newlines, so the
// generated file uses no template literals and parses on old engines.
//
//   node scripts/build-web-pages.cjs           write the generated modules
//   node scripts/build-web-pages.cjs --check  exit 1 if a module is out of date
//
// AXOTUBE_WEB_ASSET_BASE overrides the asset base URL (local testing only).
// Edit the sources in service/web/, never the generated modules.
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const WEB = path.join(ROOT, "service", "web");
const REPO = "TizenDroid/axotube";

const PAGES = [
  { source: "service/web/config.html", out: "service/webConfigPage.js", name: "webConfigPage", schema: true, assets: true },
  { source: "service/web/diagnostics.html", out: "service/diagnosticsPage.js", name: "diagnosticsPage", schema: false, assets: false },
];

// Files the Web Config shell loads from the release. Each gets an integrity hash.
const ASSETS = [
  { file: "config.css", placeholder: "__SRI_CSS__" },
  { file: "config.js", placeholder: "__SRI_JS__" },
  { file: "config-ui.json", placeholder: "__SRI_UI__" },
];

// A JS string literal that is valid ES5: U+2028 and U+2029 are escaped.
function literal(text) {
  return JSON.stringify(text).split(String.fromCharCode(0x2028)).join("\\u2028").split(String.fromCharCode(0x2029)).join("\\u2029");
}

function assetBase() {
  if (process.env.AXOTUBE_WEB_ASSET_BASE) return process.env.AXOTUBE_WEB_ASSET_BASE.replace(/\/+$/, "");
  const version = require(path.join(ROOT, "package.json")).version;
  return "https://cdn.jsdelivr.net/gh/" + REPO + "@v" + version + "/service/web";
}

function integrity(file) {
  const digest = crypto.createHash("sha384").update(fs.readFileSync(path.join(WEB, file))).digest("base64");
  return "sha384-" + digest;
}

function render(page) {
  let html = fs.readFileSync(path.join(ROOT, page.source), "utf8");
  if (page.schema) {
    const schema = JSON.stringify(require(path.join(ROOT, "config-schema.json")))
      .replace(/</g, "\\u003c");
    html = html.split("__SCHEMA__").join(schema);
  }
  if (page.assets) {
    html = html.split("__ASSET_BASE__").join(assetBase());
    for (const asset of ASSETS) {
      html = html.split(asset.placeholder).join(integrity(asset.file));
    }
  }
  for (const token of ["__SCHEMA__", "__ASSET_BASE__", "__SRI_"]) {
    if (html.indexOf(token) !== -1) throw new Error(page.source + ": unreplaced " + token);
  }
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

module.exports = { render: render, PAGES: PAGES, ASSETS: ASSETS, assetBase: assetBase, integrity: integrity };

if (require.main === module) main();
