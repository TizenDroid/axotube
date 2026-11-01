// Assembles the npm package the WGT and APK read through jsDelivr. Run after the
// root build. CI publishes it (see .github/workflows/ci.yml); publishing by hand
// is `npm publish bundle-pkg --access public` after this script.
//
// The name comes from the root package.json "bundlePackage" field. The WGT
// (service/bundleUpdates.cjs) and the APK (BundleStore.java) must use the same
// name; tests/proxy-parity.test.cjs checks that.
// The version comes from the root package.json, so the CDN's @latest always
// matches the release being shipped.
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "bundle-pkg");
const DIST = path.join(ROOT, "dist");
const rootManifest = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const NAME = rootManifest.bundlePackage;
if (!NAME) throw new Error("Root package.json has no bundlePackage field");

const files = ["userScript.js", "early.js"];
for (const f of files) {
  if (!fs.existsSync(path.join(DIST, f))) {
    throw new Error("Missing dist/" + f + ". Run npm run build first.");
  }
}

// The standalone service the WGT can update to: the core and its checksum manifest,
// both written by scripts/build-standalone.js. The core is published byte for byte,
// so the manifest's checksum stays true.
const SERVICE_DIST = path.join(ROOT, "standalone", "service", "dist");
const serviceFiles = [
  { from: path.join(SERVICE_DIST, "core.js"), to: "service-core.js" },
  { from: path.join(SERVICE_DIST, "service-core.json"), to: "service-core.json" },
];
for (const f of serviceFiles) {
  if (!fs.existsSync(f.from)) {
    throw new Error("Missing " + path.relative(ROOT, f.from) + ". Run node scripts/build-standalone.js first.");
  }
}

const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, "dist"), { recursive: true });
for (const f of files) {
  fs.copyFileSync(path.join(DIST, f), path.join(OUT, "dist", f));
}
for (const f of serviceFiles) {
  fs.copyFileSync(f.from, path.join(OUT, "dist", f.to));
}

// The published manifest must describe exactly the core that was copied.
const manifest = JSON.parse(fs.readFileSync(path.join(OUT, "dist", "service-core.json"), "utf8"));
const crypto = require("crypto");
const published = fs.readFileSync(path.join(OUT, "dist", "service-core.js"));
const digest = crypto.createHash("sha256").update(published).digest("hex");
if (manifest.version !== rootManifest.version || manifest.sha256 !== digest || manifest.bytes !== published.length) {
  throw new Error("service-core.json does not describe the service-core.js being published");
}
fs.writeFileSync(
  path.join(OUT, "package.json"),
  JSON.stringify(
    {
      name: NAME,
      version: rootPkg.version,
      description: "AxoTube page bundles and standalone service (read by the WGT through jsDelivr)",
      files: ["dist"],
      license: rootPkg.license || "UNLICENSED",
      repository: rootPkg.repository,
      publishConfig: { access: "public" },
    },
    null,
    2,
  ) + "\n",
);
// npm renders this on the package page. Without it the page says the package
// has no README, which reads like an abandoned package.
fs.copyFileSync(
  path.join(__dirname, "bundle-package-README.md"),
  path.join(OUT, "README.md"),
);
console.log("bundle package ready at bundle-pkg/ (" + NAME + "@" + rootPkg.version + ")");
