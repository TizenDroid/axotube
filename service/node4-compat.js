// Fills in the built-ins the TV's Node 4.4.4 runtime lacks, or has broken, so the
// bundled service code runs on it. Each shim is installed only when the native
// version is missing or fails a check, so on a modern Node this file changes nothing.
//
// Written in ES5 on purpose: it is the first thing the service runs on Node 4.
// Required first by service.js (Tizen module) and standalone.js (WGT core).
"use strict";

function define(target, name, value) {
  Object.defineProperty(target, name, { value: value, writable: true, configurable: true, enumerable: false });
}

function works(fn) {
  try {
    return fn() === true;
  } catch (err) {
    return false;
  }
}

// Node 4.4.4: Buffer.from is inherited from Uint8Array.from, so Buffer.from("text")
// throws "this is not a typed array". Node 5.10+ and 4.5+ have the real version.
if (!works(function () { return Buffer.from("a").length === 1 && Buffer.isBuffer(Buffer.from("a")); })) {
  define(Buffer, "from", function from(value, encodingOrOffset, length) {
    if (typeof value === "string") return new Buffer(value, encodingOrOffset || "utf8");
    if (value && typeof value === "object" && typeof ArrayBuffer !== "undefined" && value instanceof ArrayBuffer) {
      var offset = encodingOrOffset || 0;
      var size = length === undefined ? value.byteLength - offset : length;
      var out = new Buffer(size);
      copyBytes(new Uint8Array(value, offset, size), out);
      return out;
    }
    if (value && typeof value === "object" && value.buffer && typeof value.byteLength === "number" && ArrayBuffer.isView && ArrayBuffer.isView(value)) {
      return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    }
    return new Buffer(value);
  });
}

// Node 4.4.4 has no Buffer.alloc / allocUnsafe (added in 4.5). node-fetch calls
// Buffer.alloc(0) for every empty response body, so this one is hit in normal use.
// new Buffer(n) on Node 4 is not zero-filled, so alloc fills it explicitly.
if (!works(function () { return Buffer.alloc(2).length === 2 && Buffer.alloc(2)[0] === 0; })) {
  define(Buffer, "alloc", function alloc(size, fill, encoding) {
    var out = new Buffer(size);
    out.fill(fill === undefined ? 0 : fill, encoding);
    return out;
  });
}
if (!works(function () { return typeof Buffer.allocUnsafe === "function" && Buffer.allocUnsafe(2).length === 2; })) {
  define(Buffer, "allocUnsafe", function allocUnsafe(size) {
    return new Buffer(size);
  });
}

function copyBytes(source, target) {
  for (var i = 0; i < source.length; i++) target[i] = source[i];
}

if (!works(function () { return [NaN].includes(NaN) && [1, 2].includes(2) && ![1].includes(3); })) {
  define(Array.prototype, "includes", function includes(search, fromIndex) {
    var len = this.length >>> 0;
    var start = fromIndex >>> 0;
    for (var i = start; i < len; i++) {
      var item = this[i];
      if (item === search || (item !== item && search !== search)) return true;
    }
    return false;
  });
}

if (!works(function () { return typeof Object.values === "function" && Object.values({ a: 1 })[0] === 1; })) {
  define(Object, "values", function values(obj) {
    var keys = Object.keys(obj);
    var out = [];
    for (var i = 0; i < keys.length; i++) out.push(obj[keys[i]]);
    return out;
  });
}

if (!works(function () { return "a".padStart(3, "0") === "00a"; })) {
  define(String.prototype, "padStart", function padStart(length, fill) {
    var text = String(this);
    var pad = fill === undefined ? " " : String(fill);
    var need = length - text.length;
    if (need <= 0 || pad === "") return text;
    var out = "";
    while (out.length < need) out += pad;
    return out.slice(0, need) + text;
  });
}

if (!works(function () { return "a".padEnd(3, "0") === "a00"; })) {
  define(String.prototype, "padEnd", function padEnd(length, fill) {
    var text = String(this);
    var pad = fill === undefined ? " " : String(fill);
    var need = length - text.length;
    if (need <= 0 || pad === "") return text;
    var out = "";
    while (out.length < need) out += pad;
    return text + out.slice(0, need);
  });
}

if (!works(function () { return Array.from(new Set([1, 2])).length === 2; })) {
  define(Array, "from", function from(source) {
    var out = [];
    if (source && typeof source.forEach === "function" && !Array.isArray(source)) {
      source.forEach(function (item) { out.push(item); });
      return out;
    }
    var len = source.length >>> 0;
    for (var i = 0; i < len; i++) out.push(source[i]);
    return out;
  });
}
