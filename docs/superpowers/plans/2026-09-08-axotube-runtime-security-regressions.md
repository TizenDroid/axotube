# axotube Runtime, Security, and Regression Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all verified audit defects while preserving every existing axotube feature and adding regression/release gates.

**Architecture:** Keep the existing module structure. Add only small shared helpers where multiple modules need identical readiness/config/proxy rules, otherwise make minimal changes in-place. Security changes preserve DIAL, loopback TV sync, phone control, and the standalone proxy’s required Google/YouTube routes.

**Tech Stack:** JavaScript/ES modules, Node.js, Rollup, Express, Tizen Web APIs, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-08-axotube-runtime-security-regressions-design.md`

## Global Constraints
- Do not remove or disable AdBlock, SponsorBlock, DeArrow, HQ thumbnails, PiP, player controls, casting, phone control, themes, queueing, settings, or updater functionality.
- Preserve existing defaults and UX unless correcting a verified defect.
- Keep Tizen/Cobalt compatibility and current build targets.
- Write the regression before the corresponding production fix when practical.
- Never package stale production bundles.

---

### Task 1: Regression harness and feature-preservation baseline
**Files:** Create `tests/regressions.test.cjs`; modify `package.json`; create `.github/workflows/ci.yml`.
- [ ] Add Node built-in tests that assert the current defaults retain AdBlock/SponsorBlock/DeArrow/HQ features.
- [ ] Add deterministic source/runtime fixtures for the audit failures.
- [ ] Point `npm test` at the committed suite.
- [ ] Add CI running `npm ci`, tests, mods/service builds, and standalone build.

### Task 2: Runtime readiness and startup
**Files:** Modify `mods/features/userAgentSpoofing.js`, `mods/features/castReceiver.js`, `mods/features/enableFeatures.js`, `mods/ui/ytUI.js`, `mods/ui/ui.js`, `mods/features/autoFrameRate.js`.
- [ ] Pin UA repeated reload, late resolver/map readiness, duplicate dispatch, Reduced Motion scope, dimming cleanup, and AFR leave-watch behaviour.
- [ ] Implement minimum fixes and re-run regression suite.

### Task 3: Player lifecycle features
**Files:** Modify `mods/features/sponsorblock.js`, `mods/features/pictureInPicture.js`, `mods/features/preferredVideoQuality.js`, `mods/ui/speedUI.js`, `mods/ui/customUI.js`.
- [ ] Pin direct-watch SponsorBlock startup, seek-into-segment, pause/resume scheduling, late PiP services, Auto quality release, replacement-player speed/quality attachment, and custom-UI patch ownership.
- [ ] Implement fixes without changing feature policy/categories/buttons.

### Task 4: Content transformation correctness
**Files:** Modify `mods/ui/customGuideAction.js`, `mods/shared/hqThumbnails.js`, `mods/features/deArrow.js`, `mods/features/longPressMenu.js`, `mods/features/videoPreviews.js`, `mods/features/hideWatchedVideos.js`, `mods/features/videoQueuing.js`.
- [ ] Pin mixed-guide JSON safety, concurrent HQ probe fan-out, timestamp zero, duplicate queue ids, disabled long-press behaviour, video-only previews, and browse-id parsing.
- [ ] Bound session caches and implement narrow fixes.

### Task 5: Config and UI state integrity
**Files:** Modify `mods/config.js`, `mods/resolveCommand.js`, `mods/ui/disableWhosWatching.js`, `mods/ui/theme.js`, `service/webConfigPage.js`.
- [ ] Validate saved/written config against defaults; recover malformed config without `localStorage.clear()`.
- [ ] Normalize `launchToOnStartup` handling.
- [ ] Fix theme preset mapping and expensive unrelated theme refreshes.
- [ ] Clean Who's Watching intervals when settings change.
- [ ] Render/filter web-config values without raw untrusted HTML interpolation.

### Task 6: Phone control and service security
**Files:** Modify `service/service.js`, `mods/features/webConfig.js`, `service/webConfigPage.js`.
- [ ] Replace single command slot with id-based FIFO queue + ack.
- [ ] Decouple config/command/now-playing request locks.
- [ ] Add persisted pairing token for LAN API, preserving automatic loopback TV calls and public DIAL routes.
- [ ] Validate config and command payloads before storage.
- [ ] Make config persistence atomic.

### Task 7: Standalone proxy and startup hardening
**Files:** Modify `standalone/service/index.js`, `standalone/index.html`.
- [ ] Allow only current required Google/YouTube CORS-bypass targets; reject private/arbitrary/credential URLs.
- [ ] Strip sensitive headers where not required and scope rewrite rules to trusted targets.
- [ ] Guard Tizen key registration and encode appended cast args safely.
- [ ] Keep loopback-only proxy binding.

### Task 8: Updater and release integrity
**Files:** Modify `mods/features/updater.js`, `scripts/build-standalone.js`, `scripts/package-wgt.ps1`, `standalone/config.xml`, `standalone/service/package.json`, `package.json`.
- [ ] Use semantic version comparison and handle absent release asset/architecture safely.
- [ ] Always rebuild current mods/service before standalone copy/package.
- [ ] Make WGT packaging run test + fresh standalone build.
- [ ] Synchronize version metadata.

### Task 9: Final verification and PR
**Files:** All changed files.
- [ ] Run/observe CI tests and builds.
- [ ] Review diff specifically for feature removals/default changes.
- [ ] Verify main remains unchanged.
- [ ] Open a draft PR from `fix/runtime-security-regressions` to `main` with audit-to-fix mapping and known device-runtime limitations.
