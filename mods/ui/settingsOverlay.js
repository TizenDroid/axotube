// Settings overlay. Renders the settings tree from settings.js as a stack of
// panels driven by the remote: Up/Down move, OK activates, Left/Right adjust a
// stepper, Back goes up one level and closes at the top.
//
// Plain DOM is used instead of customElements: the Tizen 4 engine (Chromium 56)
// predates custom element support. Only the visible panel is in the DOM, and
// focus is tracked by index, so YouTube's own focus handling is not involved.
import { configRead } from "../config.js";
import { t } from "i18next";
import { dispatchNativeCommand } from "../shared/nativeCommand.js";
import { writeClientSetting } from "../shared/clientSettings.js";
import { generateQRCode } from "./qrCode.js";
import configSchema from "../../config-schema.json";

const KEY = {
  BACKSPACE: 8,
  ENTER: 13,
  ESC: 27,
  LEFT: 37,
  UP: 38,
  RIGHT: 39,
  DOWN: 40,
  BACK: 10009,
};
const OVERLAY_ID = "axo-settings";
const STYLE_ID = "axo-settings-style";
const TRANSITION_MS = 200;

const CSS = `
#axo-settings{position:fixed;top:0;left:0;right:0;bottom:0;z-index:100000;background:rgba(0,0,0,.72);display:flex;justify-content:flex-end;opacity:0;transition:opacity .16s ease-out;font-family:Roboto,Arial,sans-serif;color:#fff}
#axo-settings.axo-visible{opacity:1}
.axo-panel{position:relative;width:720px;max-width:88%;height:100%;box-sizing:border-box;padding:56px 48px 40px;background:#181818;display:flex;flex-direction:column;transform:translateX(0);opacity:1;transition:transform .2s ease-out,opacity .2s ease-out}
.axo-panel.axo-enter{transform:translateX(48px);opacity:0}
.axo-panel.axo-leave{position:absolute;top:0;right:0;width:720px;max-width:88%;transform:translateX(-48px);opacity:0;pointer-events:none}
.axo-title{margin:0 0 8px;font-size:40px;font-weight:500;line-height:1.2}
.axo-sub{margin:0 0 28px;font-size:22px;color:#aaa;line-height:1.35}
.axo-viewport{position:relative;flex:1;overflow:hidden}
.axo-list{position:absolute;top:0;left:0;right:0;transition:transform .16s ease-out}
.axo-row{display:flex;align-items:center;min-height:68px;box-sizing:border-box;margin-bottom:8px;padding:12px 24px;border-radius:12px;background:#262626;transition:background .12s ease-out,transform .12s ease-out}
.axo-row.axo-focus{background:#fff;color:#0f0f0f;transform:scale(1.015)}
.axo-col{flex:1;min-width:0}
.axo-label{display:block;font-size:26px;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.axo-sub-line{display:block;margin-top:2px;font-size:18px;color:#999}
.axo-row.axo-focus .axo-sub-line{color:#555}
.axo-value{flex:none;margin-left:20px;display:flex;align-items:center}
.axo-switch{position:relative;width:56px;height:32px;border-radius:16px;background:#555;transition:background .15s ease-out}
.axo-switch::after{content:"";position:absolute;top:4px;left:4px;width:24px;height:24px;border-radius:50%;background:#fff;transition:transform .15s ease-out}
.axo-switch.axo-on{background:#3ea6ff}
.axo-switch.axo-on::after{transform:translateX(24px)}
.axo-radio{width:26px;height:26px;box-sizing:border-box;border-radius:50%;border:3px solid #777}
.axo-radio.axo-on{border-color:#3ea6ff;background:radial-gradient(circle,#3ea6ff 0,#3ea6ff 40%,transparent 46%)}
.axo-box{width:28px;height:28px;box-sizing:border-box;border-radius:6px;border:3px solid #777;font-size:18px;line-height:22px;text-align:center}
.axo-box.axo-on{background:#3ea6ff;border-color:#3ea6ff;color:#fff}
.axo-chev{font-size:34px;line-height:1;color:#aaa}
.axo-row.axo-focus .axo-chev{color:#0f0f0f}
.axo-stepper{display:flex;align-items:center}
.axo-step-btn{width:44px;height:44px;border-radius:22px;background:#3a3a3a;text-align:center;line-height:44px;font-size:28px}
.axo-row.axo-focus .axo-step-btn{background:#0f0f0f;color:#fff}
.axo-step-val{min-width:120px;text-align:center;font-size:24px}
.axo-note{padding:10px 4px;font-size:24px;line-height:1.45;color:#ddd;word-wrap:break-word}
.axo-qr{padding:16px 0;text-align:center}
.axo-qr img{width:240px;height:240px;box-sizing:border-box;padding:12px;border-radius:8px;background:#fff}
.axo-hint{margin-top:16px;font-size:18px;color:#888}
.axo-reduced,.axo-reduced *{transition:none !important;animation:none !important}
`;

// Session state while the overlay is open: the panel stack, the overlay element
// and the element of the panel currently shown.
let session = null;

function makeRows(items, arrayKey) {
  const rows = [];
  for (const item of items || []) {
    if (item === null || item === undefined || item === false) continue;
    if (typeof item === "string") {
      rows.push({ kind: "text", label: item, focusable: false });
    } else if (item.qrLink) {
      rows.push({ kind: "qr", link: item.qrLink, focusable: false });
    } else if (arrayKey !== undefined) {
      rows.push({ kind: "multi", item, arrayKey, focusable: true });
    } else if (item.action) {
      rows.push({ kind: "action", item, focusable: true });
    } else if (item.stepper) {
      rows.push({ kind: "range", item, focusable: true });
    } else if (item.key !== undefined && item.key !== null) {
      rows.push({ kind: "choice", item, focusable: true });
    } else if (item.arrayToEdit) {
      const header = item.menuHeader || { title: item.name, subtitle: item.subtitle };
      rows.push({ kind: "panel", item, focusable: true,
        panel: makePanel(header, makeRows(item.options, item.arrayToEdit)) });
    } else if (item.options && !Array.isArray(item.options)) {
      const header = { title: item.options.title, subtitle: item.options.subtitle };
      rows.push({ kind: "panel", item, focusable: true,
        panel: makePanel(header, makeRows(item.options.content)) });
    } else if (Array.isArray(item.options)) {
      const header = item.menuHeader || { title: item.name, subtitle: item.subtitle };
      rows.push({ kind: "panel", item, focusable: true,
        panel: makePanel(header, makeRows(item.options)) });
    } else if (typeof item.value === "string") {
      rows.push({ kind: "toggle", item, focusable: true });
    } else {
      rows.push({ kind: "text", label: item.name || "", focusable: false });
    }
  }
  return rows;
}

function makePanel(header, rows) {
  const first = rows.findIndex((row) => row.focusable);
  return {
    title: header.title || "",
    subtitle: header.subtitle || "",
    rows,
    cursor: first < 0 ? 0 : first,
    els: [],
    list: null,
  };
}

// The value shown at the right edge of a row, read from config at paint time.
function valueNode(row) {
  const item = row.item;
  const wrap = document.createElement("span");
  wrap.className = "axo-value";
  if (row.kind === "toggle") {
    const sw = document.createElement("span");
    sw.className = "axo-switch" + (configRead(item.value) ? " axo-on" : "");
    wrap.appendChild(sw);
    return wrap;
  }
  if (row.kind === "choice") {
    const dot = document.createElement("span");
    dot.className = "axo-radio" + (configRead(item.key) === item.value ? " axo-on" : "");
    wrap.appendChild(dot);
    return wrap;
  }
  if (row.kind === "multi") {
    const list = configRead(row.arrayKey);
    const on = Array.isArray(list) && list.includes(item.value);
    const box = document.createElement("span");
    box.className = "axo-box" + (on ? " axo-on" : "");
    box.textContent = on ? "✓" : "";
    wrap.appendChild(box);
    return wrap;
  }
  if (row.kind === "panel") {
    const chev = document.createElement("span");
    chev.className = "axo-chev";
    chev.textContent = "›";
    wrap.appendChild(chev);
    return wrap;
  }
  if (row.kind === "range") {
    wrap.className = "axo-value axo-stepper";
    const minus = document.createElement("span");
    minus.className = "axo-step-btn";
    minus.textContent = "−";
    const val = document.createElement("span");
    val.className = "axo-step-val";
    val.textContent = t("settings.seconds", { count: Number(configRead(item.value)) });
    const plus = document.createElement("span");
    plus.className = "axo-step-btn";
    plus.textContent = "+";
    wrap.appendChild(minus);
    wrap.appendChild(val);
    wrap.appendChild(plus);
    return wrap;
  }
  return null;
}

function drawRow(row) {
  if (row.kind === "text") {
    row.el = document.createElement("div");
    row.el.className = "axo-note";
    row.el.textContent = row.label;
    return row.el;
  }
  if (row.kind === "qr") {
    row.el = document.createElement("div");
    row.el.className = "axo-qr";
    const src = generateQRCode(row.link);
    if (src) {
      const img = document.createElement("img");
      img.src = src;
      row.el.appendChild(img);
    }
    return row.el;
  }
  row.el = document.createElement("div");
  row.el.className = "axo-row";
  const col = document.createElement("div");
  col.className = "axo-col";
  const label = document.createElement("span");
  label.className = "axo-label";
  label.textContent = row.item.name || "";
  col.appendChild(label);
  if (row.item.subtitle) {
    const sub = document.createElement("span");
    sub.className = "axo-sub-line";
    sub.textContent = row.item.subtitle;
    col.appendChild(sub);
  }
  row.el.appendChild(col);
  row.valueEl = valueNode(row);
  if (row.valueEl) row.el.appendChild(row.valueEl);
  return row.el;
}

function drawPanel(panel) {
  const el = document.createElement("div");
  el.className = "axo-panel";
  const title = document.createElement("h1");
  title.className = "axo-title";
  title.textContent = panel.title;
  const sub = document.createElement("p");
  sub.className = "axo-sub";
  sub.textContent = panel.subtitle;
  const viewport = document.createElement("div");
  viewport.className = "axo-viewport";
  const list = document.createElement("div");
  list.className = "axo-list";
  panel.list = list;
  panel.els = panel.rows.map((row) => {
    const node = drawRow(row);
    list.appendChild(node);
    return node;
  });
  viewport.appendChild(list);
  const hint = document.createElement("div");
  hint.className = "axo-hint";
  hint.textContent = session.stack.length > 1 ? t("settings.hintBack") : t("settings.hintClose");
  if (panel.title) el.appendChild(title);
  if (panel.subtitle) el.appendChild(sub);
  el.appendChild(viewport);
  el.appendChild(hint);
  return el;
}

// Moves the highlight and keeps it in view. Offsets are read from the laid-out
// rows, so notes and QR codes of any height scroll correctly.
function applyFocus(panel) {
  panel.rows.forEach((row, i) => {
    if (row.el && row.focusable) row.el.classList.toggle("axo-focus", i === panel.cursor);
  });
  const node = panel.els[panel.cursor];
  if (!node || !panel.list) return;
  const viewportHeight = panel.list.parentNode.clientHeight;
  const maxShift = Math.max(0, panel.list.offsetHeight - viewportHeight);
  const shift = Math.min(maxShift, Math.max(0, node.offsetTop - viewportHeight * 0.35));
  panel.list.style.transform = "translateY(" + -shift + "px)";
}

// Shows a panel. `animate` slides the new panel in and the old one out; a plain
// repaint replaces the element without motion.
function show(panel, animate) {
  const next = drawPanel(panel);
  const prev = session.panelEl;
  session.panelEl = next;
  session.overlay.appendChild(next);
  if (prev && prev.parentNode) {
    if (animate) {
      prev.classList.add("axo-leave");
      setTimeout(() => {
        if (prev.parentNode) prev.parentNode.removeChild(prev);
      }, TRANSITION_MS);
    } else {
      prev.parentNode.removeChild(prev);
    }
  }
  if (animate) {
    next.classList.add("axo-enter");
    requestAnimationFrame(() => next.classList.remove("axo-enter"));
  }
  applyFocus(panel);
}

// Re-reads config into every visible value without rebuilding the rows.
function repaint(panel) {
  for (const row of panel.rows) {
    if (!row.valueEl) continue;
    const fresh = valueNode(row);
    row.el.replaceChild(fresh, row.valueEl);
    row.valueEl = fresh;
  }
}

function moveCursor(panel, dir) {
  let i = panel.cursor + dir;
  while (i >= 0 && i < panel.rows.length && !panel.rows[i].focusable) i += dir;
  if (i < 0 || i >= panel.rows.length) return;
  panel.cursor = i;
  applyFocus(panel);
}

function adjustRange(panel, dir) {
  const row = panel.rows[panel.cursor];
  if (!row || row.kind !== "range") return;
  const key = row.item.value;
  const bounds = configSchema.ranges[key] || [0, 100];
  const current = Number(configRead(key));
  const next = Math.min(bounds[1], Math.max(bounds[0], current + dir * row.item.stepper));
  if (next === current) return;
  writeClientSetting(key, "intValue", next);
  repaint(panel);
}

function activate(panel) {
  const row = panel.rows[panel.cursor];
  if (!row || !row.focusable) return;
  switch (row.kind) {
    case "toggle":
      writeClientSetting(row.item.value, "boolValue", !configRead(row.item.value));
      repaint(panel);
      break;
    case "choice":
      writeClientSetting(row.item.key, "stringValue", row.item.value);
      repaint(panel);
      break;
    case "multi":
      writeClientSetting(row.arrayKey, "arrayValue", row.item.value);
      repaint(panel);
      break;
    case "range":
      adjustRange(panel, 1);
      break;
    case "panel":
      session.stack.push(row.panel);
      show(row.panel, true);
      break;
    case "action": {
      const action = row.item.action;
      close();
      dispatchNativeCommand({ customAction: { action } });
      break;
    }
  }
}

function goBack() {
  if (session.stack.length <= 1) {
    close();
    return;
  }
  session.stack.pop();
  show(session.stack[session.stack.length - 1], true);
}

function onKeyDown(event) {
  if (!session) return;
  const panel = session.stack[session.stack.length - 1];
  switch (event.keyCode) {
    case KEY.UP: moveCursor(panel, -1); break;
    case KEY.DOWN: moveCursor(panel, 1); break;
    case KEY.LEFT: adjustRange(panel, -1); break;
    case KEY.RIGHT: adjustRange(panel, 1); break;
    case KEY.ENTER: activate(panel); break;
    case KEY.BACK:
    case KEY.ESC:
    case KEY.BACKSPACE: goBack(); break;
    // Anything else (media keys, volume) is left to the TV.
    default: return;
  }
  // Keys the overlay handles must not also reach YouTube's navigation.
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
}

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  (document.head || document.documentElement).appendChild(style);
}

export function close() {
  if (!session) return;
  window.removeEventListener("keydown", onKeyDown, true);
  const overlay = session.overlay;
  session = null;
  overlay.classList.remove("axo-visible");
  setTimeout(() => {
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
  }, TRANSITION_MS);
}

// `root` is { title, subtitle, items } where items is the settings tree.
export function openSettingsOverlay(root) {
  if (session) return;
  injectStyle();
  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  if (configRead("enableReducedMotion")) overlay.className = "axo-reduced";
  document.body.appendChild(overlay);
  const top = makePanel(root, makeRows(root.items));
  session = { stack: [top], overlay, panelEl: null };
  window.addEventListener("keydown", onKeyDown, true);
  show(top, false);
  requestAnimationFrame(() => overlay.classList.add("axo-visible"));
}
