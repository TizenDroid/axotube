"use strict";

// Minimal WebSocket client (RFC 6455) for the Chromium remote-debugging socket.
// Node built-ins only, so the service bundle gains no dependency. Written as ES5
// for the TV's Node 4 runtime: no Buffer.from or Buffer.alloc (Node 4.5+).

var http = require("http");
var crypto = require("crypto");

var GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
var OP_CONTINUATION = 0;
var OP_TEXT = 1;
var OP_BINARY = 2;
var OP_CLOSE = 8;
var OP_PING = 9;
var OP_PONG = 10;
var TWO_POW_32 = 4294967296;

function zeroBuffer(size) {
  var buf = new Buffer(size);
  buf.fill(0);
  return buf;
}

function utf8(text) {
  return new Buffer(String(text), "utf8");
}

function xorMask(payload, key) {
  var out = new Buffer(payload.length);
  for (var i = 0; i < payload.length; i += 1) out[i] = payload[i] ^ key[i & 3];
  return out;
}

function acceptKey(key) {
  return crypto.createHash("sha1").update(key + GUID).digest("base64");
}

// Client frames must be masked (RFC 6455, section 5.3).
function encodeFrame(opcode, payload) {
  var len = payload.length;
  var head;
  if (len < 126) {
    head = zeroBuffer(2);
    head[1] = 0x80 | len;
  } else if (len < 65536) {
    head = zeroBuffer(4);
    head[1] = 0x80 | 126;
    head.writeUInt16BE(len, 2);
  } else {
    head = zeroBuffer(10);
    head[1] = 0x80 | 127;
    head.writeUInt32BE(Math.floor(len / TWO_POW_32), 2);
    head.writeUInt32BE(len % TWO_POW_32, 6);
  }
  head[0] = 0x80 | opcode;
  var key = crypto.randomBytes(4);
  return Buffer.concat([head, key, xorMask(payload, key)]);
}

// Reads every complete frame at the start of buf. Returns the frames and the
// unread remainder, which the caller keeps until more bytes arrive.
function readFrames(buf) {
  var frames = [];
  var pos = 0;
  while (buf.length - pos >= 2) {
    var fin = (buf[pos] & 0x80) !== 0;
    var opcode = buf[pos] & 0x0f;
    var masked = (buf[pos + 1] & 0x80) !== 0;
    var len = buf[pos + 1] & 0x7f;
    var p = pos + 2;
    if (len === 126) {
      if (buf.length - pos < 4) break;
      len = buf.readUInt16BE(pos + 2);
      p = pos + 4;
    } else if (len === 127) {
      if (buf.length - pos < 10) break;
      len = buf.readUInt32BE(pos + 2) * TWO_POW_32 + buf.readUInt32BE(pos + 6);
      p = pos + 10;
    }
    var key = null;
    if (masked) {
      if (buf.length - p < 4) break;
      key = buf.slice(p, p + 4);
      p += 4;
    }
    if (buf.length - p < len) break;
    var payload = buf.slice(p, p + len);
    if (key) payload = xorMask(payload, key);
    frames.push({ fin: fin, opcode: opcode, payload: payload });
    pos = p + len;
  }
  return { frames: frames, rest: buf.slice(pos) };
}

// Opens ws://host:port/path. handlers: onOpen(), onMessage(text),
// onClose(err), onError(err). onError is for failures before the socket opens;
// onClose is for everything after. Returns { send(text), close() }.
function connect(options, handlers) {
  var key = crypto.randomBytes(16).toString("base64");
  var state = {
    open: false,
    closed: false,
    socket: null,
    buf: zeroBuffer(0),
    frags: null,
  };

  function terminate(err) {
    if (state.closed) return;
    state.closed = true;
    if (state.socket) state.socket.destroy();
    if (state.open) handlers.onClose(err || null);
    else handlers.onError(err || new Error("WebSocket closed before it opened"));
  }

  function write(opcode, payload) {
    if (!state.open || state.closed) return false;
    state.socket.write(encodeFrame(opcode, payload));
    return true;
  }

  function handleFrame(frame) {
    if (frame.opcode === OP_PING) return void write(OP_PONG, frame.payload);
    if (frame.opcode === OP_PONG) return;
    if (frame.opcode === OP_CLOSE) {
      write(OP_CLOSE, zeroBuffer(0));
      return void terminate(null);
    }
    if (frame.opcode === OP_TEXT || frame.opcode === OP_BINARY) {
      state.frags = [frame.payload];
    } else if (frame.opcode === OP_CONTINUATION) {
      if (!state.frags) return; // stray continuation: ignore
      state.frags.push(frame.payload);
    } else {
      return; // reserved opcode
    }
    if (frame.fin) {
      var message = Buffer.concat(state.frags);
      state.frags = null;
      handlers.onMessage(message.toString("utf8"));
    }
  }

  function pump() {
    var parsed = readFrames(state.buf);
    state.buf = parsed.rest;
    for (var i = 0; i < parsed.frames.length; i += 1) {
      if (state.closed) return;
      handleFrame(parsed.frames[i]);
    }
  }

  var req = http.request({
    host: options.host,
    port: options.port,
    path: options.path || "/",
    headers: {
      Connection: "Upgrade",
      Upgrade: "websocket",
      "Sec-WebSocket-Version": "13",
      "Sec-WebSocket-Key": key,
    },
  });

  req.on("upgrade", function (res, socket, head) {
    if (state.closed) {
      socket.destroy();
      return;
    }
    if (res.headers["sec-websocket-accept"] !== acceptKey(key)) {
      socket.destroy();
      terminate(new Error("WebSocket handshake rejected"));
      return;
    }
    state.socket = socket;
    state.open = true;
    state.buf = head && head.length ? head : zeroBuffer(0);
    socket.on("data", function (chunk) {
      state.buf = Buffer.concat([state.buf, chunk]);
      pump();
    });
    socket.on("error", function (err) { terminate(err); });
    socket.on("close", function () { terminate(null); });
    handlers.onOpen();
    pump();
  });

  req.on("response", function (res) {
    res.resume();
    terminate(new Error("WebSocket upgrade refused: HTTP " + res.statusCode));
  });
  req.on("error", function (err) { terminate(err); });
  req.end();

  return {
    send: function (text) {
      return write(OP_TEXT, utf8(text));
    },
    close: function () {
      if (state.closed) return;
      write(OP_CLOSE, zeroBuffer(0));
      terminate(null);
    },
  };
}

module.exports = {
  connect: connect,
  encodeFrame: encodeFrame,
  readFrames: readFrames,
  acceptKey: acceptKey,
};
