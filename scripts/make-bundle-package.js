// Assembles the npm package the WGT reads through jsDelivr. Run after the root
// build (npm run build), then publish:
//   node scripts/make-bundle-package.js
//   npm publish bundle-pkg --access public
//
// The package name must match DEFAULT_PACKAGE in service/bundleUpdates.cjs.
// The package version comes from the root package.json, so the CDN's @latest
// always matches the release being shipped.
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "bundle-pkg");
const DIST = path.join(ROOT, "dist");
const NAME = "axotube-bundle";

const files = ["userScript.js", "early.js"];
for (const f of files) {
  if (!fs.existsSync(path.join(DIST, f))) {
    throw new Error("Missing dist/" + f + ". Run npm run build first.");
  }
}

const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, "dist"), { recursive: true });
for (const f of files) {
  fs.copyFileSync(path.join(DIST, f), path.join(OUT, "dist", f));
}
fs.writeFileSync(
  path.join(OUT, "package.json"),
  JSON.stringify(
    {
      name: NAME,
      version: rootPkg.version,
      description: "AxoTube page bundles (read by the WGT through jsDelivr)",
      files: ["dist"],
      license: rootPkg.license || "UNLICENSED",
      repository: rootPkg.repository,
    },
    null,
    2,
  ) + "\n",
);
console.log("bundle package ready at bundle-pkg/ (" + NAME + "@" + rootPkg.version + ")");
