"use strict";
// Route driver for the TV service. It runs one check per route and branch: the status codes,
// the JSON shapes and the error paths the handlers define. It is ES5 on purpose, because it
// runs on Node 4.4.4 (the TV's runtime) as well as on the current Node. It talks to a running
// service over HTTP only, so the same checks cover the shipped build and the coverage build.
// Usage: node driver.js <controlPort> <lanHost>
// Every check prints PASS or FAIL. The exit status is 0 only when all checks pass.
var http = require("http");

var PORT = Number(process.argv[2]);
var LAN = process.argv[3] || "";
var steps = [];
var state = {};

function step(name, fn) {
  steps.push({ name: name, fn: fn });
}

function send(host, method, path, headers, body) {
  return sendRaw(host, method, path, headers, body === undefined ? null : JSON.stringify(body));
}

function sendRaw(host, method, path, headers, payload) {
  return new Promise(function (resolve, reject) {
    var head = {};
    Object.keys(headers || {}).forEach(function (key) {
      head[key] = headers[key];
    });
    if (payload !== null) {
      head["Content-Type"] = head["Content-Type"] || "application/json";
      head["Content-Length"] = Buffer.byteLength(payload);
    }
    var req = http.request({ host: host, port: PORT, method: method, path: path, headers: head, agent: false }, function (res) {
      var chunks = [];
      res.on("data", function (chunk) {
        chunks.push(chunk);
      });
      res.on("end", function () {
        var text = Buffer.concat(chunks).toString("utf8");
        var json = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch (err) {
          json = null;
        }
        resolve({ status: res.statusCode, type: String(res.headers["content-type"] || ""), text: text, json: json });
      });
    });
    req.on("error", reject);
    req.setTimeout(15000, function () {
      req.abort();
      reject(new Error("timeout: " + method + " " + path));
    });
    if (payload !== null) req.write(payload);
    req.end();
  });
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function expectStatus(res, status, label) {
  expect(res.status === status, label + ": expected HTTP " + status + ", got " + res.status + " " + res.text.slice(0, 160));
}

function expectError(res, status, message, label) {
  expectStatus(res, status, label);
  expect(res.json && res.json.ok === false, label + ": body is not an error envelope: " + res.text.slice(0, 160));
  expect(res.json.error === message, label + ": expected error \"" + message + "\", got \"" + res.json.error + "\"");
}

function loopback(method, path, headers, body) {
  return send("127.0.0.1", method, path, headers, body);
}

function config() {
  return state.config;
}

// ── Loopback: the TV's own browser and tools, which skip the phone's pairing check ──────────
step("favicon answers 204", function () {
  return loopback("GET", "/favicon.ico").then(function (res) {
    expectStatus(res, 204, "favicon");
  });
});

step("the web config page is served as HTML", function () {
  return loopback("GET", "/").then(function (res) {
    expectStatus(res, 200, "index");
    expect(res.type.indexOf("text/html") === 0, "index: content type is " + res.type);
    expect(res.text.indexOf("<html") !== -1, "index: no html document");
  });
});

step("pairing code is six digits and lists LAN URLs (loopback only)", function () {
  return loopback("GET", "/api/pairing-code").then(function (res) {
    expectStatus(res, 200, "pairing code");
    expect(res.json.ok === true, "pairing code: not ok");
    expect(/^\d+$/.test(String(res.json.code)), "pairing code: not digits");
    expect(Array.isArray(res.json.urls), "pairing code: urls is not a list");
    state.code = String(res.json.code);
    state.lanUrls = res.json.urls;
  });
});

step("pairing without a code is refused", function () {
  return loopback("POST", "/api/pair", {}, {}).then(function (res) {
    expectError(res, 403, "Invalid pairing code", "pair without code");
  });
});

step("pairing with a wrong code is refused", function () {
  return loopback("POST", "/api/pair", {}, { code: "not-the-code" }).then(function (res) {
    expectError(res, 403, "Invalid pairing code", "pair wrong code");
  });
});

step("pairing with the right code returns the API token", function () {
  return loopback("POST", "/api/pair", {}, { code: state.code }).then(function (res) {
    expectStatus(res, 200, "pair right code");
    expect(res.json.ok === true && typeof res.json.token === "string" && res.json.token.length > 0, "pair: no token");
    state.token = res.json.token;
  });
});

step("config reads return a revision and the stored settings", function () {
  return loopback("GET", "/api/config").then(function (res) {
    expectStatus(res, 200, "config get");
    expect(Number.isInteger(res.json.revision), "config get: revision is not an integer");
    expect(res.json.config && typeof res.json.config === "object", "config get: no config object");
    state.revision = res.json.revision;
    state.config = res.json.config;
  });
});

step("config rejects a body that is not JSON", function () {
  return sendRaw("127.0.0.1", "POST", "/api/config", { "Content-Type": "application/json" }, "{not json").then(function (res) {
    expectStatus(res, 400, "config bad json");
    expect(res.json && res.json.ok === false, "config bad json: not an error envelope");
  });
});

step("config rejects an array as the settings", function () {
  return loopback("POST", "/api/config", {}, []).then(function (res) {
    expectError(res, 400, "Invalid config payload", "config array");
  });
});

step("config rejects a negative revision in the envelope", function () {
  return loopback("POST", "/api/config", {}, { config: config(), revision: -1 }).then(function (res) {
    expectError(res, 400, "Invalid config revision", "config negative revision");
  });
});

step("config rejects a stale revision with 409 and the current revision", function () {
  return loopback("POST", "/api/config", {}, { config: config(), revision: state.revision + 1000 }).then(function (res) {
    expectStatus(res, 409, "config stale");
    expect(res.json.revision === state.revision, "config stale: revision not reported");
  });
});

step("config saves an envelope with the current revision", function () {
  return loopback("POST", "/api/config", {}, { config: config(), revision: state.revision }).then(function (res) {
    expectStatus(res, 200, "config envelope save");
    expect(res.json.ok === true && res.json.applied === true, "config envelope save: not applied");
    state.revision = res.json.revision;
  });
});

step("config saves a legacy plain object (last write wins)", function () {
  return loopback("POST", "/api/config", {}, config()).then(function (res) {
    expectStatus(res, 200, "config legacy save");
    expect(res.json.ok === true && res.json.applied === true, "config legacy save: not applied");
  });
});

step("config is read again before the push checks", function () {
  return loopback("GET", "/api/config").then(function (res) {
    state.revision = res.json.revision;
    state.config = res.json.config;
  });
});

step("config push rejects a body without settings", function () {
  return loopback("POST", "/api/config/push", {}, { revision: 1 }).then(function (res) {
    expectError(res, 400, "Invalid config push", "push without config");
  });
});

step("config push rejects a stale revision with 409", function () {
  return loopback("POST", "/api/config/push", {}, { config: config(), revision: -5 }).then(function (res) {
    expectStatus(res, 409, "push stale");
    expect(res.json.error === "Stale config revision" && res.json.applied === false, "push stale: wrong envelope");
  });
});

step("config push applies settings at the current revision", function () {
  return loopback("POST", "/api/config/push", {}, { config: config(), revision: state.revision }).then(function (res) {
    expectStatus(res, 200, "push ok");
    expect(res.json.applied === true, "push ok: not applied");
  });
});

step("launch mode reads as a boolean", function () {
  return loopback("GET", "/api/launch").then(function (res) {
    expectStatus(res, 200, "launch get");
    expect(typeof res.json.debugger === "boolean", "launch get: debugger is not a boolean");
    state.debugger = res.json.debugger;
  });
});

step("launch mode rejects a non-boolean", function () {
  return loopback("POST", "/api/launch", {}, { debugger: "yes" }).then(function (res) {
    expectError(res, 400, "debugger must be true or false", "launch bad value");
  });
});

step("launch mode saves the value it already has", function () {
  return loopback("POST", "/api/launch", {}, { debugger: state.debugger }).then(function (res) {
    expectStatus(res, 200, "launch save");
    expect(res.json.debugger === state.debugger, "launch save: value changed");
  });
});

step("commands reject an unsupported action", function () {
  return loopback("POST", "/api/command", {}, { action: "nope" }).then(function (res) {
    expectError(res, 400, "Unsupported command", "command unsupported");
  });
});

step("commands reject a body that is an array", function () {
  return loopback("POST", "/api/command", {}, [1]).then(function (res) {
    expectError(res, 400, "Unsupported command", "command array");
  });
});

step("command queue is empty at the start", function () {
  return loopback("GET", "/api/command").then(function (res) {
    expectStatus(res, 200, "command empty");
    expect(res.json.id === null && res.json.command === null, "command empty: queue not empty");
  });
});

step("a play command is queued and returns its id", function () {
  return loopback("POST", "/api/command", {}, { action: "play", videoId: "abc123", playlistId: "PL1" }).then(function (res) {
    expectStatus(res, 200, "command play");
    expect(res.json.ok === true && Number.isInteger(res.json.id), "command play: no id");
    expect(res.json.command.action === "play" && res.json.command.videoId === "abc123", "command play: wrong command");
    state.commandId = res.json.id;
  });
});

step("the queued command is the one at the head", function () {
  return loopback("GET", "/api/command").then(function (res) {
    expect(res.json.id === state.commandId, "command head: wrong id");
  });
});

step("acknowledging a command needs a numeric id", function () {
  return loopback("POST", "/api/command/ack", {}, { id: "x" }).then(function (res) {
    expectError(res, 400, "Invalid command id", "ack invalid id");
  });
});

step("acknowledging an id that is not pending returns 409", function () {
  return loopback("POST", "/api/command/ack", {}, { id: 999999 }).then(function (res) {
    expectError(res, 409, "Command is no longer pending", "ack not pending");
  });
});

step("acknowledging the head command removes it", function () {
  return loopback("POST", "/api/command/ack", {}, { id: state.commandId }).then(function (res) {
    expectStatus(res, 200, "ack");
    expect(res.json.ok === true, "ack: not ok");
  });
});

step("acknowledging it twice returns 409", function () {
  return loopback("POST", "/api/command/ack", {}, { id: state.commandId }).then(function (res) {
    expectError(res, 409, "Command is no longer pending", "ack twice");
  });
});

step("a full queue refuses a new command with 429", function () {
  var indexes = [];
  for (var i = 0; i < 50; i++) indexes.push(i);
  return indexes.reduce(function (chain, n) {
    return chain.then(function () {
      return loopback("POST", "/api/command", {}, { action: "play", videoId: "v" + n });
    });
  }, Promise.resolve()).then(function () {
    return loopback("POST", "/api/command", {}, { action: "play", videoId: "overflow" });
  }).then(function (res) {
    expectError(res, 429, "Command queue full", "command overflow");
  });
});

step("the queue drains one acknowledgement at a time", function () {
  var drained = 0;
  function drain() {
    return loopback("GET", "/api/command").then(function (head) {
      if (head.json.id === null) return drained;
      drained++;
      expect(drained <= 60, "drain: queue never emptied");
      return loopback("POST", "/api/command/ack", {}, { id: head.json.id }).then(function (res) {
        expectStatus(res, 200, "drain ack");
        return drain();
      });
    });
  }
  return drain().then(function (count) {
    expect(count === 50, "drain: expected 50 queued commands, drained " + count);
  });
});

step("nowplaying starts with a nowPlaying field", function () {
  return loopback("GET", "/api/nowplaying").then(function (res) {
    expectStatus(res, 200, "nowplaying get");
    expect("nowPlaying" in res.json, "nowplaying get: no field");
  });
});

step("nowplaying stores an object of fields", function () {
  return loopback("POST", "/api/nowplaying", {}, { title: "Song", videoId: "v1" }).then(function (res) {
    expectStatus(res, 200, "nowplaying set");
    return loopback("GET", "/api/nowplaying");
  }).then(function (res) {
    expect(res.json.nowPlaying && res.json.nowPlaying.title === "Song", "nowplaying: title not stored");
  });
});

step("nowplaying clears on an empty object", function () {
  return loopback("POST", "/api/nowplaying", {}, {}).then(function () {
    return loopback("GET", "/api/nowplaying");
  }).then(function (res) {
    expect(res.json.nowPlaying === null, "nowplaying empty: not cleared");
  });
});

step("nowplaying clears on an array", function () {
  return loopback("POST", "/api/nowplaying", {}, [1, 2]).then(function () {
    return loopback("GET", "/api/nowplaying");
  }).then(function (res) {
    expect(res.json.nowPlaying === null, "nowplaying array: not cleared");
  });
});

step("nowplaying clears when the body is missing", function () {
  return loopback("POST", "/api/nowplaying", {}, undefined).then(function () {
    return loopback("GET", "/api/nowplaying");
  }).then(function (res) {
    expect(res.json.nowPlaying === null, "nowplaying no body: not cleared");
  });
});

step("diagnostics summary is JSON", function () {
  return loopback("GET", "/api/diagnostics").then(function (res) {
    expectStatus(res, 200, "diagnostics");
    expect(res.json && typeof res.json === "object", "diagnostics: not an object");
  });
});

step("diagnostics export is plain text", function () {
  return loopback("GET", "/api/diagnostics/export").then(function (res) {
    expectStatus(res, 200, "diagnostics export");
    expect(res.type.indexOf("text/plain") === 0, "diagnostics export: content type " + res.type);
  });
});

step("diagnostics QR is a GIF, or 503 when the TV has no network", function () {
  return loopback("GET", "/api/diagnostics/qr").then(function (res) {
    if (res.status === 200) {
      expect(res.type === "image/gif", "qr: content type " + res.type);
      expect(res.text.indexOf("GIF8") === 0, "qr: not a GIF");
    } else {
      expectStatus(res, 503, "qr without network");
      expect(res.text.indexOf("No LAN address") === 0, "qr without network: wrong message");
    }
  });
});

step("an unknown API path is 404", function () {
  return loopback("GET", "/api/does-not-exist").then(function (res) {
    expectStatus(res, 404, "unknown api");
  });
});

step("cast restart is accepted and reports restarted", function () {
  return loopback("POST", "/api/cast/restart", {}, { reason: "manual" }).then(function (res) {
    expectStatus(res, 200, "cast restart");
    expect(res.json.ok === true && res.json.restarted === true, "cast restart: not restarted");
  });
});

// ── LAN: the phone, which must pair and then send the token ─────────────────────────────────
step("the LAN address is reported by the service", function () {
  expect(LAN, "no LAN address: the driver cannot check pairing from a phone");
});

step("a phone without a token is refused", function () {
  return send(LAN, "GET", "/api/config").then(function (res) {
    expectError(res, 401, "Pairing required", "lan no token");
  });
});

step("a phone with a wrong token is refused", function () {
  return send(LAN, "GET", "/api/config", { "x-axotube-token": "wrong" }).then(function (res) {
    expectError(res, 401, "Pairing required", "lan wrong token");
  });
});

step("the pairing page refuses a phone (loopback only)", function () {
  return send(LAN, "GET", "/api/pairing-code").then(function (res) {
    expectError(res, 403, "Loopback only", "lan pairing code");
  });
});

step("a phone with a wrong code is refused", function () {
  return send(LAN, "POST", "/api/pair", {}, { code: "not-the-code" }).then(function (res) {
    expectError(res, 403, "Invalid pairing code", "lan wrong code");
  });
});

step("a phone with the right code receives the token", function () {
  return send(LAN, "POST", "/api/pair", {}, { code: state.code }).then(function (res) {
    expectStatus(res, 200, "lan pair");
    expect(res.json.token === state.token, "lan pair: token differs from the loopback token");
  });
});

step("a phone with x-axotube-token is allowed", function () {
  return send(LAN, "GET", "/api/config", { "x-axotube-token": state.token }).then(function (res) {
    expectStatus(res, 200, "lan header token");
  });
});

step("a phone with a Bearer token is allowed", function () {
  return send(LAN, "GET", "/api/config", { authorization: "Bearer " + state.token }).then(function (res) {
    expectStatus(res, 200, "lan bearer token");
  });
});

step("repeated wrong codes from one address are rate limited with 429", function () {
  var attempts = 0;
  function attempt() {
    attempts++;
    expect(attempts <= 100, "rate limit: no 429 after 100 attempts");
    return send(LAN, "POST", "/api/pair", {}, { code: "wrong" }).then(function (res) {
      if (res.status === 429) {
        expectError(res, 429, "Too many pairing attempts", "rate limit");
        return attempts;
      }
      expectError(res, 403, "Invalid pairing code", "rate limit attempt");
      return attempt();
    });
  }
  return attempt().then(function (count) {
    expect(count > 1, "rate limit: refused on the first attempt");
  });
});

// ── Run ─────────────────────────────────────────────────────────────────────────────────────
var passed = 0;
var failed = 0;
steps.reduce(function (chain, item) {
  return chain.then(function () {
    return Promise.resolve().then(item.fn).then(function () {
      passed++;
      console.log("PASS " + item.name);
    }, function (err) {
      failed++;
      console.log("FAIL " + item.name + ": " + (err && err.message ? err.message : String(err)));
    });
  });
}, Promise.resolve()).then(function () {
  console.log("routes: " + passed + " passed, " + failed + " failed, " + steps.length + " checks");
  process.exitCode = failed === 0 ? 0 : 1;
});
