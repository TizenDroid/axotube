import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import babel from "@rollup/plugin-babel";
import replace from "@rollup/plugin-replace";
import json from "@rollup/plugin-json";
import terser from "@rollup/plugin-terser";
import fs from "fs";

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

export default {
  input: "service.js",
  output: {
    file: "../dist/service.js",
    format: "cjs",
  },
  onwarn(warning) {
    if (warning.code !== "CIRCULAR_DEPENDENCY") {
      console.warn(warning.message);
    }
  },
  plugins: [
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
    terser({
      ecma: 5,
      mangle: { reserved: ["tizen"] },
      compress: { passes: 1 },
    }),
  ],
};
