#!/usr/bin/env node
// Runs the whole test suite with V8 coverage, and reports branch coverage of the module files
// the tests execute as their own text. See tests/support/attribute-filenames.cjs for which runs
// count. Files that no test executes whole are listed as not measured, not as covered.
"use strict";
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { fileCoverage } = require("./lib/file-coverage.cjs");
const { formatCoverage } = require("./lib/coverage.cjs");

const ROOT = path.resolve(__dirname, "..");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "axotube-modcov-"));
const attribute = path.join(ROOT, "tests", "support", "attribute-filenames.cjs");

const suites = fs.readdirSync(path.join(ROOT, "tests")).filter((n) => /\.test\.cjs$/.test(n)).sort().map((n) => "tests/" + n);
execFileSync(process.execPath, ["--test"].concat(suites), {
  cwd: ROOT,
  env: Object.assign({}, process.env, {
    NODE_V8_COVERAGE: dir,
    NODE_OPTIONS: "--require " + attribute + " " + (process.env.NODE_OPTIONS || ""),
  }),
  stdio: ["ignore", "pipe", "inherit"],
});

fileCoverage(ROOT, dir).then(function (summary) {
  console.log(formatCoverage(summary).text);
  const measured = new Set(summary.keys());
  const all = [];
  (function walk(d) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (entry.name === "node_modules") continue;
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.js$/.test(entry.name) && !/\.test\./.test(entry.name)) all.push(path.relative(ROOT, full).split(path.sep).join("/"));
    }
  })(path.join(ROOT, "mods"));
  const notMeasured = all.filter((rel) => !measured.has(rel));
  console.log("\nnot measured (no test runs this file as its own text): " + notMeasured.length + " of " + all.length);
  console.log(notMeasured.join("\n"));
});
