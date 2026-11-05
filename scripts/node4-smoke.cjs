// Runs the built standalone service under Node 4.4.4, the TV's service runtime,
// and checks what the TV depends on: the loader starts the core, the content proxy
// answers its health check, a phone can pair with the code and save settings, and
// unpaired requests are refused.
//
// Usage: node scripts/node4-smoke.cjs            (after `npm run build` and build-standalone)
// Needs npm access to the registry; the Node 4 binary comes from the npm package
// node-linux-x64, because nodejs.org is not reachable from every build machine.
"use strict";

const { execFileSync, spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const NODE4_VERSION = "4.4.4";
const PROXY_PORT = 8081;
const CONTROL_PORT = 8090;

function fail(message) {
  console.error("node4-smoke: " + message);
  process.exit(1);
}

// host is the TV address to call: 127.0.0.1 for the TV itself, the LAN address for a phone.
function request(host, method, port, urlPath, headers, body) {
  return new Promise(function (resolve, reject) {
    const req = http.request(
      { host: host, port: port, path: urlPath, method: method, headers: headers || {}, timeout: 4000 },
      function (res) {
        let data = "";
        res.on("data", function (chunk) {
          data += chunk;
        });
        res.on("end", function () {
          resolve({ status: res.statusCode, body: data });
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", function () {
      req.destroy(new Error("timeout"));
    });
    if (body) req.write(body);
    req.end();
  });
}

function sleep(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

async function waitFor(check, label, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try {
      const result = await check();
      if (result) return result;
    } catch (err) {
      last = err;
    }
    await sleep(250);
  }
  fail(label + " did not happen in time" + (last ? " (" + last.message + ")" : ""));
}

// Fetches Node 4.4.4 from the npm registry and returns the path to its binary.
function fetchNode4() {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "axotube-node4-"));
  execFileSync("npm", ["pack", "node-linux-x64@" + NODE4_VERSION], { cwd: work, stdio: "pipe" });
  const tarball = path.join(work, "node-linux-x64-" + NODE4_VERSION + ".tgz");
  execFileSync("tar", ["xzf", tarball, "-C", work]);
  const binary = path.join(work, "package", "bin", "node");
  fs.chmodSync(binary, 0o755);
  const version = execFileSync(binary, ["-v"]).toString().trim();
  if (version !== "v" + NODE4_VERSION) fail("expected Node " + NODE4_VERSION + ", got " + version);
  return binary;
}

// The WGT layout the TV runs: service/dist (loader, core, version) and userscript/.
function assembleLayout() {
  const standalone = path.join(ROOT, "standalone");
  const layout = fs.mkdtempSync(path.join(os.tmpdir(), "axotube-tv-"));
  const dist = path.join(layout, "service", "dist");
  fs.mkdirSync(dist, { recursive: true });
  for (const name of ["index.js", "core.js", "version.json"]) {
    const from = path.join(standalone, "service", "dist", name);
    if (!fs.existsSync(from)) fail("missing " + path.relative(ROOT, from) + "; run build-standalone first");
    fs.copyFileSync(from, path.join(dist, name));
  }
  fs.mkdirSync(path.join(layout, "userscript"));
  for (const name of ["early.js", "userScript.js", "version.json"]) {
    fs.copyFileSync(path.join(standalone, "userscript", name), path.join(layout, "userscript", name));
  }
  // The Tizen APIs the service looks for. Node has none of them, so they are stubbed as
  // the TV reports them: a tizen id for the stable device uuid, and no running apps.
  const shim = [
    "global.tizen = {",
    "  systeminfo: { getCapability: function (k) { return k.indexOf('tizenid') !== -1 ? 'SMOKE-TIZENID' : 'SmokeTV'; } },",
    "  application: {",
    "    getAppInfo: function () { return { packageId: 'axotubeapp' }; },",
    "    getAppsContext: function (cb) { cb([]); }",
    "  }",
    "};",
    "require(" + JSON.stringify(path.join(dist, "index.js")) + ");",
  ].join("\n");
  fs.writeFileSync(path.join(layout, "run-tizen.js"), shim);
  return layout;
}

function lanAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const entry of interfaces[name] || []) {
      if (entry.family === "IPv4" && !entry.internal) return entry.address;
    }
  }
  return null;
}

async function main() {
  const node4 = fetchNode4();
  const layout = assembleLayout();
  console.log("node4-smoke: Node " + NODE4_VERSION + ", layout " + layout);

  const child = spawn(node4, ["run-tizen.js"], { cwd: layout, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", function (chunk) {
    output += chunk;
  });
  child.stderr.on("data", function (chunk) {
    output += chunk;
  });
  let exited = null;
  child.on("exit", function (code) {
    exited = code;
  });
  const stop = function () {
    if (exited === null) child.kill();
  };

  try {
    await waitFor(async function () {
      const res = await request("127.0.0.1", "GET", PROXY_PORT, "/axotube/health");
      return res.status === 200;
    }, "the content proxy health check (" + PROXY_PORT + ")", 20000);
    if (!/is answering/.test(output)) fail("loader did not report the service answering:\n" + output);
    console.log("node4-smoke: health answers 200 and the loader reports the service");

    const address = lanAddress();
    if (!address) fail("no LAN address to test pairing from");
    const phone = function (method, urlPath, headers, body) {
      return request(address, method, CONTROL_PORT, urlPath, headers, body);
    };

    // A phone on the network must be refused before it pairs.
    const unpaired = await phone("GET", "/api/config");
    if (unpaired.status !== 401) fail("an unpaired phone was not refused: " + unpaired.status);

    // The code is shown on the TV, so the TV reads it from loopback.
    const codeRes = await request("127.0.0.1", "GET", CONTROL_PORT, "/api/pairing-code");
    const code = JSON.parse(codeRes.body).code;
    if (!/^\d{6}$/.test(String(code))) fail("pairing code is not six digits: " + codeRes.body);

    const pairRes = await phone("POST", "/api/pair", { "Content-Type": "application/json" }, JSON.stringify({ code: code }));
    if (pairRes.status !== 200) fail("pairing failed with " + pairRes.status + ": " + pairRes.body);
    const token = JSON.parse(pairRes.body).token;
    if (!token) fail("pairing returned no token");
    console.log("node4-smoke: a phone on the LAN is refused until it pairs, then pairs with the code");

    const wrong = await phone("GET", "/api/config", { "x-axotube-token": "wrong-token" });
    if (wrong.status !== 401) fail("a wrong token was not refused: " + wrong.status);

    const current = await phone("GET", "/api/config", { "x-axotube-token": token });
    if (current.status !== 200) fail("the paired phone was refused: " + current.status);
    const currentRevision = JSON.parse(current.body).revision;

    const schema = JSON.parse(fs.readFileSync(path.join(ROOT, "config-schema.json"), "utf8"));
    const save = await phone(
      "POST",
      "/api/config",
      { "x-axotube-token": token, "Content-Type": "application/json" },
      JSON.stringify({ revision: currentRevision, config: schema.defaults }),
    );
    if (save.status !== 200) fail("saving the default settings returned " + save.status + ": " + save.body);
    console.log("node4-smoke: all " + Object.keys(schema.defaults).length + " settings save with 200");

    const favicon = await phone("GET", "/favicon.ico");
    if (favicon.status !== 204) fail("favicon returned " + favicon.status);

    // The version the splash compares with the WGT, and the proxy-first default.
    const shippedVersion = JSON.parse(fs.readFileSync(path.join(ROOT, "standalone", "service", "dist", "version.json"), "utf8")).version;
    const health = JSON.parse((await request("127.0.0.1", "GET", PROXY_PORT, "/axotube/health")).body);
    if (health.ok !== true || health.version !== shippedVersion) fail("health reports " + JSON.stringify(health));
    const next = JSON.parse((await request("127.0.0.1", "GET", PROXY_PORT, "/axotube/launch/next?args=")).body);
    if (next.action !== "proxy" || next.mode !== "proxy") fail("the default launch is not the proxy: " + JSON.stringify(next));
    console.log("node4-smoke: health reports " + shippedVersion + "; the default launch is the proxy, with no exit");

    // The diagnostics page the red key opens, and the data it reads.
    const diagPage = await request("127.0.0.1", "GET", PROXY_PORT, "/axotube/diagnostics");
    if (diagPage.status !== 200 || diagPage.body.indexOf("axotube diagnostics") === -1) fail("diagnostics page returned " + diagPage.status);
    const diag = JSON.parse((await request("127.0.0.1", "GET", PROXY_PORT, "/axotube/diagnostics.json")).body);
    if (diag.service.version !== shippedVersion || !Array.isArray(diag.events) || diag.launch.debugger !== false) {
      fail("diagnostics.json has an unexpected shape: " + JSON.stringify(diag).slice(0, 300));
    }
    const reset = await request("127.0.0.1", "POST", PROXY_PORT, "/axotube/launch/reset");
    if (reset.status !== 200) fail("launch reset returned " + reset.status + ": " + reset.body);

    // The phone's launch mode: read, save, reject a bad value, and put it back.
    const authed = { "x-axotube-token": token, "Content-Type": "application/json" };
    const launchGet = await phone("GET", "/api/launch", { "x-axotube-token": token });
    if (launchGet.status !== 200 || JSON.parse(launchGet.body).debugger !== false) fail("GET /api/launch: " + launchGet.body);
    const launchBad = await phone("POST", "/api/launch", authed, JSON.stringify({ debugger: "yes" }));
    if (launchBad.status !== 400) fail("a non-boolean launch mode was not refused: " + launchBad.status);
    const launchOn = await phone("POST", "/api/launch", authed, JSON.stringify({ debugger: true }));
    if (launchOn.status !== 200) fail("saving the debugger launch returned " + launchOn.status);
    const nextOn = JSON.parse((await request("127.0.0.1", "GET", PROXY_PORT, "/axotube/launch/next?args=")).body);
    if (nextOn.mode !== "debugger") fail("the saved choice did not reach the launcher: " + JSON.stringify(nextOn));
    const launchOff = await phone("POST", "/api/launch", authed, JSON.stringify({ debugger: false }));
    if (launchOff.status !== 200) fail("restoring the proxy launch returned " + launchOff.status);
    const phoneDiag = await phone("GET", "/api/diagnostics", { "x-axotube-token": token });
    if (phoneDiag.status !== 200 || JSON.parse(phoneDiag.body).service.version !== shippedVersion) fail("GET /api/diagnostics: " + phoneDiag.body.slice(0, 200));
    // The shell loads the config app from the release; the launch control is rendered
    // by service/web/config.js, so check both the served page and the shipped app.
    const configPage = await phone("GET", "/");
    const configApp = fs.readFileSync(path.join(ROOT, "service", "web", "config.js"), "utf8");
    if (
      configPage.status !== 200 ||
      configPage.body.indexOf("/config.js") === -1 ||
      configApp.indexOf("launchDebugger") === -1
    ) {
      fail("the config page does not load the launch-mode app");
    }
    console.log("node4-smoke: the launch mode saves and reaches the launcher; diagnostics and the config page answer");

    // The cast restart route uses object spread, which the ES5 build expands with a
    // helper. This runs it on Node 4 (loopback only, so the TV itself calls it).
    const restart = await request("127.0.0.1", "POST", CONTROL_PORT, "/api/cast/restart", { "Content-Type": "application/json" }, JSON.stringify({ reason: "manual" }));
    const restartBody = JSON.parse(restart.body);
    if (restart.status !== 200 || restartBody.ok !== true || restartBody.restarted !== true) fail("cast restart: " + restart.status + " " + restart.body);
    console.log("node4-smoke: cast discovery restarts from the ES5 build");

    // The DIAL identity is a name-based UUID of the tizen id, so it is stable across starts.
    // It must match uuid.v5 of the stubbed id, or the TV falls back to a random UUID.
    const dd = await request("127.0.0.1", "GET", CONTROL_PORT, "/dial/ssdp/device-desc.xml", {}, "");
    const expectedUuid = (function () {
      const hash = crypto.createHash("sha1")
        .update(Buffer.from("4bcbc514bdd641638215316526fd1d9b", "hex"))
        .update(Buffer.from("SMOKE-TIZENID", "utf8")).digest();
      hash[6] = (hash[6] & 0x0f) | 0x50;
      hash[8] = (hash[8] & 0x3f) | 0x80;
      const h = hash.toString("hex", 0, 16);
      return [h.slice(0, 8), h.slice(8, 12), h.slice(12, 16), h.slice(16, 20), h.slice(20)].join("-");
    })();
    if (dd.status !== 200 || dd.body.indexOf("uuid:" + expectedUuid) === -1) fail("DIAL device uuid is not the stable tizen-id uuid: " + dd.status);
    console.log("node4-smoke: DIAL identity is the stable uuid of the tizen id");

    const digest = crypto.createHash("sha256").update(fs.readFileSync(path.join(layout, "service", "dist", "core.js"))).digest("hex");
    console.log("node4-smoke: passed (core sha256 " + digest.slice(0, 12) + ")");
  } finally {
    stop();
    fs.rmSync(layout, { recursive: true, force: true });
  }
  if (/TypeError|ReferenceError|SyntaxError/.test(output)) {
    fail("the service logged a runtime error under Node 4:\n" + output);
  }
  process.exit(0);
}

main().catch(function (err) {
  fail(err && err.stack ? err.stack : String(err));
});
