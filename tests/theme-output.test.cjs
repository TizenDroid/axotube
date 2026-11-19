"use strict";
// The theme CSS, from the shipped module: the custom background switch, the scrim behind a
// custom background, and the navigation bar taking the page color (pure black for OLED).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { blankSyntax } = require("./support/module-source.cjs");

const ROOT = path.join(__dirname, "..");
const SOURCE = blankSyntax(fs.readFileSync(path.join(ROOT, "mods/ui/theme.js"), "utf8")).replace(/export default updateStyle;?/, "");

function themeCss(cfg) {
  const head = { children: [], appendChild(n) { this.children.push(n); } };
  const made = [];
  const document = {
    head,
    createElement: () => {
      const el = { textContent: "", id: "" };
      made.push(el);
      return el;
    },
    getElementById: () => null,
    querySelector: () => null,
    getElementById2: null,
  };
  new Function("configRead", "document", "window", "getComputedStyle", "setTimeout", SOURCE)(
    (k) => cfg[k],
    document,
    { addEventListener() {} },
    () => ({ color: "rgb(255,255,255)" }),
    () => 0,
  );
  return made[0].textContent;
}

test("the custom background is used when the switch is on", () => {
  const css = themeCss({ useCustomBackground: true, routeBackgroundUrl: "https://example.com/bg.jpg", routeColor: "#000000" });
  assert.ok(css.indexOf('url("https://example.com/bg.jpg")') !== -1, css);
});

test("the switch off ignores the custom background and shows the page color", () => {
  const css = themeCss({ useCustomBackground: false, routeBackgroundUrl: "https://example.com/bg.jpg", routeColor: "#101010" });
  assert.equal(css.indexOf("example.com"), -1, "no background image");
  assert.ok(css.indexOf("background-color: #101010") !== -1, css);
});

test("a custom background sits behind a 50% dark scrim, so text stays readable", () => {
  const css = themeCss({ useCustomBackground: true, routeBackgroundUrl: "https://example.com/bg.jpg" });
  assert.ok(css.indexOf("linear-gradient(rgba(0, 0, 0, 0.5), rgba(0, 0, 0, 0.5))") !== -1, css);
});

test("the OLED preset is pure black on the page, and the navigation bar is transparent over it", () => {
  const css = themeCss({ useCustomBackground: true, routeBackgroundUrl: "", routeColor: "#000000" });
  assert.ok(/#container \{[^}]*background-color: #000000 !important/.test(css), css);
  const nav = css.slice(css.indexOf("ytlr-guide-response {"));
  assert.ok(/ytlr-guide-response \{[^}]*background-color: transparent !important/.test(nav), nav);
  assert.equal(nav.indexOf("#000000"), -1, "the bar does not paint its own color");
});

test("the navigation bar is transparent with a custom background too", () => {
  const css = themeCss({ useCustomBackground: true, routeBackgroundUrl: "https://example.com/bg.jpg" });
  const nav = css.slice(css.indexOf("ytlr-guide-response {"));
  assert.ok(/ytlr-guide-response \{[^}]*background-color: transparent !important/.test(nav), nav);
});
