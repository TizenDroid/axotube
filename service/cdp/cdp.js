"use strict";

// Chromium DevTools Protocol client for one page target. It uses the same HTTP
// discovery (/json/list) and WebSocket endpoint that chrome-remote-interface uses,
// without the dependency. ES5, Node 4 compatible.

var http = require("http");
var websocket = require("./websocket.js");

var CALL_TIMEOUT_MS = 10000;
var DISCOVERY_TIMEOUT_MS = 3000;

function once(fn) {
  var called = false;
  return function () {
    if (called) return;
    called = true;
    fn.apply(null, arguments);
  };
}

function getJson(host, port, path, callback) {
  var done = once(callback);
  var req = http.get({ host: host, port: port, path: path }, function (res) {
    var body = "";
    res.setEncoding("utf8");
    res.on("data", function (chunk) { body += chunk; });
    res.on("end", function () {
      if (res.statusCode !== 200) return done(new Error("HTTP " + res.statusCode + " for " + path));
      try {
        done(null, JSON.parse(body));
      } catch (err) {
        done(err);
      }
    });
  });
  req.setTimeout(DISCOVERY_TIMEOUT_MS, function () {
    req.abort();
    done(new Error("discovery timed out for " + path));
  });
  req.on("error", function (err) { done(err); });
}

// The first page target that has a debugger socket. The TV's WGT has one page.
function pickPage(list) {
  if (!list || !list.length) return null;
  for (var i = 0; i < list.length; i += 1) {
    if (list[i].type === "page" && list[i].webSocketDebuggerUrl) return list[i];
  }
  return null;
}

// The path part of a ws:// URL. The host is replaced with the one we reached.
function pathOf(wsUrl) {
  var m = /^wss?:\/\/[^\/]+(\/.*)$/i.exec(String(wsUrl || ""));
  return m ? m[1] : null;
}

// options: { host, port }. callback(err, session). The session has:
//   send(method, params, cb)  cb(err, result)
//   onEvent(fn)               fn(method, params)
//   setOnClose(fn)            fn(err)
//   close()
function attach(options, callback) {
  var done = once(callback);
  getJson(options.host, options.port, "/json/list", function (err, list) {
    if (err) return done(err);
    var target = pickPage(list);
    if (!target) return done(new Error("no page target yet"));
    var path = pathOf(target.webSocketDebuggerUrl);
    if (!path) return done(new Error("page target has no socket path"));

    var pending = {};
    var nextId = 1;
    var eventHandler = null;
    var closeHandler = null;
    var session = { target: target, closed: false };

    function failPending(err) {
      var calls = pending;
      pending = {};
      Object.keys(calls).forEach(function (id) { calls[id](err, null); });
    }

    function dispatch(text) {
      var msg;
      try {
        msg = JSON.parse(text);
      } catch (err) {
        return;
      }
      if (typeof msg.id === "number" && pending[msg.id]) {
        var cb = pending[msg.id];
        delete pending[msg.id];
        if (msg.error) cb(new Error(msg.error.message || "CDP error"), null);
        else cb(null, msg.result || {});
      } else if (msg.method && eventHandler) {
        eventHandler(msg.method, msg.params || {});
      }
    }

    var socket = websocket.connect({ host: options.host, port: options.port, path: path }, {
      onOpen: function () {
        done(null, session);
      },
      onMessage: dispatch,
      onClose: function (err) {
        session.closed = true;
        failPending(err || new Error("CDP socket closed"));
        if (closeHandler) closeHandler(err || null);
      },
      onError: function (err) {
        session.closed = true;
        done(err);
      },
    });

    session.send = function (method, params, cb) {
      if (session.closed) return cb(new Error("CDP session is closed"), null);
      var id = nextId;
      nextId += 1;
      var timer = setTimeout(function () {
        if (!pending[id]) return;
        delete pending[id];
        cb(new Error(method + " timed out"), null);
      }, CALL_TIMEOUT_MS);
      pending[id] = function (err, result) {
        clearTimeout(timer);
        cb(err, result);
      };
      var sent = socket.send(JSON.stringify({ id: id, method: method, params: params || {} }));
      if (!sent) {
        clearTimeout(timer);
        delete pending[id];
        cb(new Error("could not send " + method), null);
      }
    };
    session.onEvent = function (fn) { eventHandler = fn; };
    session.setOnClose = function (fn) { closeHandler = fn; };
    session.close = function () {
      session.closed = true;
      socket.close();
      failPending(new Error("CDP session closed"));
    };
  });
}

module.exports = {
  attach: attach,
  getJson: getJson,
  pickPage: pickPage,
  pathOf: pathOf,
};
