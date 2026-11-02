"use strict";

// The launch mode the user picked on the config page. The default is the proxy
// path: YouTube opens at once and the WGT never exits. Turning on the debugger
// launch (service/cdp/launcher.js) makes the WGT exit and restart under SDB.
//
// revision counts changes. The launcher compares it to see a new choice, so a
// debugger launch that failed earlier can be tried again after the user turns it on.

var fs = require("fs");
var os = require("os");
var path = require("path");

var FILE_NAME = "axotube-launch.json";

function storeDir() {
  try {
    fs.accessSync(__dirname, fs.W_OK); // fs.constants is missing on Node 4
    return __dirname;
  } catch (e) {
    return os.tmpdir();
  }
}

// AXOTUBE_LAUNCH_FILE lets the tests use their own file. The TV never sets it.
function filePath() {
  return process.env.AXOTUBE_LAUNCH_FILE || path.join(storeDir(), FILE_NAME);
}

function read() {
  try {
    var parsed = JSON.parse(fs.readFileSync(filePath(), "utf8"));
    return {
      debugger: parsed.debugger === true,
      revision: typeof parsed.revision === "number" ? parsed.revision : 0,
    };
  } catch (e) {
    return { debugger: false, revision: 0 };
  }
}

// Returns true when the file was written.
function setDebugger(enabled) {
  var current = read();
  var next = { debugger: enabled === true, revision: current.revision + 1 };
  var target = filePath();
  var tmp = target + ".tmp";
  try {
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n", "utf8");
    fs.renameSync(tmp, target);
    return true;
  } catch (e) {
    console.warn("[AxoTube:launch] could not save launch mode: " + e.message);
    return false;
  }
}

module.exports = {
  read: read,
  setDebugger: setDebugger,
  filePath: filePath,
};
