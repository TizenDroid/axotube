#!/usr/bin/env node
// Runs every route check in scripts/node4-routes/driver.js against the real standalone
// service. By default the service runs on Node 4.4.4, the TV's runtime, from the pinned
// binary. Options:
//   --node <binary>  run the service and driver on another Node (for example the current one)
//   --coverage       build the service unminified and report V8 branch coverage of its sources
// The service is stopped with SIGTERM and exits cleanly, so V8 writes its coverage data.
"use strict";
const { execFileSync, spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { fetchNode4 } = require("./lib/node4.cjs");
const { serviceCoverage, formatCoverage } = require("./lib/coverage.cjs");

const ROOT = path.resolve(__dirname, "..");
const NODE4_VERSION = "4.4.4";
const PROXY_PORT = 8081;
const CONTROL_PORT = 8090;
const DRIVER = path.join(__dirname, "node4-routes", "driver.js");

function fail(message) {
  console.error("node4-routes: " + message);
  process.exit(1);
}

function args() {
  const out = { node: null, coverage: false };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--node") out.node = argv[++i];
    else if (argv[i] === "--coverage") out.coverage = true;
    else fail("unknown option " + argv[i]);
  }
  return out;
}

function get(port, urlPath) {
  return new Promise(function (resolve, reject) {
    const req = http.get({ host: "127.0.0.1", port: port, path: urlPath, agent: false }, function (res) {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", function (chunk) {
        text += chunk;
      });
      res.on("end", function () {
        resolve({ status: res.statusCode, text: text });
      });
    });
    req.on("error", reject);
    req.setTimeout(5000, function () {
      req.abort();
      reject(new Error("timeout " + urlPath));
    });
  });
}

async function waitFor(check, label, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try {
      if (await check()) return;
    } catch (err) {
      last = err;
    }
    await new Promise(function (resolve) {
      setTimeout(resolve, 250);
    });
  }
  fail("timed out waiting for " + label + (last ? " (" + last.message + ")" : ""));
}

// The WGT layout the TV runs: service/dist (loader, core, version) and userscript/.
// The core is the shipped one, or the unminified coverage build with its source map.
function assembleLayout(coreDir) {
  const standalone = path.join(ROOT, "standalone");
  const layout = fs.mkdtempSync(path.join(os.tmpdir(), "axotube-tv-"));
  const dist = path.join(layout, "service", "dist");
  fs.mkdirSync(dist, { recursive: true });
  for (const name of ["index.js", "version.json"]) {
    const from = path.join(standalone, "service", "dist", name);
    if (!fs.existsSync(from)) fail("missing " + path.relative(ROOT, from) + "; run build-standalone first");
    fs.copyFileSync(from, path.join(dist, name));
  }
  const core = coreDir
    ? { from: path.join(coreDir, "core.js"), map: path.join(coreDir, "core.js.map") }
    : { from: path.join(standalone, "service", "dist", "core.js"), map: null };
  fs.copyFileSync(core.from, path.join(dist, "core.js"));
  if (core.map) fs.copyFileSync(core.map, path.join(dist, "core.js.map"));
  fs.mkdirSync(path.join(layout, "userscript"));
  for (const name of ["early.js", "userScript.js", "version.json"]) {
    fs.copyFileSync(path.join(standalone, "userscript", name), path.join(layout, "userscript", name));
  }
  // The Tizen APIs the service looks for. Node has none of them, so they are stubbed as the
  // TV reports them. SIGTERM exits cleanly, which lets V8 write coverage data.
  const shim = [
    "global.tizen = {",
    "  systeminfo: { getCapability: function (k) { return k.indexOf('tizenid') !== -1 ? 'ROUTES-TIZENID' : 'RoutesTV'; } },",
    "  application: {",
    "    getAppInfo: function () { return { packageId: 'axotubeapp' }; },",
    "    getAppsContext: function (cb) { cb([]); }",
    "  }",
    "};",
    "process.on('SIGTERM', function () { process.exit(0); });",
    "require(" + JSON.stringify(path.join(dist, "index.js")) + ");",
  ].join("\n");
  fs.writeFileSync(path.join(layout, "run-tizen.js"), shim);
  return layout;
}

function coverageCore() {
  const out = execFileSync("node", [path.join(ROOT, "scripts", "build-service-coverage.mjs")], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "inherit"],
  });
  return out.toString().trim().split("\n").pop();
}

function lanHostFrom(pairing) {
  const urls = pairing.json.urls || [];
  if (!urls.length) return "";
  return new URL(urls[0]).hostname;
}

async function main() {
  const opts = args();
  const nodeBin = opts.node || fetchNode4(NODE4_VERSION);
  const version = execFileSync(nodeBin, ["-v"]).toString().trim();
  console.log("node4-routes: service and driver on " + version + (opts.coverage ? " (coverage build)" : ""));

  const coreDir = opts.coverage ? coverageCore() : null;
  const coverageDir = opts.coverage ? fs.mkdtempSync(path.join(os.tmpdir(), "axotube-v8-")) : null;
  const layout = assembleLayout(coreDir);

  const env = Object.assign({}, process.env);
  if (coverageDir) env.NODE_V8_COVERAGE = coverageDir;
  const logPath = path.join(layout, "service.log");
  const logFd = fs.openSync(logPath, "w");
  const service = spawn(nodeBin, ["run-tizen.js"], { cwd: layout, env: env, stdio: ["ignore", logFd, logFd] });
  let serviceExited = false;
  service.on("exit", function () {
    serviceExited = true;
  });

  const stop = async function () {
    if (serviceExited) return;
    service.kill("SIGTERM");
    for (let i = 0; i < 100 && !serviceExited; i++) {
      await new Promise(function (resolve) {
        setTimeout(resolve, 100);
      });
    }
    if (!serviceExited) service.kill("SIGKILL");
  };

  let driverStatus = 1;
  try {
    await waitFor(async function () {
      return (await get(PROXY_PORT, "/axotube/health")).status === 200;
    }, "the service health route", 60000);
    if (serviceExited) fail("the service exited during startup; see " + logPath + "\n" + fs.readFileSync(logPath, "utf8"));

    const pairing = await get(CONTROL_PORT, "/api/pairing-code");
    if (pairing.status !== 200) fail("pairing code route answered " + pairing.status);
    const lan = lanHostFrom({ json: JSON.parse(pairing.text) });

    const driver = spawn(nodeBin, [DRIVER, String(CONTROL_PORT), lan], { stdio: "inherit" });
    driverStatus = await new Promise(function (resolve) {
      driver.on("exit", function (code) {
        resolve(code === null ? 1 : code);
      });
    });
  } finally {
    await stop();
  }

  if (coverageDir) {
    const summary = await serviceCoverage(ROOT, coverageDir, coreDir);
    console.log("node4-routes: coverage of the service's own sources (this run only)");
    console.log(formatCoverage(summary).text);
  }
  process.exit(driverStatus);
}

main().catch(function (err) {
  fail(err && err.stack ? err.stack : String(err));
});
