import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import babel from "@rollup/plugin-babel";
import replace from "@rollup/plugin-replace";
import json from "@rollup/plugin-json";
import terser from "@rollup/plugin-terser";
import fs from "fs";

// Two bundles come from one source tree:
//   ../dist/service.js                       Tizen module (control server, 8085)
//   ../standalone/service/dist/index.js      standalone app (content proxy, 8099,
//                                            plus the same control server)
// Both are built here, so they cannot drift apart.

function injectXmlContent() {
  return {
    name: "inject-xml-content",
    renderChunk(code) {
      // Better regex - less fragile
      const pattern = /var\s+(\w+)_TEMPLATE\s+=\s+.*?readFileSync\([^)]*?'([^']+)'[^)]*?\);/g;

      const modifiedCode = code.replace(pattern, (match, varName, fileName) => {
        const xmlContent = fs.readFileSync(
          `node_modules/@patrickkfkan/peer-dial/xml/${fileName}`,
          "utf8",
        );
        return `var ${varName}_TEMPLATE = ${JSON.stringify(xmlContent)};`;
      });

      return { code: modifiedCode };
    },
  };
}

// The standalone bundle used to be produced by ncc, followed by two regex edits to
// the output. Those edits now run here, with the same patterns and the same
// first-match-only behaviour, so the standalone output is unchanged.
function standaloneNodeFetchPatches() {
  return {
    name: "standalone-node-fetch-patches",
    renderChunk(code) {
      const relativeUrl =
        /if\s*\(\/.*?\/i?\.exec\(urlStr\)\)\s*\{\s*urlStr\s*=\s*new\s+URL\(urlStr\)\.toString\(\);\s*\}/g;
      const patched = code.replace(relativeUrl, "");
      const headerLimit = /(method:\s*request\.method,)/;
      return { code: patched.replace(headerLimit, "$1 maxHeaderSize: 5*1024*1024,") };
    },
  };
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
    plugins: [...sharedPlugins(), minify()],
  },
  {
    input: "standalone.js",
    output: { file: "../standalone/service/dist/index.js", format: "cjs" },
    onwarn,
    plugins: [...sharedPlugins(), standaloneNodeFetchPatches(), minify()],
  },
];
