// Builds the standalone service core without minification, with a source map, so V8 branch
// coverage can be mapped back to the service's own sources. The shipped core is minified;
// this build contains the same code, so the coverage describes what the TV runs. Prints the
// directory holding core.js and core.js.map.
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVICE = path.join(ROOT, "service");
process.chdir(SERVICE);
// rollup is a dependency of service/, so it is resolved from there.
const { rollup } = createRequire(path.join(SERVICE, "package.json"))("rollup");

const configs = (await import(pathToFileURL(path.join(SERVICE, "rollup.config.mjs")).href)).default;
const config = configs.find((c) => String(c.output.file).endsWith("core.js"));
if (!config) throw new Error("no core.js entry in service/rollup.config.mjs");
const plugins = config.plugins.filter((p) => !(p && p.name === "terser"));
if (plugins.length !== config.plugins.length - 1) throw new Error("expected exactly one terser plugin");

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "axotube-cov-"));
const bundle = await rollup({ input: config.input, plugins, onwarn: config.onwarn });
await bundle.write({
  file: path.join(outDir, "core.js"),
  format: "cjs",
  sourcemap: true,
  sourcemapPathTransform: (relative) => path.resolve(outDir, relative),
});
await bundle.close();
console.log(outDir);
