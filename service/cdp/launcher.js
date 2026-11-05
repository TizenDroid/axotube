"use strict";

// Starts YouTube under the TV's debugger instead of through the localhost proxy.
// The page then runs at https://www.youtube.com, so the proxy's CORS, redirect and
// header rewrites are not needed for it. The bundles go in once per page load with
// Page.addScriptToEvaluateOnNewDocument, before YouTube's own scripts. The
// TizenTube standalone (3f28fc3) re-fetched the userscript on every execution
// context. This sends it once.
//
// Flow. The WGT (index.html) and this service are separate apps, so the service
// drives the restart:
//   1. index.html calls GET /axotube/launch/next. The first call gets "exit". The
//      WGT then exits.
//   2. The service waits for the WGT to stop, then runs SDB "debug" to start it
//      under the debugger. SDB reports the debug port.
//   3. The service attaches over CDP, registers the scripts, and navigates the
//      WGT to YouTube. Meanwhile index.html gets "wait", then "attached".
//   4. Any failure leads to "proxy". index.html then loads the localhost proxy as
//      before. States only move forward within one service run, so a failure
//      cannot loop. A failure is sticky until the service restarts.
//   A later launch after the WGT closed (the CDP socket closes) starts again at 1.

var sdb = require("./sdb.js");
var cdp = require("./cdp.js");
var diagnostics = require("../diagnostics.js");
var launchSettings = require("../launchSettings.js");

// Set to false to keep every launch on the proxy path.
var CDP_ENABLED = true;

var SERVICE_URL = "http://127.0.0.1:8090";
// The content proxy, for update checks. On this path the page is youtube.com, so
// the page cannot name the proxy from its own origin.
var PROXY_URL = "http://127.0.0.1:8081";
var DIAL_URL = "http%3A%2F%2Flocalhost%3A8090%2Fdial%2Fapps%2FYouTube";
var YOUTUBE_URL = "https://www.youtube.com/tv";
var APP_SUFFIX = ".AxoTubeStandalone";
var DEFAULT_APP_ID = "axotubeapp.AxoTubeStandalone";
var EXIT_WAIT_MS = 6000;
var EXIT_POLL_MS = 100;
var ATTACH_DEADLINE_MS = 15000;
var ATTACH_RETRY_MS = 250;

var ACTIONS = {
  checking: "wait",
  exiting: "wait",
  launching: "wait",
  attaching: "wait",
  attached: "attached",
  failed: "proxy",
};

function log(message) {
  console.log("[AxoTube:launch] " + message);
  diagnostics.record("info", "launch: " + message);
}

// The sentence the user reads when the debugger cannot be used. It names the fix.
function developerModeMessage(err, info) {
  if (err) {
    return "Could not read developer mode (" + err.message + "). Check that the TV's Developer mode is on.";
  }
  var devIp = info && info.developerIP;
  if (devIp && devIp !== "127.0.0.1" && devIp !== "1.0.0.127") {
    return "Developer IP is " + devIp + ". Set it to 127.0.0.1 in the TV's Developer mode settings, then restart the app.";
  }
  return "Developer mode is off. Turn it on in the TV's Developer mode settings with developer IP 127.0.0.1.";
}

// Same rule as the standalone page: only plain key=value pairs with safe keys.
function sanitizeArgs(raw) {
  var input = String(raw || "").replace(/^[?&]+/, "");
  if (!input) return "";
  var out = [];
  input.split("&").forEach(function (part) {
    if (!part) return;
    var eq = part.indexOf("=");
    var key = eq === -1 ? part : part.slice(0, eq);
    var value = eq === -1 ? "" : part.slice(eq + 1);
    try {
      key = decodeURIComponent(key.replace(/\+/g, " "));
      value = decodeURIComponent(value.replace(/\+/g, " "));
    } catch (e) {
      return;
    }
    if (!/^[A-Za-z0-9_.-]{1,64}$/.test(key)) return;
    out.push(encodeURIComponent(key) + "=" + encodeURIComponent(value));
  });
  return out.join("&");
}

// A JS string literal that is safe in old engines: U+2028 and U+2029 are escaped,
// since they were line terminators before ES2019.
function literal(text) {
  return JSON.stringify(String(text))
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

// The script that runs in the main frame, before the page's own scripts. The early
// bundle runs first, as an indirect eval, so its globals match a script tag. The
// main bundle waits for DOMContentLoaded, as the end-of-body script tag does.
function buildInjectedSource(early, main) {
  return "(function () {\n" +
    "  if (window.top !== window || window.__axotubeCdp) return;\n" +
    "  window.__axotubeCdp = true;\n" +
    "  window.__axotubeServiceUrl = " + literal(SERVICE_URL) + ";\n" +
    "  window.__axotubeProxyUrl = " + literal(PROXY_URL) + ";\n" +
    "  var early = " + literal(early) + ";\n" +
    "  var main = " + literal(main) + ";\n" +
    "  function report(where, e) {\n" +
    "    (window.__axotubeErrors = window.__axotubeErrors || []).push(where + ': ' + e);\n" +
    "    console.error('[AxoTube] ' + where + ' failed: ' + e);\n" +
    "  }\n" +
    "  try { (0, eval)(early); } catch (e) { report('early', e); }\n" +
    "  function runMain() {\n" +
    "    try { (0, eval)(main); } catch (e) { report('userscript', e); }\n" +
    "  }\n" +
    "  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', runMain);\n" +
    "  else runMain();\n" +
    "})();\n";
}

// Test-only seam: lets a test point the page at a local page instead of YouTube.
var overrides = {};
function setTestOverrides(next) {
  overrides = next || {};
}

// The proxy page that index.html falls back to. Same query as the WGT uses.
function fallbackUrl(args) {
  return "http://localhost:8081/tv?additionalDataUrl=" + DIAL_URL + (args ? "&" + args : "");
}

function youtubeUrl(args) {
  var base = overrides.youtubeUrl || YOUTUBE_URL;
  return base + "?additionalDataUrl=" + DIAL_URL + (args ? "&" + args : "");
}

// deps (injected so the state machine can run without a TV):
//   supported()                  true on the TV
//   appId()                      this package's WGT app id
//   appRunning(appId, cb)        cb(err, running)
//   debugLaunch(appId, cb)       cb(err, port)
//   checkDeveloperMode(cb)       cb(err, { ok, ip })
//   attach({ host, port }, cb)   cb(err, session)
//   launchNormal(appId)          starts the WGT without the debugger
//   readBundle(name)             returns the bundle text
//   schedule(fn, ms), now()
function createLauncher(deps) {
  var state = "idle";
  var args = "";
  var reason = "";
  var deviceIp = null;
  var pendingSession = null;
  var attachedSession = null;
  var scriptId = null;
  var seenRevision = null;

  function publish() {
    diagnostics.setLaunchStatus({ state: state, reason: reason });
  }

  function fail(message) {
    log("using the proxy path: " + message);
    state = "failed";
    reason = message;
    publish();
    if (pendingSession) {
      var stale = pendingSession;
      pendingSession = null;
      stale.close();
    }
  }

  function waitForExit() {
    var started = deps.now();
    (function poll() {
      deps.appRunning(deps.appId(), function (err, running) {
        if (err || !running) return launchDebug();
        if (deps.now() - started >= EXIT_WAIT_MS) return fail("the app did not exit");
        deps.schedule(poll, EXIT_POLL_MS);
      });
    })();
  }

  function launchDebug() {
    state = "launching";
    publish();
    var appId = deps.appId();
    deps.debugLaunch(appId, function (err, port) {
      if (err) {
        deps.launchNormal(appId);
        return fail("debug launch: " + err.message);
      }
      state = "attaching";
      publish();
      attachUntil(port, deps.now() + ATTACH_DEADLINE_MS, 0);
    });
  }

  // Tries 127.0.0.1 first, then the device IP, until the deadline.
  function attachUntil(port, until, attempt) {
    var hosts = ["127.0.0.1"];
    if (deviceIp && deviceIp !== "127.0.0.1") hosts.push(deviceIp);
    var host = hosts[attempt % hosts.length];
    deps.attach({ host: host, port: port }, function (err, session) {
      if (!err) return setUpSession(session, port);
      if (deps.now() >= until) return fail("attach on port " + port + " failed: " + err.message);
      deps.schedule(function () { attachUntil(port, until, attempt + 1); }, ATTACH_RETRY_MS);
    });
  }

  // done(err, stepName). stepName says which step failed.
  function runSteps(session, steps, i, done) {
    if (i >= steps.length) return done(null);
    session.send(steps[i][0], steps[i][1], function (err, result) {
      if (!err && result && result.errorText) err = new Error(result.errorText);
      if (err) return done(new Error(steps[i][0] + ": " + err.message), steps[i][0]);
      if (steps[i][0] === "Page.addScriptToEvaluateOnNewDocument" && result && result.identifier) {
        scriptId = result.identifier;
      }
      runSteps(session, steps, i + 1, done);
    });
  }

  // Called when the proxy's bundles change (an update applied, or a newer bundle
  // cached). The page is not reloaded here. The next page load gets the new code.
  function refreshScripts() {
    var session = attachedSession;
    if (!session || session.closed) return;
    var source;
    try {
      source = buildInjectedSource(deps.readBundle("early.js"), deps.readBundle("userScript.js"));
    } catch (err) {
      return log("bundles not refreshed: " + err.message);
    }
    function add() {
      session.send("Page.addScriptToEvaluateOnNewDocument", { source: source }, function (err, result) {
        if (err) return log("bundles not refreshed: " + err.message);
        scriptId = (result && result.identifier) || null;
        log("bundles refreshed for the next page load");
      });
    }
    if (!scriptId) return add();
    session.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: scriptId }, function () {
      scriptId = null;
      add();
    });
  }

  function setUpSession(session, port) {
    pendingSession = session;
    var source;
    try {
      source = buildInjectedSource(deps.readBundle("early.js"), deps.readBundle("userScript.js"));
    } catch (err) {
      return fail("bundles unreadable: " + err.message);
    }
    var steps = [
      ["Page.enable", {}],
      // The proxy strips YouTube's CSP. Without the bypass, the eval of the bundles
      // would be refused.
      ["Page.setBypassCSP", { enabled: true }],
      ["Page.addScriptToEvaluateOnNewDocument", { source: source }],
      ["Page.navigate", { url: youtubeUrl(args) }],
    ];
    runSteps(session, steps, 0, function (err, stepName) {
      if (err && stepName === "Page.navigate") {
        // Chromium has shown its error page, and index.html is gone with it. Send the
        // page to the proxy directly, so the WGT is not left on the error page.
        return session.send("Page.navigate", { url: fallbackUrl(args) }, function () {
          fail(err.message);
        });
      }
      if (err) return fail(err.message);
      pendingSession = null;
      attachedSession = session;
      state = "attached";
      publish();
      session.setOnClose(function () {
        if (attachedSession !== session) return;
        attachedSession = null;
        if (state === "attached") state = "idle";
        publish();
        log("debugger connection closed; the next launch starts again");
      });
      log("attached on port " + port + "; navigated to YouTube");
    });
  }

  // respond(body) is called once per request.
  // The user's choice on the config page. A new choice clears an earlier failure,
  // so turning the debugger on after a failed try starts a fresh attempt.
  function applySettings() {
    var settings = deps.readSettings();
    if (seenRevision !== null && settings.revision !== seenRevision && state === "failed") {
      log("launch mode changed; the earlier failure is cleared");
      state = "idle";
      reason = "";
      publish();
    }
    seenRevision = settings.revision;
    return settings;
  }

  // Lets the diagnostics page try the debugger again. Refused while a session is
  // attached, since the WGT is then running under the debugger.
  function reset() {
    if (attachedSession && !attachedSession.closed) return false;
    if (state === "failed" || state === "idle") {
      log("retry requested from the diagnostics page");
      state = "idle";
      reason = "";
      publish();
    }
    return true;
  }

  function status() {
    return { state: state, reason: reason, deviceIp: deviceIp };
  }

  // respond(body) is called once per request. Off by default: the proxy path is
  // answered at once, and the WGT never exits.
  function next(rawArgs, respond) {
    if (!args && rawArgs) args = sanitizeArgs(rawArgs);
    var settings = applySettings();
    if (state === "attached" && attachedSession && attachedSession.closed) {
      attachedSession = null;
      state = "idle";
      publish();
    }
    if (!deps.supported()) {
      return respond({ action: "proxy", mode: "proxy", state: state, reason: "not a Tizen TV" });
    }
    if (!settings.debugger) {
      return respond({ action: "proxy", mode: "proxy", state: state, reason: "" });
    }
    if (state === "idle") {
      state = "checking";
      publish();
      deps.checkDeveloperMode(function (err, info) {
        if (err || !info || !info.ok) {
          fail(developerModeMessage(err, info));
          return respond({ action: "proxy", mode: "debugger", state: state, reason: reason });
        }
        deviceIp = info.ip || null;
        state = "exiting";
        publish();
        waitForExit();
        respond({ action: "exit", mode: "debugger", state: state });
      });
      return;
    }
    respond({ action: ACTIONS[state] || "proxy", mode: "debugger", state: state, reason: reason });
  }

  publish();
  return {
    next: next,
    reset: reset,
    status: status,
    refreshScripts: refreshScripts,
    getState: function () { return state; },
  };
}

function isTizen3() {
  try {
    var version = String(tizen.systeminfo.getCapability("http://tizen.org/feature/platform.version"));
    return version.indexOf("3.0") === 0;
  } catch (e) {
    return false;
  }
}

function defaultDeps(readBundle) {
  return {
    supported: function () {
      return CDP_ENABLED && typeof tizen !== "undefined";
    },
    appId: function () {
      try {
        return tizen.application.getAppInfo().packageId + APP_SUFFIX;
      } catch (e) {
        return DEFAULT_APP_ID;
      }
    },
    appRunning: function (appId, cb) {
      try {
        tizen.application.getAppsContext(function (list) {
          cb(null, list.some(function (entry) { return entry.appId === appId; }));
        });
      } catch (e) {
        cb(e, false);
      }
    },
    debugLaunch: function (appId, cb) {
      sdb.debugLaunch(appId, { tizen3: isTizen3() }, cb);
    },
    checkDeveloperMode: function (cb) {
      sdb.checkDeveloperMode(cb);
    },
    attach: function (options, cb) {
      cdp.attach(options, cb);
    },
    launchNormal: function (appId) {
      try {
        tizen.application.launch(appId, function () {}, function () {});
      } catch (e) {
        log("normal relaunch failed: " + e.message);
      }
    },
    readBundle: readBundle,
    readSettings: function () { return launchSettings.read(); },
    schedule: function (fn, ms) { setTimeout(fn, ms); },
    now: function () { return Date.now(); },
  };
}

// Adds the launch routes to the content proxy. Must be mounted before the
// catch-all route.
function mountRoutes(app, readBundle) {
  var launcher = createLauncher(defaultDeps(readBundle));
  app.get("/axotube/launch/next", function (req, res) {
    launcher.next(String(req.query.args || ""), function (body) {
      res.json(body);
    });
  });
  app.post("/axotube/launch/reset", function (req, res) {
    var ok = launcher.reset();
    res.status(ok ? 200 : 409).json({ ok: ok, state: launcher.status().state });
  });
  return launcher;
}

module.exports = {
  mountRoutes: mountRoutes,
  createLauncher: createLauncher,
  buildInjectedSource: buildInjectedSource,
  sanitizeArgs: sanitizeArgs,
  youtubeUrl: youtubeUrl,
  PROXY_URL: PROXY_URL,
  developerModeMessage: developerModeMessage,
  setTestOverrides: setTestOverrides,
};
