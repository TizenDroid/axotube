/* axotube Config application. ES5 on purpose: it runs in the phone and desktop browsers
 * this page is opened in, including older WebViews. Settings metadata lives in
 * config-ui.json; defaults, valid values and ranges come from the schema injected by
 * the service. Every key rendered here comes from one of those two sources. */
(function () {
  "use strict";

  var BOOT = window.AXOTUBE_WEB || {};
  var SCHEMA = BOOT.schema || {};
  var DEFAULTS = SCHEMA.defaults || {};
  var RANGES = SCHEMA.ranges || {};
  var ENUMS = SCHEMA.enums || {};
  var PRESETS = SCHEMA.themePresetColors || {};
  var TOKEN_KEY = "axotube-pair-token";
  var HEX = /^#[0-9a-fA-F]{6}$/;

  var UI = null;          // config-ui.json: sections and per-setting metadata
  var token = readToken();
  var base = null;        // the configuration as last saved on the TV
  var draft = null;       // what the form holds; saved only when the user saves
  var revision = 0;
  var lastSaved = null;
  var saving = false;
  var conflicts = null;   // [{key, mine, theirs, choice}] while a save conflict is open
  var fieldErrors = {};   // key -> message; any entry blocks saving
  var section = "overview";
  var query = "";
  var rows = [];          // rendered setting rows, updated in place on each change
  var launch = { saved: null, draft: false, note: "", error: "" };
  var diag = { summary: "", log: "" };
  var toastTimer = null;

  var $ = function (id) { return document.getElementById(id); };
  var nav = $("nav");
  var main = $("main");
  var app = $("app");
  var search = $("search");
  var conn = $("conn");
  var pairing = $("pairing");
  var pairCode = $("pairCode");
  var saveBar = $("savebar");
  var saveCount = $("saveCount");
  var saveHint = $("saveHint");
  var saveBtn = $("saveBtn");
  var discardBtn = $("discardBtn");
  var toast = $("toast");
  var restartBar = $("restartBar");
  var restartText = $("restartText");

  // ---- small helpers -------------------------------------------------------

  function readToken() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
  }
  function writeToken(value) {
    try {
      if (value) localStorage.setItem(TOKEN_KEY, value);
      else localStorage.removeItem(TOKEN_KEY);
    } catch (e) { /* storage can be blocked; pairing then lasts only this page */ }
  }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }
  function button(text, cls, onClick) {
    var b = el("button", cls || "btn", text);
    b.type = "button";
    if (onClick) b.addEventListener("click", onClick);
    return b;
  }
  function setConn(kind, text) {
    conn.textContent = text;
    conn.className = "conn" + (kind ? " " + kind : "");
  }
  function flash(text) {
    toast.textContent = text;
    toast.className = "toast show";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.className = "toast"; }, 2600);
  }
  function settingOf(key) { return (UI && UI.settings[key]) || null; }
  function labelOf(key) { var s = settingOf(key); return s ? s.label : key; }
  function scaleOf(s) { return s && s.scale ? s.scale : 1; }
  function decimalsOf(step) {
    var text = String(step || 1);
    var dot = text.indexOf(".");
    return dot === -1 ? 0 : text.length - dot - 1;
  }
  function roundTo(value, decimals) {
    var f = Math.pow(10, decimals);
    return Math.round(value * f) / f;
  }
  function validHex(value) {
    return HEX.test(value || "") ? value.toLowerCase() : DEFAULTS.routeColor;
  }
  function isHttpUrl(value) { return /^https?:\/\/\S+$/i.test(value); }

  // Fills every schema key, so a config saved by an older service still loads.
  function fullConfig(cfg) {
    var out = clone(DEFAULTS);
    if (cfg && typeof cfg === "object") {
      Object.keys(DEFAULTS).forEach(function (key) {
        if (Object.prototype.hasOwnProperty.call(cfg, key)) out[key] = clone(cfg[key]);
      });
    }
    return out;
  }

  function dirtyKeys() {
    if (!base || !draft) return [];
    return Object.keys(DEFAULTS).filter(function (key) { return !same(draft[key], base[key]); });
  }
  function dirtyIn(sectionId) {
    return dirtyKeys().filter(function (key) {
      var s = settingOf(key);
      return s && s.section === sectionId;
    }).length;
  }

  // Three-way merge used after a 409. For each key: a change on one side only is kept;
  // the same change on both sides is no conflict; different changes on both sides are
  // reported, and the local value is kept until the user picks one.
  function mergeConfigs(baseCfg, local, remote) {
    var out = {};
    var conflictKeys = [];
    Object.keys(DEFAULTS).forEach(function (key) {
      var b = baseCfg[key];
      var l = local[key];
      var r = remote[key];
      if (same(l, b)) out[key] = clone(r);
      else if (same(r, b) || same(l, r)) out[key] = clone(l);
      else { out[key] = clone(l); conflictKeys.push(key); }
    });
    return { draft: out, conflicts: conflictKeys };
  }

  // ---- networking ----------------------------------------------------------

  function request(url, method, body, useAuth) {
    var opts = { method: method || "GET", headers: {} };
    if (useAuth !== false && token) opts.headers.Authorization = "Bearer " + token;
    if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    return fetch(url, opts).then(function (res) {
      return res.text().then(function (text) {
        var data = {};
        try { data = text ? JSON.parse(text) : {}; } catch (e) { data = {}; }
        if (!res.ok) {
          var err = new Error(data.error || ("HTTP " + res.status));
          err.status = res.status;
          throw err;
        }
        return data;
      });
    });
  }

  function failure(err, prefix) {
    if (err && err.status === 401) {
      forgetToken();
      flash("Pairing expired. Enter the code from the TV again.");
      return;
    }
    flash(prefix + ": " + ((err && err.message) || "unknown error"));
  }

  // ---- pairing and loading -------------------------------------------------

  function pairError(message) {
    var box = $("pairError");
    box.textContent = message || "";
    box.hidden = !message;
    pairCode.setAttribute("aria-invalid", message ? "true" : "false");
    pairCode.parentNode.className = "code-field" + (message ? " is-error" : "");
  }

  // The real input sits invisibly over six drawn cells. The cells show its digits.
  function syncSlots() {
    var digits = pairCode.value.replace(/\D/g, "").slice(0, 6);
    var cells = pairCode.parentNode.querySelectorAll(".code-slots span");
    for (var i = 0; i < cells.length; i++) {
      cells[i].textContent = digits.charAt(i);
      cells[i].className = i === digits.length && digits.length < 6 ? "cur" : "";
    }
  }

  function pair() {
    var code = pairCode.value.trim();
    if (!/^\d{6}$/.test(code)) {
      pairError("That code has six digits. Check the code on your TV and try again.");
      pairCode.focus();
      return;
    }
    pairError("");
    request("/api/pair", "POST", { code: code }, false).then(function (data) {
      if (!data.token) throw new Error("No token returned");
      token = data.token;
      writeToken(token);
      pairCode.value = "";
      flash("Paired");
      load();
    }).catch(function (err) {
      pairError("That code did not match. Check the code on your TV and try again.");
      setConn("err", err.message || "Pairing failed");
    });
  }

  // A phone that scanned the TV's QR code arrives with ?code=123456. Pair with it
  // directly, so nothing has to be typed, and take the code out of the address bar.
  // This replaces the startup load() so a stale token cannot race the new pairing.
  function autoPairFromLink() {
    var match = /[?&]code=(\d{6})(?:&|$)/.exec(location.search);
    if (!match) return false;
    if (window.history && history.replaceState) history.replaceState(null, "", location.pathname);
    pairCode.value = match[1];
    syncSlots();
    pair();
    return true;
  }

  function showPairing() {
    app.hidden = true;
    pairing.hidden = false;
    syncSlots();
    setConn("", "Pairing required");
    updateSaveBar();
  }

  function showApp() {
    pairing.hidden = true;
    app.hidden = false;
  }

  function forgetToken() {
    token = "";
    writeToken("");
    base = null;
    draft = null;
    conflicts = null;
    fieldErrors = {};
    launch = { saved: null, draft: false, note: "", error: "" };
    main.textContent = "";
    showPairing();
  }

  function confirmForget() {
    var dialog = $("forgetDialog");
    if (dialog && dialog.open) dialog.close();
    forgetToken();
    flash("This browser has been forgotten");
  }

  function load() {
    if (!token) { showPairing(); return; }
    setConn("", "Loading…");
    request("/api/config").then(function (data) {
      revision = data.revision || 0;
      base = fullConfig(data.config);
      draft = clone(base);
      conflicts = null;
      fieldErrors = {};
      showApp();
      setConn("ok", "Connected · revision " + revision);
      refreshAll();
      loadLaunch();
      loadDiagnostics();
    }).catch(function (err) { failure(err, "Could not load settings"); });
  }

  function reloadFromTv() {
    if (dirtyKeys().length && !window.confirm("Discard your unsaved changes and load the settings from the TV?")) return;
    load();
  }

  function loadUi() {
    var opts = { cache: "no-cache" };
    if (BOOT.uiIntegrity) opts.integrity = BOOT.uiIntegrity;
    return fetch(BOOT.uiUrl, opts).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    });
  }

  // ---- saving --------------------------------------------------------------

  function hasOpenConflict() {
    return !!conflicts && conflicts.some(function (c) { return c.choice === null; });
  }

  function save() {
    if (saving || !base || !draft) return;
    if (hasOpenConflict()) { flash("Choose a value for each conflicting setting first"); return; }
    if (Object.keys(fieldErrors).length) { flash("Fix the highlighted settings first"); return; }
    if (!dirtyKeys().length) return;
    saving = true;
    updateSaveBar();
    request("/api/config", "POST", { revision: revision, config: draft }).then(function (data) {
      revision = data.revision;
      base = clone(draft);
      conflicts = null;
      lastSaved = new Date();
      setConn("ok", "Connected · revision " + revision);
      flash("Settings saved");
      restartText.textContent = "Settings saved. You can restart YouTube now.";
      restartBar.hidden = false;
      refreshAll();
    }).catch(function (err) {
      if (err && err.status === 409) return resolveConflict();
      failure(err, "Save failed");
    }).then(function () {
      saving = false;
      updateSaveBar();
    });
  }

  // The TV changed while this page had edits. Re-read it, merge, and ask the user to
  // decide where the two sides disagree. Nothing is overwritten silently.
  function resolveConflict() {
    return request("/api/config").then(function (latest) {
      var remote = fullConfig(latest.config);
      var merged = mergeConfigs(base, draft, remote);
      base = remote;
      revision = latest.revision || 0;
      draft = merged.draft;
      conflicts = merged.conflicts.map(function (key) {
        return { key: key, mine: clone(draft[key]), theirs: clone(remote[key]), choice: null };
      });
      if (!conflicts.length) {
        conflicts = null;
        flash("The TV changed. Your edits were kept. Save again to apply them.");
      } else {
        setConn("err", "Settings changed on the TV");
      }
      refreshAll();
    });
  }

  function chooseConflict(item, choice) {
    item.choice = choice;
    draft[item.key] = clone(choice === "mine" ? item.mine : item.theirs);
    if (!hasOpenConflict() && !dirtyKeys().length) {
      conflicts = null;
      flash("Now matches the TV");
    }
    refreshAll();
  }

  function discardChanges() {
    if (!base || saving) return;
    if (!window.confirm("Discard your unsaved changes?")) return;
    draft = clone(base);
    conflicts = null;
    fieldErrors = {};
    flash("Changes discarded");
    refreshAll();
  }

  function restoreDefaults() {
    if (!window.confirm("Restore every setting to its default? This changes the form only. Save to apply it to the TV.")) return;
    draft = clone(DEFAULTS);
    conflicts = null;
    fieldErrors = {};
    flash("Defaults loaded. Save to apply.");
    refreshAll();
  }

  function undoSetting(key) {
    draft[key] = clone(base[key]);
    delete fieldErrors[key];
    refreshAll();
  }

  // ---- launch mode and diagnostics (their own endpoints and save state) -----

  function loadLaunch() {
    request("/api/launch").then(function (data) {
      launch.saved = data.debugger === true;
      launch.draft = launch.saved;
      launch.note = "";
      launch.error = "";
      renderLaunchUi();
    }).catch(function (err) {
      if (err && err.status === 401) { failure(err, "Launch"); return; }
      launch.error = "Could not read the launch mode: " + ((err && err.message) || "error");
      renderLaunchUi();
    });
  }

  function saveLaunch() {
    var wanted = launch.draft;
    request("/api/launch", "POST", { debugger: wanted }).then(function () {
      launch.saved = wanted;
      launch.error = "";
      launch.note = wanted
        ? "Saved. The next time YouTube opens, the TV app restarts under the debugger."
        : "Saved. YouTube opens through the proxy, with no restart.";
      flash("Launch mode saved");
      renderLaunchUi();
    }).catch(function (err) {
      launch.note = "";
      launch.error = "Not saved: " + ((err && err.message) || "error");
      renderLaunchUi();
    });
  }

  function renderLaunchUi() {
    var box = $("launchDebugger");
    if (!box) return;
    box.checked = !!launch.draft;
    var note = $("launchNote");
    note.textContent = launch.error || launch.note;
    $("launchSave").disabled = launch.saved === null || launch.draft === launch.saved;
  }

  function loadDiagnostics() {
    diag = { summary: "Loading…", log: "" };
    renderDiagnosticsUi();
    request("/api/diagnostics").then(function (d) {
      var b = d.bundle || {};
      var l = d.launch || {};
      var s = d.service || {};
      var line = "Service " + (s.version || "?") + " · bundle " + (b.current || "?");
      if (b.available) line += " (update " + b.latest + " ready)";
      line += " · launch " + (l.debugger ? "debugger" : "proxy");
      if (l.reason) line += " · " + l.reason;
      var events = (d.events || []).slice().reverse();
      diag = {
        summary: line,
        log: events.length
          ? events.map(function (e) { return new Date(e.t).toLocaleTimeString() + "  " + e.level + "  " + e.message; }).join("\n")
          : "No events yet."
      };
      renderDiagnosticsUi();
    }).catch(function (err) {
      diag = { summary: "Could not load diagnostics: " + ((err && err.message) || "error"), log: "" };
      renderDiagnosticsUi();
    });
  }

  function renderDiagnosticsUi() {
    var summary = $("diagSummary");
    if (!summary) return;
    summary.textContent = diag.summary;
    $("diagLog").textContent = diag.log;
  }

  function copyDiagnostics() {
    // Never includes the pairing token: it only holds the summary and the event log.
    var area = el("textarea");
    area.value = diag.summary + "\n\n" + diag.log;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    document.body.removeChild(area);
    flash(ok ? "Diagnostics copied" : "Copy failed. Select the text and copy it instead.");
  }

  function restartYouTube() {
    if (!window.confirm("Restart YouTube now? Anything playing will stop.")) return;
    request("/api/command", "POST", { action: "reload" }).then(function () {
      restartBar.hidden = true;
      flash("Restart request sent to YouTube");
    }).catch(function (err) { failure(err, "Restart failed"); });
  }

  // ---- settings: rules -----------------------------------------------------

  // A dependency is either a key that must be on (a string), or an object that
  // requires a key to be something other than a given value.
  function disabledReason(s) {
    var deps = s.dependencies || [];
    for (var i = 0; i < deps.length; i++) {
      var dep = deps[i];
      if (typeof dep === "string") {
        if (!draft[dep]) return "Needs " + labelOf(dep) + " turned on";
      } else if (draft[dep.key] === dep.notValue) {
        return "Needs " + labelOf(dep.key) + " set to something other than Off";
      }
    }
    return "";
  }

  function segmentOf(key, type) {
    if (!draft[key]) return "off";
    var manual = draft.sponsorBlockManualSkips || [];
    return manual.indexOf(type) !== -1 ? "show" : "skip";
  }

  function applySegment(key, type, mode) {
    draft[key] = mode !== "off";
    var manual = (draft.sponsorBlockManualSkips || []).filter(function (t) { return t !== type; });
    if (mode === "show") manual.push(type);
    draft.sponsorBlockManualSkips = manual;
    afterChange();
  }

  function setValue(key, value) {
    draft[key] = value;
    afterChange();
  }

  function setError(key, message) {
    fieldErrors[key] = message;
    afterChange();
  }

  function clearError(key) {
    delete fieldErrors[key];
  }

  function formatValue(key, v) {
    var s = settingOf(key);
    if (v === null || v === undefined || v === "") return "empty";
    if (typeof v === "boolean") return v ? "on" : "off";
    if (Array.isArray(v)) return v.length ? v.map(function (x) { return optionLabel(key, x); }).join(", ") : "none";
    if (typeof v === "number") return String(roundTo(v * scaleOf(s), 3)) + (s && s.unit ? s.unit : "");
    return optionLabel(key, v);
  }

  function optionLabel(key, v) {
    var s = settingOf(key);
    if (s && s.options && Object.prototype.hasOwnProperty.call(s.options, String(v))) return s.options[String(v)];
    return String(v);
  }

  function presetName(color) {
    var found = "";
    Object.keys(PRESETS).forEach(function (name) {
      if (String(PRESETS[name]).toLowerCase() === String(color || "").toLowerCase()) found = name;
    });
    return found;
  }

  // ---- settings: controls --------------------------------------------------

  function buildSwitch(reg, ctrl) {
    var label = el("label", "switch");
    var input = el("input");
    input.type = "checkbox";
    input.setAttribute("role", "switch");
    input.setAttribute("aria-labelledby", "lbl-" + reg.key);
    input.checked = !!draft[reg.key];
    input.addEventListener("change", function () { setValue(reg.key, input.checked); });
    label.appendChild(input);
    ctrl.appendChild(label);
  }

  function buildSelect(reg, ctrl) {
    var select = el("select");
    select.setAttribute("aria-labelledby", "lbl-" + reg.key);
    var current = String(draft[reg.key]);
    var values = (ENUMS[reg.key] || []).slice();
    if (values.indexOf(current) === -1) values.unshift(current);
    values.forEach(function (value) {
      var label = values.indexOf(value) >= 0 && (ENUMS[reg.key] || []).indexOf(value) === -1
        ? value + " (not recognised)"
        : optionLabel(reg.key, value);
      var option = el("option", null, label);
      option.value = value;
      select.appendChild(option);
    });
    select.value = current;
    select.addEventListener("change", function () {
      var value = select.value;
      if (reg.key === "themePreset" && PRESETS[value]) {
        draft.routeColor = PRESETS[value];
      }
      setValue(reg.key, value);
    });
    ctrl.appendChild(select);
  }

  function buildRange(reg, ctrl) {
    var key = reg.key;
    var s = reg.s;
    var bounds = RANGES[key] || [0, 100];
    var sc = scaleOf(s);
    var dec = decimalsOf(s.step);
    var lo = bounds[0] * sc;
    var hi = bounds[1] * sc;
    var wrap = el("div", "range-wrap");
    var range = el("input");
    range.type = "range";
    range.min = String(lo);
    range.max = String(hi);
    range.step = String(s.step || 1);
    range.setAttribute("aria-labelledby", "lbl-" + key);
    var num = el("input");
    num.type = "number";
    num.min = String(lo);
    num.max = String(hi);
    num.step = String(s.step || 1);
    num.setAttribute("aria-label", s.label + " value");
    var shown = roundTo(Number(draft[key]) * sc, dec);
    range.value = String(shown);
    num.value = String(shown);
    range.addEventListener("input", function () {
      num.value = range.value;
      commitNumber(reg, Number(range.value), false);
    });
    num.addEventListener("change", function () { commitNumber(reg, Number(num.value), true); });
    wrap.appendChild(range);
    wrap.appendChild(num);
    wrap.appendChild(el("span", "unit", s.unit || ""));
    ctrl.appendChild(wrap);
  }

  function commitNumber(reg, display, typed) {
    var key = reg.key;
    var sc = scaleOf(reg.s);
    var bounds = RANGES[key] || [-Infinity, Infinity];
    var lo = bounds[0] * sc;
    var hi = bounds[1] * sc;
    var dec = decimalsOf(reg.s.step);
    if (!isFinite(display) || display < lo || display > hi) {
      if (typed) setError(key, "Enter a value from " + roundTo(lo, dec) + " to " + roundTo(hi, dec) + (reg.s.unit ? " " + reg.s.unit : ""));
      return;
    }
    clearError(key);
    setValue(key, roundTo(display / sc, 6));
  }

  function buildSegment(reg, ctrl) {
    var group = el("div", "segmented");
    group.setAttribute("role", "group");
    group.setAttribute("aria-labelledby", "lbl-" + reg.key);
    reg.modes = [];
    [["off", "Off"], ["skip", "Skip automatically"], ["show", "Show skip button"]].forEach(function (m) {
      var b = button(m[1], null, function () { applySegment(reg.key, reg.s.segmentType, m[0]); });
      b.setAttribute("data-mode", m[0]);
      group.appendChild(b);
      reg.modes.push(b);
    });
    ctrl.appendChild(group);
  }

  function buildThemeColor(reg, ctrl) {
    var wrap = el("div", "setting-control");
    wrap.style.justifyContent = "flex-end";
    var color = el("input");
    color.type = "color";
    color.setAttribute("aria-label", "Background colour");
    color.addEventListener("input", function () { draft.routeColor = color.value; afterChange(); });
    var swatches = el("div", "swatches");
    swatches.setAttribute("role", "group");
    swatches.setAttribute("aria-label", "Preset colours");
    reg.swatches = [];
    Object.keys(PRESETS).forEach(function (name) {
      var b = el("button", "swatch");
      b.type = "button";
      b.setAttribute("data-preset", name);
      b.setAttribute("aria-label", "Preset " + optionLabel("themePreset", name));
      b.title = optionLabel("themePreset", name);
      b.style.backgroundColor = PRESETS[name];
      b.addEventListener("click", function () {
        draft.routeColor = PRESETS[name];
        draft.themePreset = name;
        afterChange();
      });
      swatches.appendChild(b);
      reg.swatches.push(b);
    });
    reg.colorInput = color;
    reg.readout = el("span", "muted");
    swatches.appendChild(color);
    wrap.appendChild(swatches);
    wrap.appendChild(reg.readout);
    ctrl.appendChild(wrap);
  }


  function buildUrl(reg, ctrl) {
    var key = reg.key;
    var wrap = el("div", "url-wrap");
    var input = el("input");
    input.type = "url";
    input.placeholder = "https://";
    input.value = draft[key] || "";
    input.setAttribute("aria-labelledby", "lbl-" + key);
    var img = el("img", "preview");
    img.alt = "Background preview";
    img.hidden = true;
    img.addEventListener("error", function () {
      img.hidden = true;
      reg.extra = "The preview could not be loaded. Check the address.";
      syncRow(reg);
    });
    img.addEventListener("load", function () { reg.extra = ""; syncRow(reg); });
    function showPreview(value) {
      if (!value) { img.hidden = true; img.removeAttribute("src"); reg.extra = ""; return; }
      img.src = value;
      img.hidden = false;
    }
    input.addEventListener("change", function () {
      var value = input.value.trim();
      if (value && !isHttpUrl(value)) {
        setError(key, "Enter a web address starting with http:// or https://");
        return;
      }
      clearError(key);
      draft[key] = value;
      showPreview(value);
      afterChange();
    });
    wrap.appendChild(input);
    wrap.appendChild(img);
    ctrl.appendChild(wrap);
    showPreview(input.value.trim());
  }

  function buildTags(reg, ctrl) {
    var key = reg.key;
    var s = reg.s;
    var wrap = el("div", "tags");
    var list = el("div", "tag-list");
    var entry = el("div", "tag-entry");
    var input = el("input");
    input.type = "text";
    input.placeholder = "Add a value";
    input.setAttribute("aria-label", "Add to " + s.label);
    input.maxLength = 60;
    var add = button("Add", "btn");
    entry.appendChild(input);
    entry.appendChild(add);
    if (s.suggestions && s.suggestions.length) {
      var dl = el("datalist");
      dl.id = "dl-" + key;
      s.suggestions.forEach(function (value) {
        var o = el("option");
        o.value = value;
        dl.appendChild(o);
      });
      input.setAttribute("list", dl.id);
      wrap.appendChild(dl);
    }
    // Suggestions are checkable: a tick shows the value is in the list, and tapping toggles it.
    var suggestions = [];
    var suggestRow = el("div", "suggest-row");
    (s.suggestions || []).forEach(function (value) {
      var t = button(value, "suggest", function () {
        var current = draft[key] || [];
        draft[key] = current.indexOf(value) === -1
          ? current.concat([value])
          : current.filter(function (x) { return x !== value; });
        render();
        afterChange();
      });
      suggestions.push({ value: value, btn: t });
      suggestRow.appendChild(t);
    });
    function render() {
      list.textContent = "";
      var values = draft[key] || [];
      suggestions.forEach(function (sg) {
        var on = values.indexOf(sg.value) !== -1;
        sg.btn.setAttribute("aria-pressed", String(on));
        sg.btn.textContent = (on ? "✓ " : "") + sg.value;
      });
      if (!values.length) list.appendChild(el("span", "muted", "None"));
      values.forEach(function (value) {
        var chip = el("span", "tag-chip", value);
        var remove = button("×", null, function () {
          draft[key] = (draft[key] || []).filter(function (x) { return x !== value; });
          render();
          afterChange();
        });
        remove.setAttribute("aria-label", "Remove " + value);
        chip.appendChild(remove);
        list.appendChild(chip);
      });
    }
    function addValue() {
      var value = input.value.trim();
      input.value = "";
      if (!value) return;
      var values = draft[key] || [];
      if (values.indexOf(value) !== -1) return;
      draft[key] = values.concat([value]);
      render();
      afterChange();
    }
    add.addEventListener("click", addValue);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); addValue(); }
    });
    render();
    wrap.appendChild(list);
    if (suggestions.length) wrap.appendChild(suggestRow);
    wrap.appendChild(entry);
    ctrl.appendChild(wrap);
  }


  function buildJson(reg, ctrl) {
    var key = reg.key;
    var wrap = el("div", "json-wrap");
    var area = el("textarea", "json");
    area.spellcheck = false;
    area.setAttribute("aria-label", reg.s.label);
    area.value = draft[key] || "";
    area.addEventListener("input", function () {
      var value = area.value.trim();
      if (!value) { clearError(key); setValue(key, null); return; }
      try {
        JSON.parse(value);
      } catch (e) {
        setError(key, "Not valid JSON: " + e.message);
        return;
      }
      clearError(key);
      setValue(key, value);
    });
    var actions = el("div", "json-actions");
    actions.appendChild(button("Format", "btn quiet", function () {
      try {
        area.value = JSON.stringify(JSON.parse(area.value), null, 2);
        clearError(key);
        setValue(key, area.value);
      } catch (e) {
        setError(key, "Not valid JSON: " + e.message);
      }
    }));
    actions.appendChild(button("Clear", "btn quiet", function () {
      area.value = "";
      clearError(key);
      setValue(key, null);
    }));
    wrap.appendChild(area);
    wrap.appendChild(actions);
    ctrl.appendChild(wrap);
  }

  function buildControl(reg, ctrl) {
    switch (reg.s.control) {
      case "switch": buildSwitch(reg, ctrl); break;
      case "select": buildSelect(reg, ctrl); break;
      case "range": buildRange(reg, ctrl); break;
      case "segmentMode": buildSegment(reg, ctrl); break;
      case "themeColor": buildThemeColor(reg, ctrl); break;
      case "url": buildUrl(reg, ctrl); break;
      case "tags": buildTags(reg, ctrl); break;
      case "json": buildJson(reg, ctrl); break;
      default: ctrl.appendChild(el("span", "muted", "Edit this in the TV settings"));
    }
  }

  // ---- settings: rendering -------------------------------------------------

  function renderable(s) { return s.control !== "hidden" && s.control !== "derived"; }

  function settingsIn(sectionId) {
    var out = [];
    Object.keys(UI.settings).forEach(function (key) {
      var s = UI.settings[key];
      if (s.section === sectionId && renderable(s)) out.push({ key: key, s: s });
    });
    out.sort(function (a, b) { return a.s.order - b.s.order; });
    return out;
  }

  function groupItems(items) {
    var groups = [];
    var index = {};
    items.forEach(function (it) {
      var name = it.s.group || "General";
      if (!Object.prototype.hasOwnProperty.call(index, name)) {
        index[name] = groups.length;
        groups.push({ name: name, items: [] });
      }
      groups[index[name]].items.push(it);
    });
    return groups;
  }

  function appendGroups(parent, items) {
    groupItems(items).forEach(function (g) {
      var wrap = el("section", "group");
      wrap.appendChild(el("h2", "group-title", g.name));
      var body = el("div", "group-body");
      g.items.forEach(function (it) { body.appendChild(settingRow(it.key, it.s)); });
      wrap.appendChild(body);
      parent.appendChild(wrap);
    });
  }

  function settingRow(key, s) {
    var row = el("div", "setting");
    row.setAttribute("data-key", key);
    var info = el("div", "setting-info");
    var label = el("div", "setting-label", s.label);
    label.id = "lbl-" + key;
    info.appendChild(label);
    if (s.description) info.appendChild(el("p", "setting-desc", s.description));
    var undo = button("Undo change", "btn quiet", function () { undoSetting(key); });
    undo.style.marginTop = "6px";
    info.appendChild(undo);
    row.appendChild(info);
    var control = el("div", "setting-control");
    row.appendChild(control);
    var note = el("div", "setting-note");
    note.hidden = true;
    row.appendChild(note);
    var reg = { key: key, s: s, row: row, control: control, note: note, undo: undo, extra: "" };
    buildControl(reg, control);
    rows.push(reg);
    syncRow(reg);
    return row;
  }

  function syncRow(reg) {
    var key = reg.key;
    var s = reg.s;
    var dirty = !!(base && draft && !same(draft[key], base[key]));
    var reason = disabledReason(s);
    reg.row.className = "setting" + (dirty ? " is-dirty" : "") + (reason ? " is-disabled" : "");
    var ctrls = reg.control.querySelectorAll("input, select, textarea, button");
    for (var i = 0; i < ctrls.length; i++) ctrls[i].disabled = !!reason;
    reg.undo.hidden = !dirty;
    if (reg.colorInput) {
      reg.colorInput.value = validHex(draft.routeColor);
      var matched = presetName(draft.routeColor);
      reg.readout.textContent = matched ? "Preset: " + optionLabel("themePreset", matched) : "Custom colour";
      reg.swatches.forEach(function (b) {
        b.setAttribute("aria-pressed", String(b.getAttribute("data-preset") === matched));
      });
    }
    if (reg.modes) {
      reg.modes.forEach(function (b) {
        b.setAttribute("aria-pressed", String(segmentOf(key, s.segmentType) === b.getAttribute("data-mode")));
      });
    }
    var error = fieldErrors[key] || "";
    var msg = error || reg.extra || reason;
    reg.note.textContent = msg;
    reg.note.hidden = !msg;
    reg.note.className = "setting-note" + (error ? " err" : "");
  }

  function syncRows() { rows.forEach(syncRow); }

  function matchesQuery(key, s, q) {
    var hay = [key, s.label, s.description || "", s.group || ""].concat(s.searchAliases || []).join(" ").toLowerCase();
    return hay.indexOf(q) !== -1;
  }

  // ---- views ---------------------------------------------------------------

  function sectionDef(id) {
    for (var i = 0; i < UI.sections.length; i++) {
      if (UI.sections[i].id === id) return UI.sections[i];
    }
    return null;
  }

  function conflictsPanel() {
    var box = el("section", "conflicts");
    var total = conflicts.length;
    var resolved = conflicts.filter(function (c) { return c.choice !== null; }).length;
    box.appendChild(el("h2", null, "Settings changed on your TV"));
    box.appendChild(el("p", "conflict-summary", total + (total === 1 ? " setting needs" : " settings need") +
      " your attention · " + resolved + " of " + total + " resolved"));
    conflicts.forEach(function (item) {
      var row = el("div", "conflict-row");
      var info = el("div");
      info.appendChild(el("div", "setting-label", labelOf(item.key)));
      var values = el("div", "values");
      var mine = el("div");
      mine.appendChild(el("span", null, "Your change"));
      mine.appendChild(el("strong", null, formatValue(item.key, item.mine)));
      var theirs = el("div");
      theirs.appendChild(el("span", null, "On the TV"));
      theirs.appendChild(el("strong", null, formatValue(item.key, item.theirs)));
      values.appendChild(mine);
      values.appendChild(theirs);
      info.appendChild(values);
      var choices = el("div", "choices");
      [["mine", "Keep mine"], ["theirs", "Use the TV's"]].forEach(function (pair) {
        var b = button(pair[1], "btn", function () { chooseConflict(item, pair[0]); });
        b.setAttribute("aria-pressed", String(item.choice === pair[0]));
        choices.appendChild(b);
      });
      row.appendChild(info);
      row.appendChild(choices);
      if (item.choice === null) row.appendChild(el("p", "hint", "Choose one to continue"));
      box.appendChild(row);
    });
    return box;
  }

  function renderSection(id) {
    var def = sectionDef(id) || { label: "Settings", description: "" };
    var head = el("div", "section-head");
    head.appendChild(el("h1", null, def.label));
    if (def.description) head.appendChild(el("p", null, def.description));
    main.appendChild(head);
    var items = settingsIn(id);
    appendGroups(main, items.filter(function (it) { return !it.s.advanced; }));
    var advanced = items.filter(function (it) { return it.s.advanced; });
    if (advanced.length) {
      var details = el("details", "advanced");
      details.appendChild(el("summary", null, "Advanced"));
      appendGroups(details, advanced);
      // Open when an advanced setting holds an unsaved change, so it is never hidden.
      details.open = advanced.some(function (it) { return !same(draft[it.key], base[it.key]); });
      main.appendChild(details);
    }
    if (!items.length) main.appendChild(el("div", "empty", "Nothing to set here yet."));
  }

  function renderSearch() {
    var head = el("div", "section-head");
    head.appendChild(el("h1", null, "Results for “" + search.value.trim() + "”"));
    main.appendChild(head);
    var found = 0;
    UI.sections.forEach(function (sec) {
      var hits = settingsIn(sec.id).filter(function (it) { return matchesQuery(it.key, it.s, query); });
      if (!hits.length) return;
      found += hits.length;
      var wrap = el("section", "group");
      wrap.appendChild(el("h2", "group-title", sec.label));
      var body = el("div", "group-body");
      hits.forEach(function (it) { body.appendChild(settingRow(it.key, it.s)); });
      wrap.appendChild(body);
      main.appendChild(wrap);
    });
    if (!found) main.appendChild(el("div", "empty", "No settings match “" + search.value.trim() + "”. Try another word."));
  }

  function renderOverview() {
    var head = el("div", "section-head");
    head.appendChild(el("h1", null, "Overview"));
    head.appendChild(el("p", null, "Connection, unsaved changes and quick access."));
    main.appendChild(head);
    var grid = el("div", "cards overview-cards");

    var connCard = el("section", "card");
    connCard.appendChild(el("h2", null, "TV connection"));
    connCard.appendChild(el("div", "big", base ? "Connected" : "Not connected"));
    connCard.appendChild(el("p", null, base
      ? "Revision " + revision + (lastSaved ? " · last saved " + lastSaved.toLocaleTimeString() : "")
      : "Pair this browser to read and change settings."));
    if (base) {
      var reload = button("Reload from TV", "btn", reloadFromTv);
      reload.id = "reloadBtn";
      var actions = el("div", "card-actions");
      actions.appendChild(reload);
      connCard.appendChild(actions);
    }
    grid.appendChild(connCard);

    var changed = dirtyKeys();
    var changesCard = el("section", "card");
    changesCard.appendChild(el("h2", null, "Unsaved changes"));
    changesCard.appendChild(el("div", "big", String(changed.length)));
    if (changed.length) {
      var list = el("ul", "change-list");
      changed.forEach(function (key) {
        var li = el("li");
        li.appendChild(el("span", null, labelOf(key)));
        li.appendChild(el("span", "change-values", formatValue(key, base[key]) + " → " + formatValue(key, draft[key])));
        list.appendChild(li);
      });
      changesCard.appendChild(list);
    } else {
      changesCard.appendChild(el("p", null, "Everything matches the TV."));
    }
    grid.appendChild(changesCard);

    var jump = el("section", "card");
    jump.appendChild(el("h2", null, "Jump to"));
    var jumpWrap = el("div", "jump");
    UI.sections.forEach(function (sec) {
      jumpWrap.appendChild(button(sec.label, "btn", function () { selectSection(sec.id); }));
    });
    jump.appendChild(jumpWrap);
    grid.appendChild(jump);

    var browser = el("section", "card");
    browser.appendChild(el("h2", null, "This browser"));
    browser.appendChild(el("p", null, "Forgetting removes the pairing from this browser only. Other browsers stay paired, and this one will need the TV code again."));
    var forget = button("Forget this browser", "btn danger", function () {
      var dialog = $("forgetDialog");
      if (dialog && dialog.showModal) dialog.showModal();
      else if (window.confirm("Forget this browser? You will need the code from the TV to pair again.")) confirmForget();
    });
    forget.id = "forgetBtn";
    var fa = el("div", "card-actions");
    fa.appendChild(forget);
    browser.appendChild(fa);
    grid.appendChild(browser);

    main.appendChild(grid);
    main.appendChild(toolsSection());
  }

  function toolsSection() {
    var wrap = el("section", "group");
    wrap.appendChild(el("h2", "group-title", "Tools"));
    var cards = el("div", "cards");

    var launchCard = el("section", "card");
    launchCard.appendChild(el("h2", null, "Launch mode"));
    launchCard.appendChild(el("p", null, "Start YouTube under the debugger. The TV app exits and restarts, which takes a few seconds. Needs developer mode with developer IP 127.0.0.1. Off: YouTube opens at once through the proxy."));
    var line = el("label", "checkline");
    var box = el("input");
    box.type = "checkbox";
    box.id = "launchDebugger";
    box.addEventListener("change", function () { launch.draft = box.checked; renderLaunchUi(); });
    line.appendChild(box);
    line.appendChild(el("span", null, "Start under the debugger"));
    launchCard.appendChild(line);
    var launchNote = el("p", "muted");
    launchNote.id = "launchNote";
    launchCard.appendChild(launchNote);
    var launchSave = button("Save launch mode", "btn primary", saveLaunch);
    launchSave.id = "launchSave";
    launchSave.disabled = true;
    var la = el("div", "card-actions");
    la.appendChild(launchSave);
    launchCard.appendChild(la);
    cards.appendChild(launchCard);

    var diagCard = el("section", "card");
    diagCard.appendChild(el("h2", null, "Diagnostics"));
    var summary = el("p", null, "Loading…");
    summary.id = "diagSummary";
    diagCard.appendChild(summary);
    var logBox = el("pre", "log");
    logBox.id = "diagLog";
    diagCard.appendChild(logBox);
    var da = el("div", "card-actions");
    var refresh = button("Refresh", "btn", loadDiagnostics);
    refresh.id = "diagRefresh";
    var copy = button("Copy", "btn", copyDiagnostics);
    copy.id = "diagCopy";
    da.appendChild(refresh);
    da.appendChild(copy);
    diagCard.appendChild(da);
    cards.appendChild(diagCard);

    var defCard = el("section", "card");
    defCard.appendChild(el("h2", null, "Defaults"));
    defCard.appendChild(el("p", null, "Restore every setting to its default. This changes the form only. Save to apply it."));
    var defActions = el("div", "card-actions");
    var defBtn = button("Restore defaults", "btn", restoreDefaults);
    defBtn.id = "defaultsBtn";
    defActions.appendChild(defBtn);
    defCard.appendChild(defActions);
    cards.appendChild(defCard);

    wrap.appendChild(cards);
    return wrap;
  }

  function renderMain() {
    rows = [];
    main.textContent = "";
    if (!base || !draft || !UI) return;
    if (conflicts && conflicts.length) main.appendChild(conflictsPanel());
    if (query) renderSearch();
    else if (section === "overview") renderOverview();
    else renderSection(section);
    // Tools panels are in the DOM now, so fill them from the last known state.
    renderLaunchUi();
    renderDiagnosticsUi();
  }

  function renderNav() {
    nav.textContent = "";
    if (!UI) return;
    var items = [{ id: "overview", label: "Overview" }];
    UI.sections.forEach(function (sec) { items.push({ id: sec.id, label: sec.label }); });
    // Wide screens: a sidebar of buttons. Narrow screens: one select, as on the phone design.
    var picker = el("select", "section-select");
    picker.id = "sectionSelect";
    picker.setAttribute("aria-label", "Settings section");
    items.forEach(function (item) {
      var count = item.id === "overview" ? 0 : dirtyIn(item.id);
      var b = el("button", "nav-item");
      b.type = "button";
      b.setAttribute("data-section", item.id);
      b.appendChild(el("span", null, item.label));
      if (count) b.appendChild(el("span", "nav-count", count + " changed"));
      if (item.id === section && !query) b.setAttribute("aria-current", "page");
      b.addEventListener("click", function () { selectSection(item.id); });
      nav.appendChild(b);

      var option = el("option", null, count ? item.label + " (" + count + " changed)" : item.label);
      option.value = item.id;
      option.selected = item.id === section;
      picker.appendChild(option);
    });
    picker.addEventListener("change", function () { selectSection(picker.value); });
    nav.appendChild(picker);
  }

  function selectSection(id) {
    section = id;
    query = "";
    search.value = "";
    refreshAll();
    main.focus();
    window.scrollTo(0, 0);
  }

  function updateSaveBar() {
    var visible = !app.hidden && !!base && !!draft;
    if (!visible) { saveBar.hidden = true; return; }
    var n = dirtyKeys().length;
    var open = hasOpenConflict();
    var errors = Object.keys(fieldErrors).length;
    saveBar.hidden = !(n || conflicts);
    saveCount.textContent = conflicts
      ? "Settings changed on the TV"
      : (n === 1 ? "1 unsaved change" : n + " unsaved changes");
    saveHint.textContent = open
      ? "Choose a value for each conflicting setting."
      : errors
        ? "Fix the highlighted settings to save."
        : "Your changes stay here until you save them.";
    saveBtn.disabled = saving || open || errors > 0 || !n;
    saveBtn.textContent = saving ? "Saving…" : "Save changes";
    discardBtn.disabled = saving || !(n || conflicts);
  }

  // Full rebuild: nav, content and save bar. Used after anything that changes the
  // draft behind the controls' backs (load, save, discard, defaults, undo).
  function refreshAll() {
    renderNav();
    renderMain();
    updateSaveBar();
  }

  // Light update after a single control changed: keeps focus where it is.
  function afterChange() {
    syncRows();
    renderNav();
    updateSaveBar();
    if (section === "overview" && !query) renderMain();
  }

  // ---- startup -------------------------------------------------------------

  function bindEvents() {
    pairing.addEventListener("submit", function (e) { e.preventDefault(); pair(); });
    pairCode.addEventListener("input", function () { pairError(""); syncSlots(); });
    $("forgetCancel").addEventListener("click", function () { $("forgetDialog").close(); });
    $("forgetConfirm").addEventListener("click", confirmForget);
    saveBtn.addEventListener("click", save);
    discardBtn.addEventListener("click", discardChanges);
    $("restartBtn").addEventListener("click", restartYouTube);
    $("restartDismiss").addEventListener("click", function () { restartBar.hidden = true; });
    search.addEventListener("input", function () {
      query = search.value.trim().toLowerCase();
      refreshAll();
    });
    document.addEventListener("keydown", function (e) {
      var typing = /^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || "");
      if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        save();
        return;
      }
      if (e.key === "/" && !typing && !app.hidden) {
        e.preventDefault();
        search.focus();
      }
    });
    window.addEventListener("beforeunload", function (e) {
      if (token && base && dirtyKeys().length) {
        var message = "You have unsaved changes.";
        e.returnValue = message;
        return message;
      }
      return undefined;
    });
  }

  function boot() {
    if (!SCHEMA.defaults) { window.axotubeAssetError(); return; }
    bindEvents();
    loadUi().then(function (ui) {
      UI = ui;
      if (!autoPairFromLink()) load();
    }).catch(function () {
      window.axotubeAssetError();
    });
  }

  // Test hook: the merge rule and config normalisation are checked directly.
  window.axotubeConfigInternals = { mergeConfigs: mergeConfigs, fullConfig: fullConfig };

  boot();
})();
