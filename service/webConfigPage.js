const configSchema = require("../config-schema.json");
const embeddedSchema = JSON.stringify(configSchema).replace(/</g, "\\u003c");

module.exports.webConfigPage = `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>axotube Web Config</title>
<style>
  :root { color-scheme: dark; font-family: Arial, sans-serif; background:#0f0f0f; color:#eee; }
  body { margin:0; }
  header { position:sticky; top:0; z-index:10; background:#141414; padding:16px 20px; border-bottom:1px solid #333; display:flex; gap:12px; align-items:center; justify-content:space-between; flex-wrap:wrap; }
  h1 { font-size:20px; margin:0; }
  button,input,select,textarea { font:inherit; }
  button { padding:8px 12px; border-radius:6px; border:1px solid #555; background:#272727; color:#fff; cursor:pointer; }
  button.primary { background:#fff; color:#111; }
  input,select,textarea { background:#1d1d1d; color:#fff; border:1px solid #555; border-radius:6px; padding:7px 8px; }
  input[type=checkbox] { width:20px; height:20px; }
  input[type=color] { width:48px; height:34px; padding:2px; }
  input[type=range] { width:180px; }
  textarea { min-width:280px; min-height:54px; }
  .toolbar,.pairing { display:flex; gap:8px; flex-wrap:wrap; padding:12px 20px; align-items:center; }
  .pairing { background:#171717; border-bottom:1px solid #333; }
  .pairing.hidden { display:none; }
  .hint { padding:0 20px; color:#aaa; font-size:12px; }
  main { padding:8px 20px 40px; max-width:1050px; margin:auto; }
  .group { margin-top:20px; color:#aaa; text-transform:uppercase; font-size:12px; letter-spacing:.06em; border-bottom:1px solid #333; padding-bottom:5px; }
  .row { display:flex; align-items:center; gap:12px; padding:10px 8px; border-bottom:1px solid #282828; }
  .key { flex:1; min-width:220px; word-break:break-word; }
  .ctrl { display:flex; align-items:center; gap:7px; flex-wrap:wrap; justify-content:flex-end; }
  .status { font-size:13px; color:#aaa; }
  .status.ok { color:#8fd694; }
  .status.err { color:#ff8c8c; }
  .preview { width:80px; height:45px; object-fit:cover; border-radius:4px; border:1px solid #555; }
  .swatch { width:22px; height:22px; padding:0; border-radius:50%; }
  #filter { flex:1; min-width:200px; }
  .toast { position:fixed; right:18px; bottom:18px; background:#222; border:1px solid #555; padding:10px 14px; border-radius:7px; display:none; }
  .toast.show { display:block; }
</style>
</head>
<body>
<header><h1>axotube Web Config</h1><span id="status" class="status">pairing required</span></header>
<div id="pairing" class="pairing">
  <strong>Pair with TV:</strong>
  <input id="pairCode" inputmode="numeric" maxlength="6" placeholder="6-digit code" />
  <button id="pairBtn" class="primary">Pair</button>
  <span>Code is shown on the TV when axotube connects.</span>
</div>
<div class="toolbar">
  <input type="search" id="filter" placeholder="Filter settings..." />
  <button id="saveBtn" class="primary">Save to TV</button>
  <button id="saveReloadBtn">Save & Reload TV</button>
  <button id="refreshBtn">Reload from TV</button>
  <button id="defaultsBtn">Reset to defaults</button>
</div>
<p class="hint">Settings are stored on the TV and applied live where supported.</p>
<main id="main"></main>
<div id="toast" class="toast"></div>
<script>
(function () {
  "use strict";
  var SCHEMA = ${embeddedSchema};
  var DEFAULTS = SCHEMA.defaults;
  var GROUPS = {
    enableAdBlock:"AdBlock",
    enableSponsorBlock:"SponsorBlock", enableSponsorBlockToasts:"SponsorBlock", sponsorBlockManualSkips:"SponsorBlock",
    enableSponsorBlockSponsor:"SponsorBlock", enableSponsorBlockIntro:"SponsorBlock", enableSponsorBlockOutro:"SponsorBlock",
    enableSponsorBlockInteraction:"SponsorBlock", enableSponsorBlockSelfPromo:"SponsorBlock", enableSponsorBlockPreview:"SponsorBlock",
    enableSponsorBlockMusicOfftopic:"SponsorBlock", enableSponsorBlockFiller:"SponsorBlock", enableSponsorBlockHighlight:"SponsorBlock",
    videoSpeed:"Player", preferredVideoQuality:"Player", videoPreferredCodec:"Player", enablePreviousNextButtons:"Player",
    enableSuperThanksButton:"Player", enableSpeedControlsButton:"Player", enablePatchingVideoPlayer:"Player", enableMPButton:"Player",
    enableSwapMPWithPIP:"Player", enablePreviews:"Player", autoFrameRate:"Player", autoFrameRatePauseVideoFor:"Player",
    enableDeArrowTitles:"Player", enableDeArrowThumbnails:"Player",
    routeColor:"Theme", routeBackgroundUrl:"Theme", themePreset:"Theme", textTheme:"Theme",
    enableHqThumbnails:"Interface", enableLongPress:"Interface", enableShorts:"Interface", enableReducedMotion:"Interface",
    enableHideWatchedVideos:"Interface", hideWatchedVideosThreshold:"Interface", hideWatchedVideosPages:"Interface",
    enableHideEndScreenCards:"Interface", enableYouThereRenderer:"Interface", enableScreenDimming:"Interface",
    dimmingTimeout:"Interface", dimmingOpacity:"Interface", enablePaidPromotionOverlay:"Interface",
    enableWhoIsWatchingMenu:"Interface", permanentlyEnableWhoIsWatchingMenu:"Interface", enableWhosWatchingMenuOnAppExit:"Interface",
    enableShowUserLanguage:"Interface", enableShowOtherLanguages:"Interface", showWelcomeToast:"Interface",
    launchToOnStartup:"Interface", reloadHomeOnStartup:"Interface", disabledSidebarContents:"Interface", disableChannelsOnSidebar:"Interface",
    dontCheckUpdateUntil:"System", enableUpdater:"System", enableSigninReminder:"System", sortSubscriptionsByAlphabet:"System"
  };
  var ARRAY_KEYS = { sponsorBlockManualSkips:true, hideWatchedVideosPages:true, disabledSidebarContents:true };
  var state = {};
  var revision = 0;
  var token = localStorage.getItem("axotube-pair-token") || "";
  var main = document.getElementById("main");
  var filter = document.getElementById("filter");
  var status = document.getElementById("status");
  var pairing = document.getElementById("pairing");
  var toast = document.getElementById("toast");

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function setStatus(ok, text) { status.textContent = text; status.className = "status " + (ok ? "ok" : "err"); }
  function flash(text) { toast.textContent = text; toast.className = "toast show"; setTimeout(function(){ toast.className = "toast"; }, 2200); }
  function setPaired(paired) { pairing.className = paired ? "pairing hidden" : "pairing"; }

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
        try { data = text ? JSON.parse(text) : {}; } catch (e) {}
        if (!res.ok) {
          var err = new Error(data.error || ("HTTP " + res.status));
          err.status = res.status;
          throw err;
        }
        return data;
      });
    });
  }

  function pair() {
    var code = document.getElementById("pairCode").value.trim();
    if (!/^\\d{6}$/.test(code)) { flash("Enter the 6-digit TV code"); return; }
    request("/api/pair", "POST", { code: code }, false).then(function (data) {
      if (!data.token) throw new Error("No token returned");
      token = data.token;
      localStorage.setItem("axotube-pair-token", token);
      document.getElementById("pairCode").value = "";
      setPaired(true);
      flash("Paired");
      load();
    }).catch(function (err) { setStatus(false, err.message || "Pairing failed"); });
  }

  function load() {
    if (!token) { setPaired(false); setStatus(false, "pairing required"); main.textContent = ""; return; }
    setStatus(false, "loading...");
    request("/api/config").then(function (data) {
      revision = data.revision || 0;
      var cfg = data.config && Object.keys(data.config).length ? data.config : DEFAULTS;
      state = clone(DEFAULTS);
      Object.keys(DEFAULTS).forEach(function (key) {
        if (Object.prototype.hasOwnProperty.call(cfg, key)) state[key] = clone(cfg[key]);
      });
      setPaired(true);
      setStatus(true, "connected · revision " + revision);
      render();
    }).catch(function (err) {
      if (err.status === 401) {
        token = "";
        localStorage.removeItem("axotube-pair-token");
        setPaired(false);
        setStatus(false, "pairing required");
      } else setStatus(false, err.message || "service unreachable");
    });
  }

  function addText(parent, tag, className, text) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    el.textContent = text;
    parent.appendChild(el);
    return el;
  }

  function makeInputFor(key, row) {
    var value = state[key];
    var ctrl = document.createElement("div");
    ctrl.className = "ctrl";
    row.appendChild(ctrl);

    if (key === "routeColor") {
      var color = document.createElement("input"); color.type = "color"; color.value = value; ctrl.appendChild(color);
      color.addEventListener("change", function(){ state[key] = color.value; });
      Object.keys(SCHEMA.themePresetColors).forEach(function (name) {
        var swatch = document.createElement("button"); swatch.type = "button"; swatch.className = "swatch";
        swatch.title = name; swatch.style.backgroundColor = SCHEMA.themePresetColors[name]; ctrl.appendChild(swatch);
        swatch.addEventListener("click", function(){ state.routeColor = SCHEMA.themePresetColors[name]; state.themePreset = name; color.value = state.routeColor; });
      });
      return;
    }

    if (key === "routeBackgroundUrl") {
      var url = document.createElement("input"); url.type = "url"; url.value = value || ""; url.size = 36; ctrl.appendChild(url);
      var img = document.createElement("img"); img.className = "preview"; ctrl.appendChild(img);
      function preview(){ if (url.value) { img.src = url.value; img.style.display = "block"; } else { img.removeAttribute("src"); img.style.display = "none"; } }
      url.addEventListener("change", function(){ state[key] = url.value.trim(); preview(); }); preview(); return;
    }

    if (SCHEMA.enums[key]) {
      var select = document.createElement("select");
      SCHEMA.enums[key].forEach(function (option) { var o=document.createElement("option"); o.value=option; o.textContent=option; if (String(option)===String(value)) o.selected=true; select.appendChild(o); });
      ctrl.appendChild(select);
      select.addEventListener("change", function(){ state[key]=select.value; if (key === "themePreset" && SCHEMA.themePresetColors[select.value]) state.routeColor=SCHEMA.themePresetColors[select.value]; });
      return;
    }

    if (SCHEMA.ranges[key]) {
      var range = document.createElement("input"); range.type="range"; range.min=SCHEMA.ranges[key][0]; range.max=SCHEMA.ranges[key][1]; range.step=(key==="dimmingOpacity"?0.1:(key==="videoSpeed"?0.05:1)); range.value=value; ctrl.appendChild(range);
      var label = addText(ctrl,"span","",String(value));
      range.addEventListener("input", function(){ state[key]=Number(range.value); label.textContent=range.value; });
      return;
    }

    if (ARRAY_KEYS[key]) {
      var arr = document.createElement("input"); arr.type="text"; arr.size=34; arr.value=Array.isArray(value)?value.join(", "):""; ctrl.appendChild(arr);
      arr.addEventListener("change", function(){ state[key]=arr.value.split(",").map(function(v){return v.trim();}).filter(Boolean); }); return;
    }

    if (key === "launchToOnStartup") {
      var area = document.createElement("textarea"); area.value=value || ""; ctrl.appendChild(area);
      area.addEventListener("change", function(){ var v=area.value.trim(); if (!v) { state[key]=null; return; } try { JSON.parse(v); state[key]=v; } catch(e){ flash("Launch command must be valid JSON"); area.value=state[key]||""; } }); return;
    }

    if (typeof value === "boolean") {
      var check = document.createElement("input"); check.type="checkbox"; check.checked=value; ctrl.appendChild(check); check.addEventListener("change", function(){ state[key]=check.checked; }); return;
    }

    if (typeof value === "number") {
      var num = document.createElement("input"); num.type="number"; num.value=value; num.step="any"; ctrl.appendChild(num); num.addEventListener("change", function(){ var n=Number(num.value); if (Number.isFinite(n)) state[key]=n; }); return;
    }

    var text = document.createElement("input"); text.type="text"; text.size=30; text.value=value == null ? "" : String(value); ctrl.appendChild(text); text.addEventListener("change", function(){ state[key]=text.value; });
  }

  function render() {
    main.textContent = "";
    var q = filter.value.trim().toLowerCase();
    var lastGroup = "";
    var shown = 0;
    Object.keys(DEFAULTS).forEach(function (key) {
      if (q && key.toLowerCase().indexOf(q) === -1) return;
      var group = GROUPS[key] || "General";
      if (group !== lastGroup) { addText(main,"div","group",group); lastGroup=group; }
      var row=document.createElement("div"); row.className="row"; main.appendChild(row); addText(row,"div","key",key); makeInputFor(key,row); shown++;
    });
    if (!shown) addText(main,"div","hint","No settings match \"" + q + "\".");
  }

  function save(reload) {
    request("/api/config","POST",state).then(function(data){ revision=data.revision; setStatus(true,"connected · revision " + revision); if (!reload) { flash("Saved"); return; } return request("/api/command","POST",{action:"reload"}).then(function(){ flash("Saved · TV reloading"); }); }).catch(function(err){ flash("Save failed: " + (err.message || "unknown")); });
  }

  document.getElementById("pairBtn").addEventListener("click", pair);
  document.getElementById("pairCode").addEventListener("keydown", function(e){ if(e.key==="Enter") pair(); });
  document.getElementById("saveBtn").addEventListener("click", function(){ save(false); });
  document.getElementById("saveReloadBtn").addEventListener("click", function(){ save(true); });
  document.getElementById("refreshBtn").addEventListener("click", load);
  document.getElementById("defaultsBtn").addEventListener("click", function(){ state=clone(DEFAULTS); render(); flash("Defaults loaded · press Save"); });
  filter.addEventListener("input", render);
  load();
})();
</script>
</body>
</html>`;
