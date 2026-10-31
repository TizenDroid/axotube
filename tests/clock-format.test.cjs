const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const source = fs
  .readFileSync(path.join(ROOT, "mods/shared/clockFormat.js"), "utf8")
  .replace(/^export\s+/gm, "");
const ctx = vm.createContext({});
vm.runInContext(source + "\n;globalThis.formatClock = formatClock;", ctx);
const formatClock = ctx.formatClock;

const at = (h, m, s = 0) => new Date(2026, 9, 31, h, m, s);

test("24-hour time pads hours and minutes", () => {
  assert.equal(formatClock(at(0, 5), "24h", false), "00:05");
  assert.equal(formatClock(at(14, 5), "24h", false), "14:05");
});

test("24-hour time can show seconds", () => {
  assert.equal(formatClock(at(14, 5, 9), "24h", true), "14:05:09");
});

test("12-hour with AM/PM: midnight and noon are 12, and PM is marked", () => {
  assert.equal(formatClock(at(0, 5), "12h", false), "12:05 AM");
  assert.equal(formatClock(at(12, 0), "12h", false), "12:00 PM");
  assert.equal(formatClock(at(13, 30), "12h", false), "1:30 PM");
  assert.equal(formatClock(at(9, 15), "12h", false), "9:15 AM");
});

test("12-hour without AM/PM has no suffix and no leading zero", () => {
  assert.equal(formatClock(at(13, 30), "12hNoAmPm", false), "1:30");
  assert.equal(formatClock(at(0, 5), "12hNoAmPm", false), "12:05");
  assert.equal(formatClock(at(9, 15, 7), "12hNoAmPm", true), "9:15:07");
});
