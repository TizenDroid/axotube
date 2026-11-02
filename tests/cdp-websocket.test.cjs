"use strict";
// The WebSocket client used for the Chromium debugger: frame encoding and decoding,
// fragmentation, ping/pong, and the handshake, checked over a real local socket.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");

const ws = require(path.join(__dirname, "..", "service", "cdp", "websocket.js"));

// Server frames are not masked (RFC 6455, section 5.1).
function serverFrame(opcode, payload, fin) {
  const head = payload.length < 126 ? Buffer.alloc(2) : Buffer.alloc(4);
  head[0] = (fin === false ? 0 : 0x80) | opcode;
  if (payload.length < 126) {
    head[1] = payload.length;
  } else {
    head[1] = 126;
    head.writeUInt16BE(payload.length, 2);
  }
  return Buffer.concat([head, payload]);
}

// Every connection is tracked, upgraded ones included, so a test can tear the
// server down without leaving the event loop waiting on a socket.
function track(server) {
  const sockets = new Set();
  server.on("connection", (s) => sockets.add(s));
  server.killAll = () => {
    for (const s of sockets) s.destroy();
    server.close();
  };
  return server;
}

function listen(onSocket) {
  const server = track(http.createServer((req, res) => {
    res.writeHead(404);
    res.end();
  }));
  server.on("upgrade", (req, socket) => {
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\nConnection: Upgrade\r\n" +
        "Sec-WebSocket-Accept: " + ws.acceptKey(req.headers["sec-websocket-key"]) + "\r\n\r\n",
    );
    onSocket(socket);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

test("a client frame round-trips through the decoder, masked on the wire", () => {
  const frame = ws.encodeFrame(1, Buffer.from("hello"));
  assert.ok((frame[1] & 0x80) !== 0, "client frames carry the mask bit");
  const { frames, rest } = ws.readFrames(frame);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].opcode, 1);
  assert.equal(frames[0].fin, true);
  assert.equal(frames[0].payload.toString("utf8"), "hello");
  assert.equal(rest.length, 0);
});

test("16-bit and 64-bit payload lengths decode", () => {
  for (const size of [125, 126, 300, 70000]) {
    const payload = Buffer.alloc(size, 0x61);
    const { frames } = ws.readFrames(ws.encodeFrame(1, payload));
    assert.equal(frames[0].payload.length, size, "size " + size);
  }
});

test("a partial frame waits for the rest", () => {
  const frame = ws.encodeFrame(1, Buffer.from("split message"));
  const first = ws.readFrames(frame.slice(0, 5));
  assert.equal(first.frames.length, 0);
  const second = ws.readFrames(Buffer.concat([first.rest, frame.slice(5)]));
  assert.equal(second.frames[0].payload.toString("utf8"), "split message");
});

test("fragmented server messages are joined, and a message is delivered once", async () => {
  const server = await listen((socket) => {
    socket.write(serverFrame(1, Buffer.from("hel"), false));
    socket.write(serverFrame(0, Buffer.from("lo"), true));
  });
  const got = [];
  const port = server.address().port;
  await new Promise((resolve, reject) => {
    ws.connect({ host: "127.0.0.1", port, path: "/devtools/page/1" }, {
      onOpen() {},
      onMessage(text) {
        got.push(text);
        resolve();
      },
      onClose() {},
      onError: reject,
    });
  });
  assert.deepEqual(got, ["hello"]);
  server.killAll();
});

test("text sent by the client reaches the server, and server pings get pongs", async () => {
  let serverBuf = Buffer.alloc(0);
  const received = [];
  let pong = null;
  const server = await listen((socket) => {
    socket.write(serverFrame(9, Buffer.from("p")));
    socket.on("data", (chunk) => {
      serverBuf = Buffer.concat([serverBuf, chunk]);
      const parsed = ws.readFrames(serverBuf);
      serverBuf = parsed.rest;
      for (const f of parsed.frames) {
        if (f.opcode === 1) received.push(f.payload.toString("utf8"));
        if (f.opcode === 10) pong = f.payload.toString("utf8");
      }
      if (pong !== null) socket.end();
    });
    socket.on("error", () => {});
  });
  const port = server.address().port;
  const client = await new Promise((resolve, reject) => {
    const c = ws.connect({ host: "127.0.0.1", port, path: "/" }, {
      onOpen() { resolve(c); },
      onMessage() {},
      onClose() {},
      onError: reject,
    });
  });
  client.send("ping-text");
  await new Promise((r) => setTimeout(r, 200));
  assert.deepEqual(received, ["ping-text"]);
  assert.equal(pong, "p", "the client answered the server ping");
  client.close();
  server.killAll();
});

test("a handshake with the wrong accept key is refused", async () => {
  const server = track(http.createServer());
  server.on("upgrade", (req, socket) => {
    socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: wrong\r\n\r\n");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  await assert.rejects(
    new Promise((resolve, reject) => {
      ws.connect({ host: "127.0.0.1", port: server.address().port, path: "/" }, {
        onOpen: resolve,
        onMessage() {},
        onClose() {},
        onError: reject,
      });
    }),
    /handshake rejected/,
  );
  server.killAll();
});

test("a plain HTTP refusal reports the status", async () => {
  const plain = track(http.createServer((req, res) => { res.writeHead(404); res.end(); }));
  await new Promise((r) => plain.listen(0, "127.0.0.1", r));
  await assert.rejects(
    new Promise((resolve, reject) => {
      ws.connect({ host: "127.0.0.1", port: plain.address().port, path: "/" }, {
        onOpen: resolve,
        onMessage() {},
        onClose() {},
        onError: reject,
      });
    }),
    /HTTP 404/,
  );
  plain.killAll();
});
