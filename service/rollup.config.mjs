import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import babel from "@rollup/plugin-babel";
import replace from "@rollup/plugin-replace";
import json from "@rollup/plugin-json";
import terser from "@rollup/plugin-terser";
import fs from "fs";
import MagicString from "magic-string";

// Two bundles come from one source tree:
//   ../dist/service.js                       Tizen module (control server, 8090)
//   ../standalone/service/dist/core.js       standalone app (content proxy, 8081,
//                                            plus the same control server)
// Both are built here, so they cannot drift apart.

// Rewrites rendered code and keeps a source map. A plain string replace would drop the map,
// and Rollup then has no sources to show, so the edits go through MagicString. Each match is
// replaced the way String.prototype.replace would replace it: a global pattern replaces every
// match and a plain pattern only the first; a string replacement expands $1-style groups; a
// function replacement is used exactly as it returns.
function rewriteRendered(code, pattern, replacement) {
  const edits = new MagicString(code);
  const re = new RegExp(pattern.source, pattern.global ? "g" : "");
  let match;
  while ((match = re.exec(code)) !== null) {
    if (match[0].length === 0) throw new Error("empty match in rewrite of " + pattern);
    const start = match.index;
    const end = start + match[0].length;
    const text =
      typeof replacement === "function"
        ? replacement(...match)
        : replacement.replace(/\$(\d)/g, (_, n) => (match[Number(n)] === undefined ? "" : match[Number(n)]));
    if (text === "") edits.remove(start, end);
    else edits.overwrite(start, end, text);
    if (!pattern.global) break;
  }
  return { code: edits.toString(), map: edits.generateMap({ hires: true }) };
}

function injectXmlContent() {
  const pattern = /var\s+(\w+)_TEMPLATE\s+=\s+.*?readFileSync\([^)]*?'([^']+)'[^)]*?\);/g;
  return {
    name: "inject-xml-content",
    renderChunk(code) {
      return rewriteRendered(code, pattern, (match, varName, fileName) => {
        const xmlContent = fs.readFileSync(`node_modules/@patrickkfkan/peer-dial/xml/${fileName}`, "utf8");
        return `var ${varName}_TEMPLATE = ${JSON.stringify(xmlContent)};`;
      });
    },
  };
}

// The standalone bundle used to be produced by ncc, followed by two regex edits to
// the output. Those edits now run here, with the same patterns and the same
// first-match-only behaviour, so the standalone output is unchanged.
function standaloneNodeFetchPatches() {
  const relativeUrl =
    /if\s*\(\/.*?\/i?\.exec\(urlStr\)\)\s*\{\s*urlStr\s*=\s*new\s+URL\(urlStr\)\.toString\(\);\s*\}/g;
  const headerLimit = /(method:\s*request\.method,)/;
  return [
    {
      name: "standalone-node-fetch-relative-url",
      renderChunk(code) {
        return rewriteRendered(code, relativeUrl, "");
      },
    },
    {
      name: "standalone-node-fetch-header-limit",
      renderChunk(code) {
        return rewriteRendered(code, headerLimit, "$1 maxHeaderSize: 5*1024*1024,");
      },
    },
  ];
}

function sharedPlugins() {
  return [
    injectXmlContent(),
    replace({
      "Gate.prototype.await = function await(callback)":
        "Gate.prototype.await = function(callback)",
      "Async.prototype.await = function await(callback)":
        "Async.prototype.await = function (callback)",
      delimiters: ["", ""],
      preventAssignment: true,
    }),
    resolve(),
    json(),
    commonjs(),
    babel({
      babelHelpers: "bundled",
      presets: ["@babel/preset-env"],
    }),
  ];
}

// Babel wraps native superclasses (Error, Map, ...) with a helper that calls Reflect.construct
// unconditionally. Reflect is missing on Node 4 (the TV), so the call is guarded: with no
// Reflect, the native constructor is applied and the instance is re-parented onto the
// subclass prototype, which keeps instanceof and the subclass methods working.
function guardNativeSuperConstruct() {
  const pattern = /Reflect\.construct\(([\w$.]+),arguments,this\.constructor\)/g;
  return {
    name: "guard-native-super-construct",
    renderChunk(code) {
      return rewriteRendered(code, pattern, (match, target) =>
          '(typeof Reflect!=="undefined"&&Reflect.construct?Reflect.construct(' + target + ',arguments,this.constructor):function(){var r=' + target + '.apply(this,arguments);return r&&typeof r==="object"?(Object.setPrototypeOf(r,Object.getPrototypeOf(this)),r):this}.apply(this,arguments))'
      );
    },
  };
}

function minify() {
  return terser({
    ecma: 5,
    mangle: { reserved: ["tizen"] },
    compress: { passes: 1 },
  });
}

const onwarn = (warning) => {
  if (warning.code !== "CIRCULAR_DEPENDENCY") console.warn(warning.message);
};

export default [
  {
    input: "service.js",
    output: { file: "../dist/service.js", format: "cjs" },
    onwarn,
    plugins: [...sharedPlugins(), minify(), guardNativeSuperConstruct()],
  },
  {
    // The core: the whole standalone service. index.js is the loader that starts it.
    input: "standalone.js",
    output: { file: "../standalone/service/dist/core.js", format: "cjs" },
    onwarn,
    plugins: [...sharedPlugins(), ...standaloneNodeFetchPatches(), minify(), guardNativeSuperConstruct()],
  },
];
