"use strict";
// Branch coverage of the service's own sources, from the V8 data of one run.
//
// The V8 counts are for the unminified coverage build (core.js). They are converted to
// statements, functions and branch points inside that bundle, and each point is attributed to
// the source file its start position maps to through the bundle's source map. A point counts
// once, where it starts. That is exact for code that sits inside one source file; a construct
// that Rollup or Babel expanded across several source positions is attributed to where it
// starts. The converter is given the bundle without its source map reference, because it would
// otherwise apply that map itself and drop most branch points.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createRequire } = require("node:module");
const { fileURLToPath } = require("node:url");

async function serviceCoverage(root, coverageDir, coreDir) {
  const req = createRequire(path.join(root, "service", "package.json"));
  const V8ToIstanbul = req("v8-to-istanbul");
  const { SourceMapConsumer } = req("source-map");

  const coreFile = path.join(coreDir, "core.js");
  const map = await new SourceMapConsumer(JSON.parse(fs.readFileSync(path.join(coreDir, "core.js.map"), "utf8")));
  const plainDir = fs.mkdtempSync(path.join(os.tmpdir(), "axotube-plain-"));
  const plain = path.join(plainDir, "core.js");
  fs.writeFileSync(plain, fs.readFileSync(coreFile, "utf8").replace(/\/\/# sourceMappingURL=.*\s*$/, ""));

  const runs = [];
  for (const name of fs.readdirSync(coverageDir)) {
    if (!name.endsWith(".json")) continue;
    const data = JSON.parse(fs.readFileSync(path.join(coverageDir, name), "utf8"));
    for (const script of data.result) {
      if (/^file:/.test(script.url) && fileURLToPath(script.url).endsWith(path.join("service", "dist", "core.js"))) runs.push(script);
    }
  }
  if (runs.length === 0) throw new Error("no V8 coverage for the service core in " + coverageDir);

  // Points are keyed by source file and start position, so a point seen in several runs is one
  // point, covered if any run covered it.
  const points = new Map();
  function note(kind, source, line, column, covered) {
    const key = kind + " " + source + ":" + line + ":" + column;
    const seen = points.get(key) || { kind: kind, source: source, covered: false };
    seen.covered = seen.covered || covered;
    points.set(key, seen);
  }

  for (const run of runs) {
    const converter = new V8ToIstanbul(plain, 0);
    await converter.load();
    converter.applyCoverage(run.functions);
    const report = converter.toIstanbul();
    const file = report[plain];
    const coverage = file && (file.toJSON ? file.toJSON() : file);
    if (!coverage) throw new Error("converter returned no coverage for the core");

    const attribute = function (loc) {
      // A converter location without a real start (column -1, or no line) maps to nothing.
      if (!loc || !loc.start || loc.start.line < 1 || loc.start.column < 0) return null;
      const orig = map.originalPositionFor({ line: loc.start.line, column: loc.start.column });
      if (!orig.source) return null;
      const abs = path.resolve(orig.source);
      const rel = path.relative(root, abs).split(path.sep).join("/");
      // Our code only: service/ and shared/, not the packages bundled into the service.
      if (!/^(service|shared)\//.test(rel) || /node_modules\//.test(rel)) return null;
      return { source: rel, line: orig.line, column: orig.column };
    };

    for (const id of Object.keys(coverage.statementMap)) {
      const at = attribute(coverage.statementMap[id]);
      if (at) note("statement", at.source, at.line, at.column, coverage.s[id] > 0);
    }
    for (const id of Object.keys(coverage.fnMap)) {
      const at = attribute(coverage.fnMap[id].decl || coverage.fnMap[id].loc);
      if (at) note("function", at.source, at.line, at.column, coverage.f[id] > 0);
    }
    for (const id of Object.keys(coverage.branchMap)) {
      const at = attribute(coverage.branchMap[id].loc);
      if (!at) continue;
      const arms = coverage.b[id];
      arms.forEach(function (count, arm) {
        note("branch " + arm, at.source, at.line, at.column, count > 0);
      });
    }
  }

  const summary = new Map();
  for (const point of points.values()) {
    const kind = point.kind.split(" ")[0];
    const row = summary.get(point.source) || { statements: [0, 0], functions: [0, 0], branches: [0, 0] };
    const bucket = kind === "statement" ? "statements" : kind === "function" ? "functions" : "branches";
    row[bucket][0] += 1;
    if (point.covered) row[bucket][1] += 1;
    summary.set(point.source, row);
  }
  map.destroy();
  return summary;
}

function formatCoverage(summary) {
  const rows = [...summary.keys()].sort();
  const total = { statements: [0, 0], functions: [0, 0], branches: [0, 0] };
  const pct = function (pair) {
    return pair[0] === 0 ? "n/a" : ((pair[1] / pair[0]) * 100).toFixed(1) + "%";
  };
  const covered = function (pair) {
    return pair[1] + "/" + pair[0];
  };
  const lines = ["file".padEnd(30) + "statements".padStart(18) + "functions".padStart(18) + "branches".padStart(18)];
  for (const source of rows) {
    const row = summary.get(source);
    for (const k of ["statements", "functions", "branches"]) {
      total[k][0] += row[k][0];
      total[k][1] += row[k][1];
    }
    lines.push(
      source.padEnd(30) +
        (pct(row.statements) + " " + covered(row.statements)).padStart(18) +
        (pct(row.functions) + " " + covered(row.functions)).padStart(18) +
        (pct(row.branches) + " " + covered(row.branches)).padStart(18)
    );
  }
  lines.push(
    "TOTAL".padEnd(30) +
      (pct(total.statements) + " " + covered(total.statements)).padStart(18) +
      (pct(total.functions) + " " + covered(total.functions)).padStart(18) +
      (pct(total.branches) + " " + covered(total.branches)).padStart(18)
  );
  return { text: lines.join("\n"), total: total };
}

module.exports = { serviceCoverage, formatCoverage };
