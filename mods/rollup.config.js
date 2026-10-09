import { string } from "rollup-plugin-string";
import terser from "@rollup/plugin-terser";
import getBabelOutputPlugin from "@rollup/plugin-babel";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import replace from "@rollup/plugin-replace";
import { readFileSync } from "fs";

// Read the version from the root package.json so it's baked into the bundle
// at build time (shown in the welcome toast). mods/package.json has its own
// version, so we explicitly read the project root one. The build runs from
// the mods/ directory, so the root package.json is one level up.
const rootPackage = JSON.parse(
  readFileSync(`${process.cwd()}/../package.json`, "utf8"),
);
const AXOTUBE_VERSION = String(rootPackage.version);

export default {
  input: "userScript.js",
  output: { file: "../dist/userScript.js", format: "iife" },
  plugins: [
    json(),

    string({
      include: "**/*.css",
    }),

    nodeResolve({
      browser: true,
      preferBuiltins: false,
    }),

    commonjs({
      // Include node_modules, browser mods, and the cross-runtime config policy.
      include: [/node_modules/, /mods/, /shared\/configPolicy\.js$/],
      transformMixedEsModules: true,
    }),

    getBabelOutputPlugin({
      babelHelpers: "bundled",
      presets: [
        [
          "@babel/preset-env",
          {
            // Target Tizen 4 (N5470) Cobalt / Chromium 47
            targets: {
              browsers: ["Chrome 47"],
            },
            // useBuiltIns is intentionally NOT set here – no core-js /
            // regenerator-runtime polyfills are bundled; the polyfills we
            // need are hand-written in mods/polyfills.js (imported first in
            // userScript.js) to keep the bundle lean for Tizen 4.
            modules: false,

            // Explicitly include transforms that must fire for Tizen 4:
            include: [
              // async/await  →  _asyncToGenerator + generator syntax
              "@babel/plugin-transform-async-to-generator",
              // Class fields, private methods, etc.
              "@babel/plugin-transform-class-properties",
              // for-of on non-array iterables
              "@babel/plugin-transform-for-of",
              // Object rest/spread
              "@babel/plugin-transform-object-rest-spread",
            ],
          },
        ],
      ],
      plugins: [
        // Optional chaining:  a?.b  →  a == null ? undefined : a.b
        "@babel/plugin-transform-optional-chaining",
        // Nullish coalescing:  a ?? b  →  a != null ? a : b
        "@babel/plugin-transform-nullish-coalescing-operator",
        // Logical assignment:  a ||= b, a &&= b, a ??= b
        "@babel/plugin-transform-logical-assignment-operators",
        // Numeric separators: 1_000  →  1000
        "@babel/plugin-transform-numeric-separator",
      ],
    }),

    terser({
      ecma: 5, // Output ES5 for maximum Tizen 4 compatibility
      mangle: {
        reserved: [
          "h5vcc",
          "_yttv",
          "localStorage",
        ],
      },
      compress: {
        passes: 1, // Conservative compression to avoid breaking old engines
      },
    }),

    // Terser/Babel can emit \uFFFF sequences that old V8/Cobalt engines
    // treat as invalid tokens, preventing the entire bundle from parsing.
    // Replace the U+FFFF character with the ASCII escape sequence text so
    // the output contains no raw control bytes (raw NUL breaks Violentmonkey
    // and is risky on old Cobalt parsers).
    replace({
      preventAssignment: true,
      "\uFFFF": "\\ufffd",
      // Bake the version from the root package.json into the bundle
      // (mods/version.js token -> e.g. "1.15.19"). The token lives inside a
      // string literal, so replace with the bare value (no quotes added).
      "__AXOTUBE_VERSION__": AXOTUBE_VERSION,
    }),
  ],
};
