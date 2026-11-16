"use strict";
// Branch coverage of the module files that the tests execute as their own text (see
// tests/support/attribute-filenames.cjs). Each named run is converted to branch points against
// the file on disk, and points are unioned across runs: a point counts covered if any run covered
// it. Points are keyed by file and start position, so the same code seen twice is counted once.
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { fileURLToPath } = require("node:url");

async function fileCoverage(root, coverageDir) {
  const req = createRequire(path.join(root, "service", "package.json"));
  const V8ToIstanbul = req("v8-to-istanbul");
  const points = new Map();
  const files = new Set();

  const runs = [];
  for (const name of fs.readdirSync(coverageDir)) {
    if (!name.endsWith(".json")) continue;
    const data = JSON.parse(fs.readFileSync(path.join(coverageDir, name), "utf8"));
    for (const script of data.result) {
      if (!/^file:/.test(script.url)) continue;
      const file = fileURLToPath(script.url);
      const rel = path.relative(root, file).split(path.sep).join("/");
      if (!/^(mods|shared)\//.test(rel) || /node_modules\//.test(rel)) continue;
      runs.push({ file: file, rel: rel, functions: script.functions });
    }
  }

  for (const run of runs) {
    files.add(run.rel);
    const converter = new V8ToIstanbul(run.file, 0);
    await converter.load();
    converter.applyCoverage(run.functions);
    const report = converter.toIstanbul();
    const coverage = report[run.file].toJSON ? report[run.file].toJSON() : report[run.file];
    const note = function (kind, loc, covered) {
      if (!loc || !loc.start || loc.start.line < 1 || loc.start.column < 0) return;
      const key = run.rel + " " + kind + " " + loc.start.line + ":" + loc.start.column;
      const seen = points.get(key) || { rel: run.rel, kind: kind, covered: false };
      seen.covered = seen.covered || covered;
      points.set(key, seen);
    };
    for (const id of Object.keys(coverage.statementMap)) note("statement", coverage.statementMap[id], coverage.s[id] > 0);
    for (const id of Object.keys(coverage.fnMap)) note("function", coverage.fnMap[id].decl || coverage.fnMap[id].loc, coverage.f[id] > 0);
    for (const id of Object.keys(coverage.branchMap)) {
      coverage.b[id].forEach(function (count, arm) {
        note("branch " + arm, coverage.branchMap[id].loc, count > 0);
      });
    }
  }

  const summary = new Map();
  for (const rel of files) summary.set(rel, { statements: [0, 0], functions: [0, 0], branches: [0, 0] });
  for (const point of points.values()) {
    const kind = point.kind.split(" ")[0];
    const bucket = kind === "statement" ? "statements" : kind === "function" ? "functions" : "branches";
    const row = summary.get(point.rel);
    row[bucket][0] += 1;
    if (point.covered) row[bucket][1] += 1;
  }
  return summary;
}

module.exports = { fileCoverage };
