// Measurement only, loaded with NODE_OPTIONS=--require for the coverage run. The tests run
// module source inside VM contexts without a filename, and V8 can attribute coverage only to a
// file it knows by name. When the executed text is exactly a file under mods/, shared/ or
// service/, or that file followed by more code, the run is given that file's name. Text a test
// has changed first (export or import lines removed, one function extracted) matches no file and
// stays unnamed, so no run is ever attributed to the wrong file. (Module syntax is blanked, not
// deleted, so a blanked file and its run line up exactly.) Pass and fail are unaffected:
// the name only appears in stack traces.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { blankSyntax } = require("./module-source.cjs");

const ROOT = path.resolve(__dirname, "..", "..");
const DIRS = ["mods", "shared", "service"];

function collect(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "web") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(full, out);
    else if (/\.js$/.test(entry.name) && !/\.test\./.test(entry.name)) out.push(full);
  }
  return out;
}

const candidates = [];
for (const dir of DIRS) {
  for (const file of collect(path.join(ROOT, dir), [])) {
    // The text a test runs for this file: import and export syntax blanked, offsets unchanged.
    const text = blankSyntax(fs.readFileSync(file, "utf8"));
    // Tiny files match too easily to be trusted.
    if (text.length >= 200) candidates.push({ file: file, text: text });
  }
}

function fileFor(code) {
  if (typeof code !== "string") return null;
  for (const candidate of candidates) {
    if (code === candidate.text || code.startsWith(candidate.text)) return candidate.file;
  }
  return null;
}

function named(code, options) {
  if (options && options.filename) return options;
  const file = fileFor(code);
  return file ? Object.assign({}, options, { filename: file }) : options;
}

const originalRunInContext = vm.runInContext;
const originalRunInNewContext = vm.runInNewContext;
vm.runInContext = function (code, context, options) {
  return originalRunInContext.call(vm, code, context, named(code, options));
};
vm.runInNewContext = function (code, sandbox, options) {
  return originalRunInNewContext.call(vm, code, sandbox, named(code, options));
};
