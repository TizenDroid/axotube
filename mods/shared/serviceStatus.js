// What the settings panels show about AxoTube's own parts: the service on port 8080,
// the content proxy on 8081, and the launch mode the service stores. A panel asks for
// a refresh when it opens and draws the last answer it had until the new one arrives,
// so opening a panel never waits on the network before it appears.
//
// Every request has a deadline (fetchWithTimeout), and a missing part is recorded as
// null rather than an error: "not reachable" is a normal answer here.

import { fetchWithTimeout } from "./fetch.js";
import { setPairingInfo } from "./pairingInfo.js";

const SERVICE_URL = "http://127.0.0.1:8080";
const PROXY_URL = "http://127.0.0.1:8081";

// service and proxy stay null until a check finds them. checked turns true after the
// first check whatever it found, so a panel can tell "still checking" from "not running".
let state = { checked: false, service: null, proxy: null };

function ask(url, options) {
  return fetchWithTimeout(url, options)
    .then((res) => (res && res.ok ? res.json() : null))
    .catch(() => null);
}

function serviceFrom(diagnostics) {
  if (!diagnostics || !diagnostics.service) return null;
  return {
    version: diagnostics.service.version,
    launchDebugger: !!(diagnostics.launch && diagnostics.launch.debugger),
    bundle: diagnostics.bundle || null,
  };
}

// Reads the service, the proxy and the pairing code in parallel, then calls done().
export function refreshStatus(done) {
  Promise.all([
    ask(`${SERVICE_URL}/api/diagnostics`),
    ask(`${PROXY_URL}/axotube/health`),
    ask(`${SERVICE_URL}/api/pairing-code`),
  ]).then((answers) => {
    const service = serviceFrom(answers[0]);
    const proxy = answers[1] && answers[1].ok ? { version: answers[1].version } : null;
    state = { checked: true, service, proxy };
    // The pairing code is only meaningful while the service answers.
    setPairingInfo(service ? answers[2] : null);
    if (done) done();
  });
}

export function getServiceStatus() {
  return state;
}

// Stores the launch mode in the service. The service reads it at the next app start,
// so this does not restart anything. done(ok) runs after the status is refreshed.
export function setLaunchMode(debuggerOn, done) {
  fetchWithTimeout(`${SERVICE_URL}/api/launch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ debugger: !!debuggerOn }),
  })
    .then((res) => !!(res && res.ok))
    .catch(() => false)
    .then((ok) => {
      refreshStatus(() => {
        if (done) done(ok);
      });
    });
}
