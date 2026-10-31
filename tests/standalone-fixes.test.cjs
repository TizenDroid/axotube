// Regression checks for the standalone (WGT) and APK fixes: redirects that leave the
// proxy, update checks that actually run and report failure, cast restart reasons,
// service toasts, compressed upstream bodies, raw characters in request targets,
// and the APK launcher icon. These read the sources, like proxy-parity.test.cjs.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const JAVA = "android/app/src/main/java/org/axotube/tv";

test("redirects to youtube.com stay on the proxy in both proxies", () => {
  assert.match(read("service/proxy.js"), /lower === 'location' && !isCorsBypass/);
  assert.match(read("service/proxy.js"), /replace\('https:\/\/www\.youtube\.com\/', 'http:\/\/localhost:' \+ PORT \+ '\/'\)/);
  assert.match(read(JAVA + "/LocalProxy.java"), /"location"\.equalsIgnoreCase\(entry\.getKey\(\)\) && !cors/);
  assert.match(read(JAVA + "/LocalProxy.java"), /location\.replace\("https:\/\/www\.youtube\.com\/", ORIGIN \+ "\/"\)/);
});

test("'Check for updates' runs a fresh check, and a failed check is never reported as up to date", () => {
  const updater = read("mods/features/updater.js");
  assert.match(updater, /proxyUrl\("\/axotube\/update\/check"\), \{ method: "POST"/);
  const errorGuard = updater.indexOf("if (status.error) throw");
  const upToDate = updater.indexOf("toasts.upToDate");
  assert.ok(errorGuard > 0 && upToDate > errorGuard, "error is checked before the up-to-date toast");
});

test("both proxies expose POST /axotube/update/check", () => {
  assert.match(read("service/proxy.js"), /app\.post\('\/axotube\/update\/check'/);
  assert.match(read(JAVA + "/LocalProxy.java"), /"\/axotube\/update\/check"\.equals\(path\) && "POST"/);
});

test("boot-time update checks are retried with backoff in both proxies", () => {
  assert.match(read("service/proxy.js"), /CHECK_RETRY_DELAYS_MS = \[/);
  assert.match(read(JAVA + "/BundleStore.java"), /RETRY_DELAYS_SECONDS = \{ 30, 120, 600 \}/);
});

test("cast restart toasts match the reasons the service actually returns", () => {
  const service = read("service/service.js");
  const returned = new Set([...service.matchAll(/reason: "([a-z-]+)"/g)].map((m) => m[1]));
  const page = read("mods/features/castDiscovery.js");
  for (const reason of ["too-soon", "discovery-not-running", "in-progress"]) {
    assert.ok(returned.has(reason), `service returns ${reason}`);
    assert.ok(page.includes(`"${reason}"`), `page handles ${reason}`);
  }
  assert.ok(!page.includes('"unsupported"'), "page no longer checks a reason the service never returns");
});

test("every toast key used by the cast restart path exists in en.json", () => {
  const en = JSON.parse(read("mods/translations/resources/en.json"));
  const used = [...read("mods/features/castDiscovery.js").matchAll(/t\("(toasts\.[A-Za-z]+)"\)/g)].map((m) => m[1]);
  assert.ok(used.length >= 5, "cast toast keys parsed");
  for (const key of used) {
    const [, name] = key.split(".");
    assert.ok(typeof en.toasts[name] === "string", `en.json has ${key}`);
  }
});

test("service toasts reach the page through the command queue, and phones cannot send them", () => {
  const service = read("service/service.js");
  assert.match(service, /function queueToast\(text\)/);
  assert.match(service, /global\.axotubeNotify = queueToast/);
  const normalize = service.slice(service.indexOf("function normalizeCommand"), service.indexOf("app.post(\"/api/command\""));
  assert.ok(!normalize.includes('"toast"'), "normalizeCommand does not accept toast");
  assert.match(read("mods/features/webConfig.js"), /data\.command\.action === "toast"/);
  assert.match(read(JAVA + "/ControlServer.java"), /void queueToast\(String text\)/);
  assert.match(read(JAVA + "/MainActivity.java"), /control\.queueToast\(/);
});

test("the APK proxy decodes compressed upstream bodies and escapes raw request characters", () => {
  const java = read(JAVA + "/LocalProxy.java");
  assert.match(java, /req\.target = encodeTarget\(req\.target\);/);
  assert.match(java, /new GZIPInputStream\(stream\)/);
  assert.match(java, /new InflaterInputStream\(stream\)/);
  assert.match(java, /Unsupported Content-Encoding/);
});

test("the APK logs failing sub-resources, which the main-frame callback never reports", () => {
  const main = read(JAVA + "/MainActivity.java");
  assert.match(main, /onReceivedHttpError\(WebView view, WebResourceRequest request/);
  assert.match(main, /onReceivedError\(WebView view, WebResourceRequest request/);
});

test("the APK has a launcher icon and a real TV banner", () => {
  const manifest = read("android/app/src/main/AndroidManifest.xml");
  assert.match(manifest, /android:icon="@mipmap\/ic_launcher"/);
  assert.match(manifest, /android:banner="@drawable\/tv_banner"/);
  for (const file of [
    "android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png",
    "android/app/src/main/res/drawable-xhdpi/tv_banner.png",
  ]) {
    assert.ok(fs.existsSync(path.join(ROOT, file)), file + " exists");
  }
  assert.ok(!fs.existsSync(path.join(ROOT, "android/app/src/main/res/drawable/tv_banner.xml")), "placeholder banner removed");
});
